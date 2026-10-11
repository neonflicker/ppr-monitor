"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireAdmin } from "./adminAuth";
import { bharatRowValidator, type BharatRow } from "./bharat";

const BATCH_SIZE = 100;

/**
 * Confirm a Bharat Pashudhan import.
 *
 * Rows arrive already parsed/validated/mapped by the client preview. The
 * server re-applies duplicate protection:
 *  - same externalKey → duplicate (re-upload of the same file is safe)
 *  - same natural event (date|village|vaccinator|counts) already stored from
 *    ANY source → cross-source duplicate, never counted twice
 *  - identical event twice inside the file → duplicate
 * Rejected rows are stored (not counted) so they stay inspectable.
 */
export const confirmBharatUpload = action({
  args: {
    token: v.string(),
    fileName: v.string(),
    mappedColumns: v.array(v.string()),
    unmappedColumns: v.array(v.string()),
    rows: v.array(bharatRowValidator),
  },
  handler: async (ctx, args): Promise<{
    totalRows: number;
    validRows: number;
    newRecords: number;
    duplicateRows: number;
    crossSourceDuplicates: number;
    rejectedRows: number;
    rejectedReasons: { reason: string; count: number }[];
  }> => {
    const admin = await requireAdmin(ctx, args.token);
    if (args.rows.length === 0) {
      throw new ConvexError(
        "This file contains no data rows. Check the sheet/export and try again.",
      );
    }

    const existing: Array<{ externalKey: string; naturalKey?: string; source: string; status: "valid" | "rejected" }> = await ctx.runQuery(internal.bharat.getExistingKeys, {});
    const byExternal = new Map(existing.map((r) => [r.externalKey, r]));
    const naturalSource = new Map<string, string>();
    for (const row of existing) {
      if (row.status === "valid" && row.naturalKey) {
        naturalSource.set(row.naturalKey, row.source);
      }
    }

    const inserts: BharatRow[] = [];
    const batchNaturals = new Set<string>();
    const reasonCount = new Map<string, number>();
    const bump = (reason: string) =>
      reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1);

    let validRows = 0;
    let newRecords = 0;
    let duplicateRows = 0;
    let crossSourceDuplicates = 0;
    let rejectedRows = 0;

    for (const row of args.rows) {
      if (byExternal.has(row.externalKey)) {
        duplicateRows++;
        bump("Already imported (same record)");
        continue;
      }
      if (row.status === "rejected") {
        rejectedRows++;
        bump(row.rejectReason ?? "Rejected during validation");
        inserts.push(row);
        continue;
      }
      validRows++;
      if (row.naturalKey) {
        const storedSource = naturalSource.get(row.naturalKey);
        if (storedSource) {
          if (storedSource === "bharat_pashudhan") {
            duplicateRows++;
            bump("Duplicate event already imported from Bharat Pashudhan");
          } else {
            crossSourceDuplicates++;
            bump("Matches a Google Sheet record (not counted twice)");
          }
          continue;
        }
        if (batchNaturals.has(row.naturalKey)) {
          duplicateRows++;
          bump("Duplicate row within this file");
          continue;
        }
        batchNaturals.add(row.naturalKey);
      }
      newRecords++;
      inserts.push(row);
    }

    for (let i = 0; i < inserts.length; i += BATCH_SIZE) {
      await ctx.runMutation(internal.bharat.insertBatch, {
        rows: inserts.slice(i, i + BATCH_SIZE),
      });
    }

    const rejectedReasons = [...reasonCount.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    await ctx.runMutation(internal.bharat.recordUpload, {
      fileName: args.fileName,
      uploadedBy: admin.username,
      totalRows: args.rows.length,
      validRows,
      newRecords,
      duplicateRows,
      crossSourceDuplicates,
      rejectedRows,
      rejectedReasons,
      mappedColumns: args.mappedColumns,
      unmappedColumns: args.unmappedColumns,
    });

    return {
      totalRows: args.rows.length,
      validRows,
      newRecords,
      duplicateRows,
      crossSourceDuplicates,
      rejectedRows,
      rejectedReasons,
    };
  },
});
