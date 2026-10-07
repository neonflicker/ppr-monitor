import { Slider } from "@/components/ui/slider";
import { api } from "@/convex/_generated/api";
import { normalizeVillageClient } from "@/lib/scopeKeys";
import type { Scope, ScopeData } from "@/lib/scopeLink";
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

  // Vertical slider drives a free-scrolling START OFFSET in
  // [0, list − PAGE_SIZE]: the window always shows 10 villages and the full
  // list is walkable (1–10, 11–20, …, ending on a partial window like
  // 16–25). Hidden altogether when everything fits in one window.
  const maxStart = Math.max(0, untouched.length - PAGE_SIZE);
  const start = Math.min(page, maxStart);
  const visible = untouched.slice(start, start + PAGE_SIZE);

  // A different vaccinator always starts at the first window.
  useEffect(() => {
    setPage(0);
  }, [scope.user]);

  return (
    <div className="rounded-md border border-border bg-card px-3 py-3">
      {/* ---- Header + spec-required subtitle ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <MapPinned className="size-4 shrink-0 text-primary" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em]">
            Untouched Villages
          </h3>
        </div>
        {selectedUser && (
          <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            Vaccinator: {selectedUser.name}
          </span>
        )}
      </div>
      <p className="pt-1.5 text-xs text-muted-foreground">
        Villages allotted to the selected vaccinator with no vaccination
        achievement yet.
      </p>

      {!selectedUser ? (
        /* ---- ALL USERS: never merge every vaccinator's villages ---- */
        <p className="px-1 py-6 text-center text-sm font-medium text-muted-foreground">
          Select a vaccinator to view untouched villages.
        </p>
      ) : !data ? (
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
          {/* ---- Dynamic total count (near the heading) ---- */}
          <p className="pt-2 text-sm font-semibold text-foreground tabular-nums">
            {nf.format(untouched.length)} untouched village
            {untouched.length === 1 ? "" : "es"}
          </p>

          {/* ---- [vertical slider] [village cards] ---- */}
          <div className="mt-2 flex items-stretch gap-2 sm:gap-3">
            {maxStart > 0 && (
              <div className="flex w-8 shrink-0 items-center justify-center self-stretch rounded border border-border bg-muted/30 py-2">
                <Slider
                  orientation="vertical"
                  inverted
                  value={[start]}
                  min={0}
                  max={maxStart}
                  step={1}
                  onValueChange={(values) =>
                    setPage(Math.max(0, Math.min(values[0] ?? 0, maxStart)))
                  }
                  aria-label="Scroll untouched villages"
                  /* Vertical root defaults to w-auto (a 6px track) — fill the
                     strip so the drag/touch target is finger-sized; and bump
                     the thumb to 24px. Track taps and drags both work (Radix
                     handles pointer-down anywhere on the slider). */
                  className={
                    "data-[orientation=vertical]:w-full [&_[data-slot=slider-thumb]]:size-6"
                  }
                />
              </div>
            )}

            <div className="min-w-0 flex-1">
              {/* ---- Desktop table ---- */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pl-2 pr-3 font-medium">S.No</th>
                      <th className="py-2 pr-3 font-medium">Village</th>
                      <th className="py-2 pr-3 text-right font-medium">Target</th>
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
              <div className="space-y-2 sm:hidden">
                {visible.map((row, index) => (
                  <div
                    key={`card-${row.key}`}
                    className="rounded-md border border-border bg-background px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
                        <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                          {start + index + 1}.
                        </span>
                        <p className="break-words text-sm font-semibold">{row.name}</p>
                      </div>
                      <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                        NOT STARTED
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      Target {nf.format(row.target)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
