/**
 * Bharat Pashudhan file importer (client side).
 *
 * Reads CSV/XLS/XLSX, detects and maps columns without assuming a fixed
 * order, validates rows, marks in-file duplicates and produces the exact
 * normalised rows the server stores. Preview happens before any data is
 * written — nothing touches the database until the admin confirms.
 */
import * as XLSX from "xlsx";
import {
  FIELD_LABELS,
  isPprRecord,
  mapColumns,
  normalizePpr,
  parseCsv,
  parseSheetDate,
  rowHash,
  toCount,
  type FieldKey,
} from "@/convex/lib/sheetParser";
import { naturalKeyOf } from "@/convex/lib/villageMatch";

export interface BharatRowOut {
  externalKey: string;
  naturalKey?: string;
  status: "valid" | "rejected";
  rejectReason?: string;
  isPpr: boolean;
  rawHash: string;
  date?: number;
  dateKey?: string;
  village?: string;
  vaccinator?: string;
  designation?: string;
  vaccinatorId?: string;
  disease?: string;
  species?: string;
  tagId?: string;
  goats: number;
  sheep: number;
  unspecified?: number;
  taggedGoat: number;
  taggedSheep: number;
  wasted: number;
  farmers: number;
  timestamp?: string;
  remarks?: string;
}

export interface BharatPreview {
  fileName: string;
  headers: string[];
  mappedColumns: string[];
  unmappedColumns: string[];
  missingRequired: string[];
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  nonPprRows: number;
  reasons: { reason: string; count: number }[];
  rows: BharatRowOut[];
}

const REQUIRED_LABELS: Record<string, FieldKey> = {
  date: "date",
  village: "village",
};

export function isSpreadsheetFile(fileName: string): boolean {
  return /\.(csv|xlsx|xls|txt)$/i.test(fileName);
}

/** Read a CSV/XLS/XLSX file into a header row + string matrix. */
export async function readFileRows(
  file: File,
): Promise<{ headers: string[]; rows: string[][]; sheetName: string }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = await file.text();
    const grid = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
    if (grid.length === 0) {
      throw new Error("This file contains no rows. Export the data again.");
    }
    return { headers: grid[0].map((h) => h.trim()), rows: grid.slice(1), sheetName: file.name };
  }
  if (!/\.(xlsx|xls)$/.test(lower)) {
    throw new Error("Unsupported file type. Upload a CSV, XLSX or XLS file.");
  }

  const buffer = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  } catch {
    throw new Error(
      "This Excel file could not be read. It may be corrupted or password-protected.",
    );
  }
  // Pick the sheet with the most rows.
  let best = workbook.SheetNames[0];
  let bestCount = -1;
  for (const name of workbook.SheetNames) {
    const ref = workbook.Sheets[name]?.["!ref"];
    const count = ref ? XLSX.utils.decode_range(ref).e.r : -1;
    if (count > bestCount) {
      bestCount = count;
      best = name;
    }
  }
  const sheet = workbook.Sheets[best];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  const grid = matrix
    .map((row) => (row ?? []).map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim())))
    .filter((row) => row.some((c) => c !== ""));
  if (grid.length === 0) {
    throw new Error(`Sheet “${best}” contains no rows.`);
  }
  return { headers: grid[0], rows: grid.slice(1), sheetName: best };
}

const get = (cells: string[], idx: number | undefined): string =>
  idx === undefined ? "" : (cells[idx] ?? "").trim();

function splitBySpecies(
  species: string,
  quantity: number,
  goatCell: number,
  sheepCell: number,
): { goats: number; sheep: number; unspecified: number } {
  const norm = normalizePpr(species); // lowercase alnum, works for any word
  if (norm.includes("goat")) return { goats: quantity || goatCell, sheep: 0, unspecified: 0 };
  if (norm.includes("sheep")) return { goats: 0, sheep: quantity || sheepCell, unspecified: 0 };
  if (goatCell > 0 || sheepCell > 0) {
    return { goats: goatCell, sheep: sheepCell, unspecified: 0 };
  }
  return { goats: 0, sheep: 0, unspecified: quantity };
}

