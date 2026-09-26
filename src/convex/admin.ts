import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** Whether an administrator account has been set up yet. */
export const hasAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const first = await ctx.db.query("admins").first();
    return first !== null;
  },
});

/**
 * Create the administrator account. Guarded so it can only ever run while no
 * admin exists — later attempts are rejected instead of silently resetting
 * the credentials.
 */
export const createAdmin = internalMutation({
  args: {
    username: v.string(),
    displayName: v.string(),
    salt: v.string(),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("admins").first();
    if (existing) {
      throw new Error(
        "An administrator account already exists. Please sign in instead.",
      );
    }
    const duplicate = await ctx.db
      .query("admins")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .unique();
    if (duplicate) {
      throw new Error("That username is already taken.");
    }
    return await ctx.db.insert("admins", {
      username: args.username,
      displayName: args.displayName,
      salt: args.salt,
      passwordHash: args.passwordHash,
      createdAt: Date.now(),
    });
  },
});

export const findByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    return await ctx.db
      .query("admins")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
  },
});

/** Store a new session (only the SHA-256 hash of the token). */
export const createSession = internalMutation({
  args: {
    adminId: v.id("admins"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { adminId, tokenHash, expiresAt }) => {
    // Opportunistically prune expired sessions.
    const now = Date.now();
    const expired = await ctx.db
      .query("adminSessions")
      .collect();
    for (const session of expired) {
      if (session.expiresAt <= now) await ctx.db.delete(session._id);
    }
    return await ctx.db.insert("adminSessions", {
      adminId,
      tokenHash,
      createdAt: now,
      expiresAt,
    });
  },
});

export const getSession = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!session) return null;
    // Queries are read-only; expired sessions are pruned in createSession.
    if (session.expiresAt <= Date.now()) return null;
    const admin = await ctx.db.get(session.adminId);
    if (!admin) return null;
    return {
      adminId: admin._id,
      username: admin.username,
      displayName: admin.displayName,
      lastLoginAt: admin.lastLoginAt,
      expiresAt: session.expiresAt,
    };
  },
});

export const deleteSession = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

export const recordLogin = internalMutation({
  args: { adminId: v.id("admins") },
  handler: async (ctx, { adminId }) => {
    await ctx.db.patch(adminId, { lastLoginAt: Date.now() });
  },
});
