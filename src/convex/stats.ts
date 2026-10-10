import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { readSettingsDoc } from "./settings";
import { getActiveVersion, villageTargetTotals } from "./targets";
import { matchVillage, normalizeVillage } from "./lib/villageMatch";
import {
  aggregateByDay,
  type AggregateRecord,
} from "./lib/dayAggregate";
import { allocationSummary, type AllocationSummary } from "./allocationSummary";

/** Status buckets derived from completion % (never entered manually). */
export function statusFor(completion: number | null): string {
  if (completion === null) return "NOT STARTED";
  if (completion <= 0) return "NOT STARTED";
  if (completion >= 100) return completion > 100 ? "OVER TARGET" : "TARGET COMPLETED";
  if (completion < 50) return "IN PROGRESS";
  if (completion < 75) return "GOOD PROGRESS";
  return "NEAR TARGET";
}

async function loadMapping(ctx: QueryCtx) {
  const rows = await ctx.db.query("villageMappings").collect();
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.alias, row.canonical);
  return map;
}

function resolveTargetKey(
  rawVillage: string,
  mapping: Map<string, string>,
): string {
  const key = normalizeVillage(rawVillage);
  const alias = mapping.get(key);
  return alias ? normalizeVillage(alias) : key;
}

/**
 * PUBLIC OVERVIEW — every number on the dashboard comes from here.
 * TARGET comes from the admin allocation (fallback: settings).
 * ACHIEVEMENT comes from valid, de-duplicated vaccination records.
 */
