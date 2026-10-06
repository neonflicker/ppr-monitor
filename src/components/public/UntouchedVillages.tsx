import { Slider } from "@/components/ui/slider";
import { api } from "@/convex/_generated/api";
import { normalizeVillageClient } from "@/lib/scopeKeys";
import type { Scope, ScopeData } from "@/lib/scopeLink";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Loader2, MapPinned } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const nf = new Intl.NumberFormat("en-IN");

/** Untouched = allotted in the active allocation but with zero validated
    vaccination records (no row, or a row whose achievement is 0). */
const PAGE_SIZE = 10;

interface Props {
  scope: Scope;
  scopeData: ScopeData;
}

export default function UntouchedVillages({ scope, scopeData }: Props) {
  const data = useQuery(api.stats.villageProgress, {});
  const [page, setPage] = useState(0);

  const selectedUser =
    scope.user === "ALL"
      ? null
      : (scopeData.users.find((u) => u.key === scope.user) ?? null);

  const untouched = useMemo(() => {
    if (!selectedUser) return [];
    const achievementByKey = new Map<string, number>();
    for (const row of data?.rows ?? []) {
      const key = normalizeVillageClient(row.village);
      achievementByKey.set(key, (achievementByKey.get(key) ?? 0) + row.achievement);
    }
    return selectedUser.villages
      .map((key) => ({
        key,
        name: scopeData.villageNames[key] ?? key,
        target: scopeData.villageTargets[key] ?? 0,
        achievement: achievementByKey.get(key) ?? 0,
      }))
      .filter((v) => v.achievement <= 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedUser, data, scopeData.villageNames, scopeData.villageTargets]);

  const pages = Math.max(1, Math.ceil(untouched.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const start = safePage * PAGE_SIZE;
  const visible = untouched.slice(start, start + PAGE_SIZE);

  // A different vaccinator always starts at the first page.
  useEffect(() => {
    setPage(0);
  }, [scope.user]);

  if (!selectedUser) return null;

  return (
    <div className="rounded-md border border-border bg-card px-3 py-3">
      {/* ---- User name at the top of the table ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <MapPinned className="size-4 shrink-0 text-primary" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            Untouched Villages
          </h3>
        </div>
        <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
          {selectedUser.name}
        </span>
      </div>

      {!data ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : untouched.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
          Every allotted village of <b className="text-foreground">{selectedUser.name}</b>{" "}
          has vaccination records. Nothing untouched.
        </p>
      ) : (
        <>
          {/* ---- Desktop table ---- */}
          <div className="mt-2 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pl-2 pr-3 font-medium">S.No</th>
                  <th className="py-2 pr-3 font-medium">Village</th>
                  <th className="py-2 pr-3 text-right font-medium">Target</th>
                  <th className="py-2 pr-3 text-right font-medium">Achievement</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr
                    key={row.key}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <td className="py-2.5 pl-2 pr-3 text-muted-foreground tabular-nums">
                      {start + index + 1}
                    </td>
                    <td className="py-2.5 pr-3 font-medium">{row.name}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {nf.format(row.target)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {nf.format(row.achievement)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="inline-block whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                        NOT STARTED
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ---- Mobile cards ---- */}
          <div className="mt-2 space-y-2 sm:hidden">
            {visible.map((row, index) => (
              <div
                key={`card-${row.key}`}
                className="rounded-md border border-border bg-background px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                      {start + index + 1}.
                    </span>
                    <p className="truncate text-sm font-semibold">{row.name}</p>
                  </div>
                  <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                    NOT STARTED
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  Target {nf.format(row.target)} · Achievement{" "}
                  {nf.format(row.achievement)}
                </p>
              </div>
            ))}
          </div>

          {/* ---- Slider pagination: 10 entries per view ---- */}
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground tabular-nums">
              Showing {untouched.length === 0 ? 0 : start + 1}–
              {Math.min(start + PAGE_SIZE, untouched.length)} of {untouched.length}{" "}
              untouched
            </p>
            {pages > 1 && (
              <div className="flex min-w-[180px] flex-1 items-center gap-2.5">
                <Slider
                  value={[safePage]}
                  min={0}
                  max={pages - 1}
                  step={1}
                  onValueChange={(values) =>
                    setPage(Math.max(0, Math.min(values[0] ?? 0, pages - 1)))
                  }
                  aria-label="Scroll untouched villages"
                  className={cn("flex-1")}
                />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {safePage + 1}/{pages}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
