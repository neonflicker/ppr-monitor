import HistoryChart from "@/components/public/HistoryChart";
import DailyReport from "@/components/public/DailyReport";
import NoticeBoard from "@/components/public/NoticeBoard";
import ScopeFilter, {
  type Scope,
  type ScopeData,
} from "@/components/public/ScopeFilter";
import VillageProgress, { StatusBadge } from "@/components/public/VillageProgress";
import UntouchedVillages from "@/components/public/UntouchedVillages";
import { Mark } from "@/components/Mark";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/convex-errors";
import type { Overview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ClipboardList,
  Database,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  MapPinned,
  RefreshCw,
  ShieldCheck,
  Syringe,
  Users,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { normalizeVillageClient } from "@/lib/scopeKeys";

const nf = new Intl.NumberFormat("en-IN");

/** Livestock Census goat population for Boginadi — a reference figure only.
    Never a vaccination target: it must not feed Programme Target, achievement,
    remaining or completion calculations. */
const CENSUS_GOAT_POPULATION = 18466;

const NAV = [
  { id: "dashboard", label: "DASHBOARD", icon: LayoutDashboard },
  { id: "villages", label: "VILLAGES", icon: MapPinned },
  { id: "vaccinators", label: "VACCINATORS", icon: Users },
  { id: "daily", label: "DAILY PROGRESS", icon: Syringe },
  { id: "history", label: "HISTORY", icon: History },
  { id: "reports", label: "REPORTS", icon: FileText },
] as const;

function stamp(ms?: number | null) {
  return ms ? format(ms, "d MMM yyyy, hh:mm a") : null;
}

function dayLabel(value?: string | null) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : value;
}

/** "2026-09-22" → "22 Sep 2026" for the Programme Start header field. */
function longDay(value?: string | null) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return value;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function SectionHead({
  id,
  title,
  sub,
  action,
}: {
  id?: string;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div
      id={id}
      className="scroll-mt-28 border-b border-border pb-2"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="h-6 w-[3px] shrink-0 rounded-full bg-primary"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-title text-xl font-bold tracking-tight sm:text-2xl">
              {title}
            </h2>
            {sub && (
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                {sub}
              </p>
            )}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
  tint = "tint-neutral-blue",
  contrast = false,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: string;
  tint?: string;
  contrast?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3 shadow-[0_1px_2px_rgba(45,55,90,0.05)] sm:px-4 sm:py-4",
        tint,
      )}
    >
      <p
        className={cn(
          "text-[10px] font-semibold uppercase leading-tight tracking-[0.12em] text-muted-foreground",
          contrast && "text-white",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "font-title text-3xl font-bold leading-none tracking-tight tabular-nums sm:text-4xl",
          tone,
          contrast && "text-white",
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "mt-1 text-[11px] leading-tight text-muted-foreground",
          contrast && "text-white",
        )}
      >
        {sub}
      </p>
    </div>
  );
}

function TodayMetric({
  label,
  value,
  tint = "tint-neutral-blue",
}: {
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5 shadow-[0_1px_2px_rgba(45,55,90,0.04)]",
        tint,
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="font-title text-2xl font-bold leading-tight tabular-nums">
        {value}
      </p>
    </div>
  );
}

