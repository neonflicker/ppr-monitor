import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import { useAction, useQuery } from "convex/react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const nf = new Intl.NumberFormat("en-IN");

export default function DataValidation() {
  const { token, expireSession } = useAdmin();
  const quality = useQuery(api.stats.dataQuality, {});
  const reconciliation = useQuery(api.targets.reconciliation, {});
  const rejected = useQuery(api.stats.rejectedRows, { limit: 50 });
  const mappings = useQuery(api.targets.mappings, {});
  const saveMapping = useAction(api.targetActions.saveVillageMapping);
  const removeMapping = useAction(api.targetActions.removeVillageMapping);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const addMapping = async (alias: string, canonical: string) => {
    if (!token) {
      expireSession();
      return;
    }
    setBusyKey(alias);
    try {
      await saveMapping({ token, alias, canonical });
      toast.success("Village mapping saved", {
        description: `${alias} → ${canonical}`,
      });
    } catch (err) {
      toast.error("Could not save mapping", { description: errorMessage(err) });
    } finally {
      setBusyKey(null);
    }
  };

  const dropMapping = async (id: string) => {
    if (!token) {
      expireSession();
      return;
    }
    setBusyKey(id);
    try {
      await removeMapping({ token, id: id as Id<"villageMappings"> });
      toast.success("Mapping removed");
    } catch (err) {
      toast.error("Could not remove mapping", { description: errorMessage(err) });
    } finally {
      setBusyKey(null);
    }
  };

  if (!quality || !reconciliation) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  const q = quality;
  const r = reconciliation;

  return (
    <div className="space-y-6">
      {/* ---- Reconciliation headline ---- */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">
              <ShieldCheck className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="font-title text-lg tracking-tight">
                Data Reconciliation
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Records from both sources, matched so nothing is counted twice
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <Figure
              label="Google Sheet records"
              value={nf.format(q.bySource.sheet)}
            />
            <Figure
              label="Bharat Pashudhan records"
              value={nf.format(q.bySource.bharat)}
            />
            <Figure label="Valid PPR records" value={nf.format(q.validPpr)} />
            <Figure
              label="Matched villages"
              value={`${nf.format(r.counts.matched)} / ${nf.format(r.counts.targetVillages)}`}
            />
            <Figure
              label="Potential duplicates"
              value={nf.format(q.potentialDuplicates)}
              warn={q.potentialDuplicates > 0}
            />
            <Figure
              label="Unmatched rows"
              value={nf.format(q.unmatched)}
              warn={q.unmatched > 0}
            />
          </div>

          <div className="rounded border border-border bg-muted/40 px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="size-4 text-primary" />
              {nf.format(q.total)} records stored · {nf.format(q.valid)} valid ·{" "}
              {nf.format(q.rejected)} rejected · {nf.format(q.nonPpr)} non-PPR
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {nf.format(q.duplicatesSkippedEver)} duplicate records skipped across
              all imports and synchronisations. Cross-source matches are never
              counted twice — a Bharat Pashudhan row that already exists in the
              field sheet is skipped on import.
            </p>
          </div>

          {/* Missing fields */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded border border-border px-3 py-2.5 text-sm">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Missing fields (valid records)
              </p>
              <ul className="mt-1.5 space-y-1 text-xs">
                <Row label="Village" value={q.missing.village} />
                <Row label="Date" value={q.missing.date} />
                <Row label="Vaccinator" value={q.missing.vaccinator} />
                <Row label="Species" value={q.missing.species} />
                <Row label="Tag ID" value={q.missing.tagId} />
              </ul>
            </div>
            <div className="rounded border border-border px-3 py-2.5 text-sm">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Rejection reasons
              </p>
              {q.rejectedReasons.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No rejected rows.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1 text-xs">
                  {q.rejectedReasons.map((reason) => (
                    <li
                      key={reason.reason}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="text-muted-foreground">{reason.reason}</span>
                      <span className="font-semibold tabular-nums">
                        {nf.format(reason.count)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---- Village matching ---- */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="font-title text-lg tracking-tight">
            Village Matching
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Achievement villages that do not line up with the active target
            allocation
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Figure label="Target villages" value={nf.format(r.counts.targetVillages)} />
            <Figure
              label="Villages with achievement"
              value={nf.format(r.counts.achievementVillages)}
            />
            <Figure label="Unmatched targets" value={nf.format(r.counts.unmatchedTargets)} />
            <Figure label="New villages" value={nf.format(r.counts.newVillages)} />
          </div>

          {r.overallTarget !== null && (
            <p className="text-sm text-muted-foreground">
              Official overall target {nf.format(r.overallTarget)} · village sum{" "}
              {nf.format(r.villageTargetSum)} · difference{" "}
              <span
                className={
                  r.difference === 0
                    ? "text-primary"
                    : "font-semibold text-destructive"
                }
              >
                {nf.format(r.difference)}
              </span>
            </p>
          )}

          {r.suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Suggested matches
              </p>
              {r.suggestions.map((s) => (
                <div
                  key={s.raw}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{s.raw}</p>
                    <p className="text-xs text-muted-foreground">
                      likely <span className="text-foreground">{s.suggested}</span> ·{" "}
                      {nf.format(s.achievement)} vaccinated
                      {s.reason ? ` · ${s.reason}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void addMapping(s.raw, s.suggested)}
                      disabled={busyKey === s.raw}
                    >
                      {busyKey === s.raw ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      Map it
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void addMapping(s.raw, s.raw)}
                      disabled={busyKey === s.raw}
                    >
                      Keep separate
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {r.newVillages.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Villages with achievement but no target allocation
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {r.newVillages.map((v) => (
                  <span
                    key={v.village}
                    className="rounded border border-border bg-muted/60 px-2 py-0.5 text-xs"
                  >
                    {v.village} · {nf.format(v.achievement)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {mappings && mappings.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Saved mappings
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {mappings.map((m) => (
                  <span
                    key={m._id}
                    className="inline-flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs"
                  >
                    {m.alias} → {m.canonical}
                    <button
                      type="button"
                      onClick={() => void dropMapping(m._id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove mapping"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Rejected rows ---- */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="font-title text-lg tracking-tight">
            Rejected Rows
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Stored for inspection, excluded from every dashboard figure
          </p>
        </CardHeader>
        <CardContent>
          {!rejected || rejected.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-primary" /> No rejected rows.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 font-medium">Reason</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Village</th>
                    <th className="py-2 pr-3 font-medium">Vaccinator</th>
                    <th className="py-2 pr-3 text-right font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rejected.map((row) => (
                    <tr
                      key={row._id}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="py-2 pr-3 text-muted-foreground">
                        {row.source === "google_sheet" ? "Sheet" : "Bharat"}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          {row.reason}
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{row.dateKey ?? "—"}</td>
                      <td className="py-2 pr-3">{row.village ?? "—"}</td>
                      <td className="py-2 pr-3">{row.vaccinator ?? "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {format(row.updatedAt, "d MMM yyyy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-card px-3 py-2.5 ${
        warn ? "border-destructive/40" : "border-border"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`font-title text-xl font-bold tabular-nums ${
          warn ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={value > 0 ? "font-semibold" : "text-muted-foreground"}>
        {nf.format(value)}
      </span>
    </li>
  );
}
