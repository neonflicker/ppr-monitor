import { Mark } from "@/components/Mark";
import { Button } from "@/components/ui/button";
import { useAdmin } from "@/hooks/use-admin";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  CloudDownload,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router";

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.45, ease: "easeOut" as const },
};

const STEPS = [
  {
    title: "The field sheet keeps recording",
    body: "Every vaccination entry made by vaccinators lands in the district's Google Sheet, exactly as it does today.",
    icon: <ClipboardList className="size-4" />,
  },
  {
    title: "The system synchronises it",
    body: "A sync reads the sheet, maps whichever columns it finds, and imports only rows that are new or changed — never counting a record twice.",
    icon: <CloudDownload className="size-4" />,
  },
  {
    title: "Progress answers the first question",
    body: "Total animals vaccinated against the programme target, updated with the last sync time, ready for review.",
    icon: <CheckCircle2 className="size-4" />,
  },
];

const FEATURES = [
  {
    title: "Live Google Sheet sync",
    body: "Manual refresh or automatic background sync, with row-by-row change detection and a visible sync log.",
  },
  {
    title: "Duplicate-safe by design",
    body: "Each record is identified and compared before import, so re-syncing never inflates the district total.",
  },
  {
    title: "PPR-only accounting",
    body: "Configurable accepted disease values mean only genuine PPR vaccinations count towards achievement.",
  },
  {
    title: "Administrator-gated controls",
    body: "Sign-in is username and password with salted scrypt hashes. Public viewers never see administrative controls.",
  },
];

export default function Landing() {
  const navigate = useNavigate();
  const { state } = useAdmin();
  const signedIn = state.status === "authenticated";

  return (
    <div className="min-h-screen">
      {/* ---------- Nav ---------- */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-2.5 text-left"
          >
            <Mark className="size-8" />
            <span>
              <span className="block font-title text-sm font-bold leading-tight tracking-tight">
                PPR Field Vaccination Monitoring
              </span>
              <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Lakhimpur District · Assam
              </span>
            </span>
          </button>

          <nav className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => navigate("/auth")}
            >
              {signedIn ? "Dashboard" : "Admin login"}
            </Button>
            <Button size="sm" onClick={() => navigate(signedIn ? "/dashboard" : "/auth")}>
              {signedIn ? "Open dashboard" : "Sign in"}
              <ArrowRight className="size-4" />
            </Button>
          </nav>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="pointer-events-none absolute inset-0 ruled opacity-70" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-y-0 left-6 w-px bg-[var(--margin-line)] sm:left-12 lg:left-[calc(50%-30rem)]" aria-hidden="true" />

        <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="pl-4 sm:pl-8"
          >
            <span className="sticker inline-block -rotate-1 rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              Veterinary &amp; Animal Husbandry · Assam
            </span>

            <h1 className="mt-5 font-title text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              PPR Field
              <br />
              Vaccination
              <br />
              <span className="text-primary">Monitoring</span>
            </h1>

            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              A district notebook that stays current. The historical PPR field
              sheet syncs straight into a single screen: total animals
              vaccinated against the programme target for{" "}
              <span className="font-semibold text-foreground">Lakhimpur</span>.
            </p>

            <p className="annotation mt-3 text-xl text-primary/85">
              read from the field sheet — never re-typed, never double counted →
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => navigate(signedIn ? "/dashboard" : "/auth")}>
                {signedIn ? "Open the dashboard" : "Admin sign in"}
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate(signedIn ? "/dashboard" : "/auth")}
              >
                <LockKeyhole className="size-4" />
                {signedIn ? "Refresh the data" : "Create admin account"}
              </Button>
            </div>
          </motion.div>

          {/* Notebook page preview */}
          <motion.aside
            initial={{ opacity: 0, y: 24, rotate: -1.5 }}
            animate={{ opacity: 1, y: 0, rotate: -1.5 }}
            transition={{ duration: 0.55, delay: 0.15, ease: "easeOut" }}
            className="relative self-start rounded-lg border border-border bg-card p-6 ruled sm:p-8"
          >
            <div className="margin-rule absolute inset-0" aria-hidden="true" />
            <div className="relative z-10 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Main screen
                  </p>
                  <p className="font-title text-lg font-bold tracking-tight">
                    Total animals vaccinated
                  </p>
                </div>
                <ShieldCheck className="size-5 text-primary" />
              </div>

              <div className="rounded-md border border-border bg-background/70 px-4 py-4">
                <p className="font-title text-5xl font-bold tabular-nums">—</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  of <span className="font-semibold text-foreground">—</span>{" "}
                  target
                </p>
                <div className="mt-4 h-4 overflow-hidden rounded-full border border-border bg-muted">
                  <div className="h-full w-0" />
                </div>
                <p className="annotation mt-2 text-lg text-muted-foreground">
                  figures come from your sheet, not from sample data
                </p>
              </div>

              <ul className="space-y-2.5 text-sm text-muted-foreground">
                {[
                  "Sync status with rows retrieved, new, updated, unchanged",
                  "Today’s vaccination and district coverage at a glance",
                  "Last data update timestamp under the title",
                ].map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.aside>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <motion.div {...reveal} className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Working notes
            </p>
            <h2 className="mt-2 font-title text-3xl font-bold tracking-tight sm:text-4xl">
              From the field sheet to the dashboard
            </h2>
            <p className="annotation mt-2 text-xl text-primary/80">
              three steps, all visible in the app →
            </p>
          </motion.div>

          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <motion.li
                {...reveal}
                transition={{ ...reveal.transition, delay: index * 0.08 }}
                key={step.title}
                className="relative rounded-lg border border-border bg-card p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full border border-border bg-muted font-title text-sm font-bold">
                    {index + 1}
                  </span>
                  <span className="text-primary">{step.icon}</span>
                </div>
                <h3 className="mt-3 font-title text-lg font-semibold leading-snug tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <motion.h2
            {...reveal}
            className="font-title text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Built for accurate district reporting
          </motion.h2>

          <div className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <motion.div
                {...reveal}
                key={feature.title}
                className="border-l-2 border-primary/40 pl-4"
              >
                <h3 className="font-title text-lg font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {feature.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section>
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <motion.div
            {...reveal}
            className="relative overflow-hidden rounded-xl border border-border bg-card px-6 py-10 text-center sm:px-10"
          >
            <div className="grid-paper pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
            <div className="relative z-10 mx-auto max-w-2xl">
              <RefreshCw className="mx-auto size-6 text-primary" />
              <h2 className="mt-4 font-title text-3xl font-bold tracking-tight">
                {signedIn ? "Your dashboard is ready" : "Open the monitoring dashboard"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Sign in as the district administrator to refresh the Google
                Sheet data and review total PPR vaccination against target.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button size="lg" onClick={() => navigate(signedIn ? "/dashboard" : "/auth")}>
                  {signedIn ? "Go to dashboard" : "Admin sign in"}
                  <ArrowRight className="size-4" />
                </Button>
                <Button size="lg" variant="outline" onClick={() => navigate("/")}>
                  <LockKeyhole className="size-4" />
                  Back to top
                </Button>
              </div>
            </div>
          </motion.div>

          <footer className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
            <span>
              PPR Field Vaccination Monitoring System · District Lakhimpur, Assam
            </span>
            <span>Data read-only from the official PPR field sheet</span>
          </footer>
        </div>
      </section>
    </div>
  );
}
