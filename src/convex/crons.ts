import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Near-real-time Google Sheet sync: the sheet is polled every 2 minutes and
// reconciled against the stored records (idempotent, see diffSheetRecords).
// sheetActions.cronSync self-throttles, so ticks that overlap a run or arrive
// too soon after the last one are no-ops.
crons.interval(
  "sync-google-sheet",
  { minutes: 2 },
  internal.sheetActions.cronSync,
  {},
);

export default crons;
