import { v } from "convex/values";
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { matchVillage, normalizeVillage } from "./lib/villageMatch";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export async function getActiveVersion(ctx: QueryCtx) {
  return await ctx.db
    .query("targetVersions")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .unique();
}

async function loadMappings(ctx: QueryCtx) {
  const rows = await ctx.db.query("villageMappings").collect();
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.alias, row.canonical);
  return map;
}

/** Per-village target totals of a version (records grouped by normalised village). */
export async function villageTargetTotals(
  ctx: QueryCtx,
  versionId: Id<"targetVersions">,
) {
  const records = await ctx.db
    .query("targetRecords")
    .withIndex("by_version", (q) => q.eq("versionId", versionId))
    .collect();
  const byVillage = new Map<
    string,
    {
      village: string;
      target: number;
      goatTarget: number;
      sheepTarget: number;
      rows: number;
      block?: string;
    }
  >();
  for (const record of records) {
    const key = normalizeVillage(record.village);
    if (!key) continue;
    const entry = byVillage.get(key) ?? {
      village: record.village,
      target: 0,
      goatTarget: 0,
      sheepTarget: 0,
      rows: 0,
      block: record.block,
    };
    entry.target += record.totalTarget;
    entry.goatTarget += record.goatTarget ?? 0;
    entry.sheepTarget += record.sheepTarget ?? 0;
    entry.rows += 1;
    byVillage.set(key, entry);
  }
  return { records, byVillage };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const activeVersion = query({
  args: {},
  handler: async (ctx) => await getActiveVersion(ctx),
});

export const listVersions = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("targetVersions").collect();
    return rows.sort((a, b) => b.versionNumber - a.versionNumber);
  },
});

export const activeRecords = query({
  args: {},
  handler: async (ctx) => {
    const version = await getActiveVersion(ctx);
    if (!version) return { version: null, records: [] as Doc<"targetRecords">[] };
    const records = await ctx.db
      .query("targetRecords")
      .withIndex("by_version", (q) => q.eq("versionId", version._id))
      .collect();
    return { version, records };
  },
});

export const mappings = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("villageMappings").collect();
    return rows.sort((a, b) => a.alias.localeCompare(b.alias));
  },
});

/**
 * TARGET RECONCILIATION: official overall target vs sum of village targets,
 * plus matched / unmatched / new villages between the active target and the
 * achievement data (Google Sheet + Bharat Pashudhan).
 */
export const reconciliation = query({
  args: {},
  handler: async (ctx) => {
    const version = await getActiveVersion(ctx);
    const mapping = await loadMappings(ctx);

    // Achievement villages from valid PPR vaccination records.
    const achievement = new Map<string, { raw: string; total: number }>();
    for await (const rec of ctx.db
      .query("vaccinationRecords")
      .withIndex("by_status", (q) => q.eq("status", "valid"))) {
      if (!rec.isPpr || !rec.village) continue;
      const key = normalizeVillage(rec.village);
      if (!key) continue;
      const entry = achievement.get(key) ?? { raw: rec.village, total: 0 };
      entry.total += rec.goats + rec.sheep + (rec.unspecified ?? 0);
      achievement.set(key, entry);
    }

    if (!version) {
      return {
        version: null,
        overallTarget: null,
        villageTargetSum: 0,
        difference: 0,
        counts: {
          targetVillages: 0,
          achievementVillages: achievement.size,
          matched: 0,
          unmatchedTargets: 0,
          newVillages: achievement.size,
        },
        unmatchedTargets: [],
        newVillages: [...achievement.values()].map((a) => ({
          village: a.raw,
          achievement: a.total,
        })),
        suggestions: [],
      };
    }

    const { records, byVillage } = await villageTargetTotals(ctx, version._id);
    const villageTargetSum = records.reduce((s, r) => s + r.totalTarget, 0);
    const overallTarget = version.overallTarget ?? null;

    // Resolve each achievement village: exact normalised match or saved mapping.
    const matchedTargets = new Set<string>();
    const newVillages: { village: string; achievement: number }[] = [];
    const suggestions: {
      raw: string;
      suggested: string;
      reason: string;
      achievement: number;
    }[] = [];

    const targetNames = [...byVillage.values()].map((t) => t.village);

    for (const [key, entry] of achievement) {
      const mapped = mapping.get(key);
      const targetKey = mapped ? normalizeVillage(mapped) : key;
      if (byVillage.has(targetKey)) {
        matchedTargets.add(targetKey);
        continue;
      }
      if (mapped) {
        // mapping saved but target no longer contains it
        newVillages.push({ village: entry.raw, achievement: entry.total });
        continue;
      }
      const suggestion = matchVillage(entry.raw, targetNames);
      if (suggestion.kind === "suggested" && suggestion.canonical) {
        suggestions.push({
          raw: entry.raw,
          suggested: suggestion.canonical,
          reason: suggestion.reason ?? "",
          achievement: entry.total,
        });
      } else {
        newVillages.push({ village: entry.raw, achievement: entry.total });
      }
    }

    const unmatchedTargets = [...byVillage.entries()]
      .filter(([key]) => !matchedTargets.has(key))
      .map(([key, t]) => ({
        village: t.village,
        target: t.target,
        hasAchievement: false,
        key,
      }));

    const difference =
      overallTarget !== null ? overallTarget - villageTargetSum : 0;

    return {
      version,
      overallTarget,
      overallSource: version.overallSource ?? null,
      villageTargetSum,
      difference,
      goatTarget: version.goatTarget ?? null,
      sheepTarget: version.sheepTarget ?? null,
      counts: {
        targetVillages: byVillage.size,
        achievementVillages: achievement.size,
        matched: matchedTargets.size,
        unmatchedTargets: unmatchedTargets.length,
        newVillages: newVillages.length,
      },
      unmatchedTargets: unmatchedTargets.slice(0, 200),
      newVillages: newVillages.slice(0, 200),
      suggestions: suggestions.slice(0, 50),
    };
  },
});

