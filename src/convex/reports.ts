import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { readSettingsDoc } from "./settings";
import { normalizeName } from "./lib/villageMatch";

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
 * DISTRICT DVTR FORMAT PPR-EP values for one date, computed from vaccination
 * records (Google Sheet + Bharat Pashudhan). Wastage is NOT invented — only
 * the sum present in source data is returned as a suggestion.
 */
export const compute = query({
  args: { dateKey: v.string() },
  handler: async (ctx, { dateKey }) => {
    const settings = await readSettingsDoc(ctx);
    const lists = {
      departmental: settings.personnelDepartmental,
      semi: settings.personnelSemiGovernment,
      private: settings.personnelPrivate,
    };

    let goats = 0;
    let sheep = 0;
    let unspecified = 0;
    let taggedGoat = 0;
    let taggedSheep = 0;
    let farmers = 0;
    let wastedFromData = 0;
    let recordsOnDate = 0;
    const bySource = {
      google_sheet: { goats: 0, sheep: 0, farmers: 0, records: 0 },
      bharat_pashudhan: { goats: 0, sheep: 0, farmers: 0, records: 0 },
    };
    const people = new Map<string, { name: string; designation: string }>();

    for await (const rec of ctx.db
      .query("vaccinationRecords")
      .withIndex("by_dateKey", (q) => q.eq("dateKey", dateKey))) {
      if (rec.status !== "valid" || !rec.isPpr) continue;
      recordsOnDate++;
      goats += rec.goats;
      sheep += rec.sheep;
      unspecified += rec.unspecified ?? 0;
      taggedGoat += rec.taggedGoat;
      taggedSheep += rec.taggedSheep;
      farmers += rec.farmers;
      wastedFromData += rec.wasted;
      const bucket = bySource[rec.source];
      if (bucket) {
        bucket.goats += rec.goats;
        bucket.sheep += rec.sheep;
        bucket.farmers += rec.farmers;
        bucket.records += 1;
      }
      if (rec.vaccinator) {
        const key = normalizeName(rec.vaccinator);
        if (key && !people.has(key)) {
          people.set(key, {
            name: rec.vaccinator.trim(),
            designation: (rec.designation ?? "").trim(),
          });
        }
      }
    }

    const personnel = {
      departmental: [] as { name: string; designation: string }[],
      semiGovernment: [] as { name: string; designation: string }[],
      private: [] as { name: string; designation: string }[],
      unclassified: [] as { name: string; designation: string }[],
    };
    for (const person of people.values()) {
      const bucket = classifyDesignation(person.designation, lists);
      if (bucket === "departmental") personnel.departmental.push(person);
      else if (bucket === "semi") personnel.semiGovernment.push(person);
      else if (bucket === "private") personnel.private.push(person);
      else personnel.unclassified.push(person);
    }
    personnel.departmental.sort((a, b) => a.name.localeCompare(b.name));
    personnel.semiGovernment.sort((a, b) => a.name.localeCompare(b.name));
    personnel.private.sort((a, b) => a.name.localeCompare(b.name));
    personnel.unclassified.sort((a, b) => a.name.localeCompare(b.name));

    return {
      dateKey,
      district: settings.districtName,
      vaccinationStartDate: settings.vaccinationStartDate ?? null,
      defaultWasted: settings.defaultWasted ?? 0,
      goats,
      sheep,
      unspecified,
      taggedGoat,
      taggedSheep,
      taggedTotal: taggedGoat + taggedSheep,
      farmers,
      wastedFromData,
      recordsOnDate,
      bySource,
      personnelCounts: {
        departmental: personnel.departmental.length,
        semiGovernment: personnel.semiGovernment.length,
        private: personnel.private.length,
        unclassified: personnel.unclassified.length,
      },
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
