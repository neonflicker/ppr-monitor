import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import type { AuditRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { format } from "date-fns";
import {
  FileUp,
  History,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
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

type ParsedPreview = FunctionReturnType<
  typeof api.targetActions.previewTargetPdf
>;

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

export default function TargetAllocation() {
  const { token, expireSession } = useAdmin();

  const data = useQuery(api.targets.activeRecords, {});
  const audit = useQuery(api.targets.auditTrail, { limit: 20 });

  const saveAllocation = useAction(api.targetActions.saveManualAllocation);
  const previewPdf = useAction(api.targetActions.previewTargetPdf);
  const confirmPdf = useAction(api.targetActions.confirmTargetUpload);
  const discardPdf = useAction(api.targetActions.discardTargetPdf);

  /* ---- manual editor state ---- */
  const [district, setDistrict] = useState("");
  const [allocDate, setAllocDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [rows, setRows] = useState<EditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AllocationResult | null>(null);
  const loadedVersion = useRef<string | null>(null);

  /* ---- pdf upload state ---- */
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<ParsedPreview | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

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

  const requireToken = (): string | null => {
    if (!token) {
      expireSession();
      toast.error("Session expired", { description: "Please sign in again." });
      return null;
    }
    return token;
  };

  const num = (value: string) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };

  const total = (row: EditRow) => num(row.goat) + num(row.sheep);
  const editorSum = rows.reduce(
    (s, r) => (r.active ? s + total(r) : s),
    0,
  );

  const updateRow = (index: number, patch: Partial<EditRow>) =>
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const handleSave = async () => {
    const t = requireToken();
    if (!t) return;
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
        description: "Add at least one village or a district target.",
      });
      return;
    }
    setSaving(true);
    try {
      const res = (await saveAllocation({
        token: t,
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

  /* ---- PDF upload ---- */
  const handlePdf = async (file: File | undefined) => {
    if (!file) return;
    const t = requireToken();
    if (!t) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported for target uploads.");
      return;
    }
    setPdfBusy(true);
    setPdfPreview(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const preview = (await previewPdf({
        token: t,
        fileName: file.name,
        pdfBase64: btoa(binary),
      })) as ParsedPreview;
      setPdfPreview(preview);
      toast.success("Target PDF parsed", {
        description: `${nf.format(preview.rows.length)} village rows · ${
          preview.overallTarget != null
            ? `overall target ${nf.format(preview.overallTarget)}`
            : "no overall target found"
        }`,
      });
    } catch (err) {
      toast.error("Could not read this PDF", { description: errorMessage(err) });
    } finally {
      setPdfBusy(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  const handleConfirmPdf = async (activate: boolean) => {
    const t = requireToken();
    if (!t || !pdfPreview) return;
    setPdfBusy(true);
    try {
      const res = (await confirmPdf({
        token: t,
        fileName: pdfPreview.fileName,
        storageId: pdfPreview.storageId,
        overallTarget: pdfPreview.overallTarget ?? undefined,
        overallSource: pdfPreview.overallSource ?? undefined,
        goatTarget: pdfPreview.goatTarget ?? undefined,
        sheepTarget: pdfPreview.sheepTarget ?? undefined,
        pages: pdfPreview.pages,
        confidence: pdfPreview.confidence,
        warnings: pdfPreview.warnings,
        extraction: pdfPreview.extraction,
        activate,
        correctedRecords: 0,
        records: pdfPreview.rows,
      })) as { versionId: string; versionNumber: number };
      setPdfPreview(null);
      loadedVersion.current = null; // re-seed the editor from the new version
      toast.success(
        activate
          ? `Target version ${res.versionNumber} activated`
          : `Target version ${res.versionNumber} saved as draft`,
      );
    } catch (err) {
      toast.error("Could not save the target file", {
        description: errorMessage(err),
      });
    } finally {
      setPdfBusy(false);
    }
  };

  const handleCancelPdf = async () => {
    const t = requireToken();
    if (!t || !pdfPreview) return;
    try {
      await discardPdf({ token: t, storageId: pdfPreview.storageId });
    } catch {
      // Best effort — the preview is dropped locally either way.
    }
    setPdfPreview(null);
  };

  const version = data?.version ?? null;

  return (
    <div className="space-y-6">
      {/* ============ Manual allocation ============ */}
      <Card className="border-border">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="font-title text-lg tracking-tight">
              Village Target Allocation
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              The authoritative TARGET source for the public dashboard. Every change
              is recorded with who changed it and when.
            </p>
          </div>
          {version && (
            <div className="text-right text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">
                Version {version.versionNumber} · {version.source === "manual" ? "manual" : "PDF"}
              </p>
              <p>
                {version.villageCount} active villages · uploaded{" "}
                {format(version.uploadedAt, "d MMM yyyy, hh:mm a")}
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* District-level inputs */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              District Target
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

          {/* Village rows */}
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
                      No villages yet — add the first village or upload a target PDF.
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
                      `District target: ${nf.format(Number(district) || 0)}`}
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
              Save allocation
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
                    {change.from === undefined || change.from === change.to
                      ? change.kind === "changed"
                        ? ""
                        : `: ${nf.format(change.to)}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============ Target PDF upload ============ */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="font-title text-lg tracking-tight">
            Target PDF
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Optional: upload the official district target PDF. Columns and villages
            are detected, previewed and only stored after you confirm.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => void handlePdf(e.target.files?.[0])}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => pdfInputRef.current?.click()}
              disabled={pdfBusy}
            >
              {pdfBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileUp className="size-4" />
              )}
              Upload target PDF
            </Button>
          </div>

          {pdfPreview && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
              <p className="font-semibold">{pdfPreview.fileName}</p>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                <Field label="Village rows" value={nf.format(pdfPreview.rows.length)} />
                <Field
                  label="Overall target"
                  value={
                    pdfPreview.overallTarget != null
                      ? nf.format(pdfPreview.overallTarget)
                      : "—"
                  }
                />
                <Field label="Goat target" value={pdfPreview.goatTarget != null ? nf.format(pdfPreview.goatTarget) : "—"} />
                <Field label="Sheep target" value={pdfPreview.sheepTarget != null ? nf.format(pdfPreview.sheepTarget) : "—"} />
                <Field label="Pages" value={String(pdfPreview.pages)} />
                <Field label="Confidence" value={`${Math.round(pdfPreview.confidence * 100)}%`} />
                <Field label="Extraction" value={pdfPreview.extraction} />
                <Field label="District" value={pdfPreview.district ?? "—"} />
              </div>
              {pdfPreview.warnings.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {pdfPreview.warnings.slice(0, 6).map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void handleConfirmPdf(true)} disabled={pdfBusy}>
                  {pdfBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Save & activate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleConfirmPdf(false)}
                  disabled={pdfBusy}
                >
                  Save as draft
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleCancelPdf()} disabled={pdfBusy}>
                  <X className="size-4" />
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============ Change history ============ */}
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
                          <li key={`${row._id}-${i}`} className="text-xs text-muted-foreground">
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
