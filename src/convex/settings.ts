import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";

export const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1OSjX5Z_f_eutOHG2FflLzoR4vA3cWkDz8VO0JlewByI/edit?usp=sharing";

export const DEFAULT_SETTINGS = {
  key: "main" as const,
  districtName: "LAKHIMPUR",
  state: "ASSAM",
  sheetUrl: DEFAULT_SHEET_URL,
  sheetGid: "",
  pprValues: ["PPR", "PPR Vaccine", "PPRV", "PPR Vaccination"],
};

export type Settings = {
  districtName: string;
  state: string;
  sheetUrl: string;
  sheetGid?: string;
  programmeTarget?: number;
  vaccinationStartDate?: string;
  pprValues: string[];
};

/** Read current settings, falling back to program defaults. */
export async function readSettingsDoc(ctx: QueryCtx): Promise<Settings> {
  const doc = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "main"))
    .unique();
  if (!doc) {
    return {
      districtName: DEFAULT_SETTINGS.districtName,
      state: DEFAULT_SETTINGS.state,
      sheetUrl: DEFAULT_SETTINGS.sheetUrl,
      sheetGid: DEFAULT_SETTINGS.sheetGid,
      pprValues: [...DEFAULT_SETTINGS.pprValues],
    };
  }
  return {
    districtName: doc.districtName,
    state: doc.state,
    sheetUrl: doc.sheetUrl,
    sheetGid: doc.sheetGid,
    programmeTarget: doc.programmeTarget,
    vaccinationStartDate: doc.vaccinationStartDate,
    pprValues: doc.pprValues,
  };
}

/** Public, read-only program settings for the dashboard. */
export const get = query({
  args: {},
  handler: async (ctx) => readSettingsDoc(ctx),
});

/** Full settings for internal (admin-verified) server code. */
export const getRaw = internalQuery({
  args: {},
  handler: async (ctx) => readSettingsDoc(ctx),
});

/** Create the settings document on first use. */
export const ensure = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("settings", {
      ...DEFAULT_SETTINGS,
      pprValues: [...DEFAULT_SETTINGS.pprValues],
      updatedAt: Date.now(),
    });
  },
});

const patchArgs = {
  districtName: v.optional(v.string()),
  state: v.optional(v.string()),
  sheetUrl: v.optional(v.string()),
  sheetGid: v.optional(v.string()),
  programmeTarget: v.optional(v.number()),
  vaccinationStartDate: v.optional(v.string()),
  pprValues: v.optional(v.array(v.string())),
};

function buildPatch(args: Partial<Record<keyof typeof patchArgs, unknown>>) {
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (args.districtName !== undefined)
    patch.districtName =
      (args.districtName as string).trim() || DEFAULT_SETTINGS.districtName;
  if (args.state !== undefined)
    patch.state = (args.state as string).trim() || DEFAULT_SETTINGS.state;
  if (args.sheetUrl !== undefined)
    patch.sheetUrl =
      (args.sheetUrl as string).trim() || DEFAULT_SETTINGS.sheetUrl;
  if (args.sheetGid !== undefined)
    patch.sheetGid = (args.sheetGid as string).trim();
  if (args.programmeTarget !== undefined) {
    const target = args.programmeTarget as number;
    patch.programmeTarget =
      !Number.isFinite(target) || target <= 0
        ? undefined
        : Math.round(target);
  }
  if (args.vaccinationStartDate !== undefined)
    patch.vaccinationStartDate =
      ((args.vaccinationStartDate as string).trim() || undefined) as
        | string
        | undefined;
  if (args.pprValues !== undefined) {
    const values = (args.pprValues as string[])
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    patch.pprValues = values.length
      ? values
      : [...DEFAULT_SETTINGS.pprValues];
  }
  return patch;
}

/** Persist updated program settings (called only after admin verification). */
export const apply = internalMutation({
  args: patchArgs,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const patch = buildPatch(args);
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("settings", {
      key: "main",
      districtName:
        (patch.districtName as string | undefined) ??
        DEFAULT_SETTINGS.districtName,
      state: (patch.state as string | undefined) ?? DEFAULT_SETTINGS.state,
      sheetUrl:
        (patch.sheetUrl as string | undefined) ?? DEFAULT_SETTINGS.sheetUrl,
      sheetGid:
        (patch.sheetGid as string | undefined) ?? DEFAULT_SETTINGS.sheetGid,
      programmeTarget: patch.programmeTarget as number | undefined,
      vaccinationStartDate: patch.vaccinationStartDate as string | undefined,
      pprValues:
        (patch.pprValues as string[] | undefined) ??
        [...DEFAULT_SETTINGS.pprValues],
      updatedAt: Date.now(),
    });
  },
});
