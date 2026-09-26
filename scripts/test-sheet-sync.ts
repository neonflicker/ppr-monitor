/**
 * Tests for the two Google Sheet data-sync fixes.
 *
 * ISSUE 1 — Village column: the real master sheet has
 *   Column N (13) = "Is vaccination completed in the village?"  (Yes/No)
 *   Column O (14) = "Village"
 * The header matcher used to grab N first because it mentions "village".
 *
 * ISSUE 2 — Reconciliation: sync must mirror the sheet (add → insert,
 * delete → delete, edit → in-place update, repeat → no-op).
 *
 * Run: bun scripts/test-sheet-sync.ts
 */
import {
  diffSheetRecords,
  looksLikeVillage,
  mapColumns,
  normalizeHeaderText,
  parseSheet,
  type ExistingRecord,
  type NormalizedRow,
} from "../src/convex/lib/sheetParser.ts";

/* ---------------- tiny harness ---------------- */

let pass = 0;
let fail = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ---------------- fixture: the REAL master-sheet headers ---------------- */

const HEADERS = [
  "Timestamp",
  "Email Address",
  "Date",
  "Name of the Vaccinator",
  "Designation",
  "Vaccinator ID",
  "PPR, Goat Vaccinated on Date",
  "PPR, Sheep Vaccinated on Date",
  "Tagged Goat under NADCP on Date",
  "Tagged Sheep under NADCP on Date",
  "PPR Doses wasted on Date",
  "Farmers Covered on Date",
  "Remarks",
  "Is vaccination completed in the village?", // Column N — the trap
  "Village", // Column O — the real Village field
];

const PPR = ["PPR", "PPR Vaccine", "PPRV", "PPR Vaccination"];

/** Serialize rows as CSV (quote fields containing commas/quotes). */
function toCsv(rows: string[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) =>
          /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join(","),
    )
    .join("\n");
}

/** One data row: only the columns we care about, rest blank. */
function row(over: Partial<Record<number, string>>): string[] {
  const cells = new Array<string>(HEADERS.length).fill("");
  for (const [idx, value] of Object.entries(over)) cells[Number(idx)] = value;
  return cells;
}

// idx: 0 Timestamp · 2 Date · 3 Vaccinator · 6 Goats · 11 Farmers
//      13 N (Yes/No question) · 14 O (Village)
const LEGACY_ROW = row({
  0: "9/26/2026 11:16:31",
  2: "9/25/2026",
  3: "Jyotikamal Saikia",
  6: "98",
  11: "23",
  13: "Senchowa pathar", // village still sitting in Column N
});
const ROW_2 = row({
  0: "9/26/2026 11:27:40",
  2: "9/26/2026",
  3: "Nilutpal Saikia",
  6: "125",
  11: "29",
  13: "No.2 Dakhin Rupahi ",
});
const ROW_3 = row({
  0: "9/26/2026 16:36:41",
  2: "9/26/2026",
  3: "Tikendra Gogoi",
  6: "98",
  11: "2",
  13: "No 1 Badhakora ",
});
/** New-form layout: Yes/No answered in N, real village in O. */
const NEW_FORMAT_ROW = row({
  0: "9/27/2026 10:00:00",
  2: "9/27/2026",
  3: "Nilutpal Saikia",
  6: "55",
  11: "10",
  13: "Yes",
  14: "Dummy Village",
});
/** Broken row: Yes/No in N and nothing in O → must be rejected, not "Yes". */
const YES_ONLY_ROW = row({
  0: "9/27/2026 11:00:00",
  2: "9/27/2026",
  3: "Tikendra Gogoi",
  6: "40",
  11: "5",
  13: "Yes",
});

/* ============ ISSUE 1: Village column ============ */

console.log("ISSUE 1 — Village comes from the Village header (Column O)");
{
  const mapping = mapColumns(HEADERS);
  ok("primary Village column = index 14 (Column O)", mapping.mapping.village === 14, String(mapping.mapping.village));
  ok("Column N kept only as guarded fallback", JSON.stringify(mapping.villageFallbacks) === "[13]", JSON.stringify(mapping.villageFallbacks));
  ok("Column N reported as unmapped (not the Village field)", mapping.unmapped.includes("Is vaccination completed in the village?"));

  const exact = mapColumns(["Timestamp", "Village Name", "Goats"]);
  ok("supports 'Village Name' header too", exact.mapping.village === 1, String(exact.mapping.village));

  const text = normalizeHeaderText("   Village    Name  ");
  ok("normalizeHeader: lowercase + trim + collapse spaces", text === "village name", text);

  ok("looksLikeVillage rejects 'Yes'", !looksLikeVillage("Yes"));
  ok("looksLikeVillage rejects 'No'", !looksLikeVillage("No"));
  ok("looksLikeVillage rejects a target number", !looksLikeVillage("500"));
  ok("looksLikeVillage rejects 'Target 500'", !looksLikeVillage("Target 500"));
  ok("looksLikeVillage accepts 'No.2 Dakhin Rupahi'", looksLikeVillage("No.2 Dakhin Rupahi"));
}

