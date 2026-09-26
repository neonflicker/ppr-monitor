import { normalizeName } from "./villageMatch";

/**
 * ONE normalised vaccination aggregation layer.
 *
 * Every per-date figure on the dashboard, the daily progress section, the
 * historical chart, the vaccinator tables and the DISTRICT DVTR report (view,
 * Excel, PDF) is produced here — nowhere else. Adding a field here makes it
 * available everywhere at once.
 */

export type PersonnelBucket = "departmental" | "semi" | "private";

export interface PersonnelLists {
  departmental: string[];
  semi: string[];
  private: string[];
}

export interface SourceDaySplit {
  goats: number;
  sheep: number;
  unspecified: number;
  farmers: number;
  records: number;
}

/** Shape of a stored vaccination record this layer consumes. */
export interface AggregateRecord {
  status: string;
  isPpr: boolean;
  source: "google_sheet" | "bharat_pashudhan";
  dateKey?: string;
  goats: number;
  sheep: number;
  unspecified?: number;
  farmers: number;
  wasted: number;
  taggedGoat: number;
  taggedSheep: number;
  village?: string;
  vaccinator?: string;
  designation?: string;
}

/** The one aggregate every consumer receives. */
export interface DayAggregate {
  dateKey: string;
  animalsTotal: number;
  goats: number;
  sheep: number;
  unspecified: number;
  farmers: number;
  wastedDoses: number;
  taggedGoat: number;
  taggedSheep: number;
  taggedAnimals: number;
  vaccinators: number;
  villages: number;
  records: number;
  bySource: {
    google_sheet: SourceDaySplit;
    bharat_pashudhan: SourceDaySplit;
  };
  personnel: {
    departmental: number;
    semiGovernment: number;
    private: number;
    unclassified: number;
  };
}

function classifyDesignation(
  designation: string | undefined,
  lists: PersonnelLists,
): PersonnelBucket | null {
  const norm = (designation ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!norm) return null;
  const matches = (values: string[]) =>
    values.some((value) => {
      const v = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (!v) return false;
      return norm.includes(v) || v.includes(norm);
    });
  if (matches(lists.departmental)) return "departmental";
  if (matches(lists.semi)) return "semi";
  if (matches(lists.private)) return "private";
  return null;
}

/**
 * Aggregate all valid PPR vaccination records whose dateKey falls between
 * fromKey and toKey (inclusive, ISO yyyy-MM-dd). fromKey === toKey selects a
 * single day; omit both to aggregate everything.
 */
export function aggregateRecords(
  records: AggregateRecord[],
  options: { fromKey?: string; toKey?: string } = {},
): DayAggregate {
  const { fromKey, toKey } = options;

  const acc: DayAggregate = {
    dateKey: fromKey && fromKey === toKey ? fromKey : (fromKey ?? toKey ?? ""),
    animalsTotal: 0,
    goats: 0,
    sheep: 0,
    unspecified: 0,
    farmers: 0,
    wastedDoses: 0,
    taggedGoat: 0,
    taggedSheep: 0,
    taggedAnimals: 0,
    vaccinators: 0,
    villages: 0,
    records: 0,
    bySource: {
      google_sheet: { goats: 0, sheep: 0, unspecified: 0, farmers: 0, records: 0 },
      bharat_pashudhan: { goats: 0, sheep: 0, unspecified: 0, farmers: 0, records: 0 },
    },
    personnel: {
      departmental: 0,
      semiGovernment: 0,
      private: 0,
      unclassified: 0,
    },
  };

  const people = new Set<string>();
  const villages = new Set<string>();

  for (const rec of records) {
    if (rec.status !== "valid" || !rec.isPpr) continue;
    if (fromKey && (!rec.dateKey || rec.dateKey < fromKey)) continue;
    if (toKey && (!rec.dateKey || rec.dateKey > toKey)) continue;

    const g = rec.goats;
    const s = rec.sheep;
    const u = rec.unspecified ?? 0;
    const total = g + s + u;

    acc.records += 1;
    acc.animalsTotal += total;
    acc.goats += g;
    acc.sheep += s;
    acc.unspecified += u;
    acc.farmers += rec.farmers;
    acc.wastedDoses += rec.wasted;
    acc.taggedGoat += rec.taggedGoat;
    acc.taggedSheep += rec.taggedSheep;
    acc.taggedAnimals += rec.taggedGoat + rec.taggedSheep;

    const bucket = acc.bySource[rec.source];
    if (bucket) {
      bucket.goats += g;
      bucket.sheep += s;
      bucket.unspecified += u;
      bucket.farmers += rec.farmers;
      bucket.records += 1;
    }

    if (rec.vaccinator?.trim()) {
      people.add(normalizeName(rec.vaccinator));
    }
    if (rec.village?.trim()) {
      villages.add(rec.village.trim().toLowerCase());
    }
  }

  acc.vaccinators = people.size;
  acc.villages = villages.size;
  return acc;
}

/**
 * Aggregate with personnel classification against the configured
 * departmental / semi-government / private designation lists.
 */
export function aggregateWithPersonnel(
  records: AggregateRecord[],
  lists: PersonnelLists,
  options: { fromKey?: string; toKey?: string } = {},
): DayAggregate & { personnelNames: Record<PersonnelBucket | "unclassified", string[]> } {
  const base = aggregateRecords(records, options);

  const names: Record<PersonnelBucket | "unclassified", string[]> = {
    departmental: [],
    semi: [],
    private: [],
    unclassified: [],
  };
  const seen = new Map<string, { name: string; bucket: PersonnelBucket | null }>();

  for (const rec of records) {
    if (rec.status !== "valid" || !rec.isPpr) continue;
    if (options.fromKey && (!rec.dateKey || rec.dateKey < options.fromKey)) continue;
    if (options.toKey && (!rec.dateKey || rec.dateKey > options.toKey)) continue;
    const raw = rec.vaccinator?.trim();
    if (!raw) continue;
    const key = normalizeName(raw);
    if (!key || seen.has(key)) continue;
    const bucket = classifyDesignation(rec.designation, lists);
    seen.set(key, { name: raw, bucket });
    if (bucket === "departmental") names.departmental.push(raw);
    else if (bucket === "semi") names.semi.push(raw);
    else if (bucket === "private") names.private.push(raw);
    else names.unclassified.push(raw);
  }
  for (const list of Object.values(names)) list.sort((a, b) => a.localeCompare(b));

  base.personnel = {
    departmental: names.departmental.length,
    semiGovernment: names.semi.length,
    private: names.private.length,
    unclassified: names.unclassified.length,
  };

  return { ...base, personnelNames: names };
}

/**
 * Aggregate records day by day (records without a dateKey are ignored).
 * Returns one DayAggregate per date, sorted ascending — the basis for the
 * daily progress section and the historical chart.
 */
export function aggregateByDay(
  records: AggregateRecord[],
  options: { fromKey?: string; toKey?: string } = {},
): DayAggregate[] {
  const byDay = new Map<string, AggregateRecord[]>();
  for (const rec of records) {
    if (rec.status !== "valid" || !rec.isPpr || !rec.dateKey) continue;
    if (options.fromKey && rec.dateKey < options.fromKey) continue;
    if (options.toKey && rec.dateKey > options.toKey) continue;
    const list = byDay.get(rec.dateKey);
    if (list) list.push(rec);
    else byDay.set(rec.dateKey, [rec]);
  }
  return [...byDay.keys()]
    .sort()
    .map(
      (dateKey) =>
        aggregateRecords(byDay.get(dateKey)!, {
          fromKey: dateKey,
          toKey: dateKey,
        }),
    );
}
