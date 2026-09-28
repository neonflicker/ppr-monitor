/**
 * Pure Notice Board rules — no Convex imports, so they are unit-testable
 * (scripts/test-notices.ts) and reusable from both the admin actions and the
 * internal mutations.
 *
 * One database Notice = one public bullet point (§14). The admin types plain
 * text; the dashboard adds the bullet symbol and any line breaks are kept.
 */

export const MAX_TITLE_LENGTH = 120;
export const MAX_CONTENT_LENGTH = 4000;

export type NormalizedNotice =
  | { ok: true; title?: string; content: string }
  | { ok: false; error: string };

/**
 * Trim + validate an admin-entered notice. The title is optional; the content
 * is required. CRLF is normalised so line breaks render identically
 * everywhere, and leading "•" characters are stripped so admins never have to
 * type the bullet themselves (the dashboard always draws it).
 */
export function normalizeNotice(
  title: string | undefined | null,
  content: string,
): NormalizedNotice {
  const cleanTitle = (title ?? "").trim();
  const cleanContent = (content ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*•\s+/gm, "")
    .trim();

  if (!cleanContent) {
    return { ok: false, error: "Notice content is required." };
  }
  if (cleanContent.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      error: `Notice content must be ${MAX_CONTENT_LENGTH} characters or fewer.`,
    };
  }
  if (cleanTitle.length > MAX_TITLE_LENGTH) {
    return {
      ok: false,
      error: `Notice title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
    };
  }
  return {
    ok: true,
    ...(cleanTitle ? { title: cleanTitle } : {}),
    content: cleanContent,
  };
}

/**
 * Reorder helper: return the list with `items[index]` swapped one slot up or
 * down, or null when the move is not possible (already at the edge / bad
 * index). Deterministic — the caller persists the resulting order.
 */
export function moveWithin<T>(
  items: T[],
  index: number,
  direction: "up" | "down",
): T[] | null {
  if (index < 0 || index >= items.length) return null;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return null;
  const next = items.slice();
  const held = next[index];
  next[index] = next[target];
  next[target] = held;
  return next;
}
