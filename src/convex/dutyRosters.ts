"use node";

import { ConvexError, v } from "convex/values";
import { createHash } from "node:crypto";
import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizeName } from "./lib/villageMatch";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const entryValidator = v.object({ date: v.string(), officeStaff: v.string(), fieldStaff: v.array(v.string()) });
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
async function requireRosterAdmin(ctx: ActionCtx, token: string): Promise<{ username: string }> {
  if (!token) throw new ConvexError("SESSION_EXPIRED: Please sign in as administrator.");
  const session: { username: string } | null = await ctx.runQuery(internal.admin.getSession, { tokenHash: hashToken(token) });
  if (!session) throw new ConvexError("SESSION_EXPIRED: Your administrator session has expired.");
  return session;
}

export const createUploadUrl = action({
  args: { token: v.string(), sourceHash: v.optional(v.string()) },
  handler: async (ctx, { token, sourceHash }): Promise<string> => {
    await requireRosterAdmin(ctx, token);
    if (sourceHash && await ctx.runQuery(internal.rosters.findBySourceHash, { sourceHash })) throw new ConvexError("This exact workbook has already been imported. Review its existing roster entry instead.");
    return await ctx.storage.generateUploadUrl();
  },
});

export const createDraft = action({
  args: { token: v.string(), storageId: v.id("_storage"), fileName: v.string(), effectiveStart: v.string(), effectiveEnd: v.string(), entries: v.optional(v.array(entryValidator)), sourceHash: v.optional(v.string()), importIssues: v.optional(v.array(v.string())) },
  handler:  async (ctx, args): Promise<{ rosterId: Id<"rosters">; storageUrl: string }> => {
    const admin = await requireRosterAdmin(ctx, args.token);
    const extension = args.fileName.toLowerCase().split(".").pop();
    if (!extension || !["pdf", "xlsx", "xls"].includes(extension)) throw new ConvexError("Upload must be a PDF, .xlsx, or .xls file.");
    if (args.sourceHash && await ctx.runQuery(internal.rosters.findBySourceHash, { sourceHash: args.sourceHash })) throw new ConvexError("This exact workbook has already been imported. Review its existing roster entry instead.");
    if (!datePattern.test(args.effectiveStart) || !datePattern.test(args.effectiveEnd) || args.effectiveStart > args.effectiveEnd) throw new ConvexError("Select a valid effective date range.");
    for (const entry of args.entries ?? []) {
      if (entry.date && (!datePattern.test(entry.date) || entry.date < args.effectiveStart || entry.date > args.effectiveEnd)) throw new ConvexError("Extracted assignment has a date outside the effective range.");
    }
    const expected = new Set<string>();
    const cursor = new Date(`${args.effectiveStart}T12:00:00Z`);
    const last = new Date(`${args.effectiveEnd}T12:00:00Z`);
    while (cursor <= last && expected.size < 371) { expected.add(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    if (expected.size > 370) throw new ConvexError("Effective roster period must contain 1–370 calendar days.");
    if (args.sourceHash && (args.entries ?? []).length) {
      for (const date of expected) if (!(args.entries ?? []).some((entry) => entry.date === date)) throw new ConvexError(`Missing daily review row for ${date}.`);
    }
    const storageUrl = await ctx.storage.getUrl(args.storageId);
    if (!storageUrl) throw new ConvexError("Uploaded roster file could not be found.");
    const rosterId: Id<"rosters"> = await ctx.runMutation(internal.rosters.insertDraft, { storageId: args.storageId, fileName: args.fileName, effectiveStart: args.effectiveStart, effectiveEnd: args.effectiveEnd, uploadedBy: admin.username, sourceHash: args.sourceHash, importIssues: args.importIssues, entries: args.entries ?? [] });
    return { rosterId, storageUrl };
  },
});

export const list = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<Array<Doc<"rosters"> & { originalUrl: string | null }>> => { await requireRosterAdmin(ctx, token); return await ctx.runQuery(internal.rosters.adminList, {}); },
});

