import { Input } from "@/components/ui/input";
import { normalizeVillageClient } from "@/lib/scopeKeys";
import { statusFor } from "@/lib/statusFor";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { ChevronDown, ChevronUp, Loader2, MapPin, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

const nf = new Intl.NumberFormat("en-IN");

type Row = {
  village: string;
  block?: string;
  target: number;
  goatTarget: number | null;
  sheepTarget: number | null;
  achievement: number;
  goatAchievement: number;
  sheepAchievement: number;
  remaining: number | null;
  excess: number;
  completion: number | null;
  status: string;
  allocated: boolean;
};

type SortKey = "village" | "target" | "achievement" | "completion";

const FILTERS: { id: string; label: string; test: (row: Row) => boolean }[] = [
  { id: "all", label: "All Villages", test: () => true },
  {
    id: "completed",
    label: "Completed",
    test: (r) => r.status === "TARGET COMPLETED",
  },
  {
    id: "over",
    label: "Over Target",
    test: (r) => r.status === "OVER TARGET",
  },
  {
    id: "gt75",
    label: ">75%",
    test: (r) => r.completion !== null && r.completion >= 75 && r.completion < 100,
  },
  {
    id: "50-75",
    label: "50–75%",
    test: (r) => r.completion !== null && r.completion >= 50 && r.completion < 75,
  },
  {
    id: "25-50",
    label: "25–50%",
    test: (r) => r.completion !== null && r.completion >= 25 && r.completion < 50,
  },
  {
    id: "lt25",
    label: "<25%",
    test: (r) => r.completion !== null && r.completion > 0 && r.completion < 25,
  },
  {
    id: "not-started",
    label: "Not Started",
    // §1: NOT STARTED is defined by the canonical village achievement
    // itself (achievement === 0), never by a derived status string — and
    // only for allocated villages (unallocated rows keep UNALLOCATED).
    test: (r) => r.allocated && r.achievement === 0,
  },
];

export function statusTone(status: string): string {
  switch (status) {
    case "TARGET COMPLETED":
      return "border-primary/40 bg-primary/15 text-primary";
    case "OVER TARGET":
      return "border-primary/60 bg-primary/25 text-primary";
    case "NEAR TARGET":
      return "border-[oklch(0.7_0.16_85)] bg-[oklch(0.93_0.11_95)] text-[oklch(0.38_0.09_75)]";
    case "GOOD PROGRESS":
      return "border-[oklch(0.6_0.14_205)] bg-[oklch(0.93_0.06_215)] text-[oklch(0.35_0.08_215)]";
    case "IN PROGRESS":
      return "border-border bg-muted text-muted-foreground";
    case "UNALLOCATED":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted/60 text-muted-foreground";
  }
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
        statusTone(status),
      )}
    >
      {status}
    </span>
  );
}

function completionLabel(row: Row): string {
  return row.completion === null ? "—" : `${row.completion.toFixed(2)}%`;
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <th className={cn("py-2 pr-3 font-medium", className)}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active &&
          (dir === "asc" ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          ))}
      </button>
    </th>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded border border-border bg-muted/40 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

export interface VillageScopeProps {
  /** Selected scope from the public filter bar ("ALL" or keys). */
  scope?: { user: string; village: string };
  /** Active allocation scope data (user → villages, village → target). */
  scopeData?: {
    available: boolean;
    users: { key: string; name: string; target: number; villages: string[] }[];
    villageNames: Record<string, string>;
    villageTargets: Record<string, number>;
  };
}

