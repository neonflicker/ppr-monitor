import type { QueryCtx } from "./_generated/server";

/**
 * Lightweight snapshot of the ACTIVE user/village allocation (Excel/CSV
 * import). Read by public queries; writes only happen through the admin
 * import action.
 */
export interface AllocationSummary {
  available: boolean;
  fileName: string | null;
  uploadedAt: number | null;
  users: { key: string; name: string; target: number; villages: string[] }[];
  /** normalised village → total allocated target (all users combined) */
  villageTargets: Record<string, number>;
  /** normalised village → display name */
  villageNames: Record<string, string>;
  /** normalised user → [normalised villages] */
  userVillages: Record<string, string[]>;
  totals: { rows: number; users: number; villages: number; target: number };
}

export async function allocationSummary(
  ctx: QueryCtx,
): Promise<AllocationSummary> {
  const empty: AllocationSummary = {
    available: false,
    fileName: null,
    uploadedAt: null,
    users: [],
    villageTargets: {},
    villageNames: {},
    userVillages: {},
    totals: { rows: 0, users: 0, villages: 0, target: 0 },
  };

  const upload = await ctx.db
    .query("allocationUploads")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .unique();
  if (!upload) return empty;

  const rows = await ctx.db
    .query("allocations")
    .withIndex("by_upload", (q) => q.eq("uploadId", upload._id))
    .collect();
  if (rows.length === 0) return empty;

  const users = new Map<string, { name: string; target: number; villages: Set<string> }>();
  const villageTargets: Record<string, number> = {};
  const villageNames: Record<string, string> = {};
  let totalTarget = 0;

  for (const row of rows) {
    const user = users.get(row.normalizedUser) ?? {
      name: row.userName,
      target: 0,
      villages: new Set<string>(),
    };
    user.target += row.target;
    user.villages.add(row.normalizedVillage);
    users.set(row.normalizedUser, user);

    villageTargets[row.normalizedVillage] =
      (villageTargets[row.normalizedVillage] ?? 0) + row.target;
    villageNames[row.normalizedVillage] = row.village;
    totalTarget += row.target;
  }

  const userVillages: Record<string, string[]> = {};
  const userList: AllocationSummary["users"] = [];
  for (const [key, user] of users) {
    userVillages[key] = [...user.villages];
    userList.push({
      key,
      name: user.name,
      target: user.target,
      villages: [...user.villages],
    });
  }
  userList.sort((a, b) => a.name.localeCompare(b.name));

  return {
    available: true,
    fileName: upload.fileName,
    uploadedAt: upload.uploadedAt,
    users: userList,
    villageTargets,
    villageNames,
    userVillages,
    totals: {
      rows: rows.length,
      users: users.size,
      villages: Object.keys(villageTargets).length,
      target: totalTarget,
    },
  };
}
