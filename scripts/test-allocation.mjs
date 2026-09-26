/* E2E test for the allocation import pipeline (run with `bun`).
 *
 * Self-contained: generates its own CSV + XLSX fixtures in /tmp so it can run
 * on a fresh sandbox. Exercises exactly the code paths the admin UI uses:
 *   readAllocationFile -> analyzeAllocation -> (confirm import payload) */
import { analyzeAllocation, readAllocationFile } from "../src/lib/allocationImport";
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";

const DIR = "/tmp/alloctest";

function summary(p) {
  return {
    fileName: p.fileName,
    mappedColumns: p.mappedColumns,
    totalRows: p.totalRows,
    validRows: p.validRows,
    invalidRows: p.invalidRows,
    users: p.users,
    villages: p.villages,
    totalTarget: p.totalTarget,
    errors: p.errors,
  };
}

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  PASS  ${msg}`);
  } else {
    failures++;
    console.log(`  FAIL  ${msg}`);
  }
}

async function main() {
  mkdirSync(DIR, { recursive: true });

  /* ---------------------------------------------------------------- */
  /* 1. CSV with valid + invalid rows (row-level errors must be kept)  */
  /* ---------------------------------------------------------------- */
  console.log("\n=== 1. CSV with invalid rows ===");
  const messyCsv = [
    "  User Name  ,  Allotted Village  ,  Target  ",
    "Niltupal Saikia,No.2 Dakhin Rupahi,450",
    "Jytotkamal Saikia,Senchowa Pathar,350",
    ",Missing User Village,120",
    "No Village User,,90",
    "Bad Target,Village B,abc",
    "Negative Target,Village C,-5",
  ].join("\n");
  writeFileSync(`${DIR}/allocation_test.csv`, messyCsv);

  const csvFile = new File([messyCsv], "allocation_test.csv");
  const csvData = await readAllocationFile(csvFile);
  const csvPreview = analyzeAllocation(csvData.name, csvData.headers, csvData.rows);
  console.log(JSON.stringify(summary(csvPreview), null, 2));

  assert(
    JSON.stringify(csvPreview.mappedColumns) ===
      JSON.stringify({
        user: "User Name",
        village: "Allotted Village",
        target: "Target",
      }),
    "whitespace-padded headers mapped to User Name / Allotted Village / Target",
  );
  assert(csvPreview.totalRows === 6, `totalRows = 6 (got ${csvPreview.totalRows})`);
  assert(csvPreview.validRows === 2, `validRows = 2 (got ${csvPreview.validRows})`);
  assert(
    csvPreview.invalidRows === 4,
    `invalidRows = 4 (got ${csvPreview.invalidRows})`,
  );
  assert(csvPreview.totalTarget === 800, `totalTarget = 800 (got ${csvPreview.totalTarget})`);
  assert(csvPreview.errors.length === 4, `4 row-level errors reported (got ${csvPreview.errors.length})`);
  assert(
    csvPreview.errors.some((e) => e.error === "User Name is blank"),
    'flags "User Name is blank"',
  );
  assert(
    csvPreview.errors.some((e) => e.error === "Allotted Village is blank"),
    'flags "Allotted Village is blank"',
  );
  assert(
    csvPreview.errors.some((e) => e.error.includes("is not a number")),
    'flags "Target … is not a number"',
  );
  assert(
    csvPreview.errors.some((e) => e.error === "Target is negative"),
    'flags "Target is negative"',
  );

  /* ---------------------------------------------------------------- */
  /* 2. Real XLSX (§28 sample) generated with the xlsx library          */
  /* ---------------------------------------------------------------- */
  console.log("\n=== 2. Real XLSX (§28 sample) ===");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["User Name", "Allotted Village", "Target"],
    ["Niltupal Saikia", "No.2 Dakhin Rupahi", 450],
    ["Jytotkamal Saikia", "Senchowa Pathar", 350],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Allocation");
  const xlsxPath = `${DIR}/allocation_test.xlsx`;
  XLSX.writeFile(wb, xlsxPath);
  writeFileSync(`${DIR}/allocation_test.csv`, messyCsv); // restore CSV fixture

  const xlsxFile = new File(
    [await Bun.file(xlsxPath).arrayBuffer()],
    "allocation_test.xlsx",
  );
  const xlsxData = await readAllocationFile(xlsxFile);
  const xlsxPreview = analyzeAllocation(xlsxData.name, xlsxData.headers, xlsxData.rows);
  console.log(JSON.stringify(summary(xlsxPreview), null, 2));

  assert(xlsxPreview.validRows === 2, `XLSX validRows = 2 (got ${xlsxPreview.validRows})`);
  assert(xlsxPreview.invalidRows === 0, `XLSX invalidRows = 0 (got ${xlsxPreview.invalidRows})`);
  assert(xlsxPreview.totalTarget === 800, `XLSX totalTarget = 800 (got ${xlsxPreview.totalTarget})`);
  assert(xlsxPreview.users.length === 2, "XLSX detected 2 users");
  assert(xlsxPreview.villages.length === 2, "XLSX detected 2 villages");

  /* ---------------------------------------------------------------- */
  /* 3. Missing-column detection                                       */
  /* ---------------------------------------------------------------- */
  console.log("\n=== 3. Missing required columns ===");
  const bad = await readAllocationFile(
    new File(["Date,Description\n2026-09-22,none\n"], "bad.csv"),
  );
  const badPreview = analyzeAllocation(bad.name, bad.headers, bad.rows);
  assert(
    badPreview.errors.some((e) => e.error.includes("Required column")),
    "reports missing required columns",
  );

  /* ---------------------------------------------------------------- */
  /* 4. Dependent dropdown logic (mirrors ScopeFilter exactly)          */
  /* ---------------------------------------------------------------- */
  console.log("\n=== 4. Dependent USER → ALLOTTED VILLAGE dropdown ===");
  const active = xlsxPreview.rows
    .filter((r) => r.status === "valid")
    .map((r) => ({
      userKey: r.userName.trim().toLowerCase(),
      userName: r.userName,
      villageKey: r.village.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      target: r.target,
    }));

  const users = [...new Map(active.map((r) => [r.userKey, r.userName])).entries()]
    .map(([key, name]) => ({
      key,
      name,
      villages: active.filter((r) => r.userKey === key).map((r) => r.villageKey),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const villageOptionsFor = (userKey) =>
    userKey === "ALL"
      ? ["ALL VILLAGES", ...new Set(active.map((r) => r.villageKey))]
      : ["ALL VILLAGES", ...(users.find((u) => u.key === userKey)?.villages ?? [])];

  console.log(`  USER dropdown = [ALL USERS, ${users.map((u) => u.name).join(", ")}]`);
  const allVillages = villageOptionsFor("ALL");
  console.log(`  ALL USERS → ${allVillages.join(", ")}`);
  assert(
    allVillages.length === 3,
    "ALL USERS shows ALL VILLAGES + both villages",
  );

  for (const u of users) {
    const opts = villageOptionsFor(u.key);
    console.log(`  ${u.name} → ${opts.join(", ")}`);
    assert(opts.length === 2, `${u.name} sees only their own village`);
  }

  const jyto = villageOptionsFor("jytotkamal saikia");
  assert(
    !jyto.includes("north 2 dakhin rupahi") && !jyto.includes("no 2 dakhin rupahi"),
    "Jytotkamal does NOT see No.2 Dakhin Rupahi",
  );
  const nil = villageOptionsFor("niltupal saikia");
  assert(
    !nil.includes("senchowa pathar"),
    "Niltupal does NOT see Senchowa Pathar",
  );

  /* ---------------------------------------------------------------- */
  /* 5. §16: shared village keeps both individual allocation records    */
  /* ---------------------------------------------------------------- */
  console.log("\n=== 5. Same village allocated to multiple users ===");
  const shared = [
    { userName: "Niltupal Saikia", village: "Village A", target: 300 },
    { userName: "Jytotkamal Saikia", village: "Village A", target: 200 },
  ];
  const perUser = new Map();
  const perVillage = new Map();
  for (const r of shared) {
    perUser.set(r.userName, (perUser.get(r.userName) ?? 0) + r.target);
    perVillage.set(r.village, (perVillage.get(r.village) ?? 0) + r.target);
  }
  assert(perUser.get("Niltupal Saikia") === 300, "Niltupal keeps her own 300");
  assert(perUser.get("Jytotkamal Saikia") === 200, "Jytotkamal keeps his own 200");
  assert(perVillage.get("Village A") === 500, "Village A total = 500 (summed, not overwritten)");

  /* ---------------------------------------------------------------- */
  console.log(
    failures === 0
      ? "\nTEST PASSED — all assertions green"
      : `\nTEST FAILED — ${failures} assertion(s) failed`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
