"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { requireAdmin } from "./adminAuth";

/**
 * ADMIN: confirm a User & Village allocation import (Excel/CSV previewed on
 * the client). Only valid rows are stored; invalid rows are reported back and
 * kept in the upload history for inspection.
 */
export const confirmAllocationImport = action({
  args: {
    token: v.string(),
    fileName: v.string(),
    totalRows: v.number(),
    validRows: v.number(),
    invalidRows: v.number(),
    errors: v.array(
      v.object({
        row: v.number(),
        userName: v.string(),
        village: v.string(),
        error: v.string(),
      }),
    ),
    rows: v.array(
      v.object({
        userName: v.string(),
        village: v.string(),
        target: v.number(),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    uploadId: string;
    totalTarget: number;
    userCount: number;
    villageCount: number;
  }> => {
    const admin = await requireAdmin(ctx, args.token);
    if (args.rows.length === 0) {
      throw new ConvexError(
        "No valid allocation rows to import. Fix the reported row errors and upload again.",
      );
    }
    for (const row of args.rows) {
      if (!row.userName.trim() || !row.village.trim()) {
        throw new ConvexError("Every row needs a user name and a village.");
      }
      if (!Number.isFinite(row.target) || row.target < 0) {
        throw new ConvexError(
          `Invalid target for “${row.village}” (${row.userName.trim()}).`,
        );
      }
    }
    return await ctx.runMutation(internal.allocations.confirmImport, {
      by: admin.username,
      fileName: args.fileName,
      totalRows: args.totalRows,
      validRows: args.validRows,
      invalidRows: args.invalidRows,
      errors: args.errors,
      rows: args.rows,
    });
  },
});
