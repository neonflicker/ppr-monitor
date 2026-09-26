import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { useAdmin } from "@/hooks/use-admin";
import {
  analyzeBharat,
  isSpreadsheetFile,
  readFileRows,
  type BharatPreview,
} from "@/lib/bharatImport";
import { errorMessage } from "@/lib/convex-errors";
import type { Overview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const nf = new Intl.NumberFormat("en-IN");

interface Props {
  overview: Overview;
}

type ImportResult = {
  totalRows: number;
  validRows: number;
  newRecords: number;
  duplicateRows: number;
  crossSourceDuplicates: number;
  rejectedRows: number;
  rejectedReasons: { reason: string; count: number }[];
};

export default function BharatUpload({ overview }: Props) {
  const { token, expireSession } = useAdmin();
  const inputRef = useRef<HTMLInputElement>(null);
  const confirm = useAction(api.bharatActions.confirmBharatUpload);
  const lastUpload = useQuery(api.bharat.lastUpload, {});

  const [preview, setPreview] = useState<BharatPreview | null>(null);
  const [showRows, setShowRows] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setPreview(null);
    setShowRows(false);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setShowRows(false);
    setPreview(null);
    if (!isSpreadsheetFile(file.name)) {
      toast.error("Unsupported file", {
        description: "Upload a CSV, XLSX or XLS file exported from Bharat Pashudhan.",
      });
      return;
    }
    try {
      const { headers, rows } = await readFileRows(file);
      const analysed = analyzeBharat(
        file.name,
        headers,
        rows,
        overview.pprValues,
      );
      setPreview(analysed);
      if (analysed.missingRequired.length > 0) {
        toast.error("Required columns missing", {
          description: `Could not find: ${analysed.missingRequired.join(", ")}`,
        });
      }
    } catch (err) {
      toast.error("Could not read this file", { description: String(err) });
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    if (!token) {
      expireSession();
      return;
    }
    if (preview.missingRequired.length > 0) {
      toast.error("Fix the column mapping first", {
        description: `Missing: ${preview.missingRequired.join(", ")}`,
      });
      return;
    }
    if (preview.rows.length === 0) {
      toast.error("This file has no data rows.");
      return;
    }
    setBusy(true);
    try {
      const res = (await confirm({
        token,
        fileName: preview.fileName,
        mappedColumns: preview.mappedColumns,
        unmappedColumns: preview.unmappedColumns,
        rows: preview.rows,
      })) as ImportResult;
      setResult(res);
      setPreview(null);
      setShowRows(false);
      if (inputRef.current) inputRef.current.value = "";
      toast.success("Import saved", {
        description: `${nf.format(res.newRecords)} new · ${nf.format(
          res.duplicateRows + res.crossSourceDuplicates,
        )} duplicate records skipped · ${nf.format(res.rejectedRows)} rejected`,
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
      {/* ---- Drop / pick ---- */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="font-title text-lg tracking-tight">
            Bharat Pashudhan Data
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Upload a CSV / XLSX / XLS export. Columns are detected automatically,
            validated and de-duplicated before anything is written.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              <UploadCloud className="size-4" />
              Choose file
            </Button>
            {preview && (
              <Button size="sm" variant="outline" onClick={reset}>
                Clear
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              Last upload:{" "}
              {lastUpload
                ? `${lastUpload.fileName} · ${format(
                    lastUpload.uploadedAt,
                    "d MMM yyyy, hh:mm a",
                  )}`
                : "never"}
            </span>
          </div>

          {/* ---- Import result ---- */}
          {result && (
            <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
              <p className="flex items-center gap-2 font-semibold text-primary">
                <CheckCircle2 className="size-4" /> Import complete
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                <Pair label="Rows processed" value={nf.format(result.totalRows)} />
                <Pair label="New records" value={nf.format(result.newRecords)} />
                <Pair
                  label="Duplicates skipped"
                  value={nf.format(
                    result.duplicateRows + result.crossSourceDuplicates,
                  )}
                />
                <Pair label="Rejected" value={nf.format(result.rejectedRows)} />
                <Pair label="Valid" value={nf.format(result.validRows)} />
              </div>
              {result.rejectedReasons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.rejectedReasons.map((r) => (
                    <span
                      key={r.reason}
                      className="rounded border border-border bg-background/60 px-2 py-0.5 text-xs"
                    >
                      {r.reason} · {r.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---- Preview summary ---- */}
          {preview && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <FileSpreadsheet className="size-4 text-primary" />
                {preview.fileName}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                <Pair label="Records detected" value={nf.format(preview.totalRows)} />
                <Pair label="Valid" value={nf.format(preview.validRows)} />
                <Pair
                  label="Duplicates in file"
                  value={nf.format(preview.duplicateRows)}
                />
                <Pair label="Rejected" value={nf.format(preview.invalidRows)} />
                <Pair label="Non-PPR rows" value={nf.format(preview.nonPprRows)} />
                <Pair label="Columns mapped" value={nf.format(preview.headers.length - preview.unmappedColumns.length)} />
              </div>

              {preview.missingRequired.length > 0 && (
                <p className="mt-2 flex items-start gap-2 text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Required column missing: {preview.missingRequired.join(", ")}.
                  Export the file again with a date and village column.
                </p>
              )}
              {preview.reasons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {preview.reasons.map((r) => (
                    <span
                      key={r.reason}
                      className="rounded border border-border bg-background/60 px-2 py-0.5 text-xs"
                    >
                      {r.reason} · {nf.format(r.count)}
                    </span>
                  ))}
                </div>
              )}

              <details className="mt-3">
                <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  Column mapping ({preview.mappedColumns.length})
                </summary>
                <ul className="mt-2 space-y-1 border-l-2 border-border pl-4">
                  {preview.mappedColumns.map((col) => (
                    <li key={col} className="text-xs text-muted-foreground">
                      {col}
                    </li>
                  ))}
                  {preview.unmappedColumns.length > 0 && (
                    <li className="text-xs text-muted-foreground">
                      Ignored: {preview.unmappedColumns.join(", ")}
                    </li>
                  )}
                </ul>
              </details>

              <div className="mt-4 flex flex-wrap gap-2">
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
                  disabled={busy || preview.missingRequired.length > 0}
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
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="border-b border-border uppercase tracking-wider text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">Date</th>
                        <th className="px-2 py-1.5 font-medium">Village</th>
                        <th className="px-2 py-1.5 font-medium">Vaccinator</th>
                        <th className="px-2 py-1.5 font-medium">Species</th>
                        <th className="px-2 py-1.5 text-right font-medium">Goats</th>
                        <th className="px-2 py-1.5 text-right font-medium">Sheep</th>
                        <th className="px-2 py-1.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 50).map((row, i) => (
                        <tr
                          key={`${row.externalKey}-${i}`}
                          className="border-b border-border/60 last:border-0"
                        >
                          <td className="px-2 py-1.5 tabular-nums">
                            {row.dateKey ?? "—"}
                          </td>
                          <td className="px-2 py-1.5">{row.village ?? "—"}</td>
                          <td className="px-2 py-1.5">{row.vaccinator ?? "—"}</td>
                          <td className="px-2 py-1.5">{row.species ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {row.goats}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {row.sheep}
                          </td>
                          <td className="px-2 py-1.5">
                            <span
                              className={cn(
                                "rounded border px-1.5 py-0.5",
                                row.status === "valid"
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-destructive/40 bg-destructive/10 text-destructive",
                              )}
                            >
                              {row.status === "valid"
                                ? row.isPpr
                                  ? "Valid"
                                  : "Non-PPR"
                                : (row.rejectReason ?? "Rejected")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.rows.length > 50 && (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      Showing the first 50 of {nf.format(preview.rows.length)} rows —
                      every row is imported when you confirm.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Duplicate protection note ---- */}
      <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-1 font-semibold uppercase tracking-wider text-foreground">
          Duplicate protection
        </p>
        <p>
          Each row gets a unique record identifier (record ID when present, otherwise
          date + village + vaccinator + species + counts + tag ID). Re-uploading the
          same file never double-counts: identical records are skipped, and a record
          that already exists in the Google Sheet is matched on its natural key so it
          is counted exactly once across both sources.
        </p>
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
