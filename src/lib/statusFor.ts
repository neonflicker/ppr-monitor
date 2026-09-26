/**
 * Client mirror of `statusFor` (src/convex/stats.ts) so the village table can
 * recompute status after applying the allocation-file target on the client.
 */
export function statusFor(completion: number | null): string {
  if (completion === null) return "NOT STARTED";
  if (completion <= 0) return "NOT STARTED";
  if (completion >= 100) return completion > 100 ? "OVER TARGET" : "TARGET COMPLETED";
  if (completion < 50) return "IN PROGRESS";
  if (completion < 75) return "GOOD PROGRESS";
  return "NEAR TARGET";
}