export const auditTrail = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_at", (q) => q.gte("at", 0))
      .order("desc")
      .take(Math.min(limit ?? 30, 100));
    return rows;
  },
});

/* ------------------------------------------------------------------ */
/* Internal mutations (invoked only from admin-verified actions)       */
/* ------------------------------------------------------------------ */

async function activateVersionInternal(
  ctx: MutationCtx,
  versionId: Id<"targetVersions">,
  by: string,
) {
  const next = await ctx.db.get(versionId);
  if (!next) throw new Error("Target version not found.");
  const previous = await getActiveVersion(ctx);

  if (previous && previous._id !== versionId) {
    await ctx.db.patch(previous._id, {
      status: "archived",
      archivedAt: Date.now(),
    });
  }
  await ctx.db.patch(versionId, {
    status: "active",
    activatedAt: Date.now(),
    archivedAt: undefined,
  });

  // ---- Change audit (§33) ----
  const prevRecords = previous
    ? (
        await ctx.db
          .query("targetRecords")
          .withIndex("by_version", (q) => q.eq("versionId", previous._id))
          .collect()
      ).map((r) => ({ village: normalizeVillage(r.village), target: r.totalTarget, name: r.village }))
    : [];
  const nextRecords = (
    await ctx.db
      .query("targetRecords")
      .withIndex("by_version", (q) => q.eq("versionId", versionId))
      .collect()
  ).map((r) => ({ village: normalizeVillage(r.village), target: r.totalTarget, name: r.village }));

  const prevMap = new Map(prevRecords.map((r) => [r.village, r]));
  const nextMap = new Map(nextRecords.map((r) => [r.village, r]));
  const villageChanges: {
    village: string;
    kind: "changed" | "new" | "removed";
    from?: number;
    to?: number;
  }[] = [];
  for (const [key, row] of nextMap) {
    const before = prevMap.get(key);
    if (!before) {
      villageChanges.push({ village: row.name, kind: "new", to: row.target });
    } else if (before.target !== row.target) {
      villageChanges.push({
        village: row.name,
        kind: "changed",
        from: before.target,
        to: row.target,
      });
    }
  }
  for (const [key, row] of prevMap) {
    if (!nextMap.has(key)) {
      villageChanges.push({
        village: row.name,
        kind: "removed",
        from: row.target,
      });
    }
  }

  const overallPrev = previous?.overallTarget ?? null;
  const overallNew = next.overallTarget ?? null;
  const summary = previous
    ? `Activated target V${next.versionNumber}: overall ${
        overallPrev ?? "—"
      } → ${overallNew ?? "—"} (change ${
        overallPrev !== null && overallNew !== null
          ? overallNew - overallPrev >= 0
            ? `+${overallNew - overallPrev}`
            : `${overallNew - overallPrev}`
          : "n/a"
      })`
    : `Activated target V${next.versionNumber}: overall ${overallNew ?? "—"}`;

  await ctx.db.insert("auditLog", {
    action: "target.activate",
    summary,
    details: JSON.stringify({
      previousVersion: previous?.versionNumber ?? null,
      nextVersion: next.versionNumber,
      overallPrev,
      overallNew,
      villageChanges: villageChanges.slice(0, 200),
    }),
    at: Date.now(),
    by,
  });

  return {
    previousVersion: previous?.versionNumber ?? null,
    nextVersion: next.versionNumber,
    overallPrev,
    overallNew,
    change:
      overallPrev !== null && overallNew !== null
        ? overallNew - overallPrev
        : null,
    villageChanges: villageChanges.slice(0, 200),
    villageChangeCount: villageChanges.length,
  };
}

