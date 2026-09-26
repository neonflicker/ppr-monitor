/**
 * Village name normalisation and matching.
 *
 * Village spellings differ between the Target PDF, Google Sheet and Bharat
 * Pashudhan export. Exact normalised matches are safe to auto-match; anything
 * ambiguous is only ever *suggested* so the administrator maps it manually.
 */

const ABBREVIATIONS: Record<string, string> = {
  n: "north",
  no: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
  num: "number",
  noz: "number",
  vill: "village",
  gr: "gram",
  gpm: "gaon",
};

/** Words that carry no identity for village matching. */
const FILLER = new Set([
  "village",
  "vill",
  "gaon",
  "gram",
  "gp",
  "the",
  "of",
  "near",
  "post",
  "po",
  "ps",
]);

/** Lowercase, strip punctuation, expand common abbreviations. */
export function normalizeVillage(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .normalize("NFKC")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t)
    .filter((t) => !FILLER.has(t));
  return tokens.join(" ");
}

/** Normalise a vaccinator/person name for keys (lighter than villages). */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export type MatchKind = "exact" | "suggested" | "none";

export interface MatchResult {
  kind: MatchKind;
  /** Canonical name when matched. */
  canonical?: string;
  /** Why a suggestion was made — shown to the administrator. */
  reason?: string;
}

/**
 * Match a raw village name against a list of canonical names
 * (target-village list of the active version).
 *
 * - exact: identical after normalisation → safe to auto-match
 * - suggested: one name fully contains the other (or shares a long prefix) →
 *   surfaced for manual confirmation, NEVER auto-applied
 * - none: no relationship detected
 */
export function matchVillage(
  raw: string,
  canonicalNames: string[],
): MatchResult {
  const norm = normalizeVillage(raw);
  if (!norm) return { kind: "none" };

  for (const canonical of canonicalNames) {
    if (normalizeVillage(canonical) === norm) {
      return { kind: "exact", canonical };
    }
  }

  let best: { canonical: string; reason: string } | null = null;
  for (const canonical of canonicalNames) {
    const other = normalizeVillage(canonical);
    if (!other) continue;
    const shorter = norm.length <= other.length ? norm : other;
    const longer = norm.length > other.length ? norm : other;
    if (shorter.length >= 6 && longer.includes(shorter)) {
      best = {
        canonical,
        reason: `“${raw}” contains/overlaps “${canonical}”`,
      };
      break;
    }
  }
  if (best) return { kind: "suggested", ...best };
  return { kind: "none" };
}

/**
 * Natural key shared by every vaccination record so the same real-world
 * event arriving from two sources is never counted twice.
 * Returns "" when the row lacks the minimum fields.
 */
export function naturalKeyOf(row: {
  dateKey?: string;
  village?: string;
  vaccinator?: string;
  goats: number;
  sheep: number;
}): string {
  if (!row.dateKey || !row.village) return "";
  return [
    row.dateKey,
    normalizeVillage(row.village),
    normalizeName(row.vaccinator ?? ""),
    row.goats,
    row.sheep,
  ].join("|");
}
