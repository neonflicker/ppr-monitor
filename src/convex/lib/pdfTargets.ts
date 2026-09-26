/**
 * Pure target extraction: turns pdf-parse output (page tables + page text)
 * into structured target rows.
 *
 * The parser detects whatever structure the PDF actually has — wide tables
 * (Village | Goat | Sheep | Total), long tables (Village | Species | Target),
 * single-target tables, block/circle/code columns — and never assumes a
 * fixed layout. Every row carries a confidence value and uncertain values
 * are surfaced as warnings instead of being silently imported.
 */

import { toCount } from "./sheetParser";

export interface TargetRow {
  district?: string;
  block?: string;
  circle?: string;
  village: string;
  villageCode?: string;
  species?: string;
  goatTarget?: number;
  sheepTarget?: number;
  totalTarget: number;
  sourcePage?: number;
  confidence: number;
  manuallyCorrected: boolean;
}

export interface ExtractionResult {
  rows: TargetRow[];
  overallTarget?: number;
  overallSource?: "pdf" | "sum";
  district?: string;
  species: string[];
  goatTarget?: number;
  sheepTarget?: number;
  warnings: string[];
  confidence: number;
  extraction: "tables" | "text" | "no_text";
  pages: number;
  headers: string[];
}

interface HeaderMap {
  village: number;
  goat?: number;
  sheep?: number;
  total?: number;
  species?: number;
  block?: number;
  circle?: number;
  code?: number;
  district?: number;
}

const cellNorm = (s: string | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function classifyHeader(cells: string[]): HeaderMap | null {
  const map: Partial<HeaderMap> = {};
  let villageFound = false;
  cells.forEach((raw, i) => {
    const c = cellNorm(raw);
    if (!c) return;
    if (map.goat === undefined && c.includes("goat")) {
      map.goat = i;
      return;
    }
    if (map.sheep === undefined && c.includes("sheep")) {
      map.sheep = i;
      return;
    }
    if (
      map.species === undefined &&
      (c.includes("species") || c.includes("animaltype") || c === "type")
    ) {
      map.species = i;
      return;
    }
    if (map.code === undefined && c.includes("code")) {
      map.code = i;
      return;
    }
    if (map.circle === undefined && c.includes("circle")) {
      map.circle = i;
      return;
    }
    if (
      map.block === undefined &&
      (c.includes("block") || c === "area" || c.includes("areaname"))
    ) {
      map.block = i;
      return;
    }
    if (map.district === undefined && c.includes("district")) {
      map.district = i;
      return;
    }
    if (
      !villageFound &&
      (c.includes("village") || c === "name" || c.includes("nameofvillage"))
    ) {
      map.village = i;
      villageFound = true;
      return;
    }
    if (
      map.total === undefined &&
      (c.includes("total") || c.includes("target") || c.includes("sanctioned"))
    ) {
      map.total = i;
    }
  });
  if (!villageFound || map.village === undefined) return null;
  if (
    map.total === undefined &&
    map.goat === undefined &&
    map.sheep === undefined
  ) {
    return null;
  }
  return map as HeaderMap;
}

const TOTAL_ROW = /^(grand\s+)?(district\s+)?(total|sum|overall|sub\s*total)\b/;

function parseNumericCell(raw: string | undefined): {
  value: number | null;
  hadContent: boolean;
} {
  const s = (raw ?? "").trim();
  if (!s || s === "-" || /^(n\/?a|na|nil|tbd|\?)$/i.test(s)) {
    return { value: null, hadContent: false };
  }
  // Cells like "300 (450)" or "300/150" — take the first number.
  const m = s.replace(/,/g, "").match(/\d+(\.\d+)?/);
  if (!m) return { value: null, hadContent: true };
  const n = Math.round(Number(m[0]));
  if (!Number.isFinite(n) || n < 0) return { value: null, hadContent: true };
  return { value: n, hadContent: true };
}

/** Pull a labelled overall/district target out of free text. */
function extractOverallFromText(text: string): number | null {
  const patterns = [
    /(?:district\s+)?(?:overall|grand\s+)?total\s*(?:target|sanctioned|animals)?\s*(?:of|:|is|=|-)?\s*([\d][\d,]{2,})/gi,
    /(?:overall|target)\s*(?:target)?\s*(?:is|:|of|=|-)?\s*([\d][\d,]{2,})/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const value = toCount(match[1]);
      if (value > 0) return value;
    }
  }
  return null;
}