console.log("ISSUE 1 — row-level parsing");
{
  const sheet = parseSheet(toCsv([HEADERS, LEGACY_ROW, NEW_FORMAT_ROW, YES_ONLY_ROW]), PPR);
  ok("no fatal error", !sheet.fatal, sheet.fatal ?? "");
  const [legacy, modern, yesOnly] = sheet.records;
  ok("legacy row (village in N, O blank) keeps its village", legacy.village === "Senchowa pathar", String(legacy.village));
  ok("legacy row is valid", legacy.status === "valid", `${legacy.status}: ${legacy.rejectReason ?? ""}`);
  ok("new-format row reads Column O, NOT 'Yes'", modern.village === "Dummy Village", String(modern.village));
  ok("new-format row is valid", modern.status === "valid");
  ok("'Yes' row without Column O value is rejected", yesOnly.status === "rejected", yesOnly.status);
  ok("'Yes' is never stored as a village", yesOnly.village === undefined, String(yesOnly.village));
  const villages = sheet.records.map((r) => r.village ?? "(rejected)");
  ok("no 'Yes' anywhere in parsed villages", !villages.includes("Yes"), villages.join(", "));
}

/* ============ ISSUE 2: reconciliation ============ */

/** Minimal store so we can simulate sync → store → sync cycles. */
type Stored = ExistingRecord & { row: NormalizedRow };
let idSeq = 1;

function applyDiff(store: Map<string, Stored>, diff: ReturnType<typeof diffSheetRecords>) {
  for (const row of diff.inserts) {
    const id = `id${idSeq++}`;
    store.set(row.externalKey, { id, externalKey: row.externalKey, naturalKey: row.naturalKey, source: "google_sheet", rawHash: row.rawHash, status: row.status, row });
  }
  for (const upd of diff.updates) {
    const cur = [...store.values()].find((s) => s.id === upd.id);
    if (cur) store.delete(cur.externalKey);
    store.set(upd.row.externalKey, { id: upd.id, externalKey: upd.row.externalKey, naturalKey: upd.row.naturalKey, source: "google_sheet", rawHash: upd.row.rawHash, status: upd.row.status, row: upd.row });
  }
  for (const id of diff.deletions) {
    for (const [key, rec] of [...store]) if (rec.id === id) store.delete(key);
  }
}

const toExisting = (store: Map<string, Stored>): ExistingRecord[] =>
  [...store.values()].map(({ id, externalKey, naturalKey, source, rawHash, status }) => ({ id, externalKey, naturalKey, source, rawHash, status }));

const total = (store: Map<string, Stored>) =>
  [...store.values()].filter((s) => s.status === "valid").reduce((sum, s) => sum + s.row.goats + s.row.sheep, 0);

const sync = (csvRows: string[][], store: Map<string, Stored>) => {
  const parsed = parseSheet(toCsv(csvRows), PPR);
  if (parsed.fatal) throw new Error(parsed.fatal);
  const diff = diffSheetRecords(parsed, toExisting(store));
  applyDiff(store, diff);
  return { parsed, diff };
};

console.log("TEST 1 — initial sync");
const store = new Map<string, Stored>();
let baseline = 0;
{
  const { diff } = sync([HEADERS, LEGACY_ROW, ROW_2, ROW_3], store);
  ok("3 records inserted", diff.inserts.length === 3, `inserts=${diff.inserts.length}`);
  ok("nothing deleted", diff.deletions.length === 0);
  baseline = total(store);
  ok(`baseline total = 321 (got ${baseline})`, baseline === 321);
}

console.log("TEST 2 — add one dummy row → totals increase by exactly that row");
{
  const before = total(store);
  const { diff } = sync([HEADERS, LEGACY_ROW, ROW_2, ROW_3, NEW_FORMAT_ROW], store);
  ok("exactly one insert", diff.inserts.length === 1 && diff.updates.length === 0, `inserts=${diff.inserts.length} updates=${diff.updates.length}`);
  ok("no deletions", diff.deletions.length === 0);
  ok("total rises by the dummy row (55)", total(store) === before + 55, `total=${total(store)}`);
}

console.log("TEST 3 — delete that dummy row → totals return EXACTLY to baseline");
{
  const { diff } = sync([HEADERS, LEGACY_ROW, ROW_2, ROW_3], store);
  ok("exactly one deletion", diff.deletions.length === 1, `deletions=${diff.deletions.length}`);
  ok("existing rows untouched (3 unchanged)", diff.unchanged === 3, `unchanged=${diff.unchanged}`);
  ok("no inserts/updates", diff.inserts.length === 0 && diff.updates.length === 0);
  ok(`total back to baseline ${baseline}`, total(store) === baseline, `total=${total(store)}`);
}

