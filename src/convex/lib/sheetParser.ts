/**
 * Pure helpers for reading the PPR Google Sheet.
 *
 * The sheet column order/names are NOT assumed — headers are matched
 * logically so re-ordered or renamed columns still map correctly.
 * This module must stay dependency-free (no node builtins, no Convex APIs)
 * so it can be shared by node actions and regular Convex functions.
 */

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
}

/** Map sheet headers to fields regardless of order or exact wording. */
export function mapColumns(headers: string[]): ColumnMapping {
  const mapping: Partial<Record<FieldKey, number>> = {};
  const unmapped: string[] = [];
  headers.forEach((raw, index) => {
    if (isBlank(raw)) return;
    const field = matchField(normalizeHeader(raw), raw);
    if (field && mapping[field] === undefined) {
      mapping[field] = index;
    } else {
      unmapped.push(raw.trim());
    }
  });
  return { mapping, headers, unmapped };
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
  const { mapping, unmapped } = mapColumns(headers);
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
    const village = get(cells, mapping.village);
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