export const personnel = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<string[]> => { await requireRosterAdmin(ctx, token); return await ctx.runQuery(internal.rosters.activePersonnel, {}); },
});

export const publish = action({
  args: { token: v.string(), rosterId: v.id("rosters"), entries: v.array(entryValidator), replacePublishedId: v.optional(v.id("rosters")) },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const admin = await requireRosterAdmin(ctx, args.token);
    const roster = await ctx.runQuery(internal.rosters.getRoster, { rosterId: args.rosterId });
    if (!roster || roster.status !== "draft") throw new ConvexError("Select an uploaded draft roster.");
    if (!args.entries.length) throw new ConvexError("Enter daily assignments before publishing.");
    const activePeople = await ctx.runQuery(internal.rosters.activePersonnel, {});
    const active = new Set(activePeople.map(normalizeName));
    const dates = new Set<string>();
    const expectedDates = new Set<string>();
    const cursor = new Date(`${roster.effectiveStart}T12:00:00Z`);
    const last = new Date(`${roster.effectiveEnd}T12:00:00Z`);
    while (cursor <= last && expectedDates.size <= 370) { expectedDates.add(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    if (!expectedDates.size || expectedDates.size > 370) throw new ConvexError("Effective roster period must contain 1–370 calendar days.");
    for (const entry of args.entries) {
      if (!datePattern.test(entry.date) || entry.date < roster.effectiveStart || entry.date > roster.effectiveEnd) throw new ConvexError(`Date ${entry.date} is outside the effective range.`);
      if (dates.has(entry.date)) throw new ConvexError(`Duplicate roster date: ${entry.date}.`);
      dates.add(entry.date);
      const assigned = [entry.officeStaff, ...entry.fieldStaff].map((name) => name.trim());
      if (!entry.officeStaff.trim() || entry.fieldStaff.length !== 3 || new Set(assigned.map(normalizeName)).size !== 4) throw new ConvexError(`${entry.date} must have exactly one office VFA and three distinct field VFAs.`);
      for (const name of assigned) if (!active.has(normalizeName(name))) throw new ConvexError(`${name} is not in the active personnel records.`);
    }
    for (const date of expectedDates) if (!dates.has(date)) throw new ConvexError(`Missing daily duty assignment for ${date}.`);
    await ctx.runMutation(internal.rosters.publishInternal, { rosterId: args.rosterId, entries: args.entries, replacedId: args.replacePublishedId, publishedBy: admin.username });
    return { ok: true };
  },
});

export const forcePublish = action({
  args: { token: v.string(), rosterId: v.id("rosters"), confirmedReplaceIds: v.array(v.id("rosters")) },
  handler: async (ctx, args): Promise<{
    fileName: string;
    effectiveStart: string;
    effectiveEnd: string;
    dateCount: number;
    superseded: Array<{ rosterId: Id<"rosters">; fileName: string; effectiveStart: string; effectiveEnd: string }>;
    alreadyPublished: boolean;
  }> => {
    const admin = await requireRosterAdmin(ctx, args.token);
    return await ctx.runMutation(internal.rosters.forcePublishInternal, {
      rosterId: args.rosterId,
      confirmedReplaceIds: args.confirmedReplaceIds,
      publishedBy: admin.username,
    });
  },
});

export const archive = action({
  args: { token: v.string(), rosterId: v.id("rosters") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => { const admin = await requireRosterAdmin(ctx, args.token); await ctx.runMutation(internal.rosters.archiveInternal, { rosterId: args.rosterId, archivedBy: admin.username }); return { ok: true }; },
});

export const remove = action({
  args: { token: v.string(), rosterId: v.id("rosters") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const admin = await requireRosterAdmin(ctx, args.token);
    await ctx.runMutation(internal.rosters.deleteRosterInternal, { rosterId: args.rosterId, deletedBy: admin.username });
    return { ok: true };
  },
});