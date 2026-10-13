"use node";

import { ConvexError, v } from "convex/values";
import { createHash } from "node:crypto";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import {
  buildCsvUrl,
  diffSheetRecords,
  parseSheet,
  parseVaccinationRequests,
  requestSourceId,
} from "./lib/sheetParser";
import { normalizeVillage } from "./lib/villageMatch";

const SESSION_EXPIRED = "SESSION_EXPIRED:";
const AUTO_SYNC_MIN_MS = 5 * 60 * 1000;
// Short cooldown: long enough to stop anonymous visitors from hammering the
// Google export endpoint, short enough that a human pressing Refresh after
// editing the sheet actually gets fresh data (was 15 minutes, which made the
// button look like it silently did nothing).
const PUBLIC_SYNC_COOLDOWN_MS = 60 * 1000;
// Background cron guard: skip when a sync finished moments ago or is running.
const CRON_MIN_GAP_MS = 90 * 1000;
const CRON_ERROR_BACKOFF_MS = 2 * 60 * 1000;
const STALE_RUNNING_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_SHEET_BYTES = 25 * 1024 * 1024;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

async function requireAdmin(
  ctx: ActionCtx,
  token: string,
): Promise<{ username: string; displayName: string }> {
  if (!token) {
    throw new ConvexError(`${SESSION_EXPIRED} Please sign in as administrator.`);
  }
  const session: {
    username: string;
    displayName: string;
  } | null = await ctx.runQuery(internal.admin.getSession, {
    tokenHash: sha256(token),
  });
  if (!session) {
    throw new ConvexError(
      `${SESSION_EXPIRED} Your administrator session has expired. Please sign in again.`,
    );
  }
  return session;
}

