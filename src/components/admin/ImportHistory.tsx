import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { format } from "date-fns";
import {
  ClipboardList,
  FileSpreadsheet,
  History,
  Table2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const nf = new Intl.NumberFormat("en-IN");

function stamp(ms: number) {
  return format(ms, "d MMM yyyy, hh:mm a");
}

export default function ImportHistory() {
  const uploads = useQuery(api.bharat.uploadHistory, { limit: 25 });
  const syncs = useQuery(api.sync.history, { limit: 25 });
  const versions = useQuery(api.targets.listVersions, {});
  const reports = useQuery(api.reports.history, { limit: 15 });
  const allocationUploads = useQuery(api.allocations.history, {});

  return (
    <div className="space-y-6">
      {/* ---- User & Village allocation imports ---- */}
      <HistoryCard
        title="User & Village Allocation Imports"
        icon={<ClipboardList className="size-4 text-primary" />}
        subtitle="Allocation files — the newest ACTIVE dataset drives the target views"
        empty={allocationUploads && allocationUploads.length === 0}
        emptyText="No allocation files imported yet."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
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
              {(allocationUploads ?? []).map((row) => (
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
                    {stamp(row.uploadedAt)}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{row.uploadedBy}</td>
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
      </HistoryCard>

      {/* ---- Bharat Pashudhan uploads ---- */}
      <HistoryCard
        title="Bharat Pashudhan Uploads"
        icon={<FileSpreadsheet className="size-4 text-primary" />}
        subtitle="Every confirmed file import"
        empty={uploads && uploads.length === 0}
        emptyText="No Bharat Pashudhan files uploaded yet."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">File</th>
                <th className="py-2 pr-3 font-medium">Uploaded</th>
                <th className="py-2 pr-3 font-medium">By</th>
                <th className="py-2 pr-3 text-right font-medium">Rows</th>
                <th className="py-2 pr-3 text-right font-medium">Valid</th>
                <th className="py-2 pr-3 text-right font-medium">New</th>
                <th className="py-2 pr-3 text-right font-medium">Duplicates</th>
                <th className="py-2 pr-3 text-right font-medium">Cross-source</th>
                <th className="py-2 pr-3 text-right font-medium">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {(uploads ?? []).map((row) => (
                <tr
                  key={row._id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="max-w-[220px] truncate py-2 pr-3 font-medium">
                    {row.fileName}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">
                    {stamp(row.uploadedAt)}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {row.uploadedBy}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {nf.format(row.totalRows)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {nf.format(row.validRows)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-primary">
                    {nf.format(row.newRecords)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {nf.format(row.duplicateRows)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {nf.format(row.crossSourceDuplicates)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-destructive">
                    {nf.format(row.rejectedRows)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </HistoryCard>

      {/* ---- Google Sheet syncs ---- */}
      <HistoryCard
        title="Google Sheet Synchronisations"
        icon={<Table2 className="size-4 text-primary" />}
        subtitle="District field sheet imports"
        empty={syncs && syncs.length === 0}
        emptyText="No synchronisations yet."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Started</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Trigger</th>
                <th className="py-2 pr-3 text-right font-medium">Rows</th>
                <th className="py-2 pr-3 text-right font-medium">New</th>
                <th className="py-2 pr-3 text-right font-medium">Updated</th>
                <th className="py-2 pr-3 text-right font-medium">Unchanged</th>
                <th className="py-2 pr-3 text-right font-medium">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {(syncs ?? []).map((row) => (
                <tr
                  key={row._id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">
                    {stamp(row.startedAt)}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        row.status === "done"
                          ? "rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                          : row.status === "error"
                            ? "rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
                            : "rounded border border-border bg-muted px-1.5 py-0.5 text-xs"
                      }
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
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.recordsRetrieved ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.newRecords ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.updatedRecords ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.unchangedRecords ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.rejectedRecords ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </HistoryCard>

      {/* ---- Manual target versions ---- */}
      <HistoryCard
        title="Manual Target Versions"
        icon={<Table2 className="size-4 text-primary" />}
        subtitle="Every hand-entered target allocation"
        empty={versions && versions.length === 0}
        emptyText="No target versions yet."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Version</th>
                <th className="py-2 pr-3 font-medium">File</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Uploaded</th>
                <th className="py-2 pr-3 font-medium">By</th>
                <th className="py-2 pr-3 text-right font-medium">Overall</th>
                <th className="py-2 pr-3 text-right font-medium">Villages</th>
              </tr>
            </thead>
            <tbody>
              {(versions ?? []).map((row) => (
                <tr
                  key={row._id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="py-2 pr-3 font-medium tabular-nums">
                    v{row.versionNumber}
                  </td>
                  <td className="max-w-[200px] truncate py-2 pr-3">{row.fileName}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{row.source}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        row.status === "active"
                          ? "rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                          : "rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">
                    {stamp(row.uploadedAt)}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{row.uploadedBy}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.overallTarget != null ? nf.format(row.overallTarget) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.villageCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </HistoryCard>

      {/* ---- Saved daily reports ---- */}
      <HistoryCard
        title="Saved Daily Reports"
        icon={<History className="size-4 text-primary" />}
        subtitle="DISPENSARY DVTR FORMAT PPR-EP records"
        empty={reports && reports.length === 0}
        emptyText="No daily reports saved yet."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 text-right font-medium">Goats</th>
                <th className="py-2 pr-3 text-right font-medium">Sheep</th>
                <th className="py-2 pr-3 text-right font-medium">Wasted</th>
                <th className="py-2 pr-3 text-right font-medium">Farmers</th>
                <th className="py-2 pr-3 font-medium">Generated by</th>
              </tr>
            </thead>
            <tbody>
              {(reports ?? []).map((row) => (
                <tr
                  key={row._id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="py-2 pr-3 tabular-nums">{row.reportDate}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.goats}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.sheep}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.wasted}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.farmers}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{row.generatedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </HistoryCard>
    </div>
  );
}

function HistoryCard({
  title,
  subtitle,
  icon,
  empty,
  emptyText,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  empty?: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <Card className="border-border">
      <CardHeader className="space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">
            {icon}
          </div>
          <div>
            <CardTitle className="font-title text-lg tracking-tight">{title}</CardTitle>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>{empty ? <p className="text-sm text-muted-foreground">{emptyText}</p> : children}</CardContent>
    </Card>
  );
}
