/**
 * Pure helpers for reading the PPR Google Sheet.
 *
 * The sheet column order/names are NOT assumed — headers are matched
 * logically so re-ordered or renamed columns still map correctly.
 * This module must stay dependency-free (no node builtins, no Convex APIs)
 * so it can be shared by node actions and regular Convex functions.
 */

import { naturalKeyOf } from "./villageMatch";

export type FieldKey =
  | "recordId"
  | "timestamp"
  | "date"
  | "vaccinator"
  | "designation"
  | "vaccinatorId"
  | "village"
  | "goats"
  | "sheep"
  | "taggedGoat"
  | "taggedSheep"
  | "wasted"
  | "farmers"
  | "email"
  | "remarks"
  | "disease"
  | "species"
  | "quantity"
  | "tagId";

export const FIELD_LABELS: Record<FieldKey, string> = {
  recordId: "Record ID",
  timestamp: "Timestamp",
  date: "Vaccination Date",
  vaccinator: "Vaccinator",
  designation: "Designation",
  vaccinatorId: "Vaccinator ID",
  village: "Village",
  goats: "Goats Vaccinated",
  sheep: "Sheep Vaccinated",
  taggedGoat: "Tagged Goats",
  taggedSheep: "Tagged Sheep",
  wasted: "Wasted Doses",
  farmers: "Farmers Covered",
  email: "Email",
  remarks: "Remarks",
  disease: "Disease / Vaccine",
  species: "Species",
  quantity: "Number Vaccinated",
  tagId: "Tag ID",
};

/** Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignore; \r\n handled by the \n branch
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Spec normalisation: lowercase, trim, collapse repeated whitespace. */
export function normalizeHeaderText(header: string): string {
  return header.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Headers that denote the Village field by their exact wording. */
const VILLAGE_EXACT_HEADERS = new Set([
  "village",
  "villagename",
  "nameofthevillage",
  "nameofvillage",
]);

/** Words that make a "village"-worded header a question/flag/target column
 *  instead of the Village field (e.g. “Is vaccination completed in the
 *  village?”, “Village Target”, “Village Covered? Yes/No”). */
const NON_VILLAGE_HEADER_WORDS = new Set([
  "yes", "no", "y", "n", "target", "targets", "achieved", "achievement",
  "completed", "complete", "status", "same", "check", "checked", "confirm",
  "confirmed", "verified", "total", "count", "number", "required",
]);

/** Classification rank for a column whose header mentions "village":
 *  0 = exact Village header (e.g. Column O “Village”, “Village Name”)
 *  1 = clean village-ish header that is not a question/flag/target
 *  2 = question/flag/target header — never the primary Village column. */
export function villageHeaderRank(raw: string): 0 | 1 | 2 {
  const norm = normalizeHeader(raw);
  if (VILLAGE_EXACT_HEADERS.has(norm)) return 0;
  const text = normalizeHeaderText(raw);
  if (text.includes("?")) return 2;
  const tokens = text.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  return tokens.some((t) => NON_VILLAGE_HEADER_WORDS.has(t)) ? 2 : 1;
}

/** Values that must never be treated as a village name when read from a
 *  secondary (legacy) column: Yes/No answers, bare numbers, target text. */
const NON_VILLAGE_VALUES = new Set([
  "yes", "no", "y", "n", "true", "false", "done", "complete", "completed",
  "target", "targets", "total", "na", "nil",
]);

/** Does a cell value plausibly hold a village name? Used only for the
 *  guarded legacy-column fallback so a Yes/No or Target answer can never
 *  become a village. */
export function looksLikeVillage(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const text = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!text) return false;
  if (NON_VILLAGE_VALUES.has(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (/^(target|total|count)\b/.test(text)) return false;
  if (trimmed.includes("?")) return false;
  return text.length >= 2;
}

const isBlank = (s: string) => s.trim() === "";

/** Matches a header (raw + normalised) to a logical application field. */
function matchField(norm: string, raw: string): FieldKey | null {
  if (!norm) return null;
  const has = (...parts: string[]) => parts.every((p) => norm.includes(p));

  // Specific / unique identifiers first.
  if (has("record", "id") || has("unique", "id") || has("submission", "id"))
    return "recordId";
  if (norm === "timestamp" || has("time", "stamp")) return "timestamp";
  // "Date", "Vaccination Date" … but not "Goat Vaccinated on Date" etc.
  if (
    norm === "date" ||
    (has("date") && !/(goat|sheep|tagged|farmer|wast|start|timestamp)/.test(norm))
  )
    return "date";
  if (/^tag$|^tags$|tagid|tagno|tagnumber|eartag/.test(norm)) return "tagId";
  if (
    has("quantity") ||
    has("number", "vaccinated") ||
    has("animal", "vaccinated") ||
    has("count", "vaccinated")
  )
    return "quantity";
  if (has("vaccinator", "id")) return "vaccinatorId";
  if (has("vaccinator") && has("name")) return "vaccinator";
  if (norm === "vaccinator" || norm === "nameofthevaccinator") return "vaccinator";
  if (has("designation") || has("category")) return "designation";
  if (has("village")) return "village";
  if (has("goat") && has("vaccin")) return "goats";
  if (has("sheep") && has("vaccin")) return "sheep";
  if (has("goat") && has("tag")) return "taggedGoat";
  if (has("sheep") && has("tag")) return "taggedSheep";
  if (has("wast")) return "wasted";
  if (has("farmer") || (has("owner") && has("animal"))) return "farmers";
  if (has("disease") || has("vaccine") || has("pathogen")) return "disease";
  if (has("species") || has("animaltype")) return "species";
  if (has("email")) return "email";
  if (has("remark") || has("comment") || has("observation")) return "remarks";
  // "Name of the Vaccinator" style leftovers.
  if (raw.toLowerCase().includes("vaccinator") && !norm.includes("id"))
    return "vaccinator";
  return null;
}

export interface ColumnMapping {
  mapping: Partial<Record<FieldKey, number>>;
  headers: string[];
  unmapped: string[];
  /** Other columns whose header also mentions "village" (e.g. the legacy
   *  column left behind when the form gained a new Village field). Only
   *  consulted when the primary Village cell is blank, and only for values
   *   that plausibly are village names. */
  villageFallbacks: number[];
}

/**
 * Map sheet headers to fields regardless of order or exact wording.
 *
 * Village handling (§Issue 1): every header mentioning "village" becomes a
 * candidate, but the PRIMARY column is chosen by header wording — an exact
 * "Village" / "Village Name" header (currently Column O) always beats a
 * question/flag column such as “Is vaccination completed in the village?”
 * (currently Column N). Non-winning candidates are exposed as guarded
 * per-row fallbacks and reported as unmapped.
 */
export function mapColumns(headers: string[]): ColumnMapping {
  const mapping: Partial<Record<FieldKey, number>> = {};
  const unmapped: string[] = [];
  const villageCandidates: number[] = [];

  headers.forEach((raw, index) => {
    if (isBlank(raw)) return;
    const field = matchField(normalizeHeader(raw), raw);
    if (field === "village") {
      // Handled below — multiple headers can mention "village".
      villageCandidates.push(index);
      return;
    }
    if (field && mapping[field] === undefined) {
      mapping[field] = index;
    } else {
      unmapped.push(raw.trim());
    }
  });

  const villageFallbacks: number[] = [];
  if (villageCandidates.length > 0) {
    const ordered = [...villageCandidates].sort(
      (a, b) =>
        villageHeaderRank(headers[a]) - villageHeaderRank(headers[b]) || a - b,
    );
    mapping.village = ordered[0];
    for (const idx of ordered.slice(1)) {
      villageFallbacks.push(idx);
      unmapped.push(headers[idx].trim());
    }
  }

  return { mapping, headers, unmapped, villageFallbacks };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a sheet date cell into UTC ms for that calendar day.
 * Handles M/D/YYYY, D/M/YYYY, D-M-YYYY, ISO, month names and Excel serials.
 * Ambiguous numeric dates default to M/D/YYYY (Google Forms default).
 */
export function parseSheetDate(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (!s) return null;

  const make = (y: number, m: number, d: number): number | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
    const ms = Date.UTC(y, m - 1, d);
    const check = new Date(ms);
    if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    return ms;
  };

  // ISO: 2026-09-25 (optionally with time)
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return make(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Numeric: 9/25/2026 | 25-09-2026 | 25.09.2026 (optionally with time)
  const num = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (num) {
    let a = Number(num[1]);
    let b = Number(num[2]);
    let y = Number(num[3]);
    if (y < 100) y += 2000;
    let month = a;
    let day = b;
    if (a > 12) {
      month = b;
      day = a;
    } else if (b > 12) {
      month = a;
      day = b;
    }
    const ms = make(y, month, day);
    if (ms !== null) return ms;
  }

  // Day-month-name-year: 25-Sep-2026 / 25 September 2026
  const dmy = s.match(/^(\d{1,2})[- ]([A-Za-z]{3,})[- ,]+(\d{4})/);
  if (dmy) {
    const m = MONTHS[dmy[2].slice(0, 3).toLowerCase()];
    if (m) {
      const ms = make(Number(dmy[3]), m, Number(dmy[1]));
      if (ms !== null) return ms;
    }
  }

  // Month-day-year: Sep 25, 2026
  const mdy = s.match(/^([A-Za-z]{3,})[- ]+(\d{1,2})[,-]?[- ]+(\d{4})/);
  if (mdy) {
    const m = MONTHS[mdy[1].slice(0, 3).toLowerCase()];
    if (m) {
      const ms = make(Number(mdy[3]), m, Number(mdy[2]));
      if (ms !== null) return ms;
    }
  }

  // Excel serial number (e.g. 46290)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    const epoch = Date.UTC(1899, 11, 30);
    return make(
      new Date(epoch + serial * 86400000).getUTCFullYear(),
      new Date(epoch + serial * 86400000).getUTCMonth() + 1,
      new Date(epoch + serial * 86400000).getUTCDate(),
    );
  }

  return null;
}

/** Parse a count cell ("1,234", "125", "-", "" …) into a non-negative integer. */
export function toCount(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const s = raw.trim().replace(/,/g, "");
  if (!s || s === "-" || /^(n\/?a|na|nil|none|-)$/i.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

export function dateKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Stable 32-bit FNV-1a hash used to detect changed rows between syncs. */
export function rowHash(values: string[]): string {
  const s = values.join("\u0001");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function normalizePpr(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Decide whether a record counts towards PPR achievement.
 * Rows without a disease/vaccine column come from the PPR form and count.
 */
export function isPprRecord(
  disease: string | undefined,
  pprValues: string[],
): boolean {
  if (disease === undefined || disease.trim() === "") return true;
  const target = normalizePpr(disease);
  if (!target) return true;
  return pprValues.some((v) => normalizePpr(v) === target);
}

export interface NormalizedRow {
  externalKey: string;
  naturalKey?: string;
  rawHash: string;
  status: "valid" | "rejected";
  rejectReason?: string;
  isPpr: boolean;
  date?: number;
  dateKey?: string;
  village?: string;
  vaccinator?: string;
  designation?: string;
  vaccinatorId?: string;
  disease?: string;
  species?: string;
  goats: number;
  sheep: number;
  taggedGoat: number;
  taggedSheep: number;
  wasted: number;
  farmers: number;
  timestamp?: string;
  email?: string;
  remarks?: string;
}

export interface ParsedSheet {
  headers: string[];
  mapping: Partial<Record<FieldKey, number>>;
  mappedLabels: string[];
  unmapped: string[];
  totalRows: number;
  records: NormalizedRow[];
  reasons: { reason: string; count: number }[];
  fatal?: string;
}

const get = (cells: string[], idx: number | undefined): string =>
  idx === undefined ? "" : (cells[idx] ?? "").trim();

/**
 * Read the Village cell for one row.
 *
 * The mapped column (the exact-header Village column, currently Column O) is
 * authoritative: whenever it has a value, that value is used. Only when it is
 * blank do we consult the guarded legacy fallbacks (other "village"-worded
 * columns, in header-rank order) — and only for values that plausibly are
 * village names, so a Yes/No answer or a target number can never become a
 * village (§Issue 1).
 */
function readVillage(
  cells: string[],
  primary: number | undefined,
  fallbacks: number[],
): string {
  const primaryValue = get(cells, primary);
  if (primaryValue) return primaryValue;
  for (const idx of fallbacks) {
    const candidate = get(cells, idx);
    if (looksLikeVillage(candidate)) return candidate;
  }
  return "";
}

/**
 * Parse a full sheet (headers + data rows) into normalised records.
 * Returns a `fatal` error when required columns cannot be located.
 */
export function parseSheet(text: string, pprValues: string[]): ParsedSheet {
  const rows = parseCsv(text).filter((r) => r.some((c) => !isBlank(c)));
  if (rows.length === 0) {
    return {
      headers: [],
      mapping: {},
      mappedLabels: [],
      unmapped: [],
      totalRows: 0,
      records: [],
      reasons: [],
      fatal: "The sheet is empty — no rows were found.",
    };
  }

  const headers = rows[0];
  const { mapping, unmapped, villageFallbacks } = mapColumns(headers);
  const mappedLabels = (Object.keys(mapping) as FieldKey[]).map(
    (f) => `${headers[mapping[f]!]} → ${FIELD_LABELS[f]}`,
  );

  const missing: string[] = [];
  if (mapping.date === undefined) missing.push("a vaccination date column");
  if (mapping.village === undefined) missing.push("a village column");
  const hasCount =
    mapping.goats !== undefined ||
    mapping.sheep !== undefined ||
    mapping.taggedGoat !== undefined ||
    mapping.taggedSheep !== undefined;
  if (!hasCount) missing.push("a vaccinated-count column (goats/sheep)");

  if (missing.length > 0) {
    const seen = headers.filter((h) => !isBlank(h)).join(", ");
    return {
      headers,
      mapping,
      mappedLabels,
      unmapped,
      totalRows: Math.max(0, rows.length - 1),
      records: [],
      reasons: [],
      fatal: `Could not find ${missing.join(", ")} in the sheet. Detected columns: ${seen}.`,
    };
  }

  const dataRows = rows.slice(1);
  const records: NormalizedRow[] = [];
  const reasonCount = new Map<string, number>();
  const bump = (reason: string) =>
    reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1);

  dataRows.forEach((cells) => {
    const dateRaw = get(cells, mapping.date);
    const dateMs = parseSheetDate(dateRaw || undefined);
    const village = readVillage(cells, mapping.village, villageFallbacks);
    const vaccinator = get(cells, mapping.vaccinator);
    const timestamp = get(cells, mapping.timestamp);
    const recordId = get(cells, mapping.recordId);
    const disease = get(cells, mapping.disease) || undefined;
    const species = get(cells, mapping.species) || undefined;

    const goats = toCount(get(cells, mapping.goats));
    const sheep = toCount(get(cells, mapping.sheep));
    const taggedGoat = toCount(get(cells, mapping.taggedGoat));
    const taggedSheep = toCount(get(cells, mapping.taggedSheep));
    const wasted = toCount(get(cells, mapping.wasted));
    const farmers = toCount(get(cells, mapping.farmers));

    const base: NormalizedRow = {
      externalKey: "",
      rawHash: rowHash(cells.map((c) => c.trim())),
      status: "valid",
      isPpr: isPprRecord(disease, pprValues),
      goats,
      sheep,
      taggedGoat,
      taggedSheep,
      wasted,
      farmers,
      timestamp: timestamp || undefined,
      email: get(cells, mapping.email) || undefined,
      remarks: get(cells, mapping.remarks) || undefined,
      vaccinator: vaccinator || undefined,
      designation: get(cells, mapping.designation) || undefined,
      vaccinatorId: get(cells, mapping.vaccinatorId) || undefined,
      disease,
      species,
      village: village || undefined,
      date: dateMs ?? undefined,
      dateKey: dateMs !== null ? dateKeyFromMs(dateMs) : undefined,
    };

    // Unique record identifier: explicit record id when the sheet has one,
    // otherwise a composite of the distinguishing fields.
    base.externalKey = recordId
      ? `id:${recordId}`
      : [
          "k",
          base.dateKey ?? dateRaw,
          base.village ?? "",
          base.vaccinator ?? "",
          timestamp,
          goats,
          sheep,
          taggedGoat,
          taggedSheep,
        ].join("|");

    // Validation — invalid rows are retained (status "rejected") with a reason.
    if (dateMs === null) {
      base.status = "rejected";
      base.rejectReason = dateRaw
        ? `Invalid vaccination date: "${dateRaw}"`
        : "Missing vaccination date";
      bump(base.rejectReason.startsWith("Invalid") ? "Invalid date" : "Missing date");
    } else if (!village) {
      base.status = "rejected";
      base.rejectReason = "Missing village";
      bump("Missing village");
    } else if (goats + sheep + taggedGoat + taggedSheep === 0) {
      base.status = "rejected";
      base.rejectReason = "No vaccination counts in row";
      bump("No vaccination counts");
    }

    records.push(base);
  });

  const reasons = [...reasonCount.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    headers,
    mapping,
    mappedLabels,
    unmapped,
    totalRows: dataRows.length,
    records,
    reasons,
  };
}

/** Build the public CSV export URL for a Google Sheets link. */
export function buildCsvUrl(sheetUrl: string, gid?: string): string {
  const trimmed = sheetUrl.trim();
  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    if (/\/export\?/.test(trimmed)) return trimmed;
    throw new Error(
      "The Google Sheet URL does not look like a Google Sheets link. Expected something like https://docs.google.com/spreadsheets/d/<ID>/edit",
    );
  }
  let url = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv`;
  const gidFromUrl = trimmed.match(/[?&]gid=(\d+)/);
  const gidValue = gid && gid.trim() ? gid.trim() : gidFromUrl?.[1];
  if (gidValue) url += `&gid=${gidValue}`;
  return url;
}

/* ------------------------------------------------------------------ */
/* Deterministic sync reconciliation (§Issue 2)                         */
/* ------------------------------------------------------------------ */

/** A stored vaccination record as seen by the sync (source is provenance). */
export interface ExistingRecord {
  id: string;
  externalKey: string;
  naturalKey?: string;
  source: string; // "google_sheet" | "bharat_pashudhan"
  rawHash: string;
  status: "valid" | "rejected";
}

export interface SheetDiff {
  /** rows to insert */
  inserts: NormalizedRow[];
  /** stored rows to overwrite (edit / re-key in place — never a 2nd copy) */
  updates: { id: string; row: NormalizedRow }[];
  /** stored google_sheet rows that no longer exist in the sheet */
  deletions: string[];
  unchanged: number;
  validProcessed: number;
  invalidProcessed: number;
  sheetDuplicates: number;
  eventDuplicates: number;
  /** parsed-column reasons merged with cross-sync dedup reasons */
  reasons: { reason: string; count: number }[];
}

/**
 * Diff the CURRENT sheet rows against the stored records.
 *
 * Pure and idempotent — the same (sheet, store) pair always yields the same
 * diff, and applying it makes the store mirror the sheet exactly:
 *
 *   · new row        → one insert
 *   · edited row     → one update of the SAME record (no second copy)
 *   · deleted row    → one deletion of the google_sheet record
 *   · no change      → everything lands in `unchanged`
 *
 * Reconciliation only ever targets source = "google_sheet"; Bharat Pashudhan
 * and every other source are left untouched. Provenance lives on the record
 * itself (`source`), so the sync can safely reconcile its own dataset.
 */
export function diffSheetRecords(
  parsed: ParsedSheet,
  existing: ExistingRecord[],
): SheetDiff {
  const byKey = new Map<string, ExistingRecord>();
  // naturalKey → the stored record, so an edited row updates its own record.
  const byNatural = new Map<string, ExistingRecord>();
  for (const row of existing) {
    byKey.set(row.externalKey, row);
    if (row.status === "valid" && row.naturalKey) {
      const prev = byNatural.get(row.naturalKey);
      // Prefer the google_sheet owner so sheet edits re-key that record
      // instead of being skipped against a Bharat duplicate.
      if (
        !prev ||
        (prev.source !== "google_sheet" && row.source === "google_sheet")
      ) {
        byNatural.set(row.naturalKey, row);
      }
    }
  }

  const inserts: NormalizedRow[] = [];
  const updates: { id: string; row: NormalizedRow }[] = [];
  const seenInSheet = new Set<string>();
  const batchNaturals = new Set<string>();
  const reasonCount = new Map<string, number>();
  const bump = (reason: string) =>
    reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1);

  let unchanged = 0;
  let validProcessed = 0;
  let invalidProcessed = 0;
  let sheetDuplicates = 0;
  let eventDuplicates = 0;

  for (const row of parsed.records) {
    const natural = naturalKeyOf(row);
    row.naturalKey = natural || undefined;

    if (seenInSheet.has(row.externalKey)) {
      sheetDuplicates++;
      bump("Duplicate row within sheet (skipped)");
      continue;
    }
    seenInSheet.add(row.externalKey);
    if (row.status === "rejected") invalidProcessed++;
    else validProcessed++;

    const match = byKey.get(row.externalKey);

    if (row.status === "valid" && natural && !match) {
      const owner = byNatural.get(natural);
      if (owner && owner.source === "google_sheet") {
        // Same real-world sheet event under a changed key (edited spelling,
        // village, timestamp…) → update the stored record in place. Mark the
        // old key as seen so reconciliation does not delete the record it is
        // about to re-key.
        if (!batchNaturals.has(natural)) {
          batchNaturals.add(natural);
          seenInSheet.add(owner.externalKey);
          updates.push({ id: owner.id, row });
          continue;
        }
      } else if (owner) {
        // Cross-source duplicate (Bharat Pashudhan) — never counted twice.
        eventDuplicates++;
        bump(
          owner.source === "bharat_pashudhan"
            ? "Matches a Bharat Pashudhan record (not counted twice)"
            : "Duplicate vaccination event (already stored)",
        );
        continue;
      }
    }
    if (row.status === "valid" && natural) {
      if (batchNaturals.has(natural)) {
        eventDuplicates++;
        bump("Duplicate vaccination event within sheet (skipped)");
        continue;
      }
      batchNaturals.add(natural);
    }

    if (!match) {
      inserts.push(row);
    } else if (
      match.rawHash !== row.rawHash ||
      match.status !== row.status ||
      (!match.naturalKey && row.naturalKey)
    ) {
      updates.push({ id: match.id, row });
    } else {
      unchanged++;
    }
  }

  // The sheet is the authoritative source for its own records: any stored
  // google_sheet row whose key was not seen this run has been deleted (or
  // re-keyed) upstream, so remove it. Rows from other sources never match
  // this filter — their provenance protects them.
  const deletions = existing
    .filter(
      (r) => r.source === "google_sheet" && !seenInSheet.has(r.externalKey),
    )
    .map((r) => r.id);

  const reasons: { reason: string; count: number }[] = [...parsed.reasons];
  for (const [reason, count] of reasonCount) {
    reasons.push({ reason, count });
  }

  return {
    inserts,
    updates,
    deletions,
    unchanged,
    validProcessed,
    invalidProcessed,
    sheetDuplicates,
    eventDuplicates,
    reasons,
  };
}
