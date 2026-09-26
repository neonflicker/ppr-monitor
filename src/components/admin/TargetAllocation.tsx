import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import type { AuditRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import { format } from "date-fns";
import { History, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const nf = new Intl.NumberFormat("en-IN");

type EditRow = {
  id?: string;
  village: string;
  goat: string;
  sheep: string;
  active: boolean;
  remarks: string;
};

type AllocationResult = {
  versionId: string;
  versionNumber: number;
  changeCount: number;
  changes: {
    village: string;
    kind: "new" | "changed" | "deactivated" | "reactivated";
    from?: number;
    to: number;
  }[];
  villageSum: number;
  districtTarget: number | null;
};

const CHANGE_LABEL: Record<string, string> = {
  new: "Added",
  changed: "Target changed",
  deactivated: "Deactivated",
  reactivated: "Reactivated",
};

function parseAuditDetails(row: AuditRow): AllocationResult["changes"] | null {
  if (!row.details) return null;
  try {
    const parsed = JSON.parse(row.details) as {
      changes?: AllocationResult["changes"];
    };
    return parsed.changes ?? null;
  } catch {
    return null;
  }
}

/**
 * Manual village target editor. (The PDF target reader was removed —
 * allocation now arrives via the Excel/CSV User & Village Allocation import.)
 */
export default function TargetAllocation() {
  const { token, expireSession } = useAdmin();

  const data = useQuery(api.targets.activeRecords, {});
  const audit = useQuery(api.targets.auditTrail, { limit: 20 });
  const saveAllocation = useAction(api.targetActions.saveManualAllocation);

  const [district, setDistrict] = useState("");
  const [allocDate, setAllocDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [rows, setRows] = useState<EditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AllocationResult | null>(null);
  const loadedVersion = useRef<string | null>(null);

  useEffect(() => {
    if (!data?.version) return;
    if (loadedVersion.current === data.version._id) return;
    loadedVersion.current = data.version._id;
    setDistrict(
      data.version.overallTarget != null ? String(data.version.overallTarget) : "",
    );
    setRows(
      data.records.map((r) => ({
        id: r._id,
        village: r.village,
        goat: String(r.goatTarget ?? 0),
        sheep: String(r.sheepTarget ?? 0),
        active: r.active !== false,
        remarks: r.remarks ?? "",
      })),
    );
  }, [data]);

  const num = (value: string) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };
  const total = (row: EditRow) => num(row.goat) + num(row.sheep);
  const editorSum = rows.reduce((s, r) => (r.active ? s + total(r) : s), 0);

  const updateRow = (index: number, patch: Partial<EditRow>) =>
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const handleSave = async () => {
    if (!token) {
      expireSession();
      toast.error("Session expired", { description: "Please sign in again." });
      return;
    }
    const villages = rows
      .filter((r) => r.village.trim())
      .map((r) => ({
        village: r.village.trim(),
        goatTarget: num(r.goat),
        sheepTarget: num(r.sheep),
        active: r.active,
        remarks: r.remarks.trim() || undefined,
      }));
    if (villages.length === 0 && !district.trim()) {
      toast.error("Nothing to save", {
        description: "Add at least one village or a dispensary target.",
      });
      return;
    }
    setSaving(true);
    try {
      const res = (await saveAllocation({
        token,
        districtTarget: district.trim() ? Number(district) : undefined,
        clearDistrictTarget: !district.trim(),
        allocationDate: allocDate || undefined,
        remarks: remarks.trim() || undefined,
        villages,
      })) as AllocationResult;
      setResult(res);
      loadedVersion.current = res.versionId;
      toast.success("Allocation saved", {
        description: `Version ${res.versionNumber} · ${res.changeCount} change(s) · village sum ${nf.format(res.villageSum)}`,
      });
    } catch (err) {
      toast.error("Could not save the allocation", {
        description: errorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const version = data?.version ?? null;

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="font-title text-lg tracking-tight">
              Manual Village Targets
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Optional hand-entered village targets. The primary allocation source
              is the User &amp; Village Allocation import.
            </p>
          </div>
          {version && (
            <div className="text-right text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">
                Version {version.versionNumber} ·{" "}
                {version.source === "manual" ? "manual" : "file"}
              </p>
              <p>
                {version.villageCount} active villages · updated{" "}
                {format(version.uploadedAt, "d MMM yyyy, hh:mm a")}
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              Dispensary Target
              <Input
                type="number"
                min={0}
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                placeholder="e.g. 4500"
                className="h-10 text-base tabular-nums"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Target Allocation Date
              <Input
                type="date"
                value={allocDate}
                onChange={(e) => setAllocDate(e.target.value)}
                className="h-10 text-base"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Remarks
              <Input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. revised allocation"
                className="h-10 text-base"
              />
            </label>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/80">
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pl-3 pr-3 font-medium">Village</th>
                  <th className="py-2 pr-3 text-right font-medium">Goat Target</th>
                  <th className="py-2 pr-3 text-right font-medium">Sheep Target</th>
                  <th className="py-2 pr-3 text-right font-medium">Total</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Remarks</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      No manual village targets yet.
                    </td>
                  </tr>
                )}
                {rows.map((row, index) => (
                  <tr
                    key={row.id ?? `new-${index}`}
                    className={cn(
                      "border-b border-border/60 last:border-0",
                      !row.active && "opacity-60",
                    )}
                  >
                    <td className="py-1.5 pl-3 pr-3">
                      <Input
                        value={row.village}
                        onChange={(e) => updateRow(index, { village: e.target.value })}
                        placeholder="Village name"
                        className="h-9 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <Input
                        type="number"
                        min={0}
                        value={row.goat}
                        onChange={(e) => updateRow(index, { goat: e.target.value })}
                        className="h-9 text-right text-sm tabular-nums"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <Input
                        type="number"
                        min={0}
                        value={row.sheep}
                        onChange={(e) => updateRow(index, { sheep: e.target.value })}
                        className="h-9 text-right text-sm tabular-nums"
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">
                      {nf.format(total(row))}
                    </td>
                    <td className="py-1.5 pr-3">
                      <button
                        type="button"
                        onClick={() => updateRow(index, { active: !row.active })}
                        className={cn(
                          "rounded border px-2 py-1 text-[11px] font-semibold uppercase tracking-wider",
                          row.active
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {row.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="py-1.5 pr-3">
                      <Input
                        value={row.remarks}
                        onChange={(e) => updateRow(index, { remarks: e.target.value })}
                        placeholder="—"
                        className="h-9 text-sm"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Remove this row"
                        onClick={() =>
                          setRows((list) => list.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/60 font-semibold">
                  <td className="px-3 py-2 uppercase tracking-wider">Editor total</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {nf.format(
                      rows.reduce((s, r) => (r.active ? s + num(r.goat) : s), 0),
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {nf.format(
                      rows.reduce((s, r) => (r.active ? s + num(r.sheep) : s), 0),
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {nf.format(editorSum)}
                  </td>
                  <td colSpan={3} className="py-2 pr-3 text-xs font-normal text-muted-foreground">
                    {district.trim() &&
                      `Dispensary target: ${nf.format(Number(district) || 0)}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setRows((list) => [
                  ...list,
                  { village: "", goat: "0", sheep: "0", active: true, remarks: "" },
                ])
              }
            >
              <Plus className="size-4" />
              Add Village
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save targets
            </Button>
            <span className="text-xs text-muted-foreground">
              Rows you delete are deactivated, never erased — history is preserved.
            </span>
          </div>

          {result && result.changes.length > 0 && (
            <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
              <p className="font-semibold text-primary">
                Saved version {result.versionNumber} · {result.changeCount} change(s)
              </p>
              <ul className="mt-1.5 space-y-1">
                {result.changes.slice(0, 12).map((change, i) => (
                  <li key={`${change.village}-${i}`} className="text-xs">
                    <span className="font-medium">{change.village}</span> —{" "}
                    {CHANGE_LABEL[change.kind] ?? change.kind}
                    {change.from !== undefined &&
                      change.from !== change.to &&
                      `: ${nf.format(change.from)} → ${nf.format(change.to)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Change history ---- */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">
              <History className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="font-title text-lg tracking-tight">
                Target Change History
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Previous and new values, who changed them and when.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!audit || audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No target changes recorded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {audit.map((row) => {
                const changes = parseAuditDetails(row);
                return (
                  <div
                    key={row._id}
                    className="rounded border border-border bg-muted/30 px-3 py-2.5 text-sm"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-foreground">{row.summary}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {format(row.at, "dd-MM-yyyy, hh:mm a")} · {row.by}
                      </p>
                    </div>
                    {changes && changes.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 border-l-2 border-border pl-3">
                        {changes.slice(0, 8).map((change, i) => (
                          <li
                            key={`${row._id}-${i}`}
                            className="text-xs text-muted-foreground"
                          >
                            {change.village}:{" "}
                            {change.from !== undefined
                              ? `${nf.format(change.from)} → ${nf.format(change.to)}`
                              : nf.format(change.to)}{" "}
                            ({CHANGE_LABEL[change.kind] ?? change.kind})
                          </li>
                        ))}
                        {changes.length > 8 && (
                          <li className="text-xs text-muted-foreground">
                            …and {changes.length - 8} more
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