export const overview = query({
  args: { todayKey: v.string() },
  handler: async (ctx, { todayKey }) => {
    const settings = await readSettingsDoc(ctx);
    const version = await getActiveVersion(ctx);
    const { byVillage } = version
      ? await villageTargetTotals(ctx, version._id)
      : { byVillage: new Map() };

    let villageTargetSum = 0;
    let goatTargetSum = 0;
    let sheepTargetSum = 0;
    for (const entry of byVillage.values()) {
      villageTargetSum += entry.target;
      goatTargetSum += entry.goatTarget;
      sheepTargetSum += entry.sheepTarget;
    }

    let achievement = 0;
    let goats = 0;
    let sheep = 0;
    let unspecified = 0;
    let goatAchievement = 0;
    let sheepAchievement = 0;
    let validRecords = 0;
    let nonPprRecords = 0;
    let sheetRecords = 0;
    let bharatRecords = 0;
    let yesterdayTotal = 0;
    let todayTotal = 0;
    let todayGoats = 0;
    let todaySheep = 0;
    let todayFarmers = 0;
    const todayVaccinators = new Set<string>();
    const todayVillages = new Set<string>();
    const villages = new Set<string>();
    const vaccinators = new Set<string>();
    const yesterdayKey = (() => {
      const [y, m, d] = todayKey.split("-").map(Number);
      if (!y || !m || !d) return "";
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - 1);
      return dt.toISOString().slice(0, 10);
    })();

    let rejectedRecords = 0;
    for await (const rec of ctx.db.query("vaccinationRecords")) {
      if (rec.status === "rejected") {
        rejectedRecords++;
        continue;
      }
      if (rec.source === "google_sheet") sheetRecords++;
      else bharatRecords++;
      if (!rec.isPpr) {
        nonPprRecords++;
        continue;
      }
      validRecords++;
      const g = rec.goats ?? 0;
      const s = rec.sheep ?? 0;
      const u = rec.unspecified ?? 0;
      achievement += g + s + u;
      goats += g;
      sheep += s;
      unspecified += u;
      goatAchievement += g;
      sheepAchievement += s;
      if (rec.village) villages.add(rec.village.trim().toLowerCase());
      if (rec.vaccinator) vaccinators.add(rec.vaccinator.trim().toLowerCase());

      if (rec.dateKey === todayKey) {
        todayTotal += g + s + u;
        todayGoats += g;
        todaySheep += s;
        todayFarmers += rec.farmers;
        if (rec.vaccinator) todayVaccinators.add(rec.vaccinator.toLowerCase());
        if (rec.village) todayVillages.add(rec.village.toLowerCase());
      } else if (rec.dateKey === yesterdayKey) {
        yesterdayTotal += g + s + u;
      }
    }

    // ---- Headline target ----
    const districtTarget = version?.overallTarget ?? null;
    const settingsTarget = settings.programmeTarget ?? null;
    let target: number | null = null;
    let targetSource: "district" | "villages" | "settings" | null = null;
    if (districtTarget !== null && districtTarget > 0) {
      target = districtTarget;
      targetSource = "district";
    } else if (villageTargetSum > 0) {
      target = villageTargetSum;
      targetSource = "villages";
    } else if (settingsTarget !== null && settingsTarget > 0) {
      target = settingsTarget;
      targetSource = "settings";
    }

    const remaining = target !== null ? Math.max(0, target - achievement) : null;
    const excess = target !== null ? Math.max(0, achievement - target) : 0;
    const completion =
      target !== null && target > 0
        ? Math.round((achievement / target) * 10000) / 100
        : null;

    // ---- Bharat Pashudhan upload summary ----
    // Uploaded rows ≠ achievement: uploaded/valid/rejected/duplicates are
    // reported separately so nobody reads an upload count as vaccinations.
    const uploads = await ctx.db.query("bharatUploads").collect();
    let lastUploadAt: number | null = null;
    let uploadedRows = 0;
    let duplicatesSkipped = 0;
    let bharatRejected = 0;
    for (const upload of uploads) {
      uploadedRows += upload.totalRows;
      duplicatesSkipped += upload.duplicateRows + upload.crossSourceDuplicates;
      bharatRejected += upload.rejectedRows;
      if (lastUploadAt === null || upload.uploadedAt > lastUploadAt) {
        lastUploadAt = upload.uploadedAt;
      }
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

    return {
      districtName: settings.districtName,
      dispensaryName: settings.dispensaryName,
      state: settings.state,
      vaccinationStartDate: settings.vaccinationStartDate ?? null,
      sheetUrl: settings.sheetUrl,
      sheetGid: settings.sheetGid ?? "",
      requestSheetUrl: settings.requestSheetUrl,
      requestSheetGid: settings.requestSheetGid,
      pprValues: settings.pprValues,
      defaultWasted: settings.defaultWasted,
      personnelDepartmental: settings.personnelDepartmental,
      personnelSemiGovernment: settings.personnelSemiGovernment,
      personnelPrivate: settings.personnelPrivate,
      settingsTarget,

      // Target (admin-managed allocation)
      target,
      targetSource,
      targetVersion: version
        ? {
            versionNumber: version.versionNumber,
            fileName: version.fileName,
            source: version.source ?? "pdf",
            overallSource: version.overallSource ?? null,
            uploadedAt: version.uploadedAt,
            uploadedBy: version.uploadedBy,
            villageCount: version.villageCount,
          }
        : null,
      villageTargetSum,
      // Allocation status: how many villages actually carry an active target
      // record (even a deliberate zero), and the sum of those allocations.
      allocatedVillages: byVillage.size,
      // Excel/CSV user allocation (USER → VILLAGE → TARGET).
      allocation: await allocationSummary(ctx),
      goatTarget: goatTargetSum > 0 ? goatTargetSum : null,
      sheepTarget: sheepTargetSum > 0 ? sheepTargetSum : null,

      // Achievement
      achievement,
      remaining,
      excess,
      completion,
      totals: { goats, sheep, unspecified },
      goatAchievement,
      sheepAchievement,
      yesterdayTotal,

      // Today
      today: {
        total: todayTotal,
        goats: todayGoats,
        sheep: todaySheep,
        farmers: todayFarmers,
        vaccinators: todayVaccinators.size,
        villages: todayVillages.size,
      },

      // Record book
      validRecords,
      nonPprRecords,
      rejectedRecords,
      totalRecords: validRecords + rejectedRecords + nonPprRecords,
      sheetRecords,
      bharatRecords,
      villagesCovered: villages.size,
      vaccinatorsCovered: vaccinators.size,
      bharat: {
        uploadedRows,
        validRecords: bharatRecords,
        duplicatesSkipped,
        rejectedRecords: bharatRejected,
        lastUploadAt,
      },
      lastSync,
      lastSuccess,
      serverTime: Date.now(),
    };
  },
});