function SpeciesCard({
  name,
  target,
  vaccinated,
  note,
  tint = "tint-blue-soft",
}: {
  name: string;
  target: number | null;
  vaccinated: number;
  note: string;
  tint?: string;
}) {
  const hasTarget = target !== null && target > 0;
  const remaining = hasTarget ? Math.max(0, target - vaccinated) : null;
  const completion =
    hasTarget ? Math.round((vaccinated / target) * 10000) / 100 : null;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 shadow-[0_1px_2px_rgba(45,55,90,0.05)]",
        tint,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-title text-lg font-bold uppercase tracking-wide">
          {name}
        </h3>
        <span className="annotation text-sm text-primary/80">{note}</span>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
          <dt className="text-muted-foreground">Target</dt>
          <dd className="font-semibold tabular-nums">
            {hasTarget ? nf.format(target) : "Not allocated"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
          <dt className="text-muted-foreground">Vaccinated</dt>
          <dd className="font-semibold tabular-nums">{nf.format(vaccinated)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
          <dt className="text-muted-foreground">Remaining</dt>
          <dd className="font-semibold tabular-nums">
            {remaining === null ? "—" : nf.format(remaining)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Completion</dt>
          <dd className="font-semibold tabular-nums text-primary">
            {completion === null ? "—" : `${completion.toFixed(2)}%`}
          </dd>
        </div>
      </dl>
      {hasTarget && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700"
            style={{ width: `${Math.min(completion ?? 0, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

type TodayRow = {
  vaccinator: string;
  villages: number;
  goats: number;
  sheep: number;
  total: number;
};

function TodayByVaccinator() {
  const [sortKey, setSortKey] = useState<"total" | "goats" | "sheep" | "villages">(
    "total",
  );
  const data = useQuery(api.stats.todayByVaccinator, {
    dateKey: format(new Date(), "yyyy-MM-dd"),
  });

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    list.sort((a, b) => {
      const diff =
        (b[sortKey] as number) - (a[sortKey] as number) ||
        b.total - a.total ||
        a.vaccinator.localeCompare(b.vaccinator);
      return diff;
    });
    return list;
  }, [data, sortKey]);

  const head = (key: typeof sortKey, label: string, align = "text-right") => (
    <th className={cn("py-2 pr-3 font-medium", align)}>
      <button
        type="button"
        onClick={() => setSortKey(key)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider transition-colors",
          sortKey === key ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        {sortKey === key && <ArrowDown className="size-3" aria-hidden="true" />}
      </button>
    </th>
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No vaccinations recorded today yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-muted/70">
          <tr className="border-b border-border text-[11px] uppercase tracking-wider">
            <th className="py-2 pl-3 pr-3 font-medium text-muted-foreground">
              Vaccinator
            </th>
            {head("villages", "Villages")}
            {head("goats", "Goats")}
            {head("sheep", "Sheep")}
            {head("total", "Total")}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.vaccinator}
              className="border-b border-border/60 last:border-0"
            >
              <td className="py-2.5 pl-3 pr-3 font-medium">{row.vaccinator}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{row.villages}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{row.goats}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{row.sheep}</td>
              <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/60 font-semibold">
            <td className="py-2.5 pl-3 pr-3 uppercase tracking-wider">Total</td>
            <td className="py-2.5 pr-3 text-right tabular-nums">
              {rows.reduce((s, r) => s + r.villages, 0)}
            </td>
            <td className="py-2.5 pr-3 text-right tabular-nums">
              {nf.format(rows.reduce((s, r) => s + r.goats, 0))}
            </td>
            <td className="py-2.5 pr-3 text-right tabular-nums">
              {nf.format(rows.reduce((s, r) => s + r.sheep, 0))}
            </td>
            <td className="py-2.5 pr-3 text-right tabular-nums">
              {nf.format(rows.reduce((s, r) => s + r.total, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TodayDutyRoster() {
  const published = useQuery(api.rosters.publicPublished, {});
  const indiaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const availableDates = [...new Set(published?.flatMap((roster) => roster.entries.map((entry) => entry.date)) ?? [])].sort();
  const [selectedDate, setSelectedDate] = useState(indiaToday);
  const date = selectedDate || indiaToday;
  const roster = published?.find((item) => item.effectiveStart <= date && item.effectiveEnd >= date && item.entries.some((entry) => entry.date === date));
  const entry = roster?.entries.find((item) => item.date === date);
  const prettyDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full" }).format(new Date(Date.UTC(year, month - 1, day, 6)));
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHead title="TODAY'S DUTY ROSTER" sub="OFFICE AND VACCINATION / FIELD DUTY" />
        <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">View date</span><select value={date} onChange={(event) => setSelectedDate(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3" aria-label="View duty roster date"><option value={indiaToday}>Today · {indiaToday}</option>{availableDates.filter((item) => item !== indiaToday).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      {!published ? <div className="flex justify-center py-5"><Loader2 className="size-5 animate-spin text-primary" /></div> : !entry ? <p className="rounded border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">{date === indiaToday ? "No duty roster published for today." : "No published assignment for this date."}</p> : (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <div className="rounded-md border border-border bg-muted/30 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</p><p className="font-semibold">{prettyDate(date)}</p></div>
          <div className="rounded-md border border-border bg-muted/30 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Office / dispensary duty</p><p className="font-semibold">{entry.officeStaff}</p></div>
          <div className="rounded-md border border-border bg-muted/30 p-3 sm:col-span-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Vaccination / field duty · {entry.fieldStaff.length} staff</p><div className="mt-2 flex flex-wrap gap-2">{entry.fieldStaff.map((person) => <span key={person} className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-medium">{person}</span>)}</div></div>
          {roster?.originalUrl && <a href={roster.originalUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary underline sm:col-span-3">View / Download complete roster · {roster.fileName}</a>}
        </div>
      )}
    </section>
  );
}

function PendingVaccinationRequests() {
  const requests = useQuery(api.sync.pendingRequests, {});
  const requestSyncStatus = useQuery(api.sync.requestSyncStatus, {});
  const availableRequestFields = [
    ...new Set(
      requests?.flatMap((request) =>
        (request.fields ?? []).map((field) => field.header),
      ) ?? [],
    ),
  ];
  const requestFields = [
    "Timestamp",
    "Date of Application",
    "Doses of Vaccine required?",
    "VFA ASSIGNED",
    ...availableRequestFields.filter(
      (header) =>
        header !== "Timestamp" &&
        header !== "Date of Application" &&
        header !== "Doses of Vaccine required?" &&
        header !== "VFA ASSIGNED",
    ),
  ];

  return (
    <section className="min-w-0 space-y-3">
      <SectionHead title="Pending Vaccination Requests" />
      <p className="text-xs text-muted-foreground">
        Requests synced: {requestSyncStatus?.lastSuccess?.finishedAt
          ? format(requestSyncStatus.lastSuccess.finishedAt, "d MMM yyyy, hh:mm a")
          : "Never"}
      </p>
      {requestSyncStatus?.lastAttempt?.error && (
        <p role="alert" className="break-words rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Request sync failed: {requestSyncStatus.lastAttempt.error}
        </p>
      )}
      {requests === undefined ? (
        <div className="flex items-center justify-center py-5">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : requests.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No pending vaccination requests at present.
        </p>
      ) : (
        <div className="w-full max-w-full overflow-x-auto rounded-md border border-border bg-card md:overflow-x-hidden">
          <table className="w-full min-w-[1200px] table-fixed text-left text-sm md:min-w-0">
            <colgroup>
              <col className="w-12" />
              {requestFields.map((header) => (
                <col
                  key={header}
                  style={{
                      width:
                      requestFields.length <= 8
                        ? header === "Timestamp" || header === "Date of Application"
                          ? "12%"
                          : header === "Doses of Vaccine required?" || header === "Phone Number of the requestor"
                            ? "13%"
                            : header === "VFA ASSIGNED" || header === "Name of the Requestor"
                              ? "15%"
                              : "auto"
                        : header === "Timestamp" || header === "Date of Application"
                          ? "9%"
                          : header === "Doses of Vaccine required?" || header === "Phone Number of the requestor"
                            ? "10%"
                            : header === "VFA ASSIGNED" || header === "Name of the Requestor"
                              ? "11%"
                              : "auto",
                  }}
                />
              ))}
            </colgroup>
            <thead className="bg-muted/70">
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="w-12 py-2 pl-3 pr-2 font-medium">S/N</th>
                {requestFields.map((header) => (
                  <th key={header} className="whitespace-normal break-words [overflow-wrap:anywhere] py-2 pr-2 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((request, index) => (
                <tr key={request._id} className="border-b border-border/60 align-top last:border-0">
                  <td className="py-2.5 pl-3 pr-2 tabular-nums">{index + 1}</td>
                  {requestFields.map((header) => {
                    const value = (request.fields ?? []).find((field) => field.header === header)?.value;
                    return (
                      <td key={header} className="whitespace-normal break-words [overflow-wrap:anywhere] py-2.5 pr-2">
                        {header === "Timestamp"
                          ? format(request.submittedAt, "d MMM yyyy, hh:mm a")
                          : header === "VFA ASSIGNED"
                            ? request.assignedVfa
                            : value || "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function VaccinatorProgressTable({ todayKey }: { todayKey: string }) {
  const data = useQuery(api.stats.vaccinatorProgress, { todayKey });

  if (!data) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }
  if (data.rows.length === 0) {
    return (
      <p className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No vaccinator records yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-muted/70">
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pl-3 pr-3 font-medium">Vaccinator</th>
            <th className="py-2 pr-3 font-medium">Designation</th>
            <th className="py-2 pr-3 text-right font-medium">Villages</th>
            <th className="py-2 pr-3 text-right font-medium">Today</th>
            <th className="py-2 pr-3 text-right font-medium">Goats</th>
            <th className="py-2 pr-3 text-right font-medium">Sheep</th>
            <th className="py-2 pr-3 text-right font-medium">Total</th>
            <th className="py-2 pr-3 text-right font-medium">Last active</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr
              key={row.vaccinator}
              className="border-b border-border/60 last:border-0"
            >
              <td className="py-2.5 pl-3 pr-3 font-medium">{row.vaccinator}</td>
              <td className="py-2.5 pr-3 text-muted-foreground">
                {row.designation || "—"}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{row.villages}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {row.today > 0 ? (
                  <span className="font-semibold text-primary">{row.today}</span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{row.goats}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{row.sheep}</td>
              <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">
                {row.total}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                {row.lastDate ? dayLabel(row.lastDate) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PublicDashboard() {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const overview = useQuery(api.stats.overview, { todayKey });
  const allocation = useQuery(api.allocations.active, {});
  // Same query VillageProgress subscribes to (Convex dedupes it) — used only
  // to offer vaccination-record villages that have no allocation row (§12).
  const villageProgress = useQuery(api.stats.villageProgress, {});
  const refresh = useAction(api.sheetActions.publicRefresh);
  const [refreshing, setRefreshing] = useState(false);
  const autoTried = useRef(false);
  const [scope, setScope] = useState<Scope>({ user: "ALL", village: "ALL" });

  const handleRefresh = async (silent = false) => {
    setRefreshing(true);
    try {
      const result = await refresh({});
      if (result.skipped) {
        if (!silent) toast.info("Data is already up to date");
      } else if (!silent) {
        const rejected = result.rejectedRecords ?? 0;
        toast.success("Data refreshed", {
          description: `${nf.format(result.recordsRetrieved ?? 0)} rows read · ${
            result.newRecords ?? 0
          } new · ${result.updatedRecords ?? 0} updated${
            rejected ? ` · ${rejected} rejected (see Data Quality)` : ""
          }`,
        });
      }
    } catch (err) {
      if (!silent) toast.error("Refresh failed", { description: errorMessage(err) });
    } finally {
      setRefreshing(false);
    }
  };

  // Pull fresh field-sheet data the first time the page opens if it is stale.
  useEffect(() => {
    if (!overview || autoTried.current) return;
    autoTried.current = true;
    const last = overview.lastSuccess;
    const stale = !last || (last.finishedAt ?? 0) < Date.now() - 5 * 60 * 1000;
    if (stale) void handleRefresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview]);

  // Scope data is derived from the active allocation import (never hardcoded).
  // Memoised so the child's hook layout stays stable across re-renders. It MUST
  // be declared above any early return so the hook count never changes.
  const scopeData = useMemo<ScopeData>(() => {
    const villageNames = allocation?.villageNames ?? {};
    // Villages present in vaccination records but absent from the allocation
    // file: selectable in the filter, yet never attributed to a user (§12).
    const recordVillages: Record<string, string> = {};
    for (const row of villageProgress?.rows ?? []) {
      const key = normalizeVillageClient(row.village);
      if (!(key in villageNames) && !(key in recordVillages)) {
        recordVillages[key] = row.village;
      }
    }
    return {
      available: !!allocation?.upload,
      users: (allocation?.users ?? []).map((u) => ({
        key: u.key,
        name: u.name,
        target: u.target,
        villages: u.villages,
      })),
      villageNames,
      villageTargets: allocation?.villageTargets ?? {},
      recordVillages,
    };
  }, [allocation, villageProgress]);

  if (!overview) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="size-6 animate-spin text-primary" />
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Loading programme data
        </p>
      </main>
    );
  }

  return (
    <DashboardView
      overview={overview}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      todayKey={todayKey}
      scope={scope}
      onScopeChange={setScope}
      scopeData={scopeData}
    />
  );
}

function DashboardView({
  overview,
  refreshing,
  onRefresh,
  todayKey,
  scope,
  onScopeChange,
  scopeData,
}: {
  overview: Overview;
  refreshing: boolean;
  onRefresh: (silent?: boolean) => Promise<void>;
  todayKey: string;
  scope: Scope;
  onScopeChange: (next: Scope) => void;
  scopeData: ScopeData;
}) {
  const { target, achievement, remaining, completion, excess, today } = overview;
  const hasTarget = target !== null && target > 0;

  /* ---------------- Scope (§13): summary cards honour the filter ---------------- */
  const scopeUser =
    scope.user === "ALL" ? null : scopeData.users.find((u) => u.key === scope.user) ?? null;

  /** Allocation target of the current scope (from the allocation file). */
  const scopeTarget = useMemo(() => {
    if (scope.village !== "ALL") {
      return scopeData.villageTargets[scope.village] ?? 0;
    }
    if (scopeUser) return scopeUser.target;
    return null; // ALL USERS → programme-level view
  }, [scope.village, scopeUser, scopeData.villageTargets]);

  const isScoped = scope.user !== "ALL" || scope.village !== "ALL";
  const isUserScoped = scope.user !== "ALL";

  /** PENDING → no allocation at all; FULLY when every village with records
      is covered by the allocation; PARTIALLY otherwise. */
  const allocationStatus = (() => {
    const allocatedCount = Math.max(
      Object.keys(scopeData.villageTargets).length,
      overview.allocatedVillages,
    );
    const allocatedSum = Math.max(
      overview.villageTargetSum,
      Object.values(scopeData.villageTargets).reduce((s, n) => s + n, 0),
    );
    if (allocatedCount === 0 || allocatedSum === 0) return "PENDING";
    return overview.villagesCovered <= allocatedCount
      ? "FULLY ALLOCATED"
      : "PARTIALLY ALLOCATED";
  })();

  /** Total of the village-target allocation table (import only). Distinct from
      the programme target and from the Livestock Census goat population. */
  const allocationTotal = Math.max(
    overview.allocatedVillages > 0 ? overview.villageTargetSum : 0,
    Object.values(scopeData.villageTargets).reduce((s, n) => s + n, 0),
  );

  const lastUpdate =
    Math.max(overview.lastSuccess?.finishedAt ?? 0, overview.bharat.lastUploadAt ?? 0) ||
    null;

  const sources: string[] = [];
  if (overview.sheetRecords > 0) sources.push("District Field Sheet");
  if (overview.bharatRecords > 0) sources.push("Bharat Pashudhan");
  const dataSource = sources.length > 0 ? sources.join(" + ") : "Awaiting first import";

  const syncError = overview.lastSync?.status === "error";

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-40 bg-background">
      {/* ---------------- Header ---------------- */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Mark className="size-10 shrink-0 sm:size-12" />
              <div className="min-w-0">
                <h1 className="font-title text-2xl font-bold leading-[1.05] tracking-tight sm:text-4xl">
                  PPR FIELD VACCINATION
                  <br className="sm:hidden" /> MONITORING
                </h1>
                <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground sm:text-xs">
                  {overview.dispensaryName}
                  <br />
                  {overview.districtName}, {overview.state}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                size="sm"
                onClick={() => void onRefresh(false)}
                disabled={refreshing}
                title="Refresh data from the field sheet"
              >
                {refreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                <span className="hidden sm:inline">
                  {refreshing ? "Refreshing…" : "Refresh"}
                </span>
              </Button>
              <Button size="sm" asChild className="bg-[#1877F2] text-white hover:bg-[#166FE5]">
                <a href="https://www.facebook.com/share/1KnnyG6cW2/" target="_blank" rel="noopener noreferrer" aria-label="Follow Us on Facebook">
                  <span aria-hidden="true" className="flex size-4 items-center justify-center rounded-full bg-white font-bold text-[#1877F2]">f</span>
                  <span className="hidden sm:inline">Follow Us on Facebook</span>
                  <span className="sm:hidden">Facebook</span>
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/auth">
                  <ShieldCheck className="size-4" />
                  <span className="hidden sm:inline">Admin Login</span>
                  <span className="sm:hidden">Admin</span>
                </Link>
              </Button>
            </div>
          </div>

          {/* Meta strip */}
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-border pt-3 text-xs sm:grid-cols-3">
            <div className="flex items-baseline gap-2">
              <dt className="uppercase tracking-wider text-muted-foreground">
                Programme Start:
              </dt>
              <dd className="font-semibold tabular-nums">
                {longDay(overview.vaccinationStartDate) ?? "Not set"}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="uppercase tracking-wider text-muted-foreground">
                Last Data Update:
              </dt>
              <dd className="font-semibold tabular-nums">
                {stamp(lastUpdate) ?? "Never"}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="uppercase tracking-wider text-muted-foreground">
                Data Source:
              </dt>
              <dd className="font-semibold">{dataSource}</dd>
            </div>
          </dl>
        </div>
      </header>

      {/* ---------------- Sticky navigation ---------------- */}
      <nav className="border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-2 py-1.5 sm:px-6">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => scrollTo(item.id)}
              className="whitespace-nowrap rounded px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:text-xs"
            >
              {item.label}
            </button>
          ))}
          <Link
            to="/auth"
            className="ml-auto whitespace-nowrap rounded px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:text-xs"
          >
            Admin
          </Link>
        </div>
      </nav>
      </div>

      <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
        {/* ---------------- USER / ALLOTTED VILLAGE scope filter ---------------- */}
        <ScopeFilter scope={scope} onChange={onScopeChange} data={scopeData} />

        {/* ---------------- Sync error banner ---------------- */}
        {syncError && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
            <AlertTriangle className="size-5 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 break-words text-sm text-destructive">
              Latest Google Sheet sync failed: {overview.lastSync?.error ?? "unknown error"}
              {overview.lastSuccess
                ? ` — showing data from ${stamp(overview.lastSuccess.finishedAt)}.`
                : ""}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onRefresh(false)}
              disabled={refreshing}
            >
              Retry
            </Button>
          </div>
        )}

        {/* ---------------- NOTICE BOARD (public, filter-independent) ---------------- */}
        <NoticeBoard />

        {/* ---------------- PPR vaccination request form ---------------- */}
        <section className="space-y-4">
          <div className="flex justify-center px-1">
            <Button
              asChild
              size="lg"
              className="h-12 w-full gap-2.5 rounded-md px-5 text-sm font-bold shadow-sm transition-colors hover:shadow-md sm:w-auto sm:px-7"
            >
              <a
                href="https://forms.gle/9ACbCwNgCzFhayaKA"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Syringe aria-hidden="true" />
                <span>REQUEST PPR VACCINATION</span>
                <ArrowRight aria-hidden="true" />
              </a>
            </Button>
          </div>
          <PendingVaccinationRequests />
        </section>
        <TodayDutyRoster />

        {/* ---------------- Public vaccination report form ---------------- */}
        <div className="my-4 flex justify-center px-1">
          <Button
            asChild
            size="lg"
            className="h-12 w-full gap-2.5 rounded-md px-5 text-sm font-bold shadow-sm transition-colors hover:shadow-md sm:w-auto sm:px-7"
          >
            <a
              href="https://forms.gle/CLpeWYLfmBrE5qLj6"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ClipboardList aria-hidden="true" />
              <span>REPORT TODAY'S VACCINATION</span>
              <ArrowRight aria-hidden="true" />
            </a>
          </Button>
        </div>

        {/* ---------------- Summary cards ---------------- */}
        <section id="dashboard" className="scroll-mt-28 space-y-5">
          <SectionHead
            title="Current Programme Progress"
            sub={`${overview.dispensaryName} · PPR vaccination campaign`}
          />

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard
              label="Total PPR Vaccinated"
              value={nf.format(achievement)}
              sub="Valid unique vaccination records"
              tint="bg-[#2563A6] border-[#1E4F82]"
              contrast
            />
            <SummaryCard
              label="Today's Vaccination"
              value={nf.format(today.total)}
              sub="Animals vaccinated today"
              tint="bg-[#0891B2] border-[#067A95]"
              contrast
            />
            <SummaryCard
              label="Total Programme Target"
              value={hasTarget ? nf.format(target) : "—"}
              sub={
                hasTarget ? "Dispensary programme target" : "Target data pending admin setup"
              }
              tint="bg-[#1E3A5F] border-[#172C47]"
              contrast
            />
            <SummaryCard
              label="Completion"
              value={completion !== null ? `${completion.toFixed(2)}%` : "—"}
              sub="Target completion"
              tint="bg-[#15803D] border-[#11632F]"
              contrast
            />
            <SummaryCard
              label="Remaining"
              value={remaining !== null ? nf.format(remaining) : "—"}
              sub={
                excess > 0
                  ? `Excess over target: ${nf.format(excess)}`
                  : "Animals remaining"
              }
              tint="bg-[#D97706] border-[#B65F05]"
              contrast
            />
            <SummaryCard
              label="Bharat Pashudhan Data"
              value={nf.format(overview.bharat.uploadedRows)}
              sub="Total uploaded records"
              tint="bg-[#6D4C9B] border-[#563B7C]"
              contrast
            />
          </div>

          {/* -------- Overall progress -------- */}
          <div className="tint-blue-soft rounded-lg border px-4 py-5 shadow-[0_1px_3px_rgba(45,55,90,0.06)] sm:px-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-title text-lg font-bold uppercase tracking-wide sm:text-xl">
                Dispensary PPR Vaccination Progress
              </h3>
              {hasTarget && completion !== null && (
                <p className="font-title text-3xl font-bold text-red-600 tabular-nums sm:text-4xl">
                  {completion.toFixed(2)}% COMPLETED
                </p>
              )}
            </div>

            {hasTarget ? (
              <>
                <div className="mt-3 h-5 overflow-hidden rounded-full border border-border bg-muted">
                  <div
                    className="h-full rounded-full bg-red-600 transition-[width] duration-700"
                    style={{ width: `${Math.min(completion ?? 0, 100)}%` }}
                  />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Vaccinated
                    </dt>
                    <dd className="font-title text-xl font-bold tabular-nums">
                      {nf.format(achievement)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Target
                    </dt>
                    <dd className="font-title text-xl font-bold tabular-nums">
                      {nf.format(target)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Remaining
                    </dt>
                    <dd className="font-title text-xl font-bold tabular-nums">
                      {nf.format(remaining ?? 0)}
                      {excess > 0 && (
                        <span className="ml-2 text-sm font-semibold text-red-600">
                          +{nf.format(excess)} excess
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>

                {/* Three distinct concepts, never merged: programme target,
                    village allocation table, Livestock Census population. */}
                <div className="mt-3 border-t border-border/60 pt-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                    <span className="text-muted-foreground">
                      Programme Target:{" "}
                      <span className="font-semibold text-foreground tabular-nums">
                        {nf.format(target)}
                      </span>
                    </span>
                    {allocationTotal > 0 && (
                      <span className="text-muted-foreground">
                        Village Targets Allocated:{" "}
                        <span className="font-semibold text-foreground tabular-nums">
                          {nf.format(allocationTotal)}
                        </span>
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      Allocation Status:{" "}
                      <span
                        className={cn(
                          "font-semibold",
                          allocationStatus === "PENDING"
                            ? "text-destructive"
                            : "text-primary",
                        )}
                      >
                        {allocationStatus}
                      </span>
                    </span>
                  </div>

                  {/* Census population: reference information only, shown
                      quieter and smaller so it never reads as a target. */}
                  <p className="mt-2 inline-block rounded-md border border-primary/15 bg-primary/5 px-2.5 py-1 text-[11px] leading-tight text-muted-foreground">
                    Goat Population (Livestock Census, Boginadi):{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {nf.format(CENSUS_GOAT_POPULATION)}
                    </span>
                  </p>
                </div>

                {isScoped && (
                  <p className="mt-2 rounded border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Filtered view — {scopeUser?.name ?? "All Users"} ·{" "}
                    {scope.village === "ALL"
                      ? "all allotted villages"
                      : (scopeData.villageNames[scope.village] ?? scope.village)}
                    {scopeTarget !== null && scopeTarget > 0
                      ? ` · scope allocation target ${nf.format(scopeTarget)}`
                      : ""}
                    {" "}· achievement for this scope is shown as VILLAGE
                    ACHIEVEMENT in the village table (vaccination records are
                    attributed by village, never split per user).
                  </p>
                )}
              </>
            ) : (
              <div className="mt-3 rounded border border-dashed border-border bg-muted/50 px-4 py-6 text-center">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Target data pending admin setup
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Vaccination achieved so far:{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {nf.format(achievement)}
                  </span>{" "}
                  animals
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ---------------- Species ---------------- */}
        <section className="space-y-4">
          <SectionHead
            title="PPR Vaccination by Species"
            sub="Goats and sheep, target vs achievement"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SpeciesCard
              name="Goats"
              target={overview.goatTarget}
              vaccinated={overview.goatAchievement}
              note="primary species"
            />
            <SpeciesCard
              name="Sheep"
              target={overview.sheepTarget}
              vaccinated={overview.sheepAchievement}
              note="NADCP tagging"
              tint="tint-neutral-blue"
            />
          </div>
        </section>

        {/* ---------------- Today ---------------- */}
        <section className="space-y-4">
          <SectionHead
            id="daily"
            title="Today's Vaccination"
            sub={`Date: ${format(new Date(), "d MMMM yyyy")}`}
          />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <TodayMetric
              label="Total animals today"
              value={nf.format(today.total)}
              tint="tint-blue"
            />
            <TodayMetric label="Goats" value={nf.format(today.goats)} tint="tint-blue-soft" />
            <TodayMetric label="Sheep" value={nf.format(today.sheep)} tint="tint-blue-soft" />
            <TodayMetric label="Farmers covered" value={nf.format(today.farmers)} />
            <TodayMetric label="Vaccinators active" value={nf.format(today.vaccinators)} />
            <TodayMetric label="Villages covered" value={nf.format(today.villages)} />
          </div>
          {overview.yesterdayTotal > 0 && (
            <p className="text-xs text-muted-foreground">
              Yesterday: {nf.format(overview.yesterdayTotal)} animals vaccinated
            </p>
          )}
        </section>

        {/* ---------------- Vaccinators ---------------- */}
        <section className="space-y-4">
          <SectionHead
            id="vaccinators"
            title="Today's Vaccination by Vaccinator"
            sub="Tap a column heading to sort"
          />
          <TodayByVaccinator />

          <SectionHead
            title="Vaccinator Progress"
            sub="Cumulative performance across the campaign"
          />
          <VaccinatorProgressTable todayKey={todayKey} />
        </section>

        {/* ---------------- Villages ---------------- */}
        <section className="space-y-4">
          <SectionHead
            id="villages"
            title="Village-wise PPR Progress"
            sub="Search, filter and sort every village"
          />
          <VillageProgress scope={scope} scopeData={scopeData} />
          <UntouchedVillages scope={scope} scopeData={scopeData} />
        </section>

        {/* ---------------- History ---------------- */}
        <section className="space-y-4">
          <SectionHead
            id="history"
            title="Historical PPR Progress"
            sub="Daily and cumulative vaccination"
          />
          <HistoryChart />
        </section>

        {/* ---------------- Reports ---------------- */}
        <section className="space-y-4">
          <SectionHead
            id="reports"
            title="Daily Report"
            sub="DISPENSARY DVTR FORMAT PPR-EP"
          />
          <DailyReport overview={overview} />
        </section>

        {/* ---------------- Data status ---------------- */}
        <section className="space-y-4">
          <SectionHead title="Data Status" sub="Where these numbers come from" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-card p-4 text-sm">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-primary" />
                <h3 className="font-semibold uppercase tracking-wider text-xs">
                  Google Sheet
                </h3>
              </div>
              <dl className="mt-2 space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Last sync</dt>
                  <dd className="tabular-nums">
                    {stamp(overview.lastSuccess?.finishedAt) ?? "Never"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Records imported</dt>
                  <dd className="tabular-nums">{nf.format(overview.sheetRecords)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    {overview.lastSync?.status === "running" ? (
                      <span className="text-primary">Syncing…</span>
                    ) : overview.lastSync?.status === "error" ? (
                      <span className="text-destructive">Last sync failed</span>
                    ) : (
                      <span className="text-primary">Up to date</span>
                    )}
                  </dd>
                </div>
              </dl>
              <a
                href={overview.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs text-primary underline-offset-2 hover:underline"
              >
                Open the district field sheet
              </a>
            </div>

            <div className="rounded-md border border-border bg-card p-4 text-sm">
              <div className="flex items-center gap-2">
                <Syringe className="size-4 text-primary" />
                <h3 className="font-semibold uppercase tracking-wider text-xs">
                  Bharat Pashudhan
                </h3>
              </div>
              <dl className="mt-2 space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Uploaded records</dt>
                  <dd className="tabular-nums">
                    {nf.format(overview.bharat.uploadedRows)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Valid records</dt>
                  <dd className="tabular-nums">
                    {nf.format(overview.bharat.validRecords)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Rejected records</dt>
                  <dd className="tabular-nums">
                    {nf.format(overview.bharat.rejectedRecords)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Duplicate records skipped</dt>
                  <dd className="tabular-nums">
                    {nf.format(overview.bharat.duplicatesSkipped)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Last upload</dt>
                  <dd className="tabular-nums">
                    {stamp(overview.bharat.lastUploadAt) ?? "Never"}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 font-semibold uppercase tracking-wider text-foreground">
              About / Data Sources
            </p>
            <p>
              Target figures come from the administrator-managed allocation
              (Excel/CSV user allocation or manual entry). Achievement is counted from
              validated, de-duplicated vaccination records: historical field-sheet
              entries from Google Sheets and detailed uploads from Bharat Pashudhan.
              Records present in both sources are matched on date, village,
              vaccinator and counts so the same animal is never counted twice.
              Rejected rows are stored for inspection but excluded from every figure
              above. PDF export is output only — allocation data arrives via
              Excel/CSV import.
            </p>
          </div>
        </section>

        <footer className="border-t border-border pt-4 pb-6 text-center text-xs text-muted-foreground">
          <p className="font-semibold uppercase tracking-[0.18em] text-foreground">
            PPR Field Vaccination Monitoring
          </p>
          <p className="mt-0.5">
            {overview.dispensaryName} · {overview.districtName}, {overview.state} · Total valid records:{" "}
            {nf.format(overview.validRecords)} · Rejected:{" "}
            {nf.format(overview.rejectedRecords)}
          </p>
        </footer>
      </main>
    </div>
  );
}
