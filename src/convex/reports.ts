import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { readSettingsDoc } from "./settings";
import { aggregateWithPersonnel, type AggregateRecord } from "./lib/dayAggregate";

type Bucket = "departmental" | "semi" | "private";

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function classifyDesignation(
  designation: string | undefined,
  lists: { departmental: string[]; semi: string[]; private: string[] },
): Bucket | null {
  const raw = (designation ?? "").trim();
  if (!raw) return null;
  const norm = normalizeToken(raw);
  if (!norm) return null;
  const matches = (values: string[]) =>
    values.some((value) => {
      const v = normalizeToken(value);
      if (!v) return false;
      return norm.includes(v) || v.includes(norm);
    });
  if (matches(lists.departmental)) return "departmental";
  if (matches(lists.semi)) return "semi";
  if (matches(lists.private)) return "private";
  return null;
}

/**
 * DISPENSARY DVTR FORMAT PPR-EP values for one date, computed from vaccination
 * records (Google Sheet + Bharat Pashudhan) through the shared dayAggregate
 * engine. Wastage is NOT invented — only the sum present in source data is
 * returned as a suggestion.
 */
export const compute = query({
  args: { dateKey: v.string() },
  handler: async (ctx, { dateKey }) => {
    const settings = await readSettingsDoc(ctx);

    const records: AggregateRecord[] = [];
    for await (const rec of ctx.db
      .query("vaccinationRecords")
      .withIndex("by_dateKey", (q) => q.eq("dateKey", dateKey))) {
      records.push({
        status: rec.status,
        isPpr: rec.isPpr,
        source: rec.source,
        dateKey: rec.dateKey,
        goats: rec.goats,
        sheep: rec.sheep,
        unspecified: rec.unspecified,
        farmers: rec.farmers,
        wasted: rec.wasted,
        taggedGoat: rec.taggedGoat,
        taggedSheep: rec.taggedSheep,
        village: rec.village,
        vaccinator: rec.vaccinator,
        designation: rec.designation,
      });
    }

    // ONE aggregation layer — the same engine the dashboard uses.
    const agg = aggregateWithPersonnel(records, {
      departmental: settings.personnelDepartmental,
      semi: settings.personnelSemiGovernment,
      private: settings.personnelPrivate,
    });

    const personnel = {
      departmental: agg.personnelNames.departmental.map((name) => ({
        name,
        designation: "",
      })),
      semiGovernment: agg.personnelNames.semi.map((name) => ({
        name,
        designation: "",
      })),
      private: agg.personnelNames.private.map((name) => ({
        name,
        designation: "",
      })),
      unclassified: agg.personnelNames.unclassified.map((name) => ({
        name,
        designation: "",
      })),
    };

    return {
      dateKey,
      district: settings.dispensaryName,
      vaccinationStartDate: settings.vaccinationStartDate ?? null,
      defaultWasted: settings.defaultWasted ?? 0,
      animalsTotal: agg.animalsTotal,
      goats: agg.goats,
      sheep: agg.sheep,
      unspecified: agg.unspecified,
      taggedGoat: agg.taggedGoat,
      taggedSheep: agg.taggedSheep,
      taggedTotal: agg.taggedAnimals,
      farmers: agg.farmers,
      wastedFromData: agg.wastedDoses,
      vaccinators: agg.vaccinators,
      villages: agg.villages,
      recordsOnDate: agg.records,
      bySource: {
        google_sheet: {
          goats: agg.bySource.google_sheet.goats,
          sheep: agg.bySource.google_sheet.sheep,
          farmers: agg.bySource.google_sheet.farmers,
          records: agg.bySource.google_sheet.records,
        },
        bharat_pashudhan: {
          goats: agg.bySource.bharat_pashudhan.goats,
          sheep: agg.bySource.bharat_pashudhan.sheep,
          farmers: agg.bySource.bharat_pashudhan.farmers,
          records: agg.bySource.bharat_pashudhan.records,
        },
      },
      personnelCounts: agg.personnel,
      personnel,
    };
  },
});

export const history = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("dailyReports").collect();
    return rows
      .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
      .slice(0, Math.min(limit ?? 30, 100));
  },
});

export const saveInternal = internalMutation({
  args: {
    reportDate: v.string(),
    generatedBy: v.string(),
    district: v.string(),
    vaccinationStartDate: v.optional(v.string()),
    goats: v.number(),
    sheep: v.number(),
    wasted: v.number(),
    taggedGoat: v.number(),
    taggedSheep: v.number(),
    farmers: v.number(),
    departmental: v.number(),
    semiGovernment: v.number(),
    privatePersonnel: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dailyReports")
      .withIndex("by_date", (q) => q.eq("reportDate", args.reportDate))
      .unique();
    const patch = { ...args, generatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("dailyReports", patch);
  },
});
