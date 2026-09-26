import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { useAdmin } from "@/hooks/use-admin";
import {
  analyzeAllocation,
  readAllocationFile,
  type AllocationPreview,
} from "@/lib/allocationImport";
import { errorMessage } from "@/lib/convex-errors";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  History,
  Loader2,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const nf = new Intl.NumberFormat("en-IN");

type ImportResult = {
  uploadId: string;
  totalTarget: number;
  userCount: number;
  villageCount: number;
};

export default function UserVillageAllocation() {
  const { token, expireSession } = useAdmin();
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmImport = useAction(api.allocationActions.confirmAllocationImport);
  const history = useQuery(api.allocations.history, {});
  const active = useQuery(api.allocations.active, {});

  const [preview, setPreview] = useState<AllocationPreview | null>(null);
  const [showRows, setShowRows] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setPreview(null);
    setShowRows(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setShowRows(false);
    setPreview(null);
    try {
      const { headers, rows } = await readAllocationFile(file);
      setPreview(analyzeAllocation(file.name, headers, rows));
    } catch (err) {
      toast.error("Could not read this file", { description: String(err) });
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    if (!token) {
      expireSession();
      toast.error("Session expired", { description: "Please sign in again." });
      return;
    }
    const validRows = preview.rows
      .filter((r) => r.status === "valid")
      .map((r) => ({ userName: r.userName, village: r.village, target: r.target }));
    if (validRows.length === 0) {
      toast.error("Nothing to import", {
        description: "Every row was rejected — fix the errors and upload again.",
      });
      return;
    }
    setBusy(true);
    try {
      const res = (await confirmImport({
        token,
        fileName: preview.fileName,
        totalRows: preview.totalRows,
        validRows: preview.validRows,
        invalidRows: preview.invalidRows,
        errors: preview.errors,
        rows: validRows,
      })) as ImportResult;
      setResult(res);
      setPreview(null);
      setShowRows(false);
      if (inputRef.current) inputRef.current.value = "";
      toast.success("Allocation imported", {
        description: `${nf.format(res.userCount)} users · ${nf.format(
          res.villageCount,
        )} villages · target ${nf.format(res.totalTarget)} activated`,
      });
    } catch (err) {
      const message = errorMessage(err);
      if (message.startsWith("SESSION_EXPIRED")) {
        expireSession();
        toast.error("Session expired", { description: "Please sign in again." });
      } else {
        toast.error("Import failed", { description: message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ---- Active allocation ---- */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="font-title text-lg tracking-tight">
            User &amp; Village Allocation
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Excel/CSV import (User Name · Allotted Village · Target). The newest
            confirmed file becomes the ACTIVE allocation; previous imports and all
            vaccination data are preserved.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {active?.upload && (
            <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
              <p className="font-semibold text-primary">
                Active: {active.upload.fileName}
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                <Pair label="Rows" value={nf.format(active.totals.rows)} />
                <Pair label="Users" value={nf.format(active.totals.users)} />
                <Pair label="Villages" value={nf.format(active.totals.villages)} />
                <Pair label="Total target" value={nf.format(active.totals.target)} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Uploaded {format(active.upload.uploadedAt, "d MMM yyyy, hh:mm a")} by{" "}
                {active.upload.uploadedBy}
              </p>
            </div>
          )}
          {!active?.upload && (
            <p className="rounded border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              No active allocation file yet — the public dashboards fall back to
              vaccination data only (all villages UNALLOCATED).
            </p>
          )}

          {/* ---- Upload / preview ---- */}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              <FileSpreadsheet className="size-4" />
              Upload Excel / CSV
            </Button>
            {preview && (
              <Button size="sm" variant="outline" onClick={reset}>
                Clear
              </Button>
            )}
          </div>

          {preview && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
              <p className="font-semibold">{preview.fileName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Columns detected: “{preview.mappedColumns.user}” → User Name · “
                {preview.mappedColumns.village}” → Allotted Village · “
                {preview.mappedColumns.target}” → Target
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                <Pair label="Rows detected" value={nf.format(preview.totalRows)} />
                <Pair label="Users detected" value={nf.format(preview.users.length)} />
                <Pair
                  label="Villages detected"
                  value={nf.format(preview.villages.length)}
                />
                <Pair label="Total allocated target" value={nf.format(preview.totalTarget)} />
                <Pair
                  label="Valid rows"
                  value={nf.format(preview.validRows)}
                  tone="text-primary"
                />
                <Pair
                  label="Invalid rows"
                  value={nf.format(preview.invalidRows)}
                  tone={preview.invalidRows > 0 ? "text-destructive" : undefined}
                />
              </div>

              {preview.errors.length > 0 && (
                <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
                    <AlertTriangle className="size-3.5" />
                    {preview.invalidRows} row(s) will NOT be imported:
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-destructive/90">
                    {preview.errors.slice(0, 8).map((e, i) => (
                      <li key={`${e.row}-${i}`}>
                        Row {e.row} ({e.userName} / {e.village}): {e.error}
                      </li>
                    ))}
                    {preview.errors.length > 8 && (
                      <li>…and {preview.errors.length - 8} more</li>
                    )}
                  </ul>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowRows((v) => !v)}
                >
                  {showRows ? "Hide preview" : "Preview"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleConfirm()}
                  disabled={busy || preview.validRows === 0}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  Confirm Import
                </Button>
              </div>

              {showRows && (
                <div className="mt-3 max-h-80 overflow-auto rounded border border-border bg-background">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="border-b border-border uppercase tracking-wider text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">#</th>
                        <th className="px-2 py-1.5 font-medium">User Name</th>
                        <th className="px-2 py-1.5 font-medium">Allotted Village</th>
                        <th className="px-2 py-1.5 text-right font-medium">Target</th>
                        <th className="px-2 py-1.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr
                          key={row.rowNumber}
                          className={cn(
                            "border-b border-border/60 last:border-0",
                            row.status === "invalid" && "bg-destructive/5",
                          )}
                        >
                          <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                            {row.rowNumber}
                          </td>
                          <td className="px-2 py-1.5">{row.userName || "—"}</td>
                          <td className="px-2 py-1.5">{row.village || "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {row.status === "valid" ? nf.format(row.target) : "—"}
                          </td>
                          <td className="px-2 py-1.5">
                            {row.status === "valid" ? (
                              <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">
                                Valid
                              </span>
                            ) : (
                              <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">
                                {row.error}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Import history ---- */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">
              <History className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="font-title text-lg tracking-tight">
                Allocation History
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Every confirmed allocation file — the newest ACTIVE dataset wins
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!history || history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No allocation files imported yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Filename</th>
                    <th className="py-2 pr-3 font-medium">Uploaded At</th>
                    <th className="py-2 pr-3 font-medium">By</th>
                    <th className="py-2 pr-3 text-right font-medium">Rows</th>
                    <th className="py-2 pr-3 text-right font-medium">Users</th>
                    <th className="py-2 pr-3 text-right font-medium">Villages</th>
                    <th className="py-2 pr-3 text-right font-medium">Total Target</th>
                    <th className="py-2 pr-3 text-right font-medium">Valid</th>
                    <th className="py-2 pr-3 text-right font-medium">Invalid</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr
                      key={row._id}
                      className={cn(
                        "border-b border-border/60 last:border-0",
                        row.status === "active" && "bg-primary/5",
                      )}
                    >
                      <td className="max-w-[200px] truncate py-2 pr-3 font-medium">
                        {row.fileName}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">
                        {format(row.uploadedAt, "d MMM yyyy, hh:mm a")}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {row.uploadedBy}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {nf.format(row.totalRows)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {nf.format(row.userCount)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {nf.format(row.villageCount)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {nf.format(row.totalTarget)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-primary">
                        {nf.format(row.validRows)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-destructive">
                        {nf.format(row.invalidRows)}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-xs",
                            row.status === "active"
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border bg-muted text-muted-foreground",
                          )}
                        >
                          {row.status === "active"
                            ? "Imported (active)"
                            : row.status === "superseded"
                              ? "Superseded"
                              : "Failed"}
                        </span>
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

function Pair({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", tone)}>{value}</span>
    </div>
  );
}
