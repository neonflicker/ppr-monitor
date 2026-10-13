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

export const saveDraftInternal = internalMutation({
  args: { rosterId: v.id("rosters"), effectiveStart: v.string(), effectiveEnd: v.string(), entries: v.array(entryValidator), importIssues: v.array(v.string()) },
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster || roster.status !== "draft") throw new ConvexError("Select an uploaded draft roster.");
    const validDate = (value: string) => {
      const date = new Date(`${value}T12:00:00Z`);
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!validDate(args.effectiveStart) || !validDate(args.effectiveEnd) || args.effectiveStart > args.effectiveEnd) throw new ConvexError("Select a valid effective date range.");
    const expected = new Set<string>();
    const cursor = new Date(`${args.effectiveStart}T12:00:00Z`);
    const end = new Date(`${args.effectiveEnd}T12:00:00Z`);
    while (cursor <= end && expected.size <= 370) { expected.add(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    if (!expected.size || expected.size > 370) throw new ConvexError("Effective roster period must contain 1–370 calendar days.");
    const seen = new Set<string>();
    for (const entry of args.entries) {
      const date = new Date(`${entry.date}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== entry.date || entry.date < args.effectiveStart || entry.date > args.effectiveEnd) throw new ConvexError(`Date ${entry.date} is outside the effective range or invalid.`);
      if (seen.has(entry.date)) throw new ConvexError(`Duplicate roster date: ${entry.date}.`);
      seen.add(entry.date);
    }
    for (const date of expected) if (!seen.has(date)) throw new ConvexError(`Missing daily duty assignment for ${date}.`);
    await ctx.db.patch(args.rosterId, { effectiveStart: args.effectiveStart, effectiveEnd: args.effectiveEnd, entries: args.entries, importIssues: args.importIssues });
  },
});

export const publishInternal = internalMutation({
  args: { rosterId: v.id("rosters"), effectiveStart: v.string(), effectiveEnd: v.string(), entries: v.array(entryValidator), replacedId: v.optional(v.id("rosters")), publishedBy: v.string() },
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster || roster.status !== "draft") throw new ConvexError("Select an uploaded draft roster.");
    const effectiveRoster = { ...roster, effectiveStart: args.effectiveStart, effectiveEnd: args.effectiveEnd };
    validateRosterEntries(effectiveRoster, args.entries);
    const overlaps = (await ctx.db.query("rosters").withIndex("by_status", (q) => q.eq("status", "published")).collect()).filter((row) => row.effectiveStart <= args.effectiveEnd && row.effectiveEnd >= args.effectiveStart);
    if (overlaps.some((row) => row._id !== args.replacedId) || (args.replacedId && !overlaps.some((row) => row._id === args.replacedId))) throw new ConvexError("A roster already covers this period. Explicitly select the published version to replace it.");
    if (args.replacedId) await ctx.db.patch(args.replacedId, { status: "archived", archivedAt: Date.now(), archivedBy: args.publishedBy });
    await ctx.db.patch(args.rosterId, { effectiveStart: args.effectiveStart, effectiveEnd: args.effectiveEnd, entries: args.entries, status: "published", publishedAt: Date.now(), publishedBy: args.publishedBy });
  },
});

export const forcePublishInternal = internalMutation({
  args: {
    rosterId: v.id("rosters"),
    confirmedReplaceIds: v.array(v.id("rosters")),
    publishedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const roster = await ctx.db.get(args.rosterId);
    if (!roster) throw new ConvexError("The selected roster no longer exists.");
    if (roster.status === "published") {
      return {
        fileName: roster.fileName,
        effectiveStart: roster.effectiveStart,
        effectiveEnd: roster.effectiveEnd,
        dateCount: new Set(roster.entries.map((entry) => entry.date)).size,
        superseded: [],
        alreadyPublished: true,
      };
    }
    if (roster.status !== "draft") throw new ConvexError("Only a draft roster can be force-published.");
    if (!roster.entries.length) throw new ConvexError("This draft has no imported daily assignments to publish.");

    // Keep only structural checks needed for public date lookup. Names and field
    // assignment counts are deliberately not normalized or matched to personnel.
    const seenDates = new Set<string>();
    for (const entry of roster.entries) {
      const parsedDate = new Date(`${entry.date}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== entry.date) {
        throw new ConvexError(`Cannot publish invalid assignment date “${entry.date}”.`);
      }
      if (entry.date < roster.effectiveStart || entry.date > roster.effectiveEnd) {
        throw new ConvexError(`Assignment date ${entry.date} is outside the effective period ${roster.effectiveStart} to ${roster.effectiveEnd}.`);
      }
      if (seenDates.has(entry.date)) throw new ConvexError(`Cannot publish duplicate assignment date ${entry.date}; resolve the source row ambiguity first.`);
      seenDates.add(entry.date);
    }

    const overlaps = (await ctx.db.query("rosters").withIndex("by_status", (q) => q.eq("status", "published")).collect())
      .filter((row) => row.effectiveStart <= roster.effectiveEnd && row.effectiveEnd >= roster.effectiveStart)
      .sort((a, b) => a._id.localeCompare(b._id));
    const confirmed = [...args.confirmedReplaceIds].sort((a, b) => a.localeCompare(b));
    if (overlaps.length !== confirmed.length || overlaps.some((row, index) => row._id !== confirmed[index])) {
      throw new ConvexError("Published rosters covering this period changed. Review the overlaps and confirm publication again.");
    }

    const publishedAt = Date.now();
    await ctx.db.patch(roster._id, { status: "published", publishedAt, publishedBy: args.publishedBy });
    await ctx.db.insert("auditLog", {
      action: "duty_roster_force_published",
      summary: `Force-published duty roster ${roster.fileName} (${seenDates.size} dates, ${roster.effectiveStart} to ${roster.effectiveEnd})${overlaps.length ? `; superseded overlapping coverage from ${overlaps.map((row) => row.fileName).join(", ")}` : ""}`,
      details: JSON.stringify({ rosterId: roster._id, fileName: roster.fileName, effectiveStart: roster.effectiveStart, effectiveEnd: roster.effectiveEnd, publishedAt, publishedBy: args.publishedBy, dates: [...seenDates], superseded: overlaps.map((row) => ({ rosterId: row._id, fileName: row.fileName, effectiveStart: row.effectiveStart, effectiveEnd: row.effectiveEnd })) }),
      at: publishedAt,
      by: args.publishedBy,
    });
    return {
      fileName: roster.fileName,
      effectiveStart: roster.effectiveStart,
      effectiveEnd: roster.effectiveEnd,
      dateCount: seenDates.size,
      superseded: overlaps.map(({ _id, fileName, effectiveStart, effectiveEnd }) => ({ rosterId: _id, fileName, effectiveStart, effectiveEnd })),
      alreadyPublished: false,
    };
  },
});