export default function VillageProgress({
  scope,
  scopeData,
}: VillageScopeProps = {}) {
  // Defaults (never via a default parameter, to keep the hook layout stable).
  const normalizedScope = scope ?? { user: "ALL", village: "ALL" };
  const data = useQuery(api.stats.villageProgress, {});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("village");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  // Scope keys: the allocation row keys are already normalised server-side.
  const selectedVillageKey =
    normalizedScope.village === "ALL" ? null : normalizedScope.village;
  const selectedUser =
    normalizedScope.user === "ALL"
      ? null
      : (scopeData?.users.find((u) => u.key === normalizedScope.user) ?? null);
  const userVillageKeys =
    selectedUser === null ? null : new Set(selectedUser.villages);

  // Allocation targets per village key from the active import (§14: the
  // allocation file is the TARGET source for the filtered views).
  const allocationTargets = scopeData?.villageTargets ?? {};

  const rows = useMemo(() => {
    const base = data?.rows ?? [];
    return base.map((row) => {
      const key = normalizeVillageClient(row.village);
      const allocationTarget = allocationTargets[key];
      const effectiveTarget =
        allocationTarget !== undefined ? allocationTarget : row.target;
      const zeroTarget = effectiveTarget <= 0;
      const completion =
        effectiveTarget > 0
          ? Math.round((row.achievement / effectiveTarget) * 10000) / 100
          : null;
      return {
        ...row,
        target: effectiveTarget,
        remaining: effectiveTarget > 0 ? Math.max(0, effectiveTarget - row.achievement) : null,
        excess:
          effectiveTarget > 0 ? Math.max(0, row.achievement - effectiveTarget) : 0,
        completion,
        status:
          allocationTarget === undefined && !row.allocated
            ? "UNALLOCATED"
            : zeroTarget
              ? "UNALLOCATED"
              : statusFor(completion),
        allocated: row.allocated || allocationTarget !== undefined,
      };
    });
  }, [data, allocationTargets]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filterDef = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
    const list = rows.filter((row) => {
      // Scope filters (§13, §17): village first, then user's allotted set.
      if (selectedVillageKey) {
        const key = normalizeVillageClient(row.village);
        if (key !== selectedVillageKey) return false;
      } else if (userVillageKeys && row.allocated) {
        const key = normalizeVillageClient(row.village);
        if (!userVillageKeys.has(key)) return false;
      }
      if (needle && !row.village.toLowerCase().includes(needle)) return false;
      return filterDef.test(row as Row);
    });
    const dirMul = dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "village") return a.village.localeCompare(b.village) * dirMul;
      const read = (r: typeof a): number =>
        sortKey === "target"
          ? r.target
          : sortKey === "achievement"
            ? r.achievement
            : (r.completion ?? -1);
      if (read(a) === read(b)) return a.village.localeCompare(b.village);
      return (read(a) - read(b)) * dirMul;
    });
  }, [rows, search, filter, sortKey, dir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir(key === "village" ? "asc" : "desc");
    }
  };

  // Scoped sums over the (allocation-adjusted, scope-filtered) rows.
  // Declared BEFORE any early return so the hook count is always identical.
  const scopedVisible = visible.length > 0 || rows.length === 0 ? visible : rows;
  const scopedTotals = useMemo(() => {
    const sum = scopedVisible.reduce(
      (acc, row) => {
        acc.achievement += row.achievement;
        if (row.target > 0) {
          acc.target += row.target;
          acc.remaining += row.remaining ?? 0;
        }
        return acc;
      },
      { achievement: 0, target: 0, remaining: 0 },
    );
    return {
      ...sum,
      completion:
        sum.target > 0
          ? Math.round((sum.achievement / sum.target) * 10000) / 100
          : null,
    };
  }, [scopedVisible]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  const t = data.totals;
  const unallocatedAchievement = rows
    .filter((row) => !row.allocated)
    .reduce((sum, row) => sum + row.achievement, 0);

  return (
    <div className="space-y-3">
      {/* ---- Search + filters ---- */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search village name (e.g. bog)"
          className="h-11 pl-9 text-base"
          aria-label="Search village"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "whitespace-nowrap rounded border px-2.5 py-1.5 text-xs font-medium transition-colors",
              filter === f.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="uppercase tracking-wider">Sort by:</span>
        {(
          [
            ["village", "Village"],
            ["target", "Target"],
            ["achievement", "Achievement"],
            ["completion", "Completion %"],
          ] as [SortKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleSort(key)}
            className={cn(
              "rounded border px-2 py-1 transition-colors",
              sortKey === key
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border hover:bg-muted",
            )}
          >
            {label}
            {sortKey === key && (dir === "asc" ? " ↑" : " ↓")}
          </button>
        ))}
        <span className="ml-auto tabular-nums">
          {visible.length} of {rows.length} villages
        </span>
      </div>

      {data.versionNumber !== null && (
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Active allocation · version {data.versionNumber}
        </p>
      )}

      {/* ---- Desktop table ---- */}
      <div className="hidden overflow-x-auto rounded-md border border-border bg-card sm:block">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr className="border-b border-border text-[11px] uppercase tracking-wider">
              <th className="py-2 pl-3 pr-3 font-medium text-muted-foreground">
                S.No
              </th>
              <SortHeader
                label="Village"
                active={sortKey === "village"}
                dir={dir}
                onClick={() => toggleSort("village")}
              />
              <SortHeader
                label="Target"
                active={sortKey === "target"}
                dir={dir}
                onClick={() => toggleSort("target")}
                className="text-right"
              />
              <SortHeader
                label="Achievement"
                active={sortKey === "achievement"}
                dir={dir}
                onClick={() => toggleSort("achievement")}
                className="text-right"
              />
              <th className="py-2 pr-3 text-right text-muted-foreground">
                Remaining
              </th>
              <SortHeader
                label="Completion %"
                active={sortKey === "completion"}
                dir={dir}
                onClick={() => toggleSort("completion")}
                className="text-right"
              />
              <th className="py-2 pr-3 text-right text-muted-foreground">
                Goat Target
              </th>
              <th className="py-2 pr-3 text-right text-muted-foreground">
                Goat Ach.
              </th>
              <th className="py-2 pr-3 text-right text-muted-foreground">
                Sheep Target
              </th>
              <th className="py-2 pr-3 text-right text-muted-foreground">
                Sheep Ach.
              </th>
              <th className="py-2 pr-3 text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                  No village matches your search or filter.
                </td>
              </tr>
            )}
            {visible.map((row, index) => (
              <tr
                key={`${row.village}-${row.allocated}`}
                className="border-b border-border/60 last:border-0 hover:bg-muted/40"
              >
                <td className="py-2.5 pl-3 pr-3 text-muted-foreground tabular-nums">
                  {index + 1}
                </td>
                <td className="py-2.5 pr-3 font-medium">
                  {row.village}
                  {row.block && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {row.block}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {row.allocated ? nf.format(row.target) : "—"}
                </td>
                <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">
                  {nf.format(row.achievement)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {row.remaining === null ? "—" : nf.format(row.remaining)}
                </td>
                <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">
                  {completionLabel(row)}
                  {row.excess > 0 && row.allocated && (
                    <span className="block text-[10px] font-normal text-primary">
                      +{nf.format(row.excess)} excess
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                  {row.goatTarget === null ? "—" : nf.format(row.goatTarget)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {nf.format(row.goatAchievement)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                  {row.sheepTarget === null ? "—" : nf.format(row.sheepTarget)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {nf.format(row.sheepAchievement)}
                </td>
                <td className="py-2.5 pr-3">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/60 text-sm font-semibold">
              <td className="px-3 py-2.5" aria-hidden="true" />
              <td className="py-2.5 pr-3 uppercase tracking-wider">
                Dispensary Total
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums" title="Village Target Allocated">
                {nf.format(t.target)}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums" title="All validated achievement, allocated and unallocated">
                {nf.format(t.achievement + data.unallocatedAchievement)}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {data.hasAllocation ? nf.format(t.remaining) : "—"}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {!data.hasAllocation || t.completion === null
                  ? "—"
                  : `${t.completion.toFixed(2)}%`}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {nf.format(t.goatTarget)}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {nf.format(t.goatAchievement)}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {nf.format(t.sheepTarget)}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {nf.format(t.sheepAchievement)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ---- Mobile cards ---- */}
      <div className="space-y-2 sm:hidden">
        {visible.length === 0 && (
          <p className="rounded border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No village matches your search.
          </p>
        )}
        {visible.map((row, index) => (
          <div
            key={`card-${row.village}-${row.allocated}`}
            className="rounded-md border border-border bg-card px-3 py-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                <MapPin className="size-3.5 shrink-0 text-primary" />
                <p className="text-sm font-semibold leading-tight">{row.village}</p>
              </div>
              <StatusBadge status={row.status} />
            </div>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{
                  width: `${row.completion === null ? 0 : Math.min(row.completion, 100)}%`,
                }}
              />
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <Metric
                label="Target"
                value={row.allocated ? nf.format(row.target) : "—"}
              />
              <Metric label="Achievement" value={nf.format(row.achievement)} />
              <Metric
                label="Remaining"
                value={row.remaining === null ? "—" : nf.format(row.remaining)}
              />
              <Metric label="Completion" value={completionLabel(row)} />
              <Metric
                label="Goat T / A"
                value={`${row.goatTarget === null ? "—" : nf.format(row.goatTarget)} / ${nf.format(row.goatAchievement)}`}
              />
              <Metric
                label="Sheep T / A"
                value={`${row.sheepTarget === null ? "—" : nf.format(row.sheepTarget)} / ${nf.format(row.sheepAchievement)}`}
              />
            </div>
            {row.excess > 0 && row.allocated && (
              <p className="mt-1.5 text-xs text-primary">
                Excess over target: {nf.format(row.excess)} (remaining shown as 0)
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ---- Dispensary totals: programme target vs village allocation,
              never silently merged. When a scope filter is active the scoped
              sums replace the whole-dispensary numbers. ---- */}
      <div className="rounded-md border border-border bg-card px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {normalizedScope.user !== "ALL" || normalizedScope.village !== "ALL"
            ? "Filtered Total"
            : "Dispensary Total"}
        </p>
        {normalizedScope.user !== "ALL" || normalizedScope.village !== "ALL" ? (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="Scope Target"
              value={nf.format(scopedTotals.target)}
            />
            <Metric
              label="Scope Achievement"
              value={nf.format(scopedTotals.achievement)}
              tone="text-primary"
            />
            <Metric
              label="Scope Remaining"
              value={nf.format(scopedTotals.remaining)}
            />
            <Metric
              label="Scope Completion"
              value={
                scopedTotals.completion === null
                  ? "—"
                  : `${scopedTotals.completion.toFixed(2)}%`
              }
            />
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric
              label="Dispensary Programme Target"
              value={
                data.programmeTarget !== null ? nf.format(data.programmeTarget) : "—"
              }
            />
            <Metric
              label="Village Target Allocated"
              value={nf.format(
                Math.max(
                  data.allocatedTargetSum,
                  Object.values(scopeData?.villageTargets ?? {}).reduce(
                    (s, n) => s + n,
                    0,
                  ),
                ),
              )}
            />
            <Metric
              label="Achievement"
              value={nf.format(
                Math.max(
                  data.totalAchievement,
                  rows.reduce((s, r) => s + r.achievement, 0),
                ),
              )}
              tone="text-primary"
            />
            {data.hasAllocation && data.allocatedTargetSum > 0 && (
              <>
                <Metric label="Village Remaining" value={nf.format(t.remaining)} />
                <Metric
                  label="Village Completion"
                  value={
                    t.completion === null ? "—" : `${t.completion.toFixed(2)}%`
                  }
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* ---- Allocation notice (§7): only while villages still carry no
              target after the active allocation file is applied ---- */}
      {unallocatedAchievement > 0 && (
        <div className="rounded border border-dashed border-border bg-muted/40 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-semibold uppercase tracking-wider text-foreground">
            Village-level targets have not yet been allocated.
          </p>
          <p className="mt-1">
            {nf.format(unallocatedAchievement)} vaccination records are already
            recorded across {rows.filter((row) => !row.allocated).length} village
            {rows.filter((row) => !row.allocated).length !== 1 ? "s" : ""}. These
            records are included in dispensary programme achievement but remain
            UNALLOCATED until village targets are assigned.
          </p>
        </div>
      )}
    </div>
  );
}