/** Analyse the parsed grid → mapping + validated, deduped row set. */
export function analyzeBharat(
  fileName: string,
  headers: string[],
  grid: string[][],
  pprValues: string[],
): BharatPreview {
  const { mapping, unmapped } = mapColumns(headers);
  const mappedColumns = (Object.keys(mapping) as FieldKey[]).map(
    (field) => `${headers[mapping[field]!]} → ${FIELD_LABELS[field]}`,
  );

  const missingRequired: string[] = [];
  if (mapping.date === undefined) missingRequired.push("Vaccination Date");
  if (mapping.village === undefined) missingRequired.push("Village");

  const reasons = new Map<string, number>();
  const bump = (reason: string) =>
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);

  const rows: BharatRowOut[] = [];
  const seenKeys = new Set<string>();
  let validRows = 0;
  let duplicateRows = 0;
  let invalidRows = 0;
  let nonPprRows = 0;

  if (missingRequired.length === 0) {
    for (const cells of grid) {
      const rawDate = get(cells, mapping.date);
      const dateMs = parseSheetDate(rawDate || undefined);
      const village = get(cells, mapping.village);
      const vaccinator = get(cells, mapping.vaccinator);
      const designation = get(cells, mapping.designation);
      const vaccinatorId = get(cells, mapping.vaccinatorId);
      const tagId = get(cells, mapping.tagId);
      const species = get(cells, mapping.species);
      const disease = get(cells, mapping.disease) || undefined;
      const timestamp = get(cells, mapping.timestamp);
      const recordId = get(cells, mapping.recordId);
      const quantity = toCount(get(cells, mapping.quantity));
      const goatCell = toCount(get(cells, mapping.goats));
      const sheepCell = toCount(get(cells, mapping.sheep));
      const taggedGoat = toCount(get(cells, mapping.taggedGoat));
      const taggedSheep = toCount(get(cells, mapping.taggedSheep));
      const wasted = toCount(get(cells, mapping.wasted));
      const farmers = toCount(get(cells, mapping.farmers));
      const rawHash = rowHash(cells.map((c) => c.trim()));

      const split = splitBySpecies(species, quantity, goatCell, sheepCell);
      const dateKey =
        dateMs !== null
          ? new Date(dateMs).toISOString().slice(0, 10)
          : undefined;

      const externalKey = recordId
        ? `bp:id:${recordId}`
        : `bp:${[
            dateKey ?? rawDate,
            normalizePpr(village),
            normalizePpr(vaccinator),
            tagId,
            normalizePpr(disease ?? ""),
            species,
            split.goats,
            split.sheep,
            split.unspecified,
          ].join("|")}`;

      const row: BharatRowOut = {
        externalKey,
        status: "valid",
        isPpr: isPprRecord(disease, pprValues),
        rawHash,
        date: dateMs ?? undefined,
        dateKey,
        village: village || undefined,
        vaccinator: vaccinator || undefined,
        designation: designation || undefined,
        vaccinatorId: vaccinatorId || undefined,
        disease,
        species: species || undefined,
        tagId: tagId || undefined,
        goats: split.goats,
        sheep: split.sheep,
        unspecified: split.unspecified > 0 ? split.unspecified : undefined,
        taggedGoat,
        taggedSheep,
        wasted,
        farmers,
        timestamp: timestamp || undefined,
        remarks: get(cells, mapping.remarks) || undefined,
      };
      row.naturalKey = naturalKeyOf(row) || undefined;

      // ---- Validation ----
      if (dateMs === null) {
        row.status = "rejected";
        row.rejectReason = rawDate
          ? `Invalid vaccination date: "${rawDate}"`
          : "Missing vaccination date";
        bump(row.rejectReason.startsWith("Invalid") ? "Invalid date" : "Missing date");
      } else if (!village) {
        row.status = "rejected";
        row.rejectReason = "Missing village";
        bump("Missing village");
      } else if (
        split.goats + split.sheep + split.unspecified + taggedGoat + taggedSheep ===
        0
      ) {
        row.status = "rejected";
        row.rejectReason = "No vaccination count in row";
        bump("No vaccination count");
      } else if (
        split.unspecified > 0 &&
        split.goats === 0 &&
        split.sheep === 0 &&
        species &&
        !/goat|sheep/i.test(species)
      ) {
        row.status = "rejected";
        row.rejectReason = `Species not applicable to PPR: ${species}`;
        bump(`Species not applicable to PPR: ${species}`);
      }

      // ---- In-file duplicate detection ----
      if (seenKeys.has(externalKey)) {
        duplicateRows++;
        bump("Duplicate row within file");
        // keep status so the row travels with the batch; server counts it too
      } else {
        seenKeys.add(externalKey);
        if (row.status === "rejected") invalidRows++;
        else {
          validRows++;
          if (!row.isPpr) nonPprRows++;
        }
      }
      rows.push(row);
    }
  }

  return {
    fileName,
    headers,
    mappedColumns,
    unmappedColumns: unmapped,
    missingRequired,
    totalRows: grid.length,
    validRows,
    duplicateRows,
    invalidRows,
    nonPprRows,
    reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    rows,
  };
}