export const archiveInternal = internalMutation({
  args: { rosterId: v.id("rosters"), archivedBy: v.string() },
  handler: async (ctx, { rosterId, archivedBy }) => { const row = await ctx.db.get(rosterId); if (!row) throw new ConvexError("Roster not found."); await ctx.db.patch(rosterId, { status: "archived", archivedAt: Date.now(), archivedBy }); },
});

export const deleteRosterInternal = internalMutation({
  args: { rosterId: v.id("rosters"), deletedBy: v.string() },
  handler: async (ctx, { rosterId, deletedBy }) => {
    const roster = await ctx.db.get(rosterId);
    if (!roster) throw new ConvexError("This roster was already deleted or no longer exists.");

    const deletedAt = Date.now();
    await ctx.db.delete(rosterId);

    // Keep the original file if any other roster or legacy target version references it.
    const [rosterReferences, targetVersions] = await Promise.all([
      ctx.db.query("rosters").withIndex("by_storage_id", (q) => q.eq("storageId", roster.storageId)).collect(),
      ctx.db.query("targetVersions").collect(),
    ]);
    const isShared = rosterReferences.length > 0 || targetVersions.some((version) => version.storageId === roster.storageId);
    if (!isShared) await ctx.storage.delete(roster.storageId);

    await ctx.db.insert("auditLog", {
      action: "duty_roster_deleted",
      summary: `Deleted duty roster ${roster.fileName} (${roster.effectiveStart} to ${roster.effectiveEnd}, ${roster.status})`,
      details: JSON.stringify({ rosterId, fileName: roster.fileName, effectiveStart: roster.effectiveStart, effectiveEnd: roster.effectiveEnd, status: roster.status, deletedAt }),
      at: deletedAt,
      by: deletedBy,
    });
    return { fileName: roster.fileName, effectiveStart: roster.effectiveStart, effectiveEnd: roster.effectiveEnd, status: roster.status, deletedAt };
  },
});

export const publicToday = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const row = (await ctx.db.query("rosters").withIndex("by_status", (q) => q.eq("status", "published")).collect())
      .filter((item) => item.effectiveStart <= date && item.effectiveEnd >= date && item.entries.some((entry) => entry.date === date))
      .sort((a, b) => (b.publishedAt ?? b._creationTime) - (a.publishedAt ?? a._creationTime))[0];
    if (!row) return null;
    return { rosterId: row._id, fileName: row.fileName, date, entry: row.entries.find((entry) => entry.date === date) ?? null, originalUrl: await ctx.storage.getUrl(row.storageId) };
  },
});

export const publicPublished = query({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db.query("rosters").withIndex("by_status", (q) => q.eq("status", "published")).collect())
      .sort((a, b) => (b.publishedAt ?? b._creationTime) - (a.publishedAt ?? a._creationTime));
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