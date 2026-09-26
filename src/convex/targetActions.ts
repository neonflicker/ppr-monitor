"use node";

import { ConvexError, v } from "convex/values";
import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { extractTargets, type TargetRow } from "./lib/pdfTargets";
import { normalizeVillage } from "./lib/villageMatch";
import { requireAdmin } from "./adminAuth";

const MAX_PDF_CHARS = 10_000_000; // ~7.5 MB binary after base64 decoding

/** Upload + extract a Target PDF. Returns a preview for admin review. */
export const previewTargetPdf = action({
  args: {
    token: v.string(),
    fileName: v.string(),
    pdfBase64: v.string(),
  },
  handler: async (ctx, args): Promise<{
    storageId: string;
    fileName: string;
    pages: number;
    rows: TargetRow[];
    overallTarget: number | null;
    overallSource: "pdf" | "sum" | null;
    district: string | null;
    species: string[];
    goatTarget: number | null;
    sheepTarget: number | null;
    warnings: string[];
    confidence: number;
    extraction: "tables" | "text" | "no_text";
    headers: string[];
    villageCount: number;
  }> => {
    await requireAdmin(ctx, args.token);

    if (!args.fileName.toLowerCase().endsWith(".pdf")) {
      throw new ConvexError("Only PDF files can be uploaded as target files.");
    }
    if (args.pdfBase64.length > MAX_PDF_CHARS) {
      throw new ConvexError(
        "The PDF is too large (limit 7.5 MB). Compress the file or upload a text-based PDF.",
      );
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(args.pdfBase64, "base64");
    } catch {
      throw new ConvexError("The file could not be decoded as a PDF.");
    }
    if (bytes.length < 100 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new ConvexError(
        "This file is not a valid PDF. Re-export the target file as PDF and try again.",
      );
    }

    let parsed: {
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
    };

    try {
      const parser = new PDFParse({ data: new Uint8Array(bytes) });
      const textResult = await parser.getText();
      const tableResult = await parser.getTable();
      const pageTables = tableResult.pages.map((page) => ({
        page: page.num,
        tables: page.tables,
      }));
      parsed = extractTargets(
        pageTables,
        textResult.pages.map((p) => ({ num: p.num, text: p.text })),
      );
      if (typeof (parser as { destroy?: () => Promise<void> }).destroy === "function") {
        await (parser as { destroy: () => Promise<void> }).destroy();
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      if (/password/i.test(message)) {
        throw new ConvexError(
          "This PDF is password-protected. Remove the password and upload again.",
        );
      }
      throw new ConvexError(
        `The PDF could not be read: ${message.slice(0, 200)}`,
      );
    }

    if (parsed.extraction === "no_text") {
      // Still store the file? No — nothing can be extracted, tell the admin.
      throw new ConvexError(
        "No extractable text was found in this PDF (scanned image). Add targets manually or upload a text-based PDF.",
      );
    }

    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    );

    const villageNames = new Set(
      parsed.rows.map((r) => normalizeVillage(r.village)),
    );

    return {
      storageId: storageId as string,
      fileName: args.fileName,
      pages: parsed.pages,
      rows: parsed.rows,
      overallTarget: parsed.overallTarget ?? null,
      overallSource: parsed.overallSource ?? null,
      district: parsed.district ?? null,
      species: parsed.species,
      goatTarget: parsed.goatTarget ?? null,
      sheepTarget: parsed.sheepTarget ?? null,
      warnings: parsed.warnings,
      confidence: parsed.confidence,
      extraction: parsed.extraction,
      headers: parsed.headers,
      villageCount: villageNames.size,
    };
  },
});

/** Throw away a previewed PDF (cancel before confirm). */
export const discardTargetPdf = action({
  args: { token: v.string(), storageId: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx, args.token);
    try {
      await ctx.storage.delete(args.storageId as Id<"_storage">);
    } catch {
      // Already gone — nothing to clean up.
    }
    return { ok: true };
  },
});

const rowValidator = v.object({
  district: v.optional(v.string()),
  block: v.optional(v.string()),
  circle: v.optional(v.string()),
  village: v.string(),
  villageCode: v.optional(v.string()),
  species: v.optional(v.string()),
  goatTarget: v.optional(v.number()),
  sheepTarget: v.optional(v.number()),
  totalTarget: v.number(),
  sourcePage: v.optional(v.number()),
  confidence: v.optional(v.number()),
  manuallyCorrected: v.boolean(),
});

/** Confirm the preview → create a new target version (optionally activate). */
export const confirmTargetUpload = action({
  args: {
    token: v.string(),
    fileName: v.string(),
    storageId: v.optional(v.string()),
    overallTarget: v.optional(v.number()),
    overallSource: v.optional(
      v.union(v.literal("pdf"), v.literal("sum")),
    ),
    goatTarget: v.optional(v.number()),
    sheepTarget: v.optional(v.number()),
    pages: v.optional(v.number()),
    confidence: v.optional(v.number()),
    warnings: v.optional(v.array(v.string())),
    extraction: v.union(
      v.literal("tables"),
      v.literal("text"),
      v.literal("no_text"),
    ),
    activate: v.boolean(),
    correctedRecords: v.number(),
    records: v.array(rowValidator),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    if (args.records.length === 0) {
      throw new ConvexError(
        "There are no target rows to import. Add at least one village target before confirming.",
      );
    }
    for (const row of args.records) {
      if (!row.village.trim()) {
        throw new ConvexError(
          "Every target row needs a village name. Fix the empty row before confirming.",
        );
      }
      if (!Number.isFinite(row.totalTarget) || row.totalTarget < 0) {
        throw new ConvexError(
          `Invalid total target for village “${row.village}”.`,
        );
      }
    }
    return await ctx.runMutation(internal.targets.createVersion, {
      fileName: args.fileName,
      storageId: args.storageId,
      uploadedBy: admin.username,
      overallTarget: args.overallTarget ?? undefined,
      overallSource: args.overallSource ?? undefined,
      goatTarget: args.goatTarget ?? undefined,
      sheepTarget: args.sheepTarget ?? undefined,
      pages: args.pages,
      confidence: args.confidence,
      warnings: args.warnings,
      extraction: args.extraction,
      activate: args.activate,
      correctedRecords: args.correctedRecords,
      records: args.records,
    });
  },
});

export const activateTargetVersion = action({
  args: { token: v.string(), versionId: v.id("targetVersions") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    return await ctx.runMutation(internal.targets.activateVersion, {
      versionId: args.versionId,
      by: admin.username,
    });
  },
});

export const archiveTargetVersion = action({
  args: { token: v.string(), versionId: v.id("targetVersions") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const admin = await requireAdmin(ctx, args.token);
    await ctx.runMutation(internal.targets.archiveVersion, {
      versionId: args.versionId,
      by: admin.username,
    });
    return { ok: true };
  },
});

export const saveVillageMapping = action({
  args: {
    token: v.string(),
    alias: v.string(),
    canonical: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const admin = await requireAdmin(ctx, args.token);
    const alias = normalizeVillage(args.alias);
    const canonical = args.canonical.trim();
    if (!alias || !canonical) {
      throw new ConvexError("Both village names are required to save a mapping.");
    }
    await ctx.runMutation(internal.targets.saveMappingInternal, {
      alias,
      canonical,
      createdBy: admin.username,
    });
    return { ok: true };
  },
});

export const removeVillageMapping = action({
  args: { token: v.string(), id: v.id("villageMappings") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx, args.token);
    await ctx.runMutation(internal.targets.deleteMappingInternal, {
      id: args.id,
    });
    return { ok: true };
  },
});
