import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const STALE_SYNC_MS = 5 * 60 * 1000;

const rowValidator = v.object({
  externalKey: v.string(),
  status: v.union(v.literal("valid"), v.literal("rejected")),
  rejectReason: v.optional(v.string()),
  isPpr: v.boolean(),
  rawHash: v.string(),
  date: v.optional(v.number()),
  dateKey: v.optional(v.string()),
  village: v.optional(v.string()),
  vaccinator: v.optional(v.string()),
  designation: v.optional(v.string()),
  vaccinatorId: v.optional(v.string()),
  disease: v.optional(v.string()),
  species: v.optional(v.string()),
  goats: v.number(),
  sheep: v.number(),
  taggedGoat: v.number(),
  taggedSheep: v.number(),
  wasted: v.number(),
  farmers: v.number(),
  timestamp: v.optional(v.string()),
  email: v.optional(v.string()),
  remarks: v.optional(v.string()),
});

type Row = {
  externalKey: string;
  status: "valid" | "rejected";
  rejectReason?: string;
  isPpr: boolean;
  rawHash: string;
  date?: number;
  dateKey?: string;
  village?: string;
  vaccinator?: string;
  designation?: string;
  vaccinatorId?: string;
  disease?: string;
  species?: string;
  goats: number;
  sheep: number;
  taggedGoat: number;
  taggedSheep: number;
  wasted: number;
  farmers: number;
  timestamp?: string;
  email?: string;
  remarks?: string;
};

/** Latest sync run (drives the progress indicator + last-updated display). */
export const latest = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("sheetSyncs").order("desc").first();
  },
});

/** Recent sync history for the admin view. */
export const history = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("sheetSyncs")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 5, 1), 20));
    return rows;
  },
});

async function failStaleRuns(ctx: MutationCtx) {
  const rows = await ctx.db.query("sheetSyncs").order("desc").take(5);
  const now = Date.now();
  let running = false;
  for (const row of rows) {
    if (row.status !== "running") continue;
    if (now - row.startedAt < STALE_SYNC_MS) {
      running = true;
    } else {
      await ctx.db.patch(row._id, {
        status: "error",
        error: "Sync was interrupted before it finished.",
        finishedAt: now,
        durationMs: now - row.startedAt,
      });
    }
  }
  return running;
}

/** Open a new sync run (rejects if one is genuinely still in flight). */
export const beginSync = internalMutation({
  args: {
    sheetUrl: v.string(),
    triggeredBy: v.union(v.literal("manual"), v.literal("auto")),
  },
  handler: async (ctx, { sheetUrl, triggeredBy }) => {
    const inFlight = await failStaleRuns(ctx);
    if (inFlight) {
      throw new Error("A Google Sheet sync is already in progress.");
    }
    return await ctx.db.insert("sheetSyncs", {
      status: "running",
      stage: "Connecting to Google Sheets…",
      sheetUrl,
      triggeredBy,
      startedAt: Date.now(),
    });
  },
});

export const setStage = internalMutation({
  args: { syncId: v.id("sheetSyncs"), stage: v.string() },
  handler: async (ctx, { syncId, stage }) => {
    const doc = await ctx.db.get(syncId);
    if (doc && doc.status === "running") {
      await ctx.db.patch(syncId, { stage });
    }
  },
});

export const finishError = internalMutation({
  args: { syncId: v.id("sheetSyncs"), error: v.string() },
  handler: async (ctx, { syncId, error }) => {
    const doc = await ctx.db.get(syncId);
    if (!doc) return;
    const now = Date.now();
    await ctx.db.patch(syncId, {
      status: "error",
      stage: "Failed",
      error,
      finishedAt: now,
      durationMs: now - doc.startedAt,
    });
  },
});

/** All known record keys + hashes, so the action can diff against the sheet. */
export const getExisting = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("vaccinationRecords").collect();
    return rows.map((r) => ({
      id: r._id,
      externalKey: r.externalKey,
      rawHash: r.rawHash,
      status: r.status,
    }));
  },
});

async function insertRows(ctx: MutationCtx, rows: Row[]) {
  const now = Date.now();
  let inserted = 0;
  for (const row of rows) {
    await ctx.db.insert("vaccinationRecords", {
      source: "google_sheet",
      updatedAt: now,
      ...row,
    });
    inserted++;
  }
  return inserted;
}

async function updateRows(
  ctx: MutationCtx,
  rows: { id: Id<"vaccinationRecords">; row: Row }[],
) {
  const now = Date.now();
  let updated = 0;
  for (const { id, row } of rows) {
    const doc = await ctx.db.get(id);
    if (!doc) continue;
    await ctx.db.patch(id, { ...row, updatedAt: now });
    updated++;
  }
  return updated;
}

/** Apply a chunk of new/changed records (called repeatedly by the sync action). */
export const applyBatch = internalMutation({
  args: {
    inserts: v.array(rowValidator),
    updates: v.array(
      v.object({ id: v.id("vaccinationRecords"), row: rowValidator }),
    ),
  },
  handler: async (ctx, { inserts, updates }) => {
    const inserted = await insertRows(ctx, inserts);
    const updated = await updateRows(ctx, updates);
    return { inserted, updated };
  },
});

export const finishSync = internalMutation({
  args: {
    syncId: v.id("sheetSyncs"),
    recordsRetrieved: v.number(),
    validRecords: v.number(),
    duplicateRows: v.number(),
    newRecords: v.number(),
    updatedRecords: v.number(),
    unchangedRecords: v.number(),
    rejectedRecords: v.number(),
    invalidReasons: v.array(
      v.object({ reason: v.string(), count: v.number() }),
    ),
    mappedColumns: v.array(v.string()),
    unmappedColumns: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.syncId);
    if (!doc) return;
    const now = Date.now();
    await ctx.db.patch(args.syncId, {
      status: "done",
      stage: "Complete",
      finishedAt: now,
      durationMs: now - doc.startedAt,
      recordsRetrieved: args.recordsRetrieved,
      validRecords: args.validRecords,
      duplicateRows: args.duplicateRows,
      newRecords: args.newRecords,
      updatedRecords: args.updatedRecords,
      unchangedRecords: args.unchangedRecords,
      rejectedRecords: args.rejectedRecords,
      invalidReasons: args.invalidReasons,
      mappedColumns: args.mappedColumns,
      unmappedColumns: args.unmappedColumns,
    });
  },
});

export type SyncDoc = Doc<"sheetSyncs">;
