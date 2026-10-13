import { normalizeName } from "@/convex/lib/villageMatch";

export type RosterScheduleEntry = {
  date: string;
  officeStaff: string;
  fieldStaff: string[];
  sourceOfficeStaff?: string;
  sourceFieldStaff?: string[];
  sourceWorksheet?: string;
  sourceRow?: number;
};

export function monthPeriod(month: string): { start: string; end: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

export function monthDates(month: string): string[] {
  const period = monthPeriod(month);
  if (!period) return [];
  const days = Number(period.end.slice(-2));
  return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

export function inferRosterMonth(entries: RosterScheduleEntry[], start: string, end: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && start.slice(0, 7) === end.slice(0, 7)) return start.slice(0, 7);
  const counts = new Map<string, number>();
  for (const entry of entries) if (/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) counts.set(entry.date.slice(0, 7), (counts.get(entry.date.slice(0, 7)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? start.slice(0, 7);
}

const STAFF_ALIASES: Record<string, string> = {
  "jyoti kamal saikia": "jyotikamal saikia",
  "jyotikamal saikia": "jyotikamal saikia",
  "kankan jyoti mili": "kankan jyoti mili",
  "nilutpal saikia": "nilutpal saikia",
  "susanta borah biswakarma": "susanta borah biswakarma",
};

/** Stable identity key for the explicit names used by the October source workbook. */
export function dutyStaffIdentity(raw: string): string {
  const normalized = normalizeName(raw);
  return STAFF_ALIASES[normalized] ?? normalized;
}

function editDistanceAtMostOne(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else { i += 1; j += 1; }
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

function matchesWords(source: string[], candidate: string[]): boolean {
  if (source.length !== candidate.length) return false;
  const visit = (index: number, used: Set<number>): boolean => {
    if (index === source.length) return true;
    return candidate.some((word, candidateIndex) => !used.has(candidateIndex)
      && editDistanceAtMostOne(source[index], word)
      && visit(index + 1, new Set([...used, candidateIndex])));
  };
  return visit(0, new Set());
}

/** Resolve exact names, explicit source aliases, or a single unambiguous spelling correction. */
export function canonicalStaffName(raw: string, activeStaff: string[]): string | undefined {
  const key = normalizeName(raw);
  if (!key) return undefined;
  const aliasKey = STAFF_ALIASES[key] ?? key;
  const exact = activeStaff.filter((person) => dutyStaffIdentity(person) === aliasKey);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const sourceWords = aliasKey.split(" ");
  const candidates = activeStaff.filter((person) => matchesWords(sourceWords, normalizeName(person).split(" ")));
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Return one canonical active personnel record per identity, excluding office staff. */
export function assignFieldStaff(officeStaff: string, activeStaff: string[]): string[] {
  const office = dutyStaffIdentity(officeStaff);
  const unique = new Map<string, string>();
  for (const person of activeStaff) {
    const identity = dutyStaffIdentity(person);
    if (identity && identity !== office && !unique.has(identity)) unique.set(identity, person);
  }
  return [...unique.values()];
}

/** Change one dated assignment without touching any other roster row. */
export function updateOfficeDutyForDate<T extends RosterScheduleEntry>(
  entries: T[],
  date: string,
  officeStaff: string,
  activeStaff: string[],
): T[] {
  return entries.map((entry) => entry.date === date
    ? { ...entry, officeStaff, fieldStaff: canonicalStaffName(officeStaff, activeStaff) ? assignFieldStaff(officeStaff, activeStaff) : [] }
    : entry);
}

export function getMonthlyScheduleWarnings(entries: RosterScheduleEntry[], month: string): string[] {
  return entries.filter((entry) => entry.date && entry.date.slice(0, 7) !== month)
    .map((entry) => `Imported date ${entry.date} is outside the selected roster month ${month}; review this row.`);
}

export function weekdayForDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "Choose date";
  const date = new Date(`${isoDate}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === isoDate
    ? new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(date)
    : "Choose date";
}

/** Generate missing monthly dates without moving any dated imported assignments. */
export function completeMonthlyEntries(
  month: string,
  activeStaff: string[],
  sourceEntries: RosterScheduleEntry[],
): { entries: RosterScheduleEntry[]; removedOctoberExtra: boolean } {
  const dates = monthDates(month);
  if (!dates.length) return { entries: sourceEntries, removedOctoberExtra: false };
  const byDate = new Map<string, RosterScheduleEntry>();
  const duplicateRows: RosterScheduleEntry[] = [];
  let removedOctoberExtra = false;
  for (const entry of sourceEntries) {
    if (month === "2026-10" && entry.date === "2026-09-30") { removedOctoberExtra = true; continue; }
    if (byDate.has(entry.date)) { duplicateRows.push(entry); continue; }
    byDate.set(entry.date, entry);
  }
  const counts = new Map(activeStaff.map((person) => [normalizeName(person), 0]));
  const validExisting = dates.map((date) => canonicalStaffName(byDate.get(date)?.officeStaff ?? "", activeStaff));
  for (const person of validExisting) if (person) counts.set(normalizeName(person), (counts.get(normalizeName(person)) ?? 0) + 1);
  let rotationCursor = 0;
  let previousOffice = "";
  const entries = dates.map((date): RosterScheduleEntry => {
    const existing = byDate.get(date);
    let officeStaff = existing?.officeStaff.trim() ?? "";
    const canonicalOffice = canonicalStaffName(officeStaff, activeStaff);
    if (canonicalOffice) officeStaff = canonicalOffice;
    if (!officeStaff && activeStaff.length === 4) {
      const candidates = activeStaff.map((_, offset) => activeStaff[(rotationCursor + offset) % activeStaff.length])
        .filter((person) => normalizeName(person) !== previousOffice);
      const pool = candidates.length ? candidates : activeStaff;
      officeStaff = pool.reduce((best, person) =>
        (counts.get(normalizeName(person)) ?? 0) < (counts.get(normalizeName(best)) ?? 0) ? person : best, pool[0]);
      rotationCursor = (activeStaff.findIndex((person) => normalizeName(person) === normalizeName(officeStaff)) + 1) % activeStaff.length;
      counts.set(normalizeName(officeStaff), (counts.get(normalizeName(officeStaff)) ?? 0) + 1);
    } else if (canonicalOffice) {
      rotationCursor = (activeStaff.findIndex((person) => normalizeName(person) === normalizeName(canonicalOffice)) + 1) % activeStaff.length;
    }
    if (officeStaff) previousOffice = normalizeName(officeStaff);
    const officeCanonical = canonicalStaffName(officeStaff, activeStaff);
    const importedFields = existing?.fieldStaff ?? [];
    const canonicalFields = importedFields.map((person) => canonicalStaffName(person, activeStaff) ?? person);
    const fieldKeys = canonicalFields.map(dutyStaffIdentity);
    const hasRecognizedFieldList = canonicalFields.length === 3
      && canonicalFields.every((person) => canonicalStaffName(person, activeStaff) !== undefined)
      && new Set(fieldKeys).size === 3
      && canonicalFields.every((person) => dutyStaffIdentity(person) !== dutyStaffIdentity(officeStaff));
    // Keep valid source assignments; repair malformed/overlong/duplicate lists from the
    // active directory without moving or deriving assignments from neighboring dates.
    const fieldStaff = hasRecognizedFieldList
      ? canonicalFields.map((person) => canonicalStaffName(person, activeStaff)!)
      : officeCanonical
        ? assignFieldStaff(officeCanonical, activeStaff)
        : canonicalFields;
    return {
      ...existing,
      date,
      officeStaff,
      fieldStaff,
      sourceOfficeStaff: existing?.sourceOfficeStaff,
      sourceFieldStaff: existing?.sourceFieldStaff,
      sourceWorksheet: existing?.sourceWorksheet,
      sourceRow: existing?.sourceRow,
    };
  });
  const extraDates = [...byDate.values()].filter((entry) => !dates.includes(entry.date));
  return { entries: [...entries, ...extraDates, ...duplicateRows].sort((a, b) => a.date.localeCompare(b.date) || (a.sourceRow ?? 0) - (b.sourceRow ?? 0)), removedOctoberExtra };
}
