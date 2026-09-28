import { v } from "convex/values";
import { internalMutation, query, type QueryCtx } from "./_generated/server";
import { moveWithin, normalizeNotice } from "./lib/noticeRules";

/* ------------------------------------------------------------------ */
/* Notice Board — persistent public announcements (independent feature).*/
/* One row = one public bullet point. Reads are public (active notices  */
/* for everyone, full list for the admin UI — same convention as the   */
/* other admin read queries in this app, e.g. sync.history). ALL writes */
/* go through noticeActions.ts, which requires an admin session.       */
/* Nothing here touches vaccinationRecords, the sheet sync, or the     */
/* allocation pipeline.                                                */
/* ------------------------------------------------------------------ */

/** Admin-defined order: sortOrder ascending, creation time as tie-breaker. */
async function orderedNotices(ctx: QueryCtx) {
  const rows = await ctx.db
    .query("notices")
    .withIndex("by_sort")
    .order("asc")
    .collect();
  return rows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
  );
}

/** PUBLIC: active notices only — drives the dashboard Notice Board. */
export const listActive = query({
  args: {},
  handler: async (ctx) =>
    (await orderedNotices(ctx)).filter((notice) => notice.active),
});

/** ADMIN: every notice (active + inactive) for the management list. */
export const listAll = query({
  args: {},
  handler: async (ctx) => await orderedNotices(ctx),
});

/** Append a new notice at the end of the list. */
export const create = internalMutation({
  args: {
    title: v.optional(v.string()),
    content: v.string(),
    active: v.boolean(),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const norm = normalizeNotice(args.title, args.content);
    if (!norm.ok) throw new Error(norm.error);
    const last = await ctx.db
      .query("notices")
      .withIndex("by_sort")
      .order("desc")
      .first();
    const now = Date.now();
    return await ctx.db.insert("notices", {
      ...(norm.title ? { title: norm.title } : {}),
      content: norm.content,
      active: args.active,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
      ...(args.createdBy ? { createdBy: args.createdBy } : {}),
    });
  },
});

/** Replace the editable fields of a notice (edit form: title/content/active). */
export const update = internalMutation({
  args: {
    id: v.id("notices"),
    title: v.optional(v.string()),
    content: v.string(),
    active: v.boolean(),
  },
  handler: async (ctx, { id, title, content, active }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Notice not found.");
    const norm = normalizeNotice(title, content);
    if (!norm.ok) throw new Error(norm.error);
    await ctx.db.patch(id, {
      ...(norm.title ? { title: norm.title } : { title: undefined }),
      content: norm.content,
      active,
      updatedAt: Date.now(),
    });
  },
});

/** Activate / deactivate without deleting (deactivation keeps the row). */
export const setActive = internalMutation({
  args: { id: v.id("notices"), active: v.boolean() },
  handler: async (ctx, { id, active }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Notice not found.");
    await ctx.db.patch(id, { active, updatedAt: Date.now() });
  },
});

/** Permanent removal (admin-confirmed in the UI). */
export const remove = internalMutation({
  args: { id: v.id("notices") },
  handler: async (ctx, { id }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Notice not found.");
    await ctx.db.delete(id);
  },
});

/**
 * Move a notice one slot up or down. The resulting positions are persisted
 * as normalised sortOrder values (0, 1, 2, …) so the public list always
 * reads them back with a single index scan.
 */
export const move = internalMutation({
  args: {
    id: v.id("notices"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, { id, direction }) => {
    const rows = await orderedNotices(ctx);
    const index = rows.findIndex((row) => row._id === id);
    if (index < 0) throw new Error("Notice not found.");
    const next = moveWithin(rows, index, direction);
    if (!next) return { moved: false }; // already at the top/bottom edge
    const now = Date.now();
    for (let position = 0; position < next.length; position++) {
      const row = next[position];
      if (row.sortOrder === position && row._id !== id) continue;
      await ctx.db.patch(row._id, {
        sortOrder: position,
        ...(row._id === id ? { updatedAt: now } : {}),
      });
    }
    return { moved: true };
  },
});
