import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizeVillage } from "./lib/villageMatch";
import { internal } from "./_generated/api";
import { resolveAssignments } from "./villageAssignments";
import { readSettingsDoc } from "./settings";
import { requestSourceId } from "./lib/sheetParser";

const STALE_SYNC_MS = 5 * 60 * 1000;

const rowValidator = v.object({
  externalKey: v.string(),
  naturalKey: v.optional(v.string()),
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
  tagId: v.optional(v.string()),
  goats: v.number(),
  sheep: v.number(),
  unspecified: v.optional(v.number()),
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
  naturalKey?: string;
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
  tagId?: string;
  goats: number;
  sheep: number;
  unspecified?: number;
  taggedGoat: number;
  taggedSheep: number;
  wasted: number;
  farmers: number;
  timestamp?: string;
  email?: string;
  remarks?: string;
};

/** Latest sync run (drives the progress indicator + last-updated display). */
const requestRowValidator = v.object({
  sourceKey: v.string(),
  timestamp: v.string(),
  submittedAt: v.number(),
  requestDate: v.number(),
  fields: v.optional(v.array(v.object({ header: v.string(), value: v.string() }))),
  village: v.string(),
  normalizedVillage: v.string(),
  requestorName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  vaccinationDoneBefore: v.optional(v.string()),
  remarks: v.optional(v.string()),
});

/** Public request rows omit all contact and identity details. */
async function loadPendingRequests(ctx: QueryCtx) {
  const settings = await readSettingsDoc(ctx);
  const requestSource = requestSourceId(settings.requestSheetUrl, settings.requestSheetGid);
  const rows = (await ctx.db.query("vaccinationRequests").withIndex("by_status", (q) => q.eq("status", "pending")).collect())
    .filter((row) => !row.requestSource || row.requestSource === requestSource);
  const assignments = await resolveAssignments(ctx, rows.map((row) => row.village));
  return rows.map(({ _id, timestamp, submittedAt, requestDate, village, fields }) => ({
    _id, timestamp, submittedAt, requestDate, village,
    assignedVfa: assignments[normalizeVillage(village)] ?? "Not Assigned",
    fields,
  })).sort((a, b) => b.submittedAt - a.submittedAt);
}

export const pendingRequests = query({
  args: {},
  handler: async (ctx) => {
    return await loadPendingRequests(ctx);
  },
});

/** Request-specific status follows the active configured spreadsheet + tab. */
export const requestSyncStatus = query({
  args: {},
  handler: async (ctx) => {
    const settings = await readSettingsDoc(ctx);
    const sourceId = requestSourceId(settings.requestSheetUrl, settings.requestSheetGid);
    const latestAttempt = await ctx.db
      .query("sheetSyncs")
      .withIndex("by_request_source_started", (q) => q.eq("requestSource", sourceId))
      .order("desc")
      .first();
    const lastSuccess = await ctx.db
      .query("sheetSyncs")
      .withIndex("by_request_source_finished", (q) => q.eq("requestSource", sourceId))
      .order("desc")
      .first();
    return {
      lastAttempt: latestAttempt
        ? {
            status: latestAttempt.status,
            startedAt: latestAttempt.startedAt,
            finishedAt: latestAttempt.finishedAt,
            error:
              latestAttempt.status === "error" &&
              latestAttempt.requestSyncStartedAt !== undefined &&
              latestAttempt.requestSyncFinishedAt === undefined
                ? latestAttempt.requestSyncError ?? latestAttempt.error
                : undefined,
          }
        : null,
      lastSuccess: lastSuccess?.requestSyncFinishedAt
        ? {
            finishedAt: lastSuccess.requestSyncFinishedAt,
            rowsRetrieved: lastSuccess.requestRowsRetrieved ?? 0,
            deletedPendingRequests: lastSuccess.deletedPendingRequests ?? 0,
          }
        : null,
    };
  },
});

/** Admin-only UI data is still protected by the AdminPanel route; contact
 *  columns are intentionally never included in this projection. */
type CompletedRequestRow = {
  _id: Id<"vaccinationRequests">;
  timestamp: string;
  submittedAt: number;
  requestDate: number;
  village: string;
  requestorName?: string;
  email?: string;
  phone?: string;
  vaccinationDoneBefore?: string;
  remarks?: string;
  fields?: { header: string; value: string }[];
  completedAt?: number;
  completionSource?: string;
  assignedVfa: string;
};

export const getPendingRequests = internalQuery({
  args: {},
  handler: async (ctx) => await loadPendingRequests(ctx),
});

export const getCompletedRequests = internalQuery({
  args: {},
  handler: async (ctx): Promise<CompletedRequestRow[]> => {
    const rows = await ctx.db
      .query("vaccinationRequests")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .collect();
    const completed = rows
      .filter((row) => row.completionSource === COMPLETION_SOURCE)
      .sort((a, b) => b.submittedAt - a.submittedAt);
    const assignments = await resolveAssignments(ctx, completed.map((row) => row.village));
    return completed.map(({ _id, timestamp, submittedAt, requestDate, village, requestorName, email, phone, vaccinationDoneBefore, remarks, fields, completedAt, completionSource }) => ({
      _id, timestamp, submittedAt, requestDate, village,
      assignedVfa: assignments[normalizeVillage(village)] ?? "Not Assigned",
      requestorName, email, phone, vaccinationDoneBefore, remarks, fields, completedAt, completionSource,
    }));
  },
});

const COMPLETION_SOURCE = "Vaccination submission — village completion reported YES";

/** Atomically upsert the validated full response snapshot and reconcile only
 *  pending requests owned by this exact spreadsheet + worksheet. Completed
 *  rows are retained as audit history, including when their source row vanishes. */
export const syncVaccinationRequests = internalMutation({
  args: {
    syncId: v.id("sheetSyncs"),
    requestSource: v.string(),
    rows: v.array(requestRowValidator),
    totalRows: v.number(),
  },
  handler: async (ctx, { syncId, requestSource, rows, totalRows }) => {
    const now = Date.now();
    const seenKeys = new Set<string>();
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const sourceKey = `${requestSource}::${row.sourceKey}`;
      seenKeys.add(sourceKey);
      let existing = await ctx.db
        .query("vaccinationRequests")
        .withIndex("by_source_key", (q) => q.eq("sourceKey", sourceKey))
        .first();
      // One-time compatibility migration: older versions stored only the
      // response timestamp. The app had a single configured request sheet, so
      // an untagged timestamp match is legacy data from that source.
      if (!existing) {
        const legacy = await ctx.db
          .query("vaccinationRequests")
          .withIndex("by_source_key", (q) => q.eq("sourceKey", row.sourceKey))
          .first();
        if (legacy && !legacy.requestSource) existing = legacy;
      }
      if (!existing) {
        await ctx.db.insert("vaccinationRequests", {
          ...row,
          sourceKey,
          requestSource,
          status: "pending",
          updatedAt: now,
        });
        inserted++;
        continue;
      }
      await ctx.db.patch(existing._id, {
        ...row,
        sourceKey,
        requestSource,
        // Completion survives edited source rows and later synchronizations.
        status: existing.status,
        completedAt: existing.completedAt,
        completionSource: existing.completionSource,
        updatedAt: now,
      });
      updated++;
    }

    const pending = await ctx.db
      .query("vaccinationRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    let deletedPendingRequests = 0;
    for (const request of pending) {
      // Legacy untagged pending rows are attributable to the application's
      // former single configured request-response worksheet.
      if (!request.requestSource) {
        const existingResponse = rows.find((row) => row.sourceKey === request.sourceKey);
        if (existingResponse) {
          await ctx.db.patch(request._id, {
            ...existingResponse,
            sourceKey: `${requestSource}::${request.sourceKey}`,
            requestSource,
            status: "pending",
            updatedAt: now,
          });
          updated++;
          continue;
        }
        await ctx.db.delete(request._id);
        deletedPendingRequests++;
        continue;
      }
      if (request.requestSource !== requestSource || seenKeys.has(request.sourceKey)) continue;
      await ctx.db.delete(request._id);
      deletedPendingRequests++;
    }

    const completed = await ctx.db
      .query("vaccinationRequests")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .collect();
    for (const request of completed) {
      if (request.requestSource && request.requestSource !== requestSource) continue;
      const sourceKey = request.requestSource
        ? request.sourceKey
        : `${requestSource}::${request.sourceKey}`;
      const isPresent = seenKeys.has(sourceKey);
      if (!request.requestSource || (isPresent && request.sourceMissingAt) || (!isPresent && !request.sourceMissingAt)) {
        await ctx.db.patch(request._id, {
          requestSource,
          sourceKey,
          sourceMissingAt: isPresent ? undefined : now,
        });
      }
    }

    await ctx.db.patch(syncId, {
      requestSyncFinishedAt: now,
      requestRowsRetrieved: totalRows,
      deletedPendingRequests,
      requestSyncError: undefined,
    });
    return { inserted, updated, deletedPendingRequests };
  },
});

/** Complete every pending request whose normalized village matches a valid
 *  vaccination-sheet row with YES. Repeated runs preserve the first completion
 *  event and only affect the independent request table. */
export const completeRequestsForVillages = internalMutation({
  args: { villages: v.array(v.object({ village: v.string(), completedAt: v.number() })) },
  handler: async (ctx, { villages }) => {
    const completedAtByVillage = new Map<string, number>();
    for (const row of villages) {
      const normalized = normalizeVillage(row.village);
      if (!normalized) continue;
      completedAtByVillage.set(
        normalized,
        Math.max(completedAtByVillage.get(normalized) ?? 0, row.completedAt),
      );
    }
    if (!completedAtByVillage.size) return { completed: 0 };
    const pending = await ctx.db
      .query("vaccinationRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    let completed = 0;
    for (const request of pending) {
      const requestVillage = normalizeVillage(request.village);
      if (!requestVillage) continue;
      const completedAt = completedAtByVillage.get(requestVillage);
      if (completedAt === undefined) continue;
      await ctx.db.patch(request._id, {
        status: "completed",
        completedAt,
        completionSource: COMPLETION_SOURCE,
        updatedAt: Date.now(),
      });
      completed++;
    }
    return { completed };
  },
});

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
    requestSource: v.string(),
      triggeredBy: v.union(v.literal("manual"), v.literal("auto")),
  },
  handler: async (ctx, { sheetUrl, requestSource, triggeredBy }) => {
    const inFlight = await failStaleRuns(ctx);
    if (inFlight) {
      throw new Error("A Google Sheet sync is already in progress.");
    }
    return await ctx.db.insert("sheetSyncs", {
      status: "running",
      stage: "Connecting to Google Sheets…",
      sheetUrl,
      requestSource,
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

export const markRequestSyncStarted = internalMutation({
  args: { syncId: v.id("sheetSyncs") },
  handler: async (ctx, { syncId }) => {
    const doc = await ctx.db.get(syncId);
    if (doc?.status === "running") {
      await ctx.db.patch(syncId, { requestSyncStartedAt: Date.now() });
    }
  },
});

export const finishError = internalMutation({
  args: {
    syncId: v.id("sheetSyncs"),
    error: v.string(),
    requestSyncError: v.optional(v.string()),
  },
  handler: async (ctx, { syncId, error, requestSyncError }) => {
    const doc = await ctx.db.get(syncId);
    if (!doc) return;
    const now = Date.now();
    await ctx.db.patch(syncId, {
      status: "error",
      stage: "Failed",
      error,
      requestSyncError,
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
      naturalKey: r.naturalKey ?? "",
      source: r.source,
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

/**
 * Remove google_sheet records that no longer exist in the master sheet.
 *
 * Called by the sync action after a fully successful parse. The source
 * provenance is re-checked here so this mutation can NEVER delete a record
 * belonging to another dataset (Bharat Pashudhan, validated imports, …).
 */
export const deleteRecords = internalMutation({
  args: { ids: v.array(v.id("vaccinationRecords")) },
  handler: async (ctx, { ids }) => {
    let deleted = 0;
    for (const id of ids) {
      const doc = await ctx.db.get(id);
      if (!doc || doc.source !== "google_sheet") continue;
      await ctx.db.delete(id);
      deleted++;
    }
    return deleted;
  },
});

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
    deletedRecords: v.optional(v.number()),
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
      deletedRecords: args.deletedRecords,
      invalidReasons: args.invalidReasons,
      mappedColumns: args.mappedColumns,
      unmappedColumns: args.unmappedColumns,
    });
  },
});

export type SyncDoc = Doc<"sheetSyncs">;
