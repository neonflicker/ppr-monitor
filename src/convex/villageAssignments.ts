import { v } from "convex/values";
import { normalizeName, normalizeVillage } from "./lib/villageMatch";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";

async function loadVfas(ctx: QueryCtx) {
  const rows = await ctx.db.query("vaccinationRecords").withIndex("by_status", (q) => q.eq("status", "valid")).collect();
  const vfas = new Map<string, string>();
  for (const row of rows) {
    if (row.isPpr && row.vaccinator && /\bvfa\b/i.test(row.designation ?? "")) {
      const name = row.vaccinator.trim();
      if (name) vfas.set(normalizeName(name), name);
    }
  }
  return vfas;
}

export async function resolveAssignments(ctx: QueryCtx, villages: string[]) {
  const keys = [...new Set(villages.map(normalizeVillage).filter(Boolean))];    const vfas = await loadVfas(ctx);
    const savedRows = await ctx.db.query("villageVfaAssignments").collect();
  const saved = new Map<string, string[]>();
  for (const row of savedRows) {
    const key = normalizeVillage(row.village);
    if (key) saved.set(key, row.vfaNames);
  }
  const upload = await ctx.db.query("allocationUploads").withIndex("by_status", (q) => q.eq("status", "active")).unique();
  const allocationRows = upload
    ? (await ctx.db.query("allocations").withIndex("by_upload", (q) => q.eq("uploadId", upload._id)).collect()).filter((row) => row.active)
    : [];
  const candidates = new Map<string, Set<string>>();
  for (const row of allocationRows) {
    const staff = vfas.get(normalizeName(row.userName));
    if (!staff) continue;
    const names = candidates.get(row.normalizedVillage) ?? new Set<string>();
    names.add(staff);
    candidates.set(row.normalizedVillage, names);
  }
  const result: Record<string, string> = {};
  for (const key of keys) {      const names = saved.has(key) ? saved.get(key)! : [...(candidates.get(key) ?? [])];
    const valid = [...new Set(names.map((name) => vfas.get(normalizeName(name))).filter((name): name is string => !!name))];
    result[key] = valid.length === 1 ? valid[0] : valid.length > 1 ? "Assignment Ambiguous — Admin review" : "Not Assigned";
  }
  return result;
}

export const activeVfas = internalQuery({
  args: {},
  handler: async (ctx) => [...(await loadVfas(ctx)).values()],
});

export const assignmentOptions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const vfas = await loadVfas(ctx);
    const upload = await ctx.db.query("allocationUploads").withIndex("by_status", (q) => q.eq("status", "active")).unique();
    const allocations = upload
      ? (await ctx.db.query("allocations").withIndex("by_upload", (q) => q.eq("uploadId", upload._id)).collect()).filter((row) => row.active)
      : [];
    const savedRows = await ctx.db.query("villageVfaAssignments").collect();
    const byVillage = new Map<string, { village: string; candidates: Set<string>; assigned: string[] }>();
    for (const row of allocations) {
      const entry = byVillage.get(row.normalizedVillage) ?? { village: row.village, candidates: new Set<string>(), assigned: [] };
      const person = vfas.get(normalizeName(row.userName));
      if (person) entry.candidates.add(person);
      byVillage.set(row.normalizedVillage, entry);
    }
    for (const row of savedRows) {
      const entry = byVillage.get(row.normalizedVillage) ?? { village: row.village, candidates: new Set<string>(), assigned: [] };
      entry.assigned = row.vfaNames;
      byVillage.set(row.normalizedVillage, entry);
    }
    return {
      staff: [...vfas.values()].sort((a, b) => a.localeCompare(b)),
      rows: [...byVillage.entries()].map(([normalizedVillage, row]) => ({ village: row.village, normalizedVillage, candidates: [...row.candidates], assigned: row.assigned })).sort((a, b) => a.village.localeCompare(b.village)),
    };
  },
});

export const resolveForRequests = internalQuery({
  args: { villages: v.array(v.string()) },
  handler: async (ctx, { villages }) => resolveAssignments(ctx, villages),
});

export const saveInternal = internalMutation({
  args: { village: v.string(), normalizedVillage: v.string(), vfaNames: v.array(v.string()), updatedBy: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("villageVfaAssignments").withIndex("by_village", (q) => q.eq("normalizedVillage", args.normalizedVillage)).unique();
    if (existing) await ctx.db.patch(existing._id, { village: args.village, vfaNames: args.vfaNames, updatedAt: Date.now(), updatedBy: args.updatedBy });
    else await ctx.db.insert("villageVfaAssignments", { ...args, updatedAt: Date.now() });
  },
});