function extractDistrictFromText(text: string): string | undefined {
  const m = text.match(
    /district\s*[:\-–]\s*([a-z][a-z\s]{2,30}?)(?:\n|,|;|\.|block|circle)/i,
  );
  if (m) {
    const value = m[1].trim().replace(/\s+/g, " ");
    if (value.length >= 3) return value.toUpperCase();
  }
  return undefined;
}

export interface PdfTableInput {
  page: number;
  tables: string[][][];
}

export function extractTargets(
  pageTables: PdfTableInput[],
  pageTexts: { num: number; text: string }[],
): ExtractionResult {
  const warnings: string[] = [];
  const rows: TargetRow[] = [];
  const headers: string[] = [];
  let overallFromTable: number | null = null;
  let overallFromTableIsDistrict = false;
  let district: string | undefined;
  let lastHeader: HeaderMap | null = null;
  let lastHeaderCells: string[] = [];
  let anyTable = false;

  for (const page of pageTables) {
    for (const table of page.tables) {
      if (!table || table.length === 0) continue;
      let header: HeaderMap | null = null;
      let headerIndex = -1;
      for (let i = 0; i < Math.min(table.length, 6); i++) {
        const found = classifyHeader(table[i]);
        if (found) {
          header = found;
          headerIndex = i;
          break;
        }
      }
      if (!header && lastHeader && table.length > 1) {
        // Continuation of a table whose header lives on an earlier page.
        header = lastHeader;
        headerIndex = -1;
      }
      if (!header) continue;
      anyTable = true;
      if (headerIndex >= 0 && headers.length === 0) {
        headers.push(...table[headerIndex].map((c) => c.trim()).filter(Boolean));
      }
      lastHeader = header;
      if (headerIndex >= 0) lastHeaderCells = table[headerIndex];

      const isLongForm =
        header.species !== undefined &&
        header.goat === undefined &&
        header.sheep === undefined;

      for (let r = Math.max(headerIndex + 1, 0); r < table.length; r++) {
        const cells = table[r];
        if (!cells) continue;
        // Skip a repeated header row inside a continuation table.
        if (classifyHeader(cells)) continue;
        const villageRaw = (cells[header.village] ?? "").trim();
        if (!villageRaw) continue;

        // Total / grand-total rows carry the overall figure instead of a village.
        if (TOTAL_ROW.test(villageRaw.replace(/\d+/g, "").trim())) {
          const totalCell =
            header.total !== undefined
              ? parseNumericCell(cells[header.total])
              : { value: null, hadContent: false };
          if (totalCell.value && totalCell.value > 0) {
            overallFromTable = totalCell.value;
            overallFromTableIsDistrict = /district|grand|overall/i.test(
              villageRaw,
            );
          }
          continue;
        }

        const rowDistrict =
          header.district !== undefined
            ? (cells[header.district] ?? "").trim() || undefined
            : undefined;
        if (!district && rowDistrict) district = rowDistrict;

        const base = {
          district: rowDistrict,
          block:
            header.block !== undefined
              ? (cells[header.block] ?? "").trim() || undefined
              : undefined,
          circle:
            header.circle !== undefined
              ? (cells[header.circle] ?? "").trim() || undefined
              : undefined,
          sourcePage: page.page,
        };

        // Purely numeric first cell → not a village row (page numbers etc.).
        if (/^[\d\s.,-]+$/.test(villageRaw)) continue;

        let village = villageRaw;
        let villageCode: string | undefined;
        const codeMatch = villageRaw.match(/^(\d{2,7})\s+(.+)$/);
        if (codeMatch && header.code !== undefined) {
          villageCode = codeMatch[1];
          village = codeMatch[2];
        } else if (
          header.code !== undefined &&
          header.code !== header.village
        ) {
          const code = (cells[header.code] ?? "").trim();
          if (/^\d{2,7}$/.test(code)) villageCode = code;
        }

        const goat =
          header.goat !== undefined
            ? parseNumericCell(cells[header.goat])
            : { value: null, hadContent: false };
        const sheep =
          header.sheep !== undefined
            ? parseNumericCell(cells[header.sheep])
            : { value: null, hadContent: false };
        const total =
          header.total !== undefined
            ? parseNumericCell(cells[header.total])
            : { value: null, hadContent: false };
        const speciesCell =
          header.species !== undefined
            ? (cells[header.species] ?? "").trim()
            : undefined;

        const numericCells = [goat, sheep, total];
        const contentCount = numericCells.filter((c) => c.hadContent).length;
        const badContent = numericCells.filter(
          (c) => c.hadContent && c.value === null,
        ).length;

        let confidence = 0.95;
        if (badContent > 0) {
          confidence -= 0.3 * badContent;
          warnings.push(
            `Page ${page.page}: could not read a number in the row “${villageRaw}”.`,
          );
        }

        if (isLongForm) {
          const target = total.value;
          if (target === null) {
            if (contentCount > 0) confidence -= 0.4;
            else confidence -= 0.5;
          }
          rows.push({
            ...base,
            village,
            villageCode,
            species: speciesCell || undefined,
            totalTarget: target ?? 0,
            confidence: Math.max(0.2, confidence),
            manuallyCorrected: false,
          });
          continue;
        }

        let goatTarget = goat.value ?? undefined;
        let sheepTarget = sheep.value ?? undefined;
        let totalTarget = total.value ?? null;

        if (totalTarget === null) {
          const sum = (goat.value ?? 0) + (sheep.value ?? 0);
          if (sum > 0) totalTarget = sum;
          else if (contentCount > 0) confidence -= 0.35;
          else confidence -= 0.5;
        }
        if (goatTarget === undefined && sheepTarget === undefined) {
          // No species breakdown in this table — do not invent one.
          goatTarget = undefined;
          sheepTarget = undefined;
        }

        rows.push({
          ...base,
          village,
          villageCode,
          goatTarget,
          sheepTarget,
          totalTarget: totalTarget ?? 0,
          confidence: Math.max(0.2, confidence),
          manuallyCorrected: false,
        });
      }
    }
  }

  // ---- Long-form (Village | Species | Target): merge species rows ----
  const hasLongFormRows = rows.some((r) => r.species !== undefined);
  let mergedRows = rows;
  if (hasLongFormRows) {
    const byVillage = new Map<string, TargetRow>();
    for (const row of rows) {
      const key = [
        row.village.toLowerCase().trim(),
        row.block ?? "",
        row.circle ?? "",
        row.sourcePage ?? "",
      ].join("|");
      const existing = byVillage.get(key);
      const species = (row.species ?? "").toLowerCase();
      if (!existing) {
        byVillage.set(key, {
          ...row,
          goatTarget: species.includes("goat")
            ? row.totalTarget
            : undefined,
          sheepTarget: species.includes("sheep")
            ? row.totalTarget
            : undefined,
          species: row.species,
        });
      } else {
        existing.totalTarget += row.totalTarget;
        existing.confidence = Math.min(existing.confidence, row.confidence);
        if (species.includes("goat")) existing.goatTarget = row.totalTarget;
        if (species.includes("sheep")) existing.sheepTarget = row.totalTarget;
        if (!existing.species && row.species) existing.species = row.species;
      }
    }
    mergedRows = [...byVillage.values()];
  }

  // ---- Species list + species totals ----
  const speciesSet = new Set<string>();
  for (const row of mergedRows) {
    if (row.species) speciesSet.add(row.species.trim());
  }
  const hasGoatColumn = mergedRows.some((r) => r.goatTarget !== undefined);
  const hasSheepColumn = mergedRows.some((r) => r.sheepTarget !== undefined);
  if (hasGoatColumn) speciesSet.add("Goat");
  if (hasSheepColumn) speciesSet.add("Sheep");

  let goatTarget: number | undefined;
  let sheepTarget: number | undefined;
  if (hasGoatColumn) {
    goatTarget = mergedRows.reduce((sum, r) => sum + (r.goatTarget ?? 0), 0);
    warnings.push(
      "Goat target total computed by summing the goat columns of the extracted rows.",
    );
  }
  if (hasSheepColumn) {
    sheepTarget = mergedRows.reduce((sum, r) => sum + (r.sheepTarget ?? 0), 0);
    warnings.push(
      "Sheep target total computed by summing the sheep columns of the extracted rows.",
    );
  }

  // ---- Overall target ----
  const fullText = pageTexts.map((p) => p.text).join("\n");
  const overallFromText = extractOverallFromText(fullText);
  let overallTarget: number | undefined;
  let overallSource: "pdf" | "sum" | undefined;

  if (overallFromTable !== null && (!overallFromText || overallFromTableIsDistrict)) {
    overallTarget = overallFromTable;
    overallSource = "pdf";
  } else if (overallFromText !== null) {
    overallTarget = overallFromText;
    overallSource = "pdf";
  } else if (mergedRows.length > 0) {
    overallTarget = mergedRows.reduce((sum, r) => sum + r.totalTarget, 0);
    overallSource = "sum";
    warnings.push(
      "No explicit overall target found in the PDF — the overall target shown is the sum of the extracted village targets.",
    );
  }

  if (!district) district = extractDistrictFromText(fullText);

  // ---- Confidence + structural warnings ----
  let confidence: number;
  let extraction: ExtractionResult["extraction"];
  if (!anyTable && mergedRows.length === 0) {
    const hasText = fullText.trim().length > 20;
    extraction = hasText ? "text" : "no_text";
    confidence = 0;
    if (!hasText) {
      warnings.push(
        "This PDF has no extractable text — it looks like a scanned image. Use manual entry to add targets, or upload a text-based PDF.",
      );
    } else {
      warnings.push(
        "No target tables were detected in the PDF. Only headline values were found — add village targets manually if needed.",
      );
    }
  } else {
    extraction = "tables";
    const sample = mergedRows.length > 0 ? mergedRows : rows;
    confidence =
      sample.reduce((sum, r) => sum + r.confidence, 0) / (sample.length || 1);
    confidence = Math.round(confidence * 100) / 100;
    if (confidence < 0.75) {
      warnings.push(
        "Extraction confidence is low — review every value before importing.",
      );
    }
    if (mergedRows.length === 0) {
      warnings.push("No village rows could be read from the detected tables.");
    }
  }

  const villageNames = new Set(
    mergedRows.map((r) => r.village.toLowerCase().trim()),
  );

  if (overallTarget !== undefined && overallSource === "pdf") {
    const sum = mergedRows.reduce((s, r) => s + r.totalTarget, 0);
    if (mergedRows.length > 0 && Math.abs(sum - overallTarget) > 0) {
      warnings.push(
        `Reconciliation needed: PDF overall target ${overallTarget.toLocaleString("en-IN")} vs sum of village targets ${sum.toLocaleString("en-IN")}.`,
      );
    }
  }

  return {
    rows: mergedRows,
    overallTarget,
    overallSource,
    district,
    species: [...speciesSet],
    goatTarget,
    sheepTarget,
    warnings: [...new Set(warnings)],
    confidence: extraction === "tables" ? (confidence as number) : 0,
    extraction,
    pages: pageTexts.length,
    headers: headers.length ? headers : lastHeaderCells.filter(Boolean),
  };
}
