import { readAllocationFile, analyzeAllocation } from "../src/lib/allocationImport.js";

async function main() {
  const cases = [
    { name: "good csv", body: "User Name,Allotted Village,Target\nA,X,100\nB,Y,200" },
    { name: "xlsx inline gen", makeXlsx: true },
    { name: "whitespace padded header", body: "  User Name  ,  Allotted Village  ,  Target  \nA, X , 100" },
    { name: "missing columns csv", body: "Name,Village,Total\nA,B,1" },
    { name: "headers in different case", body: "USER NAME,ALLOTTED VILLAGE,TARGET\nA,X,1" },
  ];

  for (const c of cases) {
    let file;
    if (c.makeXlsx) {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([["User Name","Allotted Village","Target"],["A","X",100]]);
      XLSX.utils.book_append_sheet(wb, ws, "Allocation");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      file = new File([buf], "inline.xlsx");
    } else {
      file = new File([c.body], `${c.name}.csv`);
    }
    const raw = await readAllocationFile(file);
    const p = analyzeAllocation(file.name, raw.headers, raw.rows);
    console.log(`=== ${c.name} ===`);
    console.log(JSON.stringify({
      headers: raw.headers,
      mappedColumns: p.mappedColumns,
      totalRows: p.totalRows,
      validRows: p.validRows,
      invalidRows: p.invalidRows,
      users: p.users,
      villages: p.villages,
      totalTarget: p.totalTarget,
      errors: p.errors,
    }, null, 2));
  }
}

main().catch((e) => { console.error("FAILED", e); process.exit(1); });
