import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import type { SyncSummary } from "@/convex/sheetActions";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import type { Overview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Database,
  ExternalLink,
  Loader2,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

const nf = new Intl.NumberFormat("en-IN");

function stamp(ms?: number | null) {
  return ms ? format(ms, "d MMM yyyy, hh:mm a") : null;
}

interface Props {
  overview: Overview;
  onOpenSettings: () => void;
}

export default function AdminStatus({ overview, onOpenSettings }: Props) {
  const { token, expireSession } = useAdmin();
  const runSync = useAction(api.sheetActions.syncNow);
  const history = useQuery(api.sync.history, { limit: 6 });
  const requestSyncStatus = useQuery(api.sync.requestSyncStatus, {});
  const [syncing, setSyncing] = useState(false);
  const autoAttempted = useRef(false);

  const lastSync = overview.lastSync;
  const lastSuccess = overview.lastSuccess;
  const busy = syncing || lastSync?.status === "running";

  const handleSync = async (mode: "manual" | "auto") => {
    if (!token) {
      expireSession();
      return;
    }
    setSyncing(true);
    try {
      const result = (await runSync({ token, triggeredBy: mode })) as SyncSummary;
      if (result.skipped) return;
      if (mode === "manual") {
        toast.success("Google Sheet synced", {
          description: `${nf.format(result.recordsRetrieved ?? 0)} rows read · ${
            result.newRecords ?? 0
          } new · ${result.updatedRecords ?? 0} updated · ${
            result.unchangedRecords ?? 0
          } unchanged${
            result.deletedRecords
              ? ` · ${result.deletedRecords} removed`
              : ""
          }`,
        });
      }
    } catch (err) {
      const message = errorMessage(err);
      if (message.startsWith("SESSION_EXPIRED")) {
        expireSession();
        toast.error("Session expired", { description: "Please sign in again." });
        return;
      }
      if (mode === "manual") toast.error("Sync failed", { description: message });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!token || autoAttempted.current) return;
    autoAttempted.current = true;
    const last = overview.lastSync;
    const stale =
      !last ||
      last.status === "error" ||
      (last.finishedAt ?? 0) < Date.now() - 15 * 60 * 1000;
    if (stale) void handleSync("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => void handleSync("auto"), 15 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="space-y-6">
      {/* ---- Headline numbers ---- */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Vaccinated"
          value={nf.format(overview.achievement)}
          sub="valid PPR records"
        />
        <Stat
          label="Today"
          value={nf.format(overview.today.total)}
          sub="animals today"
        />
        <Stat
          label="Target"
          value={overview.target !== null ? nf.format(overview.target) : "—"}
          sub={
            overview.target !== null
              ? overview.completion !== null
                ? `${overview.completion.toFixed(2)}% complete`
                : ""
              : "pending setup"
          }
        />
        <Stat
          label="Sheet records"
          value={nf.format(overview.sheetRecords)}
          sub="Google Sheet"
        />
        <Stat
          label="Bharat Pashudhan"
          value={nf.format(overview.bharatRecords)}
          sub={`last upload ${
            stamp(overview.bharat.lastUploadAt)?.split(",")[0] ?? "never"
          }`}
        />
        <Stat
          label="Rejected rows"
          value={nf.format(overview.rejectedRecords)}
          sub="kept for inspection"
          warn={overview.rejectedRecords > 0}
        />
      </div>

      {/* ---- Sync error ---- */}
      {lastSync?.status === "error" && (
        <div className="flex flex-wrap items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-destructive">
              Google Sheet synchronisation failed
            </p>
            <p className="break-words text-sm text-destructive/90">
              {lastSync.error ?? "Unknown error."}{" "}
              {lastSuccess
                ? `Showing data from ${stamp(lastSuccess.finishedAt)}.`
                : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => void handleSync("manual")}
            disabled={busy}
          >
            <RefreshCw className="size-4" />
            Try again
          </Button>
        </div>
      )}

      {/* ---- Google Sheet sync ---- */}
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium">
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : lastSync?.status === "error" ? (
                <AlertTriangle className="size-3 text-destructive" />
              ) : (
                <CheckCircle2 className="size-3 text-primary" />
              )}
              {busy
                ? "Syncing"
                : lastSync?.status === "error"
                  ? "Last sync failed"
                  : `Synced ${stamp(lastSuccess?.finishedAt) ?? "never"}`}
            </span>
            <Button
              size="sm"
              onClick={() => void handleSync("manual")}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Sync now
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium">Vaccination request responses</p>
            <p className="text-muted-foreground">
              Last successful request sync: {stamp(requestSyncStatus?.lastSuccess?.finishedAt) ?? "Never"}
              {requestSyncStatus?.lastSuccess
                ? ` · ${nf.format(requestSyncStatus.lastSuccess.deletedPendingRequests)} pending removed`
                : ""}
            </p>
            {requestSyncStatus?.lastAttempt?.error && (
              <p className="mt-1 break-words text-destructive">
                Request sync failed: {requestSyncStatus.lastAttempt.error}
              </p>
            )}
          </div>
          {busy && (
            <div>
              <p className="text-sm font-medium text-foreground">
                {lastSync?.stage ?? "Syncing…"}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-1/3 animate-pulse rounded-full bg-primary" />
              </div>
            </div>
          )}

          {lastSuccess && !busy && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
                <Mini label="Rows retrieved" value={lastSuccess.recordsRetrieved} />
                <Mini label="New records" value={lastSuccess.newRecords} />
                <Mini label="Updated" value={lastSuccess.updatedRecords} />
                <Mini label="Unchanged" value={lastSuccess.unchangedRecords} />
                <Mini
                  label="Removed (deleted in sheet)"
                  value={lastSuccess.deletedRecords}
                />
                <Mini label="Rejected" value={lastSuccess.rejectedRecords} />
                <Mini label="Duplicates skipped" value={lastSuccess.duplicateRows} />
              </div>
              {lastSuccess.invalidReasons && lastSuccess.invalidReasons.length > 0 && (
                <div className="flex flex-wrap gap-2">
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
              <details className="group text-sm">
                <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">
                  <span className="group-open:hidden">▸ </span>
                  <span className="hidden group-open:inline">▾ </span>
                  Detected column mapping ({lastSuccess.mappedColumns?.length ?? 0}{" "}
                  fields)
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

          {!lastSuccess && !busy && (
            <p className="text-sm text-muted-foreground">
              No successful sync yet. Press{" "}
              <span className="font-medium text-foreground">Sync now</span> to pull
              the historical field sheet.
            </p>
          )}

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
                        {stamp(row.startedAt)}
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

      {/* ---- Data summary ---- */}
      <Card className="border-border">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">
              <Database className="size-4 text-primary" />
            </div>
            <CardTitle className="font-title text-lg tracking-tight">
              Data Summary
            </CardTitle>
          </div>
          <Button size="sm" variant="outline" onClick={onOpenSettings}>
            <Settings2 className="size-4" />
            Settings
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <dl className="space-y-2.5 rounded-md border border-border px-4 py-4 text-sm">
            <Pair label="Total records" value={nf.format(overview.totalRecords)} />
            <Pair
              label="Counted as achievement"
              value={nf.format(overview.validRecords)}
            />
            <Pair label="Rejected" value={nf.format(overview.rejectedRecords)} />
            <Pair
              label="Non-PPR (excluded)"
              value={nf.format(overview.nonPprRecords)}
            />
            <Pair label="Villages covered" value={nf.format(overview.villagesCovered)} />
            <Pair
              label="Vaccinators covered"
              value={nf.format(overview.vaccinatorsCovered)}
            />
          </dl>

          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Master vaccination datasheet
              </p>
              <a
                href={overview.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 break-all text-primary underline-offset-2 hover:underline"
              >
                Open original Google Sheet
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
              <p className="mt-1 text-xs text-muted-foreground">
                Source for vaccination records and dashboard totals. Sync controls and history are above.
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                PPR values accepted
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
              <p className="mt-0.5">{overview.vaccinationStartDate ?? "Not set"}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card px-3 py-3",
        warn && "border-destructive/40",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="font-title text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] leading-tight text-muted-foreground">{sub}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded border border-border bg-muted/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="font-title text-lg font-semibold tabular-nums">
        {value === undefined || value === null ? "—" : nf.format(value)}
      </p>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
