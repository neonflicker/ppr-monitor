"use node";

import { ConvexError, v } from "convex/values";
import ExcelJS from "exceljs";
import { api, internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import { requireAdmin } from "./adminAuth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}-${m}-${y}`;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

type Computed = Awaited<ReturnType<typeof computeReport>>;

async function computeReport(ctx: ActionCtx, dateKey: string) {
  return await ctx.runQuery(api.reports.compute, { dateKey });
}

async function persistReport(
  ctx: ActionCtx,
  dateKey: string,
  computed: Computed,
  wasted: number,
  notes: string | undefined,
  by: string,
) {
  return await ctx.runMutation(internal.reports.saveInternal, {
    reportDate: dateKey,
    generatedBy: by,
    district: computed.district,
    vaccinationStartDate: computed.vaccinationStartDate ?? undefined,
    goats: computed.goats,
    sheep: computed.sheep,
    wasted,
    taggedGoat: computed.taggedGoat,
    taggedSheep: computed.taggedSheep,
    farmers: computed.farmers,
    departmental: computed.personnelCounts.departmental,
    semiGovernment: computed.personnelCounts.semiGovernment,
    privatePersonnel: computed.personnelCounts.private,
    notes,
  });
}

/** Save the administrator-edited report (wastage is manual input). */
export const saveDailyReport = action({
  args: {
    token: v.string(),
    reportDate: v.string(),
    wasted: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    if (!DATE_RE.test(args.reportDate)) {
      throw new ConvexError("Report date must be in YYYY-MM-DD format.");
    }
    if (!Number.isFinite(args.wasted) || args.wasted < 0) {
      throw new ConvexError("Wasted vaccine doses must be zero or more.");
    }
    const computed = await computeReport(ctx, args.reportDate);
    await persistReport(
      ctx,
      args.reportDate,
      computed,
      Math.round(args.wasted),
      args.notes?.trim() || undefined,
      admin.username,
    );
    return { ok: true as const, reportDate: args.reportDate };
  },
});

/** Generate the styled DISTRICT DVTR FORMAT PPR-EP Excel file. */
export const generateReportExcel = action({
  args: {
    token: v.string(),
    reportDate: v.string(),
    wasted: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; fileName: string; reportDate: string }> => {
    const admin = await requireAdmin(ctx, args.token);
    if (!DATE_RE.test(args.reportDate)) {
      throw new ConvexError("Report date must be in YYYY-MM-DD format.");
    }
    const wasted = Math.round(args.wasted);
    const computed = await computeReport(ctx, args.reportDate);
    await persistReport(
      ctx,
      args.reportDate,
      computed,
      wasted,
      args.notes?.trim() || undefined,
      admin.username,
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("PPR Daily Report");

    sheet.getColumn(1).width = 38;
    sheet.getColumn(2).width = 30;

    // ---- Title ----
    sheet.mergeCells("A1:B1");
    const title = sheet.getCell("A1");
    title.value = "DISTRICT DVTR FORMAT PPR-EP";
    title.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    title.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1B5E20" },
    };
    title.border = {
      top: { style: "medium", color: { argb: "FF1B5E20" } },
      left: { style: "medium", color: { argb: "FF1B5E20" } },
      bottom: { style: "medium", color: { argb: "FF1B5E20" } },
      right: { style: "medium", color: { argb: "FF1B5E20" } },
    };
    sheet.getRow(1).height = 30;

    const rows: [string, string | number][] = [
      ["Date", formatDate(args.reportDate)],
      ["Name of the District", computed.district],
      [
        "Vaccination Start Date",
        computed.vaccinationStartDate
          ? formatDate(computed.vaccinationStartDate)
          : "N/A",
      ],
      ["Goats vaccinated on Date", computed.goats],
      ["Sheep vaccinated on Date", computed.sheep],
      ["Wasted Vaccine doses on", wasted],
      ["Tagged Goat + Sheep on", computed.taggedTotal],
      ["Farmers Covered on Date", computed.farmers],
      ["Persons Departmental used", computed.personnelCounts.departmental],
      ["Persons semi-government", computed.personnelCounts.semiGovernment],
      ["Persons Private", computed.personnelCounts.private],
    ];

    const thin = { style: "thin" as const, color: { argb: "FF8A8A8A" } };

    rows.forEach(([label, value], index) => {
      const row = sheet.addRow([label, value]);
      row.height = 22;
      const labelCell = row.getCell(1);
      const valueCell = row.getCell(2);
      labelCell.font = { bold: true, size: 12 };
      labelCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: index % 2 === 0 ? "FFF2F7F2" : "FFFFFFFF" },
      };
      valueCell.alignment = { horizontal: "center" };
      valueCell.font = { size: 12 };
      labelCell.border = {
        top: thin,
        left: thin,
        bottom: thin,
        right: thin,
      };
      valueCell.border = {
        top: thin,
        left: thin,
        bottom: thin,
        right: thin,
      };
    });

    // ---- Footer ----
    const footerRowNumber = rows.length + 2;
    sheet.mergeCells(`A${footerRowNumber}:B${footerRowNumber}`);
    const footer = sheet.getCell(`A${footerRowNumber}`);
    footer.value = `Generated ${new Date().toLocaleString("en-IN")} by ${admin.username} · Achievement data: Google Sheet + Bharat Pashudhan`;
    footer.font = { italic: true, size: 9, color: { argb: "FF666666" } };
    footer.alignment = { horizontal: "center" };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      throw new ConvexError("The Excel file could not be stored.");
    }

    const fileName = `PPR_Daily_Report_${titleCase(computed.district)}_${args.reportDate}.xlsx`;
    return { url, fileName, reportDate: args.reportDate };
  },
});
