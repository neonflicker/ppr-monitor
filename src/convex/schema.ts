import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Program configuration (single document table, keyed by "main").
    settings: defineTable({
      key: v.string(),
      districtName: v.string(),
      dispensaryName: v.optional(v.string()), // e.g. "SVD BOGINADI"
      state: v.string(),
      sheetUrl: v.string(),
      sheetGid: v.optional(v.string()),
      programmeTarget: v.optional(v.number()),
      vaccinationStartDate: v.optional(v.string()),
      pprValues: v.array(v.string()),
      personnelDepartmental: v.optional(v.array(v.string())),
      personnelSemiGovernment: v.optional(v.array(v.string())),
      personnelPrivate: v.optional(v.array(v.string())),
      defaultWasted: v.optional(v.number()),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    // Administrator credentials. Passwords are scrypt-hashed, never plain text.
    admins: defineTable({
      username: v.string(), // lowercased, unique
      displayName: v.string(),
      salt: v.string(),
      passwordHash: v.string(),
      createdAt: v.number(),
      lastLoginAt: v.optional(v.number()),
    }).index("by_username", ["username"]),

    // Server-side sessions for the admin login (only the hash is stored).
    adminSessions: defineTable({
      adminId: v.id("admins"),
      tokenHash: v.string(),
      createdAt: v.number(),
      expiresAt: v.number(),
    })
      .index("by_tokenHash", ["tokenHash"])
      .index("by_admin", ["adminId"]),

    // One row per Google Sheet synchronisation run, used for progress + history.
    sheetSyncs: defineTable({
      status: v.union(
        v.literal("running"),
        v.literal("done"),
        v.literal("error"),
      ),
      stage: v.string(),
      sheetUrl: v.string(),
      triggeredBy: v.union(v.literal("manual"), v.literal("auto")),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      recordsRetrieved: v.optional(v.number()),
      validRecords: v.optional(v.number()),
      duplicateRows: v.optional(v.number()),
      newRecords: v.optional(v.number()),
      updatedRecords: v.optional(v.number()),
      unchangedRecords: v.optional(v.number()),
      rejectedRecords: v.optional(v.number()),
      // google_sheet rows removed because they no longer exist in the sheet.
      deletedRecords: v.optional(v.number()),
      invalidReasons: v.optional(
        v.array(v.object({ reason: v.string(), count: v.number() })),
      ),
      mappedColumns: v.optional(v.array(v.string())),
      unmappedColumns: v.optional(v.array(v.string())),
      error: v.optional(v.string()),
      durationMs: v.optional(v.number()),
    }),

    // Normalised vaccination records (Google Sheet + Bharat Pashudhan).
    vaccinationRecords: defineTable({
      source: v.union(
        v.literal("google_sheet"),
        v.literal("bharat_pashudhan"),
      ),
      externalKey: v.string(),
      naturalKey: v.optional(v.string()),
      status: v.union(v.literal("valid"), v.literal("rejected")),
      rejectReason: v.optional(v.string()),
      isPpr: v.boolean(),
      rawHash: v.string(),
      date: v.optional(v.number()), // UTC ms for the calendar day
      dateKey: v.optional(v.string()), // YYYY-MM-DD
      village: v.optional(v.string()),
      vaccinator: v.optional(v.string()),
      designation: v.optional(v.string()),
      vaccinatorId: v.optional(v.string()),
      disease: v.optional(v.string()),
      species: v.optional(v.string()),
      tagId: v.optional(v.string()),
      goats: v.number(),
      sheep: v.number(),
      unspecified: v.optional(v.number()),
      taggedGoat: v.number(),
      taggedSheep: v.number(),
      wasted: v.number(),
      farmers: v.number(),
      timestamp: v.optional(v.string()),
      email: v.optional(v.string()),
      remarks: v.optional(v.string()),
      updatedAt: v.number(),
    })
      .index("by_key", ["externalKey"])
      .index("by_status", ["status"])
      .index("by_dateKey", ["dateKey"])
      .index("by_naturalKey", ["naturalKey"]),

    // ---- User & village allocation (Excel/CSV import) ----
    // One row per (user, village, target) from the ACTIVE allocation file.
    // This is TARGET data only — never vaccination achievement.
    allocations: defineTable({
      uploadId: v.id("allocationUploads"),
      userName: v.string(),
      normalizedUser: v.string(),
      village: v.string(),
      normalizedVillage: v.string(),
      target: v.number(),
      active: v.boolean(),
    })
      .index("by_upload", ["uploadId"])
      .index("by_active", ["active"]),

    // One row per confirmed allocation file import (newest active wins).
    allocationUploads: defineTable({
      fileName: v.string(),
      uploadedAt: v.number(),
      uploadedBy: v.string(),
      totalRows: v.number(),
      validRows: v.number(),
      invalidRows: v.number(),
      userCount: v.number(),
      villageCount: v.number(),
      totalTarget: v.number(),
      errors: v.array(
        v.object({
          row: v.number(),
          userName: v.string(),
          village: v.string(),
          error: v.string(),
        }),
      ),
      status: v.union(
        v.literal("active"),
        v.literal("superseded"),
        v.literal("failed"),
      ),
    }).index("by_status", ["status"]),

    // ---- Source 1: TARGET PDF (legacy, kept for existing data) ----
    targetVersions: defineTable({
      versionNumber: v.number(),
      fileName: v.string(),
      storageId: v.optional(v.string()),
      uploadedAt: v.number(),
      uploadedBy: v.string(),
      overallTarget: v.optional(v.number()),
      overallSource: v.optional(
        v.union(v.literal("pdf"), v.literal("sum")),
      ),
      goatTarget: v.optional(v.number()),
      sheepTarget: v.optional(v.number()),
      villageCount: v.number(),
      recordCount: v.number(),
      pages: v.optional(v.number()),
      confidence: v.optional(v.number()),
      warnings: v.optional(v.array(v.string())),
      extraction: v.union(
        v.literal("tables"),
        v.literal("text"),
        v.literal("no_text"),
        v.literal("manual"),
      ),
      source: v.optional(
        v.union(v.literal("pdf"), v.literal("manual")),
      ),
      status: v.union(
        v.literal("draft"),
        v.literal("active"),
        v.literal("archived"),
      ),
      activatedAt: v.optional(v.number()),
      archivedAt: v.optional(v.number()),
      correctedRecords: v.optional(v.number()),
    }).index("by_status", ["status"]),

    targetRecords: defineTable({
      versionId: v.id("targetVersions"),
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
      normalizedVillage: v.string(),
      active: v.optional(v.boolean()),
      remarks: v.optional(v.string()),
      allocationDate: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
      updatedBy: v.optional(v.string()),
    })
      .index("by_version", ["versionId"])
      .index("by_village", ["normalizedVillage"]),

    // Manual village alias map: normalised alias → canonical target village.
    villageMappings: defineTable({
      alias: v.string(),
      canonical: v.string(),
      createdAt: v.number(),
      createdBy: v.optional(v.string()),
    }).index("by_alias", ["alias"]),

    // ---- Source 3: BHARAT PASHUDHAN uploads ----
    bharatUploads: defineTable({
      fileName: v.string(),
      uploadedAt: v.number(),
      uploadedBy: v.string(),
      totalRows: v.number(),
      validRows: v.number(),
      newRecords: v.number(),
      duplicateRows: v.number(),
      crossSourceDuplicates: v.number(),
      rejectedRows: v.number(),
      rejectedReasons: v.array(
        v.object({ reason: v.string(), count: v.number() }),
      ),
      mappedColumns: v.array(v.string()),
      unmappedColumns: v.array(v.string()),
      status: v.union(v.literal("completed"), v.literal("failed")),
      error: v.optional(v.string()),
    }),

    dailyReports: defineTable({
      reportDate: v.string(),
      generatedAt: v.number(),
      generatedBy: v.string(),
      district: v.string(),
      vaccinationStartDate: v.optional(v.string()),
      goats: v.number(),
      sheep: v.number(),
      wasted: v.number(),
      taggedGoat: v.number(),
      taggedSheep: v.number(),
      farmers: v.number(),
      departmental: v.number(),
      semiGovernment: v.number(),
      privatePersonnel: v.number(),
      notes: v.optional(v.string()),
    }).index("by_date", ["reportDate"]),

    // Target change / activation audit trail.
    auditLog: defineTable({
      action: v.string(),
      summary: v.string(),
      details: v.optional(v.string()),
      at: v.number(),
      by: v.optional(v.string()),
    }).index("by_at", ["at"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
