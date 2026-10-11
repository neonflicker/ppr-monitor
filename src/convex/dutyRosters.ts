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
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<string> => { await requireRosterAdmin(ctx, token); return await ctx.storage.generateUploadUrl(); },
});

export const createDraft = action({
  args: { token: v.string(), storageId: v.id("_storage"), fileName: v.string(), effectiveStart: v.string(), effectiveEnd: v.string() },
  handler: async (ctx, args): Promise<{ rosterId: Id<"rosters">; storageUrl: string }> => {
    const admin = await requireRosterAdmin(ctx, args.token);
    if (!args.fileName.toLowerCase().endsWith(".pdf")) throw new ConvexError("Upload must be a PDF.");
    if (!datePattern.test(args.effectiveStart) || !datePattern.test(args.effectiveEnd) || args.effectiveStart > args.effectiveEnd) throw new ConvexError("Select a valid effective date range.");
    const storageUrl = await ctx.storage.getUrl(args.storageId);
    if (!storageUrl) throw new ConvexError("Uploaded PDF could not be found.");
    const rosterId: Id<"rosters"> = await ctx.runMutation(internal.rosters.insertDraft, { storageId: args.storageId, fileName: args.fileName, effectiveStart: args.effectiveStart, effectiveEnd: args.effectiveEnd, uploadedBy: admin.username });
    return { rosterId, storageUrl };
  },
});

export const list = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<Array<Doc<"rosters"> & { pdfUrl: string | null }>> => { await requireRosterAdmin(ctx, token); return await ctx.runQuery(internal.rosters.adminList, {}); },
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

export const archive = action({
  args: { token: v.string(), rosterId: v.id("rosters") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => { const admin = await requireRosterAdmin(ctx, args.token); await ctx.runMutation(internal.rosters.archiveInternal, { rosterId: args.rosterId, archivedBy: admin.username }); return { ok: true }; },
});