async function fetchCsv(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/csv,text/plain,*/*" },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new ConvexError(
          "Google denied access to the sheet. Share it as “Anyone with the link → Viewer” and try again.",
        );
      }
      if (res.status === 404) {
        throw new ConvexError(
          "Google Sheet not found. Check the sheet URL in Settings.",
        );
      }
      if (res.status === 429) {
        throw new ConvexError(
          "Google Sheets rate-limited the request. Wait a minute and sync again.",
        );
      }
      throw new ConvexError(`Google Sheets returned HTTP ${res.status}.`);
    }

    const finalUrl = res.url || url;
    if (
      finalUrl.includes("ServiceLogin") ||
      finalUrl.includes("accounts.google.com")
    ) {
      throw new ConvexError(
        "Google asked for sign-in, so the sheet is private. Share it as “Anyone with the link → Viewer”.",
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (text.length > MAX_SHEET_BYTES) {
      throw new ConvexError(
        "The sheet is larger than 25 MB. Split the history into another sheet or trim old rows.",
      );
    }
    if (contentType.includes("text/html")) {
      throw new ConvexError(
        "Google returned a web page instead of data. Make sure the link is a Google Sheet shared as “Anyone with the link → Viewer”.",
      );
    }
    if (text.trim() === "") {
      throw new ConvexError("The Google Sheet appears to be empty.");
    }
    return text;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new ConvexError(
        "Google Sheets did not respond within 30 seconds. Try syncing again.",
      );
    }
    if (err instanceof Error) throw err;
    throw new ConvexError(String(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the CURRENT PPR Google Sheet, diff it against the stored records and
 * reconcile: new rows are inserted, edited rows update in place, and rows
 * deleted from the sheet are removed. Existing rows are never re-counted and
 * running it twice with no sheet change is a no-op (idempotent).
 */
export type SyncSummary = {
  skipped?: boolean;
  ok?: boolean;
  triggeredBy?: string;
  triggeredByUser?: string;
  durationMs?: number;
  recordsRetrieved?: number;
  validRecords?: number;
  duplicateRows?: number;
  newRecords?: number;
  updatedRecords?: number;
  unchangedRecords?: number;
  rejectedRecords?: number;
  deletedRecords?: number;
  invalidReasons?: { reason: string; count: number }[];
};

export const syncNow = action({
  args: {
    token: v.string(),
    triggeredBy: v.optional(
      v.union(v.literal("manual"), v.literal("auto")),
    ),
  },
  handler: async (
    ctx,
    { token, triggeredBy },
  ): Promise<SyncSummary> => {
    const admin = await requireAdmin(ctx, token);
    const mode = triggeredBy ?? "manual";
    if (mode === "auto") {
      const last = await ctx.runQuery(api.sync.latest, {});
      if (
        last &&
        last.status === "done" &&
        last.finishedAt &&
        Date.now() - last.finishedAt < AUTO_SYNC_MIN_MS
      ) {
        return { skipped: true as const };
      }
    }
    return await performSync(ctx, mode, admin.username);
  },
});

/**
 * PUBLIC refresh: keeps the dashboard current without a login, but is
 * rate-limited server-side (only runs when the last sync is stale) so
 * anonymous visitors cannot hammer Google Sheets.
 */
export const publicRefresh = action({
  args: {},
  handler: async (ctx): Promise<SyncSummary> => {
    const latest = await ctx.runQuery(api.sync.latest, {});
    const now = Date.now();
    if (latest) {
      if (
        latest.status === "running" &&
        now - latest.startedAt < AUTO_SYNC_MIN_MS
      ) {
        return { skipped: true as const };
      }
      if (
        latest.status === "done" &&
        latest.finishedAt &&
        now - latest.finishedAt < PUBLIC_SYNC_COOLDOWN_MS
      ) {
        return { skipped: true as const };
      }
      if (
        latest.status === "error" &&
        latest.finishedAt &&
        now - latest.finishedAt < 2 * 60 * 1000
      ) {
        return { skipped: true as const };
      }
    }
    return await performSync(ctx, "auto", "public");
  },
});

/**
 * SCHEDULED SYNC (crons.ts): runs every couple of minutes so the dashboard is
 * near-real-time without anyone opening a page. Self-throttles so overlapping
 * ticks and rapid repeat runs are no-ops.
 */
export const cronSync = internalAction({
  args: {},
  handler: async (ctx): Promise<SyncSummary> => {
    const latest = await ctx.runQuery(api.sync.latest, {});
    const now = Date.now();
    if (latest) {
      if (
        latest.status === "running" &&
        now - latest.startedAt < STALE_RUNNING_MS
      ) {
        return { skipped: true as const };
      }
      if (
        latest.status === "done" &&
        latest.finishedAt &&
        now - latest.finishedAt < CRON_MIN_GAP_MS
      ) {
        return { skipped: true as const };
      }
      if (
        latest.status === "error" &&
        latest.finishedAt &&
        now - latest.finishedAt < CRON_ERROR_BACKOFF_MS
      ) {
        return { skipped: true as const };
      }
    }
    return await performSync(ctx, "auto", "cron");
  },
});

/** Core sync routine shared by the admin action and the public refresh. */
async function performSync(
  ctx: ActionCtx,
  mode: "manual" | "auto",
  by: string,
): Promise<SyncSummary> {
    const settings = await ctx.runQuery(internal.settings.getRaw, {});
    const syncId = await ctx.runMutation(internal.sync.beginSync, {
      sheetUrl: settings.sheetUrl,
      requestSource: requestSourceId(settings.requestSheetUrl, settings.requestSheetGid),
      triggeredBy: mode,
    });

    const startedAt = Date.now();
    let requestSyncStarted = false;
    try {
      await ctx.runMutation(internal.sync.setStage, {
        syncId,
        stage: "Fetching the Google Sheet…",
      });
      const csvUrl = buildCsvUrl(settings.sheetUrl, settings.sheetGid);
      const text = await fetchCsv(csvUrl);

      await ctx.runMutation(internal.sync.setStage, {
        syncId,
        stage: "Reading columns and validating rows…",
      });
      const parsed = parseSheet(text, settings.pprValues);
      if (parsed.fatal) {
        throw new ConvexError(parsed.fatal);
      }
      if (!parsed.completionQuestionFound) {
        throw new ConvexError(
          'The vaccination sheet is missing the exact "Is vaccination completed in the village?" column; requests were not changed.',
        );
      }

      // Request response reconciliation is separate from vaccination-record
      // diff/deletion and never contributes to achievement counts.
      requestSyncStarted = true;
      await ctx.runMutation(internal.sync.markRequestSyncStarted, { syncId });
      const requestCsv = await fetchCsv(
        buildCsvUrl(settings.requestSheetUrl, settings.requestSheetGid),
      );
      const requestParse = parseVaccinationRequests(requestCsv);
      if (requestParse.fatal) throw new ConvexError(requestParse.fatal);
      const requestSyncRows = requestParse.records.map((row) => ({
        ...row,
        // Preserve the request as submitted, but completion matching will skip
        // villages that normalize to an empty key.
        normalizedVillage: normalizeVillage(row.village),
      }));

      await ctx.runMutation(internal.sync.setStage, {
        syncId,
        stage: "Matching against stored records…",
      });
      const existing: Array<{
        id: string;
        externalKey: string;
        naturalKey?: string;
        source: string;
        rawHash: string;
        status: "valid" | "rejected";
      }> = await ctx.runQuery(internal.sync.getExisting, {});

      // Deterministic diff of the CURRENT sheet rows vs the stored records
      // (pure + idempotent, unit-tested): inserts, in-place updates, and the
      // google_sheet rows that vanished from the sheet.
      const diff = diffSheetRecords(
        parsed,
        existing.map((row) => ({ ...row, id: row.id as string })),
      );

      let newRecords = 0;
      let updatedRecords = 0;
      if (diff.inserts.length > 0 || diff.updates.length > 0) {
        await ctx.runMutation(internal.sync.setStage, {
          syncId,
          stage: `Importing ${diff.inserts.length} new and ${diff.updates.length} updated records…`,
        });
        for (let i = 0; i < diff.inserts.length; i += BATCH_SIZE) {
          const result = await ctx.runMutation(internal.sync.applyBatch, {
            inserts: diff.inserts.slice(i, i + BATCH_SIZE),
            updates: [],
          });
          newRecords += result.inserted;
        }
        for (let i = 0; i < diff.updates.length; i += BATCH_SIZE) {
          const result = await ctx.runMutation(internal.sync.applyBatch, {
            inserts: [],
            updates: diff.updates
              .slice(i, i + BATCH_SIZE)
              .map(({ id, row }) => ({
                id: id as Id<"vaccinationRecords">,
                row,
              })),
          });
          updatedRecords += result.updated;
        }
      }

      // Reconciliation (§Issue 2): the sheet is authoritative for its own
      // records. Remove google_sheet rows that no longer exist upstream.
      // Only reached after a fully successful parse, and deleteRecords
      // re-checks provenance, so other datasets are never touched.
      let deletedRecords = 0;
      if (diff.deletions.length > 0) {
        await ctx.runMutation(internal.sync.setStage, {
          syncId,
          stage: `Removing ${diff.deletions.length} records deleted from the sheet…`,
        });
        for (let i = 0; i < diff.deletions.length; i += BATCH_SIZE) {
          deletedRecords += await ctx.runMutation(internal.sync.deleteRecords, {
            ids: diff.deletions
              .slice(i, i + BATCH_SIZE)
              .map((id) => id as Id<"vaccinationRecords">),
          });
        }
      }

      // Commit request sync only after vaccination-sheet reconciliation has
      // completed. The request table is separate and is never part of deletes.
      const requestSource = requestSourceId(settings.requestSheetUrl, settings.requestSheetGid);
      const requestResult = await ctx.runMutation(internal.sync.syncVaccinationRequests, {
        syncId,
        requestSource,
        rows: requestSyncRows,
        totalRows: requestParse.totalRows,
      });
      await ctx.runMutation(internal.sync.completeRequestsForVillages, {
        villages: parsed.completionYesVillages,
      });

      const invalidReasons = diff.reasons;

      await ctx.runMutation(internal.sync.finishSync, {
        syncId,
        recordsRetrieved: parsed.totalRows,
        validRecords: diff.validProcessed,
        duplicateRows: diff.sheetDuplicates + diff.eventDuplicates,
        newRecords,
        updatedRecords,
        unchangedRecords: diff.unchanged,
        rejectedRecords: diff.invalidProcessed,
        deletedRecords,
        invalidReasons,
        mappedColumns: parsed.mappedLabels,
        unmappedColumns: parsed.unmapped,
      });

      return {
        ok: true as const,
        triggeredBy: mode,
        triggeredByUser: by,
        durationMs: Date.now() - startedAt,
        recordsRetrieved: parsed.totalRows,
        validRecords: diff.validProcessed,
        duplicateRows: diff.sheetDuplicates + diff.eventDuplicates,
        newRecords,
        updatedRecords,
        unchangedRecords: diff.unchanged,
        rejectedRecords: diff.invalidProcessed,
        deletedRecords,
        invalidReasons,
      };
    } catch (err: any) {
      const message =
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : err instanceof Error
            ? err.message
            : "The sync failed for an unknown reason.";
      await ctx.runMutation(internal.sync.finishError, {
        syncId,
        error: message,
        requestSyncError: requestSyncStarted ? message : undefined,
      });
      throw new ConvexError(message);
    }
}
