import * as XLSX from "xlsx";

/**
 * USER & VILLAGE ALLOCATION file reader (client side).
 *
 * Accepts .xlsx / .xls / .csv with the columns:
 *   User Name | Allotted Village | Target
 *
 * Headers are matched case/whitespace-insensitively; leading/trailing
 * whitespace in header cells is ignored. Only these three columns are
 * required — everything else in the file is ignored.
 */

export interface AllocationRowOut {
  rowNumber: number;
  userName: string;
  village: string;
  target: number;
  status: "valid" | "invalid";
  error?: string;
}

export interface AllocationPreview {
  fileName: string;
  headers: string[];
  mappedColumns: { user: string; village: string; target: string };
  totalRows: number;
  validRows: number;
  invalidRows: number;
  users: string[];
  villages: string[];
  totalTarget: number;
  errors: { row: number; userName: string; village: string; error: string }[];
  rows: AllocationRowOut[];
}

/** Loose header matcher: lowercase, strip everything non-alphanumeric. */
function normHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const USER_HEADERS = new Set(["username", "user", "name", "personname", "vaccinator"]);
const VILLAGE_HEADERS = new Set([
  "allottedvillage",
  "village",
  "villagename",
  "allottedvillages",
  "villageallotted",
]);
const TARGET_HEADERS = new Set(["target", "targets", "targetno", "totaltarget", "nooftarget"]);

function pickColumn(
  headers: string[],
  candidates: Set<string>,
): { index: number; label: string } | null {
  // 1) exact normalised match
  for (let i = 0; i < headers.length; i++) {
    if (candidates.has(normHeader(headers[i]))) return { index: i, label: headers[i] };
  }
  // 2) contains match (e.g. "User Name (VFA)")
  for (let i = 0; i < headers.length; i++) {
    const h = normHeader(headers[i]);
    if (!h) continue;
    for (const candidate of candidates) {
      if (h.includes(candidate) || candidate.includes(h)) {
        return { index: i, label: headers[i] };
      }
    }
  }
  return null;
}

/** Read a CSV/XLS/XLSX allocation file into a header row + string matrix. */
export async function readAllocationFile(
  file: File,
): Promise<{ headers: string[]; rows: string[][] }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = await file.text();
    const grid = parseSimpleCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
    if (grid.length === 0) throw new Error("This file contains no rows.");
    return { headers: grid[0].map((h) => h.trim()), rows: grid.slice(1) };
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
    .map((row) =>
      (row ?? []).map((cell) =>
        cell === null || cell === undefined ? "" : String(cell).trim(),
      ),
    )
    .filter((row) => row.some((c) => c !== ""));
  if (grid.length === 0) throw new Error(`Sheet “${best}” contains no rows.`);
  return { headers: grid[0], rows: grid.slice(1) };
}

/** Minimal CSV parser handling quoted fields, commas and newlines. */
function parseSimpleCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function parseTarget(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Analyse the grid → column mapping + validated rows + preview stats. */
export function analyzeAllocation(
  fileName: string,
  headers: string[],
  grid: string[][],
): AllocationPreview {
  const userCol = pickColumn(headers, USER_HEADERS);
  const villageCol = pickColumn(headers, VILLAGE_HEADERS);
  const targetCol = pickColumn(headers, TARGET_HEADERS);

  const missing: string[] = [];
  if (!userCol) missing.push("User Name");
  if (!villageCol) missing.push("Allotted Village");
  if (!targetCol) missing.push("Target");

  const errors: AllocationPreview["errors"] = [];
  const rows: AllocationRowOut[] = [];
  const users = new Set<string>();
  const villages = new Set<string>();
  let totalTarget = 0;
  let validRows = 0;

  if (missing.length === 0) {
    grid.forEach((cells, index) => {
      const rowNumber = index + 2; // header is row 1
      const userName = (cells[userCol!.index] ?? "").trim();
      const village = (cells[villageCol!.index] ?? "").trim();
      const targetRaw = (cells[targetCol!.index] ?? "").trim();
      const target = parseTarget(targetRaw);

      const fail = (error: string) => {
        rows.push({
          rowNumber,
          userName,
          village,
          target: Number.isFinite(target as number) ? (target as number) : 0,
          status: "invalid",
          error,
        });
        errors.push({
          row: rowNumber,
          userName: userName || "—",
          village: village || "—",
          error,
        });
      };

      if (!userName) {
        fail("User Name is blank");
        return;
      }
      if (!village) {
        fail("Allotted Village is blank");
        return;
      }
      if (target === null) {
        fail(targetRaw ? `Target “${targetRaw}” is not a number` : "Target is blank");
        return;
      }
      if (target < 0) {
        fail("Target is negative");
        return;
      }

      rows.push({ rowNumber, userName, village, target, status: "valid" });
      users.add(userName);
      villages.add(village);
      totalTarget += target;
      validRows++;
    });
  } else {
    errors.push({
      row: 1,
      userName: "—",
      village: "—",
      error: `Required column(s) missing: ${missing.join(", ")}`,
    });
  }

  return {
    fileName,
    headers,
    mappedColumns: {
      user: userCol?.label ?? "?",
      village: villageCol?.label ?? "?",
      target: targetCol?.label ?? "?",
    },
    totalRows: grid.length,
    validRows,
    invalidRows: rows.filter((r) => r.status === "invalid").length,
    users: [...users].sort((a, b) => a.localeCompare(b)),
    villages: [...villages].sort((a, b) => a.localeCompare(b)),
    totalTarget,
    errors,
    rows,
  };
}