/** TODAY'S VACCINATION BY VACCINATOR (§8). */
export const todayByVaccinator = query({
  args: { dateKey: v.string() },
  handler: async (ctx, { dateKey }) => {
    const rows = new Map<
      string,
      {
        vaccinator: string;
        villages: Set<string>;
        goats: number;
        sheep: number;
        total: number;
      }
    >();
    const totals = { goats: 0, sheep: 0, total: 0, vaccinators: 0 };

    for await (const rec of ctx.db
      .query("vaccinationRecords")
      .withIndex("by_dateKey", (q) => q.eq("dateKey", dateKey))) {
      if (rec.status !== "valid" || !rec.isPpr) continue;
      const name = (rec.vaccinator ?? "Unknown").trim() || "Unknown";
      const key = name.toLowerCase();
      const entry = rows.get(key) ?? {
        vaccinator: name,
        villages: new Set<string>(),
        goats: 0,
        sheep: 0,
        total: 0,
      };
      entry.goats += rec.goats;
      entry.sheep += rec.sheep + (rec.unspecified ?? 0);
      // Total is always Goats + Sheep — the same sum the dashboard cards use.
      entry.total = entry.goats + entry.sheep;
      if (rec.village) entry.villages.add(rec.village.toLowerCase());
      rows.set(key, entry);
      totals.goats += rec.goats;
      totals.sheep += rec.sheep + (rec.unspecified ?? 0);
      totals.total += rec.goats + rec.sheep + (rec.unspecified ?? 0);
    }

    const list = [...rows.values()]
      .map((r) => ({
        vaccinator: r.vaccinator,
        villages: r.villages.size,
        goats: r.goats,
        sheep: r.sheep,
        total: r.goats + r.sheep,
      }))
      .sort((a, b) => b.total - a.total);
    totals.vaccinators = list.length;
    return { rows: list, totals };
  },
});

