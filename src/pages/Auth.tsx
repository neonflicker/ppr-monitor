import { Mark } from "@/components/Mark";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import { ArrowLeft, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { state, login, setup } = useAdmin();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  const needsSetup = state.status === "unauthenticated" && state.needsSetup;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === "authenticated") navigate(redirect, { replace: true });
  }, [state.status, navigate, redirect]);

  // Wait for session restore before deciding between login and first-run setup.
  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Enter both username and password.");
      return;
    }
    if (needsSetup) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters long.");
        return;
      }
      if (password !== confirm) {
        setError("The two passwords do not match.");
        return;
      }
    }

    setBusy(true);
    try {
      if (needsSetup) await setup(username, password);
      else await login(username, password);
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Notebook cover panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-card p-10 ruled lg:flex">
        <div className="margin-rule absolute inset-0" aria-hidden="true" />
        <div className="relative z-10 flex items-center gap-3">
          <Mark className="size-10" />
          <div>
            <p className="font-title text-lg font-semibold tracking-tight">
              PPR Field Vaccination Monitoring
            </p>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              District · Lakhimpur, Assam
            </p>
          </div>
        </div>

        <div className="relative z-10 max-w-md space-y-4">
          <span className="sticker inline-block -rotate-1 rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Administrator sign-in
          </span>
          <h1 className="font-title text-4xl font-bold leading-tight tracking-tight">
            The field notebook,
            <br />
            now synchronised.
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Sign in to refresh the Google Sheet data, review import quality and
            manage the programme target. Public dashboards never need an
            account.
          </p>
          <p className="annotation text-xl text-primary/80">
            keep the sheet shared &ldquo;anyone with the link can view&rdquo; →
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate("/")}
          className="relative z-10 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </button>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <Card className="w-full max-w-md border-border">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
              {needsSetup ? (
                <ShieldCheck className="size-5 text-primary" />
              ) : (
                <KeyRound className="size-5 text-primary" />
              )}
            </div>
            <CardTitle className="font-title text-2xl tracking-tight">
              {needsSetup ? "Create administrator account" : "Admin login"}
            </CardTitle>
            <CardDescription>
              {needsSetup
                ? "First run — choose the credentials that will protect this system."
                : "Username and password are checked against a hashed credential."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="e.g. dlakhimpur"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={
                    needsSetup ? "new-password" : "current-password"
                  }
                  placeholder={needsSetup ? "At least 8 characters" : "••••••••"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>

              {needsSetup && (
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat the password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={busy}
                    required
                  />
                </div>
              )}

              {error && (
                <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {needsSetup ? "Creating…" : "Signing in…"}
                  </>
                ) : needsSetup ? (
                  "Create account & enter"
                ) : (
                  "Sign in"
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => navigate("/")}
                disabled={busy}
              >
                <ArrowLeft className="size-4" />
                Back to home
              </Button>
            </form>

            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              Passwords are stored only as salted scrypt hashes. Sessions expire
              after 7 days.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      }
    >
      <Auth {...props} />
    </Suspense>
  );
}
