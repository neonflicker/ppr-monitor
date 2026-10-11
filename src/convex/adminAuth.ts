"use node";

import { ConvexError, v } from "convex/values";
import { normalizeName, normalizeVillage } from "./lib/villageMatch";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";

type SessionInfo = {
  adminId: Id<"admins">;
  username: string;
  displayName: string;
  lastLoginAt?: number;
  expiresAt: number;
};

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SESSION_EXPIRED = "SESSION_EXPIRED:";

function scryptHash(
  password: string,
  salt: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(
      Buffer.from(password, "utf8"),
      salt,
      64,
      SCRYPT,
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      },
    );
  });
}

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const DUMMY_SALT = randomBytes(16);
/** Runs one scrypt so a missing user costs the same time as a wrong password. */
async function burnTime(password: string) {
  await scryptHash(password, DUMMY_SALT);
}

function normalizeUsername(raw: string): string {
  const username = raw.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    throw new ConvexError(
      "Username must be 3–32 characters and may only contain letters, numbers, dots, dashes and underscores.",
    );
  }
  return username;
}

function assertPassword(password: string) {
  if (password.length < 8) {
    throw new ConvexError("Password must be at least 8 characters long.");
  }
  if (password.length > 200) {
    throw new ConvexError("Password must be 200 characters or fewer.");
  }
}

export async function requireAdmin(
  ctx: ActionCtx,
  token: string,
): Promise<{ username: string; displayName: string }> {
  if (!token) {
    throw new ConvexError(`${SESSION_EXPIRED} Please sign in as administrator.`);
  }
  const session: SessionInfo | null = await ctx.runQuery(
    internal.admin.getSession,
    { tokenHash: sha256(token) },
  );
  if (!session) {
    throw new ConvexError(
      `${SESSION_EXPIRED} Your administrator session has expired. Please sign in again.`,
    );
  }
  return { username: session.username, displayName: session.displayName };
}

async function issueSession(
  ctx: ActionCtx,
  adminId: Id<"admins">,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await ctx.runMutation(internal.admin.createSession, {
    adminId,
    tokenHash: sha256(token),
    expiresAt,
  });
  return { token, expiresAt };
}

/** Whether the admin account still needs to be created (first run). */
export const status = action({
  args: {},
  handler: async (ctx): Promise<{ needsSetup: boolean }> => {
    const hasAdmin: boolean = await ctx.runQuery(internal.admin.hasAdmin, {});
    return { needsSetup: !hasAdmin };
  },
});

/** First-run only: create the single administrator account. */
export const setup = action({
  args: {
    username: v.string(),
    password: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { username, password, displayName },
  ): Promise<{ token: string; username: string; expiresAt: number }> => {
    const user = normalizeUsername(username);
    assertPassword(password);
    const already: boolean = await ctx.runQuery(internal.admin.hasAdmin, {});
    if (already) {
      throw new ConvexError(
        "An administrator account already exists. Please sign in instead.",
      );
    }
    const salt = randomBytes(16);
    const passwordHash = (await scryptHash(password, salt)).toString("hex");
    const adminId = await ctx.runMutation(internal.admin.createAdmin, {
      username: user,
      displayName: (displayName ?? "").trim() || "Administrator",
      salt: salt.toString("hex"),
      passwordHash,
    });
    await ctx.runMutation(internal.settings.ensure, {});
    await ctx.runMutation(internal.admin.recordLogin, { adminId });
    const session = await issueSession(ctx, adminId);
    return { token: session.token, username: user, expiresAt: session.expiresAt };
  },
});

/** Verify username + password and start an admin session. */
export const login = action({
  args: {
    username: v.string(),
    password: v.string(),
  },
  handler: async (
    ctx,
    { username, password },
  ): Promise<{ token: string; username: string; expiresAt: number }> => {
    const user = normalizeUsername(username);
    const admin: Doc<"admins"> | null = await ctx.runQuery(
      internal.admin.findByUsername,
      { username: user },
    );
    if (!admin) {
      await burnTime(password);
      throw new ConvexError("Incorrect username or password.");
    }
    const derived = await scryptHash(
      password,
      Buffer.from(admin.salt, "hex"),
    );
    const stored = Buffer.from(admin.passwordHash, "hex");
    const ok = derived.length === stored.length && timingSafeEqual(derived, stored);
    if (!ok) {
      throw new ConvexError("Incorrect username or password.");
    }
    await ctx.runMutation(internal.admin.recordLogin, { adminId: admin._id });
    const session = await issueSession(ctx, admin._id);
    return {
      token: session.token,
      username: admin.username,
      expiresAt: session.expiresAt,
    };
  },
});

/** Validate a session token (used by the client to restore sign-in). */
type MeResult = {
  authenticated: boolean;
  needsSetup: boolean;
  admin: {
    username: string;
    displayName: string;
    lastLoginAt: number | null;
    expiresAt: number;
  } | null;
};

