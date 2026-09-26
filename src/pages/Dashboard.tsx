import { Mark } from "@/components/Mark";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import type { SyncSummary } from "@/convex/sheetActions";
import { useAdmin } from "@/hooks/use-admin";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/convex-errors";
import { useAction, useQuery } from "convex/react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Database,
  ExternalLink,
  LogOut,
  RefreshCw,
  Settings2,
  Syringe,
  Loader2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

const nf = new Intl.NumberFormat("en-IN");

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: "easeOut" as const },
};

function formatStamp(ms?: number | null) {
  if (!ms) return null;
  return format(ms, "d MMM yyyy, hh:mm a");
}

function sessionExpiredError(message: string) {
  return message.startsWith("SESSION_EXPIRED");
}

export default function Dashboard() {
  const { state, token, logout, expireSession } = useAdmin();
  const adminName = state.status === "authenticated" ? state.admin.username : "";

  const todayKey = format(new Date(), "yyyy-MM-dd");
  const overview = useQuery(api.stats.overview, { todayKey });
  const history = useQuery(api.sync.history, { limit: 5 });
  const runSync = useAction(api.sheetActions.syncNow);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const autoAttempted = useRef(false);

  const lastSync = overview?.lastSync ?? null;
  const lastSuccess = overview?.lastSuccess ?? null;
  const syncing = lastSync?.status === "running";

  const handleSync = async (mode: "manual" | "auto") => {
    if (!token) {
      expireSession();
      return;
    }
    try {
      const result = (await runSync({ token, triggeredBy: mode })) as SyncSummary;
      if (result.skipped) return;
      if (mode === "manual") {
        toast.success("Google Sheet synced", {
          description: `${nf.format(result.recordsRetrieved ?? 0)} rows read · ${
            result.newRecords ?? 0
          } new · ${result.updatedRecords ?? 0} updated · ${
            result.unchangedRecords ?? 0
          } unchanged`,
        });
      }
    } catch (err) {
      const message = errorMessage(err);
      if (sessionExpiredError(message)) {
        expireSession();
        toast.error("Session expired", { description: "Please sign in again." });
        return;
      }
      if (mode === "manual") {
        toast.error("Sync failed", { description: message });
      }
    }
  };

  // First sync on open whenever the data is missing or stale.
  useEffect(() => {
    if (!token || !overview || autoAttempted.current) return;
    autoAttempted.current = true;
    const last = overview.lastSync;
    const stale =
      !last ||
      last.status === "error" ||
      (last.finishedAt ?? 0) < Date.now() - 15 * 60 * 1000;
    if (stale) void handleSync("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, overview]);

  // Periodic background refresh while the dashboard stays open.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => void handleSync("auto"), 15 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!overview) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    );
  }

  const { target, achievement, remaining, completion, today, totals } = overview;
  const percent = completion ?? 0;
  const hasTarget = target !== null && target > 0;

  return (
    <div className="min-h-screen">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Mark className="size-9 shrink-0" />
            <div>
              <h1 className="font-title text-[15px] font-bold leading-tight tracking-tight sm:text-lg">
                PPR FIELD VACCINATION MONITORING
              </h1>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">
                {overview.districtName} District · {overview.state}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="hidden text-right sm:block">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Last data update
              </p>
              <p className="text-sm font-medium tabular-nums">
                {syncing
                  ? "Updating…"
                  : (formatStamp(lastSuccess?.finishedAt) ?? "Never synced")}
              </p>
            </div>

            <Button
              size="sm"
              onClick={() => void handleSync("manual")}
              disabled={syncing}
              title="Refresh data from the Google Sheet"
            >
              {syncing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              <span className="hidden sm:inline">
                {syncing ? "Syncing…" : "Refresh data"}
              </span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setSettingsOpen(true)}
              title="Data configuration"
            >
              <Settings2 className="size-4" />
              <span className="hidden md:inline">Settings</span>
            </Button>

            <span
              className="hidden items-center gap-1.5 text-sm text-muted-foreground md:flex"
              title="Signed in as administrator"
            >
              <CheckCircle2 className="size-4 text-primary" />
              {adminName}
            </span>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => void logout()}
              title="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* ---------- Error banner ---------- */}
        {lastSync?.status === "error" && (
          <motion.div
            {...fadeUp}
            className="flex flex-wrap items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3"
          >
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-destructive">
                Google Sheet synchronisation failed
              </p>
              <p className="break-words text-sm text-destructive/90">
                {lastSync.error ?? "Unknown error."}{" "}
                {lastSuccess
                  ? `Showing data from ${formatStamp(lastSuccess.finishedAt)}.`
                  : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => void handleSync("manual")}
              disabled={syncing}
            >
              <RefreshCw className="size-4" />
              Try again
            </Button>
          </motion.div>
        )}

        {/* ---------- Hero: vaccinated vs target ---------- */}
        <motion.section {...fadeUp}>
          <Card className="relative overflow-hidden border-border">
            <div className="margin-rule absolute inset-0" aria-hidden="true" />
            <CardContent className="relative z-10 px-5 py-6 sm:px-8 sm:py-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Total animals vaccinated
                  </p>
                  <p className="annotation -mt-1 text-lg text-primary/80">
                    valid unique PPR records, district-wide
                  </p>
                </div>
                <span className="sticker -rotate-1 rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                  PPR · {overview.districtName}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
                <p className="font-title text-6xl font-bold leading-none tracking-tight tabular-nums sm:text-7xl">
                  {nf.format(achievement)}
                </p>
                <p className="pb-1 text-base text-muted-foreground sm:text-lg">
                  {hasTarget ? (
                    <>
                      of{" "}
                      <span className="font-semibold text-foreground">
                        {nf.format(target!)}
                      </span>{" "}
                      target
                    </>
                  ) : (
                    <span className="text-sm">
                      target not set — open Settings to define it
                    </span>
                  )}
                </p>
              </div>

              {/* Progress */}
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <div className="h-6 min-w-[200px] flex-1 overflow-hidden rounded-full border border-border bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-700"
                    style={{
                      width: hasTarget ? `${Math.min(percent, 100)}%` : "0%",
                    }}
                  />
                </div>
                <p className="annotation text-2xl font-semibold text-primary">
                  {hasTarget ? `${percent.toFixed(2)}% completed` : "— % completed"}
                </p>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <HeroStat
                  label="Remaining"
                  value={remaining !== null ? nf.format(remaining) : "N/A"}
                />
                <HeroStat
                  label="Completion"
                  value={completion !== null ? `${completion.toFixed(2)}%` : "N/A"}
                />
                <HeroStat label="Goats vaccinated" value={nf.format(totals.goats)} />
                <HeroStat label="Sheep vaccinated" value={nf.format(totals.sheep)} />
              </dl>

              {overview.totalRecords === 0 && (
                <div className="mt-6 rounded-md border border-dashed border-border bg-muted/50 px-4 py-4 text-sm text-muted-foreground">
                  No records yet — use{" "}
                  <span className="font-medium text-foreground">Refresh data</span>{" "}
                  to pull the historical PPR sheet for the first time.
                </div>
              )}
            </CardContent>
          </Card>
        </motion.section>

        {/* ---------- Quick stats ---------- */}
        <motion.section {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.05 }}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <QuickStat
              label="Today's vaccination"
              value={nf.format(today.total)}
              sub={
                today.total > 0
                  ? `${nf.format(today.goats)} goats · ${nf.format(today.sheep)} sheep`
                  : "No vaccinations logged today"
              }
              icon={<Syringe className="size-4" />}
            />
            <QuickStat
              label="Villages covered"
              value={nf.format(overview.villagesCovered)}
              sub="with at least one valid record"
            />
            <QuickStat
              label="Vaccinators"
              value={nf.format(overview.vaccinatorsCovered)}
              sub="distinct names in the sheet"
            />
            <QuickStat
              label="Valid PPR records"
              value={nf.format(overview.validRecords)}
              sub="counted towards achievement"
            />
            <QuickStat
              label="Rejected rows"
              value={nf.format(overview.rejectedRecords)}
              sub="kept for inspection, not counted"
              warn={overview.rejectedRecords > 0}
            />
          </div>
        </motion.section>

        {/* ---------- Sync panel ---------- */}
        <motion.section {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }}>
          <Card className="border-border">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <CloudDownload className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="font-title text-lg tracking-tight">
                    Google Sheet Sync
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {overview.sheetUrl.replace(/\?.*$/, "")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <SyncPill
                  status={
                    syncing ? "running" : (lastSync?.status ?? "none")
                  }
                  lastSyncLabel={formatStamp(lastSuccess?.finishedAt)}
                />
                <Button
                  size="sm"
                  onClick={() => void handleSync("manual")}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Sync now
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              {syncing && (
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {lastSync?.stage ?? "Syncing…"}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                  </div>
                </div>
              )}

              {lastSuccess && !syncing && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <SyncStat
                      label="Rows retrieved"
                      value={lastSuccess.recordsRetrieved}
                    />
                    <SyncStat label="New records" value={lastSuccess.newRecords} />
                    <SyncStat
                      label="Updated"
                      value={lastSuccess.updatedRecords}
                    />
                    <SyncStat
                      label="Unchanged"
                      value={lastSuccess.unchangedRecords}
                    />
                    <SyncStat
                      label="Rejected"
                      value={lastSuccess.rejectedRecords}
                    />
                    <SyncStat
                      label="Duplicates skipped"
                      value={lastSuccess.duplicateRows}
                    />
                  </div>

                  {lastSuccess.invalidReasons &&
                    lastSuccess.invalidReasons.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wider text-muted-foreground">
                          Rejection reasons:
                        </span>
                        {lastSuccess.invalidReasons.map((reason) => (
                          <span
                            key={reason.reason}
                            className="rounded border border-border bg-muted/60 px-2 py-0.5 text-xs"
                          >
                            {reason.reason} · {reason.count}
                          </span>
                        ))}
                      </div>
                    )}

                  {lastSuccess.unmappedColumns &&
                    lastSuccess.unmappedColumns.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Ignored columns:{" "}
                        {lastSuccess.unmappedColumns.join(", ")}
                      </p>
                    )}

                  <details className="group text-sm">
                    <summary className="cursor-pointer list-none text-muted-foreground transition-colors hover:text-foreground">
                      <span className="group-open:hidden">▸ </span>
                      <span className="hidden group-open:inline">▾ </span>
                      Detected column mapping (
                      {lastSuccess.mappedColumns?.length ?? 0} fields)
                    </summary>
                    <ul className="mt-2 space-y-1 border-l-2 border-border pl-4 text-muted-foreground">
                      {(lastSuccess.mappedColumns ?? []).map((col) => (
                        <li key={col} className="text-xs">
                          {col}
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}

              {!lastSuccess && !syncing && (
                <p className="text-sm text-muted-foreground">
                  No successful sync yet. Press{" "}
                  <span className="font-medium text-foreground">Sync now</span>{" "}
                  to pull the historical sheet.
                </p>
              )}

              {/* Sync history */}
              {history && history.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Time</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Trigger</th>
                        <th className="py-2 pr-3 font-medium">New</th>
                        <th className="py-2 pr-3 font-medium">Updated</th>
                        <th className="py-2 pr-3 font-medium">Unchanged</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr
                          key={row._id}
                          className="border-b border-border/60 last:border-0"
                        >
                          <td className="py-2 pr-3 tabular-nums">
                            {formatStamp(row.startedAt)}
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className={cn(
                                "rounded border px-1.5 py-0.5 text-xs",
                                row.status === "done" &&
                                  "border-primary/40 bg-primary/10 text-primary",
                                row.status === "error" &&
                                  "border-destructive/40 bg-destructive/10 text-destructive",
                                row.status === "running" &&
                                  "border-border bg-muted text-muted-foreground",
                              )}
                            >
                              {row.status === "done"
                                ? "Success"
                                : row.status === "error"
                                  ? "Failed"
                                  : "Running"}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {row.triggeredBy}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {row.newRecords ?? "—"}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {row.updatedRecords ?? "—"}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {row.unchangedRecords ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.section>

        {/* ---------- Data summary ---------- */}
        <motion.section {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.15 }}>
          <Card className="border-border">
            <CardHeader className="space-y-0 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <Database className="size-4 text-primary" />
                </div>
                <CardTitle className="font-title text-lg tracking-tight">
                  Data Summary
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <dl className="ruled space-y-3 rounded-md border border-border px-4 py-4 text-sm">
                <SummaryRow
                  label="Google Sheet records"
                  value={nf.format(overview.totalRecords)}
                />
                <SummaryRow
                  label="Valid, counted as achievement"
                  value={nf.format(overview.validRecords)}
                />
                <SummaryRow
                  label="Rejected, kept for inspection"
                  value={nf.format(overview.rejectedRecords)}
                />
                <SummaryRow
                  label="Last synchronization"
                  value={formatStamp(lastSuccess?.finishedAt) ?? "Never"}
                />
              </dl>

              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    PPR disease / vaccine values accepted
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {overview.pprValues.map((value) => (
                      <span
                        key={value}
                        className="rounded border border-border bg-muted/60 px-2 py-0.5 text-xs"
                      >
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Source sheet
                  </p>
                  <a
                    href={overview.sheetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1.5 break-all text-primary underline-offset-2 hover:underline"
                  >
                    Open in Google Sheets
                    <ExternalLink className="size-3.5 shrink-0" />
                  </a>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Vaccination start date
                  </p>
                  <p className="mt-0.5">
                    {overview.vaccinationStartDate ?? (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.section>

        <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
          PPR Field Vaccination Monitoring System · District Lakhimpur, Assam ·
          data read-only from the official field sheet
        </footer>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        overview={overview}
      />
    </div>
  );
}

/* ---------- small presentational pieces ---------- */

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="font-title text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function QuickStat({
  label,
  value,
  sub,
  icon,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  icon?: ReactNode;
  warn?: boolean;
}) {
  return (
    <Card className={cn("border-border", warn && "border-destructive/40")}>
      <CardContent className="space-y-1 px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          {icon && <span className="text-primary">{icon}</span>}
        </div>
        <p className="font-title text-3xl font-bold tabular-nums">{value}</p>
        <p className="text-xs leading-4 text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function SyncStat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="font-title text-lg font-semibold tabular-nums">
        {value === undefined || value === null ? "—" : nf.format(value)}
      </p>
    </div>
  );
}

function SyncPill({
  status,
  lastSyncLabel,
}: {
  status: "running" | "done" | "error" | "none";
  lastSyncLabel: string | null;
}) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium">
        <Loader2 className="size-3 animate-spin" />
        Syncing
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
        <AlertTriangle className="size-3" />
        Last sync failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
      <CheckCircle2 className="size-3" />
      {lastSyncLabel ? `Synced ${lastSyncLabel}` : "Ready"}
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
