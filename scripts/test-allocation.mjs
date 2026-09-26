/* One-off E2E test for the allocation import pipeline (run with `bun`). */
import { analyzeAllocation, readAllocationFile } from "../src/lib/allocationImport";
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";

async function main() {
  // ---- 1. CSV: read + analyze (includes invalid rows) ----
  const csv = new File(
    [await Bun.file("/tmp/alloctest/allocation_test.csv").text()],
    "allocation_test.csv",
  );
  const csvData = await readAllocationFile(csv);
  const csvPreview = analyzeAllocation(csv.name, csvData.headers, csvData.rows);
  console.log("=== CSV PREVIEW ===");
  console.log(JSON.stringify({
    fileName: csvPreview.fileName,
    mappedColumns: csvPreview.mappedColumns,
    totalRows: csvPreview.totalRows,
    validRows: csvPreview.validRows,
    invalidRows: csvPreview.invalidRows,
    users: csvPreview.users,
    villages: csvPreview.villages,
    totalTarget: csvPreview.totalTarget,
    errors: csvPreview.errors,
  }, null, 2));

  // ---- 2. XLSX: generate a real Excel file and analyze it ----
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["User Name", "Allotted Village", "Target"],
    ["Niltupal Saikia", "No.2 Dakhin Rupahi", 450],
    ["Jytotkamal Saikia", "Senchowa Pathar", 350],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Allocation");
  const out = "/tmp/alloctest/allocation_test.xlsx";
  XLSX.writeFile(wb, out);
  const xlsxData = await readAllocationFile(
    new File([await Bun.file(out).arrayBuffer()], "allocation_test.xlsx"),
  );
  const xlsxPreview = analyzeAllocation(xlsxData.name, xlsxData.headers, xlsxData.rows);
  console.log("=== XLSX PREVIEW ===");
  console.log(JSON.stringify({
    fileName: xlsxPreview.fileName,
    mappedColumns: xlsxPreview.mappedColumns,
    totalRows: xlsxPreview.totalRows,
    validRows: xlsxPreview.validRows,
    invalidRows: xlsxPreview.invalidRows,
    users: xlsxPreview.users,
    villages: xlsxPreview.villages,
    totalTarget: xlsxPreview.totalTarget,
    rows: xlsxPreview.rows,
  }, null, 2));

  // ---- 3. Dependent dropdown logic (mirrors ScopeFilter) ----
  const users = [
    { key: "niltupal saikia", name: "Niltupal Saikia", target: 950, villages: ["no 2 dakhin rupahi", "x"] },
    { key: "jytotkamal saikia", name: "Jytotkamal Saikia", target: 350, villages: ["senchowa pathar"] },
  ];
  for (const user of [null, ...users]) {
    const options = user
      ? user.villages.map((k) => [k, k])
      : [["ALL", "ALL VILLAGES"]];
    console.log(`USER=${user?.name ?? "ALL USERS"} → village options:`, options.map((o) => o[1]).join(", "));
  }
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