export const me = action({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }): Promise<MeResult> => {
    const hasAdmin: boolean = await ctx.runQuery(internal.admin.hasAdmin, {});
    if (!token) {
      return { authenticated: false, needsSetup: !hasAdmin, admin: null };
    }
    const session: SessionInfo | null = await ctx.runQuery(
      internal.admin.getSession,
      { tokenHash: sha256(token) },
    );
    if (!session) {
      return { authenticated: false, needsSetup: !hasAdmin, admin: null };
    }
    return {
      authenticated: true,
      needsSetup: false,
      admin: {
        username: session.username,
        displayName: session.displayName,
        lastLoginAt: session.lastLoginAt ?? null,
        expiresAt: session.expiresAt,
      },
    };
  },
});

export const logout = action({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, { token }): Promise<{ ok: boolean }> => {
    if (token) {
      await ctx.runMutation(internal.admin.deleteSession, {
        tokenHash: sha256(token),
      });
    }
    return { ok: true };
  },
});

/** Return request history only after validating the Admin session token. */
export const completedVaccinationRequests = action({
  args: { token: v.string() },
  handler: async (
    ctx,
    { token },
  ): Promise<Array<{
    _id: Id<"vaccinationRequests">;
    timestamp: string;
    submittedAt: number;
    requestDate: number;
    village: string;
    requestorName?: string;
    email?: string;
    phone?: string;
    vaccinationDoneBefore?: string;
    remarks?: string;
    fields?: { header: string; value: string }[];
    completedAt?: number;
    completionSource?: string;
    assignedVfa: string;
  }>> => {
    await requireAdmin(ctx, token);
    return await ctx.runQuery(internal.sync.getCompletedRequests, {});
  },
});

export const pendingVaccinationRequests = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<Array<{ _id: Id<"vaccinationRequests">; timestamp: string; submittedAt: number; requestDate: number; village: string; assignedVfa: string; fields?: { header: string; value: string }[] }>> => {
    await requireAdmin(ctx, token);
    return await ctx.runQuery(internal.sync.getPendingRequests, {});
  },
});

export const villageVfaAssignmentOptions = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ staff: string[]; rows: Array<{ village: string; normalizedVillage: string; candidates: string[]; assigned: string[] }> }> => {
    await requireAdmin(ctx, token);
    return await ctx.runQuery(internal.villageAssignments.assignmentOptions, {});
  },
});

export const saveVillageVfaAssignment = action({
  args: { token: v.string(), village: v.string(), vfaNames: v.array(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    const village = args.village.trim().replace(/\s+/g, " ");
    const normalizedVillage = normalizeVillage(village);
    if (!normalizedVillage) throw new ConvexError("Village name is required.");
    const people: string[] = await ctx.runQuery(internal.villageAssignments.activeVfas, {});
    const names = [...new Set(args.vfaNames.map((name) => people.find((person: string) => normalizeName(person) === normalizeName(name))).filter((name): name is string => !!name))];
    if (names.length !== new Set(args.vfaNames.map(normalizeName)).size) throw new ConvexError("Assignments may only use active VFA personnel.");
    await ctx.runMutation(internal.villageAssignments.saveInternal, { village, normalizedVillage, vfaNames: names, updatedBy: admin.username });
    return { ok: true };
  },
});

/** Admin-only program settings update (target, sheet URL, PPR values, …). */
export const updateSettings = action({
  args: {
    token: v.string(),
    districtName: v.optional(v.string()),
    dispensaryName: v.optional(v.string()),
    state: v.optional(v.string()),
    sheetUrl: v.optional(v.string()),
    sheetGid: v.optional(v.string()),
    requestSheetUrl: v.optional(v.string()),
    requestSheetGid: v.optional(v.string()),
    programmeTarget: v.optional(v.number()),
    vaccinationStartDate: v.optional(v.string()),
    pprValues: v.optional(v.array(v.string())),
    personnelDepartmental: v.optional(v.array(v.string())),
    personnelSemiGovernment: v.optional(v.array(v.string())),
    personnelPrivate: v.optional(v.array(v.string())),
    defaultWasted: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx, args.token);
    if (args.programmeTarget !== undefined) {
      if (!Number.isFinite(args.programmeTarget)) {
        throw new ConvexError("Programme target must be a number.");
      }
      if (args.programmeTarget < 0) {
        throw new ConvexError("Programme target cannot be negative.");
      }
    }
    for (const url of [args.sheetUrl, args.requestSheetUrl]) {
      if (url !== undefined && url.trim() !== "") {
        const trimmed = url.trim();
        if (!trimmed.startsWith("https://docs.google.com/spreadsheets/")) {
          throw new ConvexError(
            "Sheet URLs must be docs.google.com/spreadsheets links.",
          );
        }
      }
    }
    const { token: _token, ...patch } = args;
    await ctx.runMutation(internal.settings.apply, patch);
    return { ok: true };
  },
});