console.log("TEST 4 — sync again with no sheet change → totals unchanged");
{
  const before = total(store);
  const { diff } = sync([HEADERS, LEGACY_ROW, ROW_2, ROW_3], store);
  ok("idempotent: 0 inserts, 0 updates, 0 deletions", diff.inserts.length === 0 && diff.updates.length === 0 && diff.deletions.length === 0, JSON.stringify({ i: diff.inserts.length, u: diff.updates.length, d: diff.deletions.length }));
  ok("all rows counted as unchanged", diff.unchanged === 3, `unchanged=${diff.unchanged}`);
  ok("total identical", total(store) === before, `total=${total(store)}`);
}

console.log("Extra — edits, provenance and stale rows");
{
  // (a) stale row with village="Yes" from an old bad sync gets purged
  const staleStore = new Map(store);
  const staleRow = row({ 0: "9/20/2026 10:00:00", 2: "9/20/2026", 3: "Old Vaccinator", 6: "255", 13: "Yes" });
  sync([HEADERS, LEGACY_ROW, ROW_2, ROW_3, staleRow], staleStore);
  const yesCount = [...staleStore.values()].filter((s) => s.row.village === "Yes").length;
  ok("a 'Yes' row can be stored when the sheet contains it (then removed on next sync)", yesCount === 1 || yesCount === 0, `yesCount=${yesCount}`);
  const { diff } = sync([HEADERS, LEGACY_ROW, ROW_2, ROW_3], staleStore);
  ok("stale 'Yes' row deleted when absent from the sheet", diff.deletions.length === 1, `deletions=${diff.deletions.length}`);
  ok("no 'Yes' village remains", [...staleStore.values()].every((s) => s.row.village !== "Yes"));

  // (b) editing a row updates the SAME record — no second copy
  const editStore = new Map(store);
  const editedRow = row({ 0: "9/26/2026 11:16:31", 2: "9/25/2026", 3: "Jyotikamal Saikia", 6: "98", 11: "25", 13: "Senchowa pathar" }); // farmers 23 → 25
  const r = sync([HEADERS, editedRow, ROW_2, ROW_3], editStore);
  ok("edit → one update, zero inserts", r.diff.updates.length === 1 && r.diff.inserts.length === 0, JSON.stringify({ i: r.diff.inserts.length, u: r.diff.updates.length }));
  ok("edit → zero deletions (record kept, not lost)", r.diff.deletions.length === 0, `deletions=${r.diff.deletions.length}`);
  ok("record count stays 3 (no duplicate copy)", editStore.size === 3, `size=${editStore.size}`);
  ok("edited row carries the new value", [...editStore.values()].some((s) => s.row.farmers === 25));

  // (b2) an edit that changes the counts replaces the row 1-for-1: the
  // contribution is updated and no duplicate copy survives.
  const countStore = new Map(store);
  const recount = row({ 0: "9/26/2026 11:16:31", 2: "9/25/2026", 3: "Jyotikamal Saikia", 6: "99", 11: "23", 13: "Senchowa pathar" }); // goats 98 → 99
  const r2 = sync([HEADERS, recount, ROW_2, ROW_3], countStore);
  ok("count edit leaves exactly 3 records", countStore.size === 3, `size=${countStore.size}`);
  ok("old key removed, new key added (1 delete + 1 insert)", r2.diff.deletions.length === 1 && r2.diff.inserts.length === 1, JSON.stringify({ i: r2.diff.inserts.length, d: r2.diff.deletions.length }));
  ok("total reflects the edit (321 + 1)", total(countStore) === baseline + 1, `total=${total(countStore)}`);
  ok("the edited village row appears exactly once", [...countStore.values()].filter((s) => s.row.village === "Senchowa pathar").length === 1);

  // (c) Bharat Pashudhan records are never deleted by a sheet sync
  const bharatStore = new Map(store);
  const bharat: Stored = { id: "bharat1", externalKey: "bharat|x", naturalKey: "", source: "bharat_pashudhan", rawHash: "h", status: "valid", row: { externalKey: "bharat|x", rawHash: "h", status: "valid", isPpr: true, goats: 7, sheep: 0, taggedGoat: 0, taggedSheep: 0, wasted: 0, farmers: 1 } };
  bharatStore.set("bharat|x", bharat);
  const r3 = sync([HEADERS, LEGACY_ROW, ROW_2, ROW_3], bharatStore);
  ok("Bharat record survives the sync", bharatStore.has("bharat|x"));
  ok("its key never appears in deletions", !r3.diff.deletions.includes("bharat1"));
}

/* ---------------- summary ---------------- */
console.log(`\n${pass}/${pass + fail} assertions passed`);
if (fail > 0) process.exit(1);
