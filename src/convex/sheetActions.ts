"use node";

import { ConvexError, v } from "convex/values";
import { createHash } from "node:crypto";
import { api, internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import { buildCsvUrl, parseSheet } from "./lib/sheetParser";
import { naturalKeyOf } from "./lib/villageMatch";

const SESSION_EXPIRED = "SESSION_EXPIRED:";
const AUTO_SYNC_MIN_MS = 5 * 60 * 1000;
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

type Counters = {
  validProcessed: number;
  invalidProcessed: number;
  sheetDuplicates: number;
  eventDuplicates: number;
};

/**
 * Pull the historical PPR Google Sheet, diff it against stored records and
 * persist only what is new or changed. Existing rows are never re-counted.
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

    const settings = await ctx.runQuery(internal.settings.getRaw, {});
    const syncId = await ctx.runMutation(internal.sync.beginSync, {
      sheetUrl: settings.sheetUrl,
      triggeredBy: mode,
    });

    const startedAt = Date.now();
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

      await ctx.runMutation(internal.sync.setStage, {
        syncId,
        stage: "Matching against stored records…",
      });
      const existing = await ctx.runQuery(internal.sync.getExisting, {});
      type Existing = (typeof existing)[number];
      const byKey = new Map<string, Existing>();
      const naturalSource = new Map<string, string>();
      for (const row of existing) {
        byKey.set(row.externalKey, row);
        if (row.status === "valid" && row.naturalKey) {
          naturalSource.set(row.naturalKey, row.source);
        }
      }

      const inserts: any[] = [];
      const updates: { id: Existing["id"]; row: any }[] = [];
      const seenInSheet = new Set<string>();
      const batchNaturals = new Set<string>();
      const reasonCount = new Map<string, number>();
      const bump = (reason: string) =>
        reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1);
      const counters: Counters = {
        validProcessed: 0,
        invalidProcessed: 0,
        sheetDuplicates: 0,
        eventDuplicates: 0,
      };
      let unchanged = 0;

      for (const row of parsed.records) {
        const natural = naturalKeyOf(row);
        row.naturalKey = natural || undefined;

        if (seenInSheet.has(row.externalKey)) {
          counters.sheetDuplicates++;
          bump("Duplicate row within sheet (skipped)");
          continue;
        }
        seenInSheet.add(row.externalKey);
        if (row.status === "rejected") counters.invalidProcessed++;
        else counters.validProcessed++;

        const match = byKey.get(row.externalKey);

        // Never count the same real-world event twice across sources.
        if (row.status === "valid" && natural && !match) {
          const storedSource = naturalSource.get(natural);
          if (storedSource) {
            counters.eventDuplicates++;
            bump(
              storedSource === "bharat_pashudhan"
                ? "Matches a Bharat Pashudhan record (not counted twice)"
                : "Duplicate vaccination event (already stored)",
            );
            continue;
          }
        }
        if (row.status === "valid" && natural) {
          if (batchNaturals.has(natural)) {
            counters.eventDuplicates++;
            bump("Duplicate vaccination event within sheet (skipped)");
            continue;
          }
          batchNaturals.add(natural);
        }

        if (!match) {
          inserts.push(row);
        } else if (
          match.rawHash !== row.rawHash ||
          match.status !== row.status ||
          (!match.naturalKey && row.naturalKey)
        ) {
          updates.push({ id: match.id, row });
        } else {
          unchanged++;
        }
      }

      let newRecords = 0;
      let updatedRecords = 0;
      if (inserts.length > 0 || updates.length > 0) {
        await ctx.runMutation(internal.sync.setStage, {
          syncId,
          stage: `Importing ${inserts.length} new and ${updates.length} updated records…`,
        });
        for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
          const result = await ctx.runMutation(internal.sync.applyBatch, {
            inserts: inserts.slice(i, i + BATCH_SIZE),
            updates: [],
          });
          newRecords += result.inserted;
        }
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
          const result = await ctx.runMutation(internal.sync.applyBatch, {
            inserts: [],
            updates: updates.slice(i, i + BATCH_SIZE),
          });
          updatedRecords += result.updated;
        }
      }

      const invalidReasons = [...parsed.reasons];
      for (const [reason, count] of reasonCount) {
        invalidReasons.push({ reason, count });
      }

      await ctx.runMutation(internal.sync.finishSync, {
        syncId,
        recordsRetrieved: parsed.totalRows,
        validRecords: counters.validProcessed,
        duplicateRows: counters.sheetDuplicates + counters.eventDuplicates,
        newRecords,
        updatedRecords,
        unchangedRecords: unchanged,
        rejectedRecords: counters.invalidProcessed,
        invalidReasons,
        mappedColumns: parsed.mappedLabels,
        unmappedColumns: parsed.unmapped,
      });

      return {
        ok: true as const,
        triggeredBy: mode,
        triggeredByUser: admin.username,
        durationMs: Date.now() - startedAt,
        recordsRetrieved: parsed.totalRows,
        validRecords: counters.validProcessed,
        duplicateRows: counters.sheetDuplicates + counters.eventDuplicates,
        newRecords,
        updatedRecords,
        unchangedRecords: unchanged,
        rejectedRecords: counters.invalidProcessed,
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
      });
      throw new ConvexError(message);
    }
  },
});
