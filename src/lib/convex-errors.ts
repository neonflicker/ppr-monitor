import { ConvexError } from "convex/values";

/**
 * Extract a displayable message from an error thrown by a Convex function.
 *
 * Expected, user-facing failures are thrown as `ConvexError`, whose payload
 * reaches the client even in production (plain `Error` messages do not).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    const data = err.data as unknown;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message: unknown }).message;
      if (typeof message === "string") return message;
    }
    try {
      return JSON.stringify(data);
    } catch {
      return "Something went wrong. Please try again.";
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}