/** VILLAGE-WISE PROGRESS: active allocation joined with achievements. */
export const villageProgress = query({
  args: {
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, { dateFrom, dateTo }) => {
    const version = await getActiveVersion(ctx);
    const mapping = await loadMapping(ctx);
    const { byVillage } = version
      ? await villageTargetTotals(ctx, version._id)
      : { byVillage: new Map() };

    const achievementByKey = new Map<
      string,
      {
        raw: string;
        total: number;
        goats: number;
        sheep: number;
        unspecified: number;
      }
    >();
    for await (const rec of ctx.db
      .query("vaccinationRecords")
      .withIndex("by_status", (q) => q.eq("status", "valid"))) {
      if (!rec.isPpr || !rec.village) continue;
      if (dateFrom && rec.dateKey && rec.dateKey < dateFrom) continue;
      if (dateTo && rec.dateKey && rec.dateKey > dateTo) continue;
      const key = resolveTargetKey(rec.village, mapping);
      if (!key) continue;
      const entry = achievementByKey.get(key) ?? {
        raw: rec.village,
        total: 0,
        goats: 0,
        sheep: 0,
        unspecified: 0,
      };
      entry.total += rec.goats + rec.sheep + (rec.unspecified ?? 0);
      entry.goats += rec.goats;
      entry.sheep += rec.sheep;
      entry.unspecified += rec.unspecified ?? 0;
      achievementByKey.set(key, entry);
    }

    // Village allocation status: a village counts as allocated only when an
    // active target record exists for it (even if that target is explicitly 0).
    let allocatedVillages = 0;
    let allocatedTargetSum = 0;
    for (const entry of byVillage.values()) {
      allocatedVillages += 1;
      allocatedTargetSum += entry.target;
    }
    const hasAllocation = version !== null && allocatedVillages > 0;
    // Programme target (settings) is authoritative for the DISTRICT.
    const settings = await readSettingsDoc(ctx);
    const settingsProgrammeTarget = settings.programmeTarget ?? 0;
    const programmeTarget = settingsProgrammeTarget > 0 ? settingsProgrammeTarget : null;

    const targetNames = [...byVillage.values()].map((t) => t.village);
    const rows: {
      village: string;
      block?: string;
      target: number;
      goatTarget: number | null;
      sheepTarget: number | null;
      achievement: number;
      goatAchievement: number;
      sheepAchievement: number;
      remaining: number | null;
      excess: number;
      completion: number | null;
      status: string;
      allocated: boolean;
    }[] = [];

    const matched = new Set<string>();
    for (const [key, target] of byVillage) {
      const hit = achievementByKey.get(key);
      if (hit) matched.add(key);
      const achievement = hit?.total ?? 0;
      // §13: Village Target = 0 → UNALLOCATED semantics (no completion, no
      // remaining) until the administrator allocates a positive target.
      const zeroTarget = target.target <= 0;
      const completion =
        target.target > 0
          ? Math.round((achievement / target.target) * 10000) / 100
          : null;
      rows.push({
        village: target.village,
        block: target.block,
        target: target.target,
        goatTarget: target.goatTarget > 0 ? target.goatTarget : null,
        sheepTarget: target.sheepTarget > 0 ? target.sheepTarget : null,
        achievement,
        goatAchievement: hit?.goats ?? 0,
        sheepAchievement: (hit?.sheep ?? 0) + (hit?.unspecified ?? 0),
        remaining:
          target.target > 0 ? Math.max(0, target.target - achievement) : null,
        excess: target.target > 0 ? Math.max(0, achievement - target.target) : 0,
        completion,
        status: zeroTarget ? "UNALLOCATED" : statusFor(completion),
        allocated: true,
      });
    }

    // Achievement villages that are not in the allocation — shown, not hidden.
    const unallocated: typeof rows = [];
    const targetNameList = targetNames;
    let unallocatedAchievement = 0;
    for (const [key, hit] of achievementByKey) {
      if (matched.has(key)) continue;
      if (byVillage.has(key)) continue;
      const suggestion = matchVillage(hit.raw, targetNameList);
      if (suggestion.kind === "exact" && suggestion.canonical) continue;
      unallocatedAchievement += hit.total;
      unallocated.push({
        village: hit.raw,
        target: 0,
        goatTarget: null,
        sheepTarget: null,
        achievement: hit.total,
        goatAchievement: hit.goats,
        sheepAchievement: hit.sheep + hit.unspecified,
        remaining: null,
        excess: 0,
        completion: null,
        status: "UNALLOCATED",
        allocated: false,
      });
    }
    rows.push(...unallocated);

    const totals = rows.reduce(
      (acc, row) => {
        if (!row.allocated) return acc;
        acc.target += row.target;
        acc.achievement += row.achievement;
        acc.goatTarget += row.goatTarget ?? 0;
        acc.goatAchievement += row.goatAchievement;
        acc.sheepTarget += row.sheepTarget ?? 0;
        acc.sheepAchievement += row.sheepAchievement;
        return acc;
      },
      {
        target: 0,
        achievement: 0,
        goatTarget: 0,
        goatAchievement: 0,
        sheepTarget: 0,
        sheepAchievement: 0,
      },
    );
    totals.achievement = rows
      .filter((r) => r.allocated)
      .reduce((s, r) => s + r.achievement, 0);

    return {
      hasAllocation,
      versionNumber: version?.versionNumber ?? null,
      rows,
      totals: {
        ...totals,
        remaining: Math.max(0, totals.target - totals.achievement),
        completion:
          totals.target > 0
            ? Math.round((totals.achievement / totals.target) * 10000) / 100
            : null,
      },
      unallocatedCount: unallocated.length,
      // Programme-level context so the table footer can distinguish the
      // DISTRICT PROGRAMME TARGET from the sum of VILLAGE allocations.
      programmeTarget,
      allocatedVillages,
      allocatedTargetSum,
      unallocatedAchievement,
      totalAchievement:
        totals.achievement +
        rows.filter((r) => !r.allocated).reduce((s, r) => s + r.achievement, 0),
    };
  },
});

