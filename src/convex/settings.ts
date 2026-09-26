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
  dispensaryName: "SVD BOGINADI",
  state: "ASSAM",
  sheetUrl: DEFAULT_SHEET_URL,
  sheetGid: "",
  pprValues: ["PPR", "PPR Vaccine", "PPRV", "PPR Vaccination"],
};

/** Personnel designation buckets used by the Daily Report. */
export const DEFAULT_PERSONNEL = {
  departmental: [
    "VFA",
    "Doctor",
    "CVAS",
    "LDA",
    "MPW",
    "Veterinary Officer",
    "Livestock Inspector",
  ],
  semiGovernment: [] as string[],
  private: [] as string[],
};

export type Settings = {
  districtName: string;
  /** Operational/programme unit, e.g. "SVD BOGINADI". Falls back to districtName. */
  dispensaryName: string;
  state: string;
  sheetUrl: string;
  sheetGid?: string;
  programmeTarget?: number;
  vaccinationStartDate?: string;
  pprValues: string[];
  personnelDepartmental: string[];
  personnelSemiGovernment: string[];
  personnelPrivate: string[];
  defaultWasted: number;
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
      dispensaryName: DEFAULT_SETTINGS.dispensaryName,
      state: DEFAULT_SETTINGS.state,
      sheetUrl: DEFAULT_SETTINGS.sheetUrl,
      sheetGid: DEFAULT_SETTINGS.sheetGid,
      pprValues: [...DEFAULT_SETTINGS.pprValues],
      personnelDepartmental: [...DEFAULT_PERSONNEL.departmental],
      personnelSemiGovernment: [...DEFAULT_PERSONNEL.semiGovernment],
      personnelPrivate: [...DEFAULT_PERSONNEL.private],
      defaultWasted: 0,
    };
  }
  return {
    districtName: doc.districtName,
    // Docs created before the dispensary field existed fall back to the
    // centrally configured default (SVD BOGINADI).
    dispensaryName: doc.dispensaryName ?? DEFAULT_SETTINGS.dispensaryName,
    state: doc.state,
    sheetUrl: doc.sheetUrl,
    sheetGid: doc.sheetGid,
    programmeTarget: doc.programmeTarget,
    vaccinationStartDate: doc.vaccinationStartDate,
    pprValues: doc.pprValues,
    personnelDepartmental:
      doc.personnelDepartmental ?? [...DEFAULT_PERSONNEL.departmental],
    personnelSemiGovernment:
      doc.personnelSemiGovernment ?? [...DEFAULT_PERSONNEL.semiGovernment],
    personnelPrivate: doc.personnelPrivate ?? [...DEFAULT_PERSONNEL.private],
    defaultWasted: doc.defaultWasted ?? 0,
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
  dispensaryName: v.optional(v.string()),
  state: v.optional(v.string()),
  sheetUrl: v.optional(v.string()),
  sheetGid: v.optional(v.string()),
  programmeTarget: v.optional(v.number()),
  vaccinationStartDate: v.optional(v.string()),
  pprValues: v.optional(v.array(v.string())),
  personnelDepartmental: v.optional(v.array(v.string())),
  personnelSemiGovernment: v.optional(v.array(v.string())),
  personnelPrivate: v.optional(v.array(v.string())),
  defaultWasted: v.optional(v.number()),
};

function buildPatch(args: Partial<Record<keyof typeof patchArgs, unknown>>) {
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (args.districtName !== undefined)
    patch.districtName =
      (args.districtName as string).trim() || DEFAULT_SETTINGS.districtName;
  if (args.dispensaryName !== undefined)
    patch.dispensaryName =
      (args.dispensaryName as string).trim() || DEFAULT_SETTINGS.dispensaryName;
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
  if (args.personnelDepartmental !== undefined)
    patch.personnelDepartmental = (args.personnelDepartmental as string[])
      .map((s) => s.trim())
      .filter(Boolean);
  if (args.personnelSemiGovernment !== undefined)
    patch.personnelSemiGovernment = (args.personnelSemiGovernment as string[])
      .map((s) => s.trim())
      .filter(Boolean);
  if (args.personnelPrivate !== undefined)
    patch.personnelPrivate = (args.personnelPrivate as string[])
      .map((s) => s.trim())
      .filter(Boolean);
  if (args.defaultWasted !== undefined) {
    const wasted = args.defaultWasted as number;
    patch.defaultWasted =
      !Number.isFinite(wasted) || wasted < 0 ? 0 : Math.round(wasted);
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
      dispensaryName:
        (patch.dispensaryName as string | undefined) ??
        DEFAULT_SETTINGS.dispensaryName,
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
