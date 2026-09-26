/**
 * Client mirror of `normalizeVillage` (src/convex/lib/villageMatch.ts):
 * lowercase, non-alphanumerics → spaces, standard abbreviations expanded,
 * filler words dropped. Used to align vaccination-record village names with
 * allocation scope keys so the public USER / VILLAGE filters work without a
 * server round-trip.
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

const FILLER = new Set([
  "village",
  "vill",
  "gaon",
  "gram",
  "revenue",
  "circle",
  "block",
  "town",
  "te",
  "t e",
]);

export function normalizeVillageClient(value: string): string {
  const tokens = value
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
