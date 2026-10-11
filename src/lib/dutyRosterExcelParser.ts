import * as XLSX from "xlsx";
import { normalizeName } from "@/convex/lib/villageMatch";

export type DutyRosterExcelEntry = {
  date: string;
  officeStaff: string;
  fieldStaff: string[];
};

export type DutyRosterExcelResult = {
  entries: DutyRosterExcelEntry[];
  issues: string[];
};

type ColumnMap = { date: number; day: number; office: number; field: number };

const headerKey = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cellText = (value: unknown) => value instanceof Date ? value.toLocaleDateString("en-GB") : String(value ?? "").trim();

function columnsFor(row: unknown[]): ColumnMap | null {
  const headers = row.map(headerKey);
  const date = headers.findIndex((header) => header === "date" || header === "rosterdate" || header.startsWith("date"));
  const day = headers.findIndex((header) => header === "day" || header === "weekday" || header.startsWith("day"));
  const office = headers.findIndex((header) => header.includes("staff") && (header.includes("dispensary") || header.includes("office")) && !header.includes("field"));
  const field = headers.findIndex((header) => (header.includes("vaccination") || header.includes("field")) && (header.includes("staff") || header.includes("duty")));
  return date >= 0 && day >= 0 && office >= 0 && field >= 0 ? { date, day, office, field } : null;
}

function dateToIso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const parts = XLSX.SSF.parse_date_code(value);
    if (!parts) return null;
    const date = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
    if (date.getUTCFullYear() !== parts.y || date.getUTCMonth() !== parts.m - 1 || date.getUTCDate() !== parts.d) return null;
    return `${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  let parts: { year: number; month: number; day: number } | null = null;
  let match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
  if (match) parts = { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
  match = match ?? /^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/.exec(text);
  if (!parts && match) parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!parts) {
    const parsed = new Date(text);
    if (Number.isFinite(parsed.getTime()) && /[a-z]/i.test(text)) parts = { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
  }
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() !== parts.month - 1 || date.getUTCDate() !== parts.day) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function namesInCell(value: unknown, activeStaff: string[], issues: string[], rowNumber: number, duty: string): string[] {
  const raw = cellText(value);
  if (!raw) return [];
  const active = new Map(activeStaff.map((name) => [normalizeName(name), name]));
  return raw.split(/[,;\n]|\s+(?:and|&)\s+/i).map((candidate) => candidate.trim().replace(/^[-•\s]+|[-•\s]+$/g, "")).filter(Boolean).map((candidate) => {
    if (!active.has(normalizeName(candidate))) {
      issues.push(`Worksheet row ${rowNumber}: unrecognized ${duty} staff name “${candidate}”.`);
    }
    // The workbook spelling is the assignment source of truth. Keep it even
    // when it matches an official personnel name only through normalization.
    return candidate;
  });
}

/** Detect the roster table within the first 30 rows, then retain every dated row for admin review. */
export function parseDutyRosterWorksheet(sheet: XLSX.WorkSheet, activeStaff: string[]): DutyRosterExcelResult {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  let headerIndex = -1;
  let columns: ColumnMap | null = null;
  for (let index = 0; index < Math.min(grid.length, 30); index += 1) {
    columns = columnsFor(grid[index] ?? []);
    if (columns) { headerIndex = index; break; }
  }
  if (!columns) return { entries: [], issues: ["This worksheet is missing one or more required headers: Date, Day, Staff on Dispensary Duty, Staff on Vaccination/Field Duty."] };

  const issues: string[] = [];
  const entries = new Map<string, DutyRosterExcelEntry>();
  const ambiguousDates = new Set<string>();
  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const row = grid[index] ?? [];
    const dateCell = row[columns.date];
    const officeCell = row[columns.office];
    const fieldCell = row[columns.field];
    const rowHasContent = [dateCell, officeCell, fieldCell].some((value) => cellText(value) !== "");
    if (!rowHasContent) continue;
    const date = dateToIso(dateCell);
    if (!date) {
      issues.push(`Worksheet row ${index + 1}: invalid or missing date “${cellText(dateCell) || "(blank)"}”; assignments: dispensary “${cellText(officeCell) || "(blank)"}”, field “${cellText(fieldCell) || "(blank)"}”. Review this source row before publishing.`);
      continue;
    }
    const officeNames = namesInCell(officeCell, activeStaff, issues, index + 1, "dispensary");
    const fieldNames = namesInCell(fieldCell, activeStaff, issues, index + 1, "field-duty");
    if (officeNames.length !== 1) issues.push(`Worksheet row ${index + 1} (${date}): expected one dispensary assignment, found ${officeNames.length}.`);
    if (fieldNames.length !== 3) issues.push(`Worksheet row ${index + 1} (${date}): expected three field assignments, found ${fieldNames.length}.`);
    const entry = { date, officeStaff: officeNames[0] ?? "", fieldStaff: fieldNames };
    if (entries.has(date) || ambiguousDates.has(date)) {
      ambiguousDates.add(date);
      entries.set(date, { date, officeStaff: "", fieldStaff: [] });
      issues.push(`Worksheet row ${index + 1}: duplicate roster date ${date}; both rows need administrator review.`);
    } else entries.set(date, entry);
  }
  return { entries: [...entries.values()].sort((a, b) => a.date.localeCompare(b.date)), issues };
}
