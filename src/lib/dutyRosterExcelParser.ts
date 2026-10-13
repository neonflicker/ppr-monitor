import * as XLSX from "xlsx";
import { canonicalStaffName } from "@/lib/dutyRosterSchedule";

export type DutyRosterExcelEntry = {
  date: string;
  officeStaff: string;
  fieldStaff: string[];
  sourceOfficeStaff?: string;
  sourceFieldStaff?: string[];
  sourceWorksheet?: string;
  sourceRow?: number;
};

export type DutyRosterWorksheetEntry = DutyRosterExcelEntry;

export type DutyRosterExcelResult = {
  entries: DutyRosterExcelEntry[];
  issues: string[];
};

type ColumnMap = { date: number; day: number; office: number; field: number };

const headerKey = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cellText = (value: unknown) => value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "Invalid date") : String(value ?? "").trim();
const displaySheet = (sheet: XLSX.WorkSheet) => String(sheet["!name"] ?? "(selected worksheet)");
const rowLabel = (sheet: XLSX.WorkSheet, rowNumber: number) => `${displaySheet(sheet)}!row ${rowNumber}`;

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
  let match = /^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/.exec(text);
  if (match) parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!parts) {
    match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
    if (match) parts = { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
  }
  if (!parts) {
    const parsed = new Date(text);
    if (Number.isFinite(parsed.getTime()) && /[a-z]/i.test(text)) parts = { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
  }
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() !== parts.month - 1 || date.getUTCDate() !== parts.day) return null;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function namesInCell(value: unknown, activeStaff: string[], unresolved: Map<string, number[]>, sheet: XLSX.WorkSheet, rowNumber: number, duty: string): string[] {
  const raw = cellText(value);
  if (!raw) return [];
  const candidates = raw.split(/[,;\n]|\s+(?:and|&)\s+/i).map((candidate) => candidate.trim().replace(/^[-•\s]+|[-•\s]+$/g, "")).filter(Boolean);
  return candidates.map((candidate) => {
    const canonical = canonicalStaffName(candidate, activeStaff);
    if (!canonical) {
      const issueKey = `${duty.toLowerCase()}\u0000${candidate.toLowerCase()}`;
      const sourceRows = unresolved.get(issueKey) ?? [];
      sourceRows.push(rowNumber);
      unresolved.set(issueKey, sourceRows);
    }
    return canonical ?? candidate;
  });
}

/** Detect the roster table within the first 30 rows, then retain every dated row for admin review. */
export function parseDutyRosterWorksheet(sheet: XLSX.WorkSheet, activeStaff: string[], intendedMonth?: string, worksheetName?: string): DutyRosterExcelResult {
  if (worksheetName) Object.defineProperty(sheet, "!name", { value: worksheetName, configurable: true });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
  let headerIndex = -1;
  let columns: ColumnMap | null = null;
  for (let index = 0; index < Math.min(grid.length, 30); index += 1) {
    columns = columnsFor(grid[index] ?? []);
    if (columns) { headerIndex = index; break; }
  }
  if (!columns) return { entries: [], issues: ["This worksheet is missing one or more required headers: Date, Day, Staff on Dispensary Duty, Staff on Vaccination/Field Duty."] };

  const issues: string[] = [];
  const unresolvedNames = new Map<string, number[]>();
  const entries: DutyRosterExcelEntry[] = [];
  const seenDates = new Set<string>();
  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const row = grid[index] ?? [];
    const dateCell = row[columns.date];
    const officeCell = row[columns.office];
    const fieldCell = row[columns.field];
    const rowHasContent = [dateCell, officeCell, fieldCell].some((value) => cellText(value) !== "");
    if (!rowHasContent) continue;
    const date = dateToIso(dateCell);
    if (!date) {
      issues.push(`${rowLabel(sheet, index + 1)}: invalid or missing date “${cellText(dateCell) || "(blank)"}”; assignments: dispensary “${cellText(officeCell) || "(blank)"}”, field “${cellText(fieldCell) || "(blank)"}”. Review this source row before publishing.`);
      continue;
    }
    const officeNames = namesInCell(officeCell, activeStaff, unresolvedNames, sheet, index + 1, "dispensary");
    const fieldNames = namesInCell(fieldCell, activeStaff, unresolvedNames, sheet, index + 1, "field-duty");
    const expectedWeekday = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    const suppliedWeekday = cellText(row[columns.day]);
    if (suppliedWeekday && suppliedWeekday.toLowerCase() !== expectedWeekday.toLowerCase()) {
      issues.push(`${rowLabel(sheet, index + 1)} (${date}): supplied weekday “${suppliedWeekday}” does not match calculated ${expectedWeekday}; calculated date weekday is used.`);
    }
    if (intendedMonth && date.slice(0, 7) !== intendedMonth) issues.push(`${rowLabel(sheet, index + 1)} (${date}): date is outside selected roster month ${intendedMonth}; assignment remains associated with the source date for review.`);
    if (officeNames.length !== 1) issues.push(`${rowLabel(sheet, index + 1)} (${date}): expected one dispensary assignment, found ${officeNames.length}.`);
    if (fieldNames.length !== 3) issues.push(`${rowLabel(sheet, index + 1)} (${date}): expected three field assignments, found ${fieldNames.length}.`);
    const entry = { date, officeStaff: officeNames[0] ?? "", fieldStaff: fieldNames, sourceOfficeStaff: cellText(officeCell), sourceFieldStaff: typeof fieldCell === "string" ? fieldCell.split(/[,;\n]|\s+(?:and|&)\s+/i).map((value) => value.trim()).filter(Boolean) : fieldNames, sourceWorksheet: displaySheet(sheet), sourceRow: index + 1 };
    if (seenDates.has(date)) issues.push(`${rowLabel(sheet, index + 1)}: duplicate roster date ${date}; this separate source row is retained and requires administrator review.`);
    seenDates.add(date);
    entries.push(entry);
  }
  for (const [key, rows] of unresolvedNames) {
    const [duty, ...nameParts] = key.split("\u0000");
    const name = nameParts.join("\u0000");
    issues.push(`${displaySheet(sheet)} rows ${rows.join(", ")}: unrecognized ${duty} staff name “${name}”; retain the source spelling for administrator review.`);
  }
  return { entries: entries.sort((a, b) => a.date.localeCompare(b.date) || (a.sourceRow ?? 0) - (b.sourceRow ?? 0)), issues };
}
