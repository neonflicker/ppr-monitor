import { useAdmin } from "@/hooks/use-admin";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

/**
 * Protects administrator-only routes.
 *
 * The PPR dashboard is the signed-in product, so signed-out visitors are sent
 * straight to `/auth` with their intended path preserved in `returnTo`.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { state } = useAdmin();
  const location = useLocation();

  if (state.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    );
  }

  if (state.status === "unauthenticated") {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}
