import { v } from "convex/values";
import { query } from "./_generated/server";
import { readSettingsDoc } from "./settings";

/**
 * Everything the main dashboard shows, computed from stored records.
 * PPR achievement only counts valid, unique, PPR-tagged vaccination rows.
 */
export const overview = query({
  args: { todayKey: v.string() },
  handler: async (ctx, { todayKey }) => {
    const settings = await readSettingsDoc(ctx);

    let achievement = 0;
    let totalGoats = 0;
    let totalSheep = 0;
    let todayTotal = 0;
    let todayGoats = 0;
    let todaySheep = 0;
    let validRecords = 0;
    const villages = new Set<string>();
    const vaccinators = new Set<string>();

    for await (const rec of ctx.db
      .query("vaccinationRecords")
      .withIndex("by_status", (q) => q.eq("status", "valid"))) {
      if (!rec.isPpr) continue;
      validRecords++;
      const goats = rec.goats ?? 0;
      const sheep = rec.sheep ?? 0;
      achievement += goats + sheep;
      totalGoats += goats;
      totalSheep += sheep;
      if (rec.village) villages.add(rec.village.trim().toLowerCase());
      if (rec.vaccinator) vaccinators.add(rec.vaccinator.trim().toLowerCase());
      if (rec.dateKey === todayKey) {
        todayTotal += goats + sheep;
        todayGoats += goats;
        todaySheep += sheep;
      }
    }

    let rejectedRecords = 0;
    for await (const rec of ctx.db
      .query("vaccinationRecords")
      .withIndex("by_status", (q) => q.eq("status", "rejected"))) {
      rejectedRecords++;
    }

    const lastSync = await ctx.db.query("sheetSyncs").order("desc").first();
    let lastSuccess: typeof lastSync = null;
    if (lastSync && lastSync.status === "done") {
      lastSuccess = lastSync;
    } else if (lastSync) {
      lastSuccess = await ctx.db
        .query("sheetSyncs")
        .order("desc")
        .filter((q) => q.eq(q.field("status"), "done"))
        .first();
    }

    const target = settings.programmeTarget ?? null;
    const completion =
      target && target > 0
        ? Math.round((achievement / target) * 10000) / 100
        : null;
    const remaining = target !== null ? Math.max(0, target - achievement) : null;

    return {
      districtName: settings.districtName,
      state: settings.state,
      vaccinationStartDate: settings.vaccinationStartDate ?? null,
      sheetUrl: settings.sheetUrl,
      sheetGid: settings.sheetGid ?? "",
      pprValues: settings.pprValues,
      target,
      achievement,
      remaining,
      completion,
      today: { total: todayTotal, goats: todayGoats, sheep: todaySheep },
      totals: { goats: totalGoats, sheep: totalSheep },
      villagesCovered: villages.size,
      vaccinatorsCovered: vaccinators.size,
      validRecords,
      rejectedRecords,
      totalRecords: validRecords + rejectedRecords,
      lastSync,
      lastSuccess,
      serverTime: Date.now(),
    };
  },
});

/** Rows rejected by validation, kept for inspection in the admin view. */
export const rejectedRows = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("vaccinationRecords")
      .withIndex("by_status", (q) => q.eq("status", "rejected"))
      .order("desc")
      .take(Math.min(limit ?? 25, 100));
    return rows.map((r) => ({
      _id: r._id,
      reason: r.rejectReason ?? "Rejected during import",
      dateKey: r.dateKey ?? null,
      village: r.village ?? null,
      vaccinator: r.vaccinator ?? null,
      goats: r.goats,
      sheep: r.sheep,
      timestamp: r.timestamp ?? null,
      updatedAt: r.updatedAt,
    }));
  },
});
