"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { requireAdmin } from "./adminAuth";
import { normalizeNotice } from "./lib/noticeRules";

/**
 * ADMIN Notice Board operations. Every action authenticates the session with
 * the existing requireAdmin helper first — the public client can only READ
 * active notices (api.notices.listActive); it has no path to any mutation.
 *
 * These are thin, validated wrappers around internal.notices.* so the
 * dashboard's management UI follows the same action + internal mutation
 * pattern used by allocationActions / bharatActions / targetActions.
 */

function assertNotice(title: string | undefined, content: string) {
  const norm = normalizeNotice(title, content);
  if (!norm.ok) throw new ConvexError(norm.error);
  return norm;
}

/** ADMIN: add a notice (appended to the end of the public list). */
export const createNotice = action({
  args: {
    token: v.string(),
    title: v.optional(v.string()),
    content: v.string(),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ id: string }> => {
    const admin = await requireAdmin(ctx, args.token);
    const norm = assertNotice(args.title, args.content);
    const id: string = await ctx.runMutation(internal.notices.create, {
      ...(norm.title ? { title: norm.title } : {}),
      content: norm.content,
      active: args.active ?? true,
      createdBy: admin.username,
    });
    return { id };
  },
});

/** ADMIN: save edits to an existing notice (title, content, active state). */
export const updateNotice = action({
  args: {
    token: v.string(),
    id: v.string(),
    title: v.optional(v.string()),
    content: v.string(),
    active: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx, args.token);
    const norm = assertNotice(args.title, args.content);
    await ctx.runMutation(internal.notices.update, {
      id: args.id as Id<"notices">,
      ...(norm.title ? { title: norm.title } : {}),
      content: norm.content,
      active: args.active,
    });
    return { ok: true };
  },
});

/** ADMIN: activate/deactivate — deactivation hides but never deletes. */
export const setNoticeActive = action({
  args: { token: v.string(), id: v.string(), active: v.boolean() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx, args.token);
    await ctx.runMutation(internal.notices.setActive, {
      id: args.id as Id<"notices">,
      active: args.active,
    });
    return { ok: true };
  },
});

/** ADMIN: permanently delete a notice (confirmed in the UI first). */
export const deleteNotice = action({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx, args.token);
    await ctx.runMutation(internal.notices.remove, {
      id: args.id as Id<"notices">,
    });
    return { ok: true };
  },
});

/** ADMIN: reorder — move a notice one slot up or down; order is persisted. */
export const moveNotice = action({
  args: {
    token: v.string(),
    id: v.string(),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args): Promise<{ moved: boolean }> => {
    await requireAdmin(ctx, args.token);
    return await ctx.runMutation(internal.notices.move, {
      id: args.id as Id<"notices">,
      direction: args.direction,
    });
  },
});
