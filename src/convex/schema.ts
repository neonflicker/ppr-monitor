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
      state: v.string(),
      sheetUrl: v.string(),
      sheetGid: v.optional(v.string()),
      programmeTarget: v.optional(v.number()),
      vaccinationStartDate: v.optional(v.string()),
      pprValues: v.array(v.string()),
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
      invalidReasons: v.optional(
        v.array(v.object({ reason: v.string(), count: v.number() })),
      ),
      mappedColumns: v.optional(v.array(v.string())),
      unmappedColumns: v.optional(v.array(v.string())),
      error: v.optional(v.string()),
      durationMs: v.optional(v.number()),
    }),

    // Normalised vaccination records (from the Google Sheet in v1).
    vaccinationRecords: defineTable({
      source: v.union(v.literal("google_sheet")),
      externalKey: v.string(),
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
      goats: v.number(),
      sheep: v.number(),
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
      .index("by_dateKey", ["dateKey"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