/** VACCINATOR PROGRESS (factual counts only — no scores). */
export const vaccinatorProgress = query({
  args: { todayKey: v.string() },
  handler: async (ctx, { todayKey }) => {
    const rows = new Map<
      string,
      {
        vaccinator: string;
        designation: string;
        today: number;
        total: number;
        goats: number;
        sheep: number;
        villages: Set<string>;
        lastDate: string | null;
      }
    >();

    for await (const rec of ctx.db
      .query("vaccinationRecords")
      .withIndex("by_status", (q) => q.eq("status", "valid"))) {
      if (!rec.isPpr) continue;
      const name = (rec.vaccinator ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const entry = rows.get(key) ?? {
        vaccinator: name,
        designation: (rec.designation ?? "").trim(),
        today: 0,
        total: 0,
        goats: 0,
        sheep: 0,
        villages: new Set<string>(),
        lastDate: null,
      };
      const amount = rec.goats + rec.sheep + (rec.unspecified ?? 0);
      entry.total += amount;
      entry.goats += rec.goats;
      entry.sheep += rec.sheep + (rec.unspecified ?? 0);
      if (rec.dateKey === todayKey) entry.today += amount;
      if (rec.village) entry.villages.add(rec.village.toLowerCase());
      if (rec.dateKey && (!entry.lastDate || rec.dateKey > entry.lastDate)) {
        entry.lastDate = rec.dateKey;
      }
      rows.set(key, entry);
    }

    return {
      rows: [...rows.values()]
        .map((r) => ({
          vaccinator: r.vaccinator,
          designation: r.designation,
          today: r.today,
          total: r.total,
          goats: r.goats,
          sheep: r.sheep,
          villages: r.villages.size,
          lastDate: r.lastDate,
        }))
        .sort((a, b) => b.total - a.total),
    };
  },
});

/**
 * HISTORICAL SERIES: daily + cumulative vaccination, built from the SAME
 * normalised per-day aggregation engine as the report and dashboard figures.
 */
export const dailySeries = query({
  args: { fromKey: v.optional(v.string()) },
  handler: async (ctx, { fromKey }) => {
    const records: AggregateRecord[] = [];
    for await (const rec of ctx.db
      .query("vaccinationRecords")
      .withIndex("by_status", (q) => q.eq("status", "valid"))) {
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
    const days = aggregateByDay(records, { fromKey });
    let cumulative = 0;
    const series = days.map((day) => {
      cumulative += day.animalsTotal;
      return {
        dateKey: day.dateKey,
        goats: day.goats,
        sheep: day.sheep + day.unspecified,
        farmers: day.farmers,
        total: day.animalsTotal,
        vaccinators: day.vaccinators,
        villages: day.villages,
        cumulative,
      };
    });
    return { series, total: cumulative };
  },
});

/** ADMIN DATA VALIDATION (§31): cross-source reconciliation numbers. */
export const dataQuality = query({
  args: {},
  handler: async (ctx) => {
    const naturalCounts = new Map<string, number>();
    let total = 0;
    let valid = 0;
    let validPpr = 0;
    let rejected = 0;
    let sheet = 0;
    let bharat = 0;
    let missingVillage = 0;
    let missingDate = 0;
    let missingTag = 0;
    let missingVaccinator = 0;
    let missingSpecies = 0;
    let invalidDates = 0;
    let nonPpr = 0;
    let unmatched = 0;
    const reasons = new Map<string, number>();

    for await (const rec of ctx.db.query("vaccinationRecords")) {
      total++;
      if (rec.status === "rejected") {
        rejected++;
        const reason = rec.rejectReason ?? "Rejected";
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        if (/date/i.test(reason)) invalidDates++;
        if (/village/i.test(reason)) missingVillage++;
        continue;
      }
      valid++;
      if (rec.source === "google_sheet") sheet++;
      else bharat++;
      if (!rec.isPpr) nonPpr++;
      else validPpr++;
      if (!rec.village) missingVillage++;
      if (!rec.dateKey) missingDate++;
      if (!rec.tagId) missingTag++;
      if (!rec.vaccinator) missingVaccinator++;
      if (!rec.species) missingSpecies++;
      if (rec.naturalKey && rec.status === "valid") {
        naturalCounts.set(
          rec.naturalKey,
          (naturalCounts.get(rec.naturalKey) ?? 0) + 1,
        );
      } else {
        unmatched++;
      }
    }

    let potentialDuplicates = 0;
    for (const count of naturalCounts.values()) {
      if (count > 1) potentialDuplicates += count - 1;
    }

    const uploads = await ctx.db.query("bharatUploads").collect();
    const syncs = await ctx.db
      .query("sheetSyncs")
      .order("desc")
      .take(20)
      .then((rows) => rows.filter((r) => r.status === "done"));

    return {
      total,
      valid,
      validPpr,
      rejected,
      nonPpr,
      bySource: { sheet, bharat },
      missing: {
        village: missingVillage,
        date: missingDate,
        tagId: missingTag,
        vaccinator: missingVaccinator,
        species: missingSpecies,
      },
      invalidDates,
      potentialDuplicates,
      unmatched,
      duplicatesSkippedEver:
        uploads.reduce(
          (s, u) => s + u.duplicateRows + u.crossSourceDuplicates,
          0,
        ) + syncs.reduce((s, u) => s + (u.duplicateRows ?? 0), 0),
      rejectedReasons: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
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
      source: r.source,
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
