import { normalizeName } from "./villageMatch";

export type DutyEntry = {
  date: string;
  officeStaff: string;
  fieldStaff: string[];
};

const DATE_PATTERN = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/;
function isoDate(match: RegExpMatchArray): string | null {
  const year = Number(match[4] ?? match[3]);
  const month = Number(match[5] ?? match[2]);
  const day = Number(match[6] ?? match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses only rows with a date and exactly four known active staff names.
 * Non-text/scanned, incomplete, duplicate, or uncertain rows are omitted for
 * explicit administrator review instead of guessing assignments.
 */
export function parseDutyRosterText(text: string, activeStaff: string[]): DutyEntry[] {
  const people = activeStaff
    .map((name) => ({ name: name.trim(), key: normalizeName(name) }))
    .filter((person) => person.name && person.key)
    .sort((a, b) => b.key.length - a.key.length);
  const entries = new Map<string, DutyEntry>();
  const ambiguousDates = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const match = DATE_PATTERN.exec(rawLine);
    if (!match) continue;
    const date = isoDate(match);
    if (!date) continue;

    const searchable = normalizeName(rawLine);
    const occurrences: Array<{ start: number; end: number; name: string }> = [];
    for (const person of people) {
      const phrase = person.key;
      let from = 0;
      while (from < searchable.length) {
        const start = searchable.indexOf(phrase, from);
        if (start < 0) break;
        const end = start + phrase.length;
        if (
          (start === 0 || searchable[start - 1] === " ") &&
          (end === searchable.length || searchable[end] === " ") &&
          !occurrences.some((item) => start < item.end && end > item.start)
        ) occurrences.push({ start, end, name: person.name });
        from = end;
      }
    }
    occurrences.sort((a, b) => a.start - b.start);
    const names = occurrences.map((item) => item.name);
    if (new Set(names.map(normalizeName)).size !== 4 || names.length !== 4) {
      ambiguousDates.add(date);
      continue;
    }
    if (entries.has(date)) {
      ambiguousDates.add(date);
      entries.delete(date);
      continue;
    }
    entries.set(date, { date, officeStaff: names[0], fieldStaff: names.slice(1) });
  }

  for (const date of ambiguousDates) entries.delete(date);
  return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
}
