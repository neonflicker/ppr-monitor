import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { normalizeVillage } from "./lib/villageMatch";

/**
 * USER & VILLAGE ALLOCATION — Excel/CSV import data.
 *
 * The allocation file defines USER → ALLOTTED VILLAGE → TARGET. It is TARGET
 * data only: it never contributes to vaccination achievement. The newest
 * confirmed import becomes the ACTIVE allocation dataset; previous imports are
 * superseded (kept for history), and vaccination records are never touched.
 */

/** All allocations of the active dataset, plus per-user / per-village totals. */
export const active = query({
  args: {},
  handler: async (ctx) => {
    const upload = await ctx.db
      .query("allocationUploads")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .unique();
    if (!upload) {
      return {
        upload: null,
        rows: [] as {
          _id: string;
          userName: string;
          village: string;
          target: number;
        }[],
        users: [] as { key: string; name: string; target: number; villages: string[] }[],
        villageTargets: {} as Record<string, number>,
        villageNames: {} as Record<string, string>,
        totals: { rows: 0, users: 0, villages: 0, target: 0 },
      };
    }

    const rows = await ctx.db
      .query("allocations")
      .withIndex("by_upload", (q) => q.eq("uploadId", upload._id))
      .collect();

    const userMap = new Map<string, { name: string; target: number; villages: Set<string> }>();
    const villageMap = new Map<string, { name: string; target: number }>();
    let totalTarget = 0;

    for (const row of rows) {
      const user = userMap.get(row.normalizedUser) ?? {
        name: row.userName,
        target: 0,
        villages: new Set<string>(),
      };
      user.target += row.target;
      user.villages.add(row.normalizedVillage);
      userMap.set(row.normalizedUser, user);

      const village = villageMap.get(row.normalizedVillage) ?? {
        name: row.village,
        target: 0,
      };
      village.target += row.target;
      villageMap.set(row.normalizedVillage, village);

      totalTarget += row.target;
    }

    const users = [...userMap.entries()]
      .map(([key, u]) => ({
        key,
        name: u.name,
        target: u.target,
        villages: [...u.villages],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const villageTargets: Record<string, number> = {};
    const villageNames: Record<string, string> = {};
    for (const [key, v] of villageMap) {
      villageTargets[key] = v.target;
      villageNames[key] = v.name;
    }

    return {
      upload: {
        _id: upload._id,
        fileName: upload.fileName,
        uploadedAt: upload.uploadedAt,
        uploadedBy: upload.uploadedBy,
        totalRows: upload.totalRows,
        validRows: upload.validRows,
        invalidRows: upload.invalidRows,
        userCount: upload.userCount,
        villageCount: upload.villageCount,
        totalTarget: upload.totalTarget,
      },
      rows: rows.map((r) => ({
        _id: r._id,
        userName: r.userName,
        village: r.village,
        target: r.target,
      })),
      users,
      villageTargets,
      villageNames,
      totals: {
        rows: rows.length,
        users: users.length,
        villages: villageMap.size,
        target: totalTarget,
      },
    };
  },
});

/** Import history (all confirmed allocation files, newest first). */
export const history = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("allocationUploads").collect();
    return rows.sort((a, b) => b.uploadedAt - a.uploadedAt);
  },
});

/** All allocation rows of one historical upload (admin inspection). */
export const byUpload = query({
  args: { uploadId: v.id("allocationUploads") },
  handler: async (ctx, { uploadId }) =>
    await ctx.db
      .query("allocations")
      .withIndex("by_upload", (q) => q.eq("uploadId", uploadId))
      .collect(),
});

/* ------------------------------------------------------------------ */
/* Internal mutations (invoked from the admin-verified action)         */
/* ------------------------------------------------------------------ */

export const validRowValidator = v.object({
  userName: v.string(),
  village: v.string(),
  target: v.number(),
});

export const getActiveUploadId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const upload = await ctx.db
      .query("allocationUploads")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .unique();
    return upload?._id ?? null;
  },
});

/**
 * Confirm an allocation import: supersede the previous active dataset, store
 * the new upload record + rows, deactivate the old rows (history preserved —
 * rows are never deleted).
 */
export const confirmImport = internalMutation({
  args: {
    by: v.string(),
    fileName: v.string(),
    totalRows: v.number(),
    validRows: v.number(),
    invalidRows: v.number(),
    errors: v.array(
      v.object({
        row: v.number(),
        userName: v.string(),
        village: v.string(),
        error: v.string(),
      }),
    ),
    rows: v.array(validRowValidator),
  },
  handler: async (ctx, args) => {
    if (args.rows.length === 0) {
      throw new ConvexError(
        "No valid allocation rows to import. Fix the reported row errors and upload again.",
      );
    }

    const now = Date.now();

    // Supersede the previous active upload + deactivate its rows.
    const previous = await ctx.db
      .query("allocationUploads")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .unique();
    if (previous) {
      await ctx.db.patch(previous._id, { status: "superseded" });
      const prevRows = await ctx.db
        .query("allocations")
        .withIndex("by_upload", (q) => q.eq("uploadId", previous._id))
        .collect();
      for (const row of prevRows) {
        if (row.active !== false) {
          await ctx.db.patch(row._id, { active: false });
        }
      }
    }

    const users = new Set<string>();
    const villages = new Set<string>();
    let totalTarget = 0;
    for (const row of args.rows) {
      users.add(row.userName.trim().toLowerCase());
      villages.add(normalizeVillage(row.village));
      totalTarget += row.target;
    }

    const uploadId = await ctx.db.insert("allocationUploads", {
      fileName: args.fileName,
      uploadedAt: now,
      uploadedBy: args.by,
      totalRows: args.totalRows,
      validRows: args.validRows,
      invalidRows: args.invalidRows,
      userCount: users.size,
      villageCount: villages.size,
      totalTarget,
      errors: args.errors,
      status: "active",
    });

    for (const row of args.rows) {
      await ctx.db.insert("allocations", {
        uploadId,
        userName: row.userName,
        normalizedUser: row.userName.trim().toLowerCase(),
        village: row.village,
        normalizedVillage: normalizeVillage(row.village),
        target: row.target,
        active: true,
      });
    }

    await ctx.db.insert("auditLog", {
      action: "allocation.import",
      summary: `Allocation file “${args.fileName}” activated by ${args.by}: ${args.validRows} rows, ${users.size} users, ${villages.size} villages, target ${totalTarget}`,
      details: JSON.stringify({ errors: args.errors.slice(0, 100) }),
      at: now,
      by: args.by,
    });

    return { uploadId, totalTarget, userCount: users.size, villageCount: villages.size };
  },
});
