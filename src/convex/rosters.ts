import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

const entryValidator = v.object({ date: v.string(), officeStaff: v.string(), fieldStaff: v.array(v.string()) });

export const findBySourceHash = internalQuery({
  args: { sourceHash: v.string() },
  handler: async (ctx, { sourceHash }) => await ctx.db.query("rosters").withIndex("by_source_hash", (q) => q.eq("sourceHash", sourceHash)).first(),
});

export const insertDraft = internalMutation({
  args: { storageId: v.id("_storage"), fileName: v.string(), effectiveStart: v.string(), effectiveEnd: v.string(), uploadedBy: v.string(), sourceHash: v.optional(v.string()), importIssues: v.optional(v.array(v.string())), entries: v.optional(v.array(entryValidator)) },
  handler: async (ctx, args) => {
    if (args.sourceHash) {
      const duplicate = await ctx.db.query("rosters").withIndex("by_source_hash", (q) => q.eq("sourceHash", args.sourceHash!)).first();
      if (duplicate) throw new ConvexError("This exact workbook has already been imported. Review its existing roster entry instead.");
    }
    return await ctx.db.insert("rosters", { ...args, entries: args.entries ?? [], status: "draft", uploadedAt: Date.now() });
  },
});

export const adminList = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("rosters").collect();
    return await Promise.all(rows.sort((a, b) => b.uploadedAt - a.uploadedAt).map(async (row) => ({ ...row, originalUrl: await ctx.storage.getUrl(row.storageId) })));
  },
});

export const activePersonnel = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("vaccinationRecords").withIndex("by_status", (q) => q.eq("status", "valid")).collect();
    const people = new Map<string, string>();
    for (const row of rows) if (row.isPpr && /\bvfa\b/i.test(row.designation ?? "") && row.vaccinator?.trim()) people.set(row.vaccinator.trim().toLowerCase().replace(/\s+/g, " "), row.vaccinator.trim());
    return [...people.values()].sort((a, b) => a.localeCompare(b));
  },
});

export const getRoster = internalQuery({ args: { rosterId: v.id("rosters") }, handler: async (ctx, { rosterId }) => await ctx.db.get(rosterId) });

export const publishedOverlaps = internalQuery({
  args: { start: v.string(), end: v.string() },
  handler: async (ctx, { start, end }) => (await ctx.db.query("rosters").withIndex("by_status", (q) => q.eq("status", "published")).collect()).filter((row) => row.effectiveStart <= end && row.effectiveEnd >= start).map(({ _id }) => ({ _id })),
});

function validateRosterEntries(roster: { effectiveStart: string; effectiveEnd: string }, entries: Array<{ date: string; officeStaff: string; fieldStaff: string[] }>) {
  if (!entries.length) throw new ConvexError("Enter daily assignments before publishing.");
  const dates = new Set<string>();
  const expectedDates: string[] = [];
  const cursor = new Date(`${roster.effectiveStart}T12:00:00Z`);
  const end = new Date(`${roster.effectiveEnd}T12:00:00Z`);
  while (cursor <= end && expectedDates.length <= 370) {
    expectedDates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (!expectedDates.length || expectedDates.length > 370) throw new ConvexError("Effective roster period must contain 1–370 calendar days.");
  for (const entry of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || entry.date < roster.effectiveStart || entry.date > roster.effectiveEnd) throw new ConvexError(`Date ${entry.date} is outside the effective range.`);
    if (dates.has(entry.date)) throw new ConvexError(`Duplicate roster date: ${entry.date}.`);
    dates.add(entry.date);
    const staff = [entry.officeStaff, ...entry.fieldStaff].map((name) => name.trim());
    const normalize = (name: string) => name.toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
    if (!staff[0] || entry.fieldStaff.length !== 3 || new Set(staff.map(normalize)).size !== 4) throw new ConvexError(`${entry.date} must have exactly one office VFA and three distinct field VFAs.`);
  }
  for (const date of expectedDates) if (!dates.has(date)) throw new ConvexError(`Missing daily duty assignment for ${date}.`);
}

export const publishInternal = internalMutation({
  args: { rosterId: v.id("rosters"), entries: v.array(entryValidator), replacedId: v.optional(v.id("rosters")), publishedBy: v.string() },
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster || roster.status !== "draft") throw new ConvexError("Select an uploaded draft roster.");
    validateRosterEntries(roster, args.entries);
    const overlaps = (await ctx.db.query("rosters").withIndex("by_status", (q) => q.eq("status", "published")).collect()).filter((row) => row.effectiveStart <= roster.effectiveEnd && row.effectiveEnd >= roster.effectiveStart);
    if (overlaps.some((row) => row._id !== args.replacedId) || (args.replacedId && !overlaps.some((row) => row._id === args.replacedId))) throw new ConvexError("A roster already covers this period. Explicitly select the published version to replace it.");
    if (args.replacedId) await ctx.db.patch(args.replacedId, { status: "archived", archivedAt: Date.now(), archivedBy: args.publishedBy });
    await ctx.db.patch(args.rosterId, { entries: args.entries, status: "published", publishedAt: Date.now(), publishedBy: args.publishedBy });
  },
});

export const archiveInternal = internalMutation({
  args: { rosterId: v.id("rosters"), archivedBy: v.string() },
  handler: async (ctx, { rosterId, archivedBy }) => { const row = await ctx.db.get(rosterId); if (!row) throw new ConvexError("Roster not found."); await ctx.db.patch(rosterId, { status: "archived", archivedAt: Date.now(), archivedBy }); },
});

export const publicToday = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const row = (await ctx.db.query("rosters").withIndex("by_status", (q) => q.eq("status", "published")).collect()).find((item) => item.effectiveStart <= date && item.effectiveEnd >= date);
    if (!row) return null;
    return { rosterId: row._id, fileName: row.fileName, date, entry: row.entries.find((entry) => entry.date === date) ?? null, originalUrl: await ctx.storage.getUrl(row.storageId) };
  },
});

export const publicPublished = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("rosters").withIndex("by_status", (q) => q.eq("status", "published")).collect();
    return await Promise.all(rows.map(async (row) => ({
      rosterId: row._id,
      fileName: row.fileName,
      effectiveStart: row.effectiveStart,
      effectiveEnd: row.effectiveEnd,
      entries: row.entries,
      originalUrl: await ctx.storage.getUrl(row.storageId),
    })));
  },
});

export const publicRoster = query({
  args: { rosterId: v.id("rosters") },
  handler: async (ctx, { rosterId }) => { const row = await ctx.db.get(rosterId); if (!row || row.status !== "published") return null; return { rosterId: row._id, fileName: row.fileName, effectiveStart: row.effectiveStart, effectiveEnd: row.effectiveEnd, entries: row.entries, originalUrl: await ctx.storage.getUrl(row.storageId) }; },
});