export const createVersion = internalMutation({
  args: {
    fileName: v.string(),
    storageId: v.optional(v.string()),
    uploadedBy: v.string(),
    overallTarget: v.optional(v.number()),
    overallSource: v.optional(
      v.union(v.literal("pdf"), v.literal("sum")),
    ),
    goatTarget: v.optional(v.number()),
    sheepTarget: v.optional(v.number()),
    pages: v.optional(v.number()),
    confidence: v.optional(v.number()),
    warnings: v.optional(v.array(v.string())),
    extraction: v.union(
      v.literal("tables"),
      v.literal("text"),
      v.literal("no_text"),
    ),
    activate: v.boolean(),
    correctedRecords: v.number(),
    records: v.array(
      v.object({
        district: v.optional(v.string()),
        block: v.optional(v.string()),
        circle: v.optional(v.string()),
        village: v.string(),
        villageCode: v.optional(v.string()),
        species: v.optional(v.string()),
        goatTarget: v.optional(v.number()),
        sheepTarget: v.optional(v.number()),
        totalTarget: v.number(),
        sourcePage: v.optional(v.number()),
        confidence: v.optional(v.number()),
        manuallyCorrected: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.records.length === 0) {
      throw new Error("Cannot create a target version with no records.");
    }
    const existing = await ctx.db.query("targetVersions").collect();
    const versionNumber =
      existing.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;

    const versionId = await ctx.db.insert("targetVersions", {
      versionNumber,
      fileName: args.fileName,
      storageId: args.storageId,
      uploadedAt: Date.now(),
      uploadedBy: args.uploadedBy,
      overallTarget: args.overallTarget,
      overallSource: args.overallSource,
      goatTarget: args.goatTarget,
      sheepTarget: args.sheepTarget,
      villageCount: new Set(
        args.records.map((r) => normalizeVillage(r.village)),
      ).size,
      recordCount: args.records.length,
      pages: args.pages,
      confidence: args.confidence,
      warnings: args.warnings,
      extraction: args.extraction,
      status: "draft",
      correctedRecords: args.correctedRecords,
    });

    for (const record of args.records) {
      await ctx.db.insert("targetRecords", {
        versionId,
        ...record,
        normalizedVillage: normalizeVillage(record.village),
      });
    }

    await ctx.db.insert("auditLog", {
      action: "target.create",
      summary: `Target V${versionNumber} imported from ${args.fileName} (${args.records.length} records, overall ${args.overallTarget ?? "—"})`,
      at: Date.now(),
      by: args.uploadedBy,
    });

    let activation = null;
    if (args.activate) {
      activation = await activateVersionInternal(ctx, versionId, args.uploadedBy);
    }
    return { versionId, versionNumber, activation };
  },
});

export const activateVersion = internalMutation({
  args: { versionId: v.id("targetVersions"), by: v.string() },
  handler: async (ctx, { versionId, by }) =>
    await activateVersionInternal(ctx, versionId, by),
});

export const archiveVersion = internalMutation({
  args: { versionId: v.id("targetVersions"), by: v.string() },
  handler: async (ctx, { versionId, by }) => {
    const version = await ctx.db.get(versionId);
    if (!version) throw new Error("Target version not found.");
    await ctx.db.patch(versionId, {
      status: "archived",
      archivedAt: Date.now(),
    });
    await ctx.db.insert("auditLog", {
      action: "target.archive",
      summary: `Target V${version.versionNumber} archived`,
      at: Date.now(),
      by,
    });
    return { ok: true };
  },
});

export const saveMappingInternal = internalMutation({
  args: {
    alias: v.string(),
    canonical: v.string(),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, { alias, canonical, createdBy }) => {
    const existing = await ctx.db
      .query("villageMappings")
      .withIndex("by_alias", (q) => q.eq("alias", alias))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { canonical });
      return existing._id;
    }
    return await ctx.db.insert("villageMappings", {
      alias,
      canonical,
      createdAt: Date.now(),
      createdBy,
    });
  },
});

export const deleteMappingInternal = internalMutation({
  args: { id: v.id("villageMappings") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
