"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { normalizeVillage } from "./lib/villageMatch";
import { requireAdmin } from "./adminAuth";

/**
 * Manual target actions. (The PDF target reader was removed — allocation now
 * arrives via the Excel/CSV User & Village Allocation import; PDF is OUTPUT
 * only, used for the daily report export.)
 */

/**
 * ADMIN: save dispensary + village target allocation (manual management).
 * History is preserved via audit entries; rows are never hard-deleted.
 */
export const saveManualAllocation = action({
  args: {
    token: v.string(),
    districtTarget: v.optional(v.number()),
    clearDistrictTarget: v.optional(v.boolean()),
    allocationDate: v.optional(v.string()),
    remarks: v.optional(v.string()),
    villages: v.array(
      v.object({
        village: v.string(),
        goatTarget: v.number(),
        sheepTarget: v.number(),
        active: v.optional(v.boolean()),
        remarks: v.optional(v.string()),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    versionId: string;
    versionNumber: number;
    changeCount: number;
    changes: {
      village: string;
      kind: "new" | "changed" | "deactivated" | "reactivated";
      from?: number;
      to: number;
    }[];
    villageSum: number;
    districtTarget: number | null;
  }> => {
    const admin = await requireAdmin(ctx, args.token);
    if (
      args.districtTarget !== undefined &&
      (!Number.isFinite(args.districtTarget) || args.districtTarget < 0)
    ) {
      throw new ConvexError("Dispensary target must be zero or more.");
    }
    for (const row of args.villages) {
      if (!row.village.trim()) {
        throw new ConvexError("Every village row needs a village name.");
      }
      if (
        !Number.isFinite(row.goatTarget) ||
        !Number.isFinite(row.sheepTarget) ||
        row.goatTarget < 0 ||
        row.sheepTarget < 0
      ) {
        throw new ConvexError(
          `Invalid target numbers for village “${row.village}”.`,
        );
      }
    }
    return await ctx.runMutation(internal.targets.saveManualAllocation, {
      by: admin.username,
      districtTarget: args.districtTarget,
      clearDistrictTarget: args.clearDistrictTarget,
      allocationDate: args.allocationDate,
      remarks: args.remarks,
      villages: args.villages,
    });
  },
});

export const saveVillageMapping = action({
  args: {
    token: v.string(),
    alias: v.string(),
    canonical: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const admin = await requireAdmin(ctx, args.token);
    const alias = normalizeVillage(args.alias);
    const canonical = args.canonical.trim();
    if (!alias || !canonical) {
      throw new ConvexError("Both village names are required to save a mapping.");
    }
    await ctx.runMutation(internal.targets.saveMappingInternal, {
      alias,
      canonical,
      createdBy: admin.username,
    });
    return { ok: true };
  },
});

export const removeVillageMapping = action({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx, args.token);
    await ctx.runMutation(internal.targets.deleteMappingInternal, {
      id: args.id as never,
    });
    return { ok: true };
  },
});
