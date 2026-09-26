import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Normalised vaccination row as prepared by the client-side importer. */
export const bharatRowValidator = v.object({
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

export type BharatRow = {
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

/** Every stored record's dedupe keys, so imports can skip duplicates. */
export const getExistingKeys = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("vaccinationRecords").collect();
    return rows.map((r) => ({
      id: r._id,
      externalKey: r.externalKey,
      naturalKey: r.naturalKey ?? "",
      status: r.status,
      source: r.source,
    }));
  },
});

async function insertRows(ctx: MutationCtx, rows: BharatRow[]) {
  const now = Date.now();
  let inserted = 0;
  for (const row of rows) {
    await ctx.db.insert("vaccinationRecords", {
      source: "bharat_pashudhan",
      updatedAt: now,
      ...row,
    });
    inserted++;
  }
  return inserted;
}

export const insertBatch = internalMutation({
  args: { rows: v.array(bharatRowValidator) },
  handler: async (ctx, { rows }) => await insertRows(ctx, rows),
});

export const recordUpload = internalMutation({
  args: {
    fileName: v.string(),
    uploadedBy: v.string(),
    totalRows: v.number(),
    validRows: v.number(),
    newRecords: v.number(),
    duplicateRows: v.number(),
    crossSourceDuplicates: v.number(),
    rejectedRows: v.number(),
    rejectedReasons: v.array(
      v.object({ reason: v.string(), count: v.number() }),
    ),
    mappedColumns: v.array(v.string()),
    unmappedColumns: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const uploadId = await ctx.db.insert("bharatUploads", {
      ...args,
      uploadedAt: Date.now(),
      status: "completed",
    });
    await ctx.db.insert("auditLog", {
      action: "bharat.upload",
      summary: `Bharat Pashudhan ${args.fileName}: ${args.newRecords} new, ${args.duplicateRows} duplicates, ${args.crossSourceDuplicates} cross-source, ${args.rejectedRows} rejected`,
      at: Date.now(),
      by: args.uploadedBy,
    });
    return uploadId;
  },
});

/** Upload history for the admin Import History page. */
export const uploadHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("bharatUploads").collect();
    return rows
      .sort((a, b) => b.uploadedAt - a.uploadedAt)
      .slice(0, Math.min(limit ?? 25, 100));
  },
});

export const lastUpload = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("bharatUploads").collect();
    if (rows.length === 0) return null;
    return rows.reduce((latest, row) =>
      row.uploadedAt > latest.uploadedAt ? row : latest,
    );
  },
});

export type { Id };
