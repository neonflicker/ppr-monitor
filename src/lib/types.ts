import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

/** Shared return types for the public/admin panels (avoids redeclaring props). */
export type Overview = NonNullable<FunctionReturnType<typeof api.stats.overview>>;
export type VillageProgressData = NonNullable<
  FunctionReturnType<typeof api.stats.villageProgress>
>;
export type DailyReportCompute = NonNullable<
  FunctionReturnType<typeof api.reports.compute>
>;
export type SyncRow = NonNullable<
  FunctionReturnType<typeof api.sync.history>
>[number];
export type BharatUploadRow = NonNullable<
  FunctionReturnType<typeof api.bharat.uploadHistory>
>[number];
export type TargetRecordsData = NonNullable<
  FunctionReturnType<typeof api.targets.activeRecords>
>;
export type TargetRecordRow = TargetRecordsData["records"][number];
export type DataQuality = NonNullable<
  FunctionReturnType<typeof api.stats.dataQuality>
>;
export type Reconciliation = NonNullable<
  FunctionReturnType<typeof api.targets.reconciliation>
>;
export type AuditRow = NonNullable<
  FunctionReturnType<typeof api.targets.auditTrail>
>[number];
export type ReportHistoryRow = NonNullable<
  FunctionReturnType<typeof api.reports.history>
>[number];
