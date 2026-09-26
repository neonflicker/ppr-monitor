import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import type { Overview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import { format } from "date-fns";
import { FileDown, FileText, Loader2, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const nf = new Intl.NumberFormat("en-IN");

function isoToday() {
  return format(new Date(), "yyyy-MM-dd");
}
function isoYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return format(d, "yyyy-MM-dd");
}
function prettyDate(dateKey: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

interface Props {
  overview: Overview;
}

/**
 * DISTRICT DVTR FORMAT PPR-EP — publicly viewable.
 * Save / export controls only unlock for a signed-in administrator.
 */
export default function DailyReport({ overview }: Props) {
  const [dateKey, setDateKey] = useState(isoToday());
  const [wasted, setWasted] = useState("0");
  const [busy, setBusy] = useState<"save" | "excel" | null>(null);

  const { state, token } = useAdmin();
  const isAdmin = state.status === "authenticated";

  const compute = useQuery(api.reports.compute, { dateKey });
  const history = useQuery(api.reports.history, { limit: 60 });
  const saved = useMemo(
    () => history?.find((row) => row.reportDate === dateKey) ?? null,
    [history, dateKey],
  );

  const saveReport = useAction(api.reportsActions.saveDailyReport);
  const excel = useAction(api.reportsActions.generateReportExcel);

  useEffect(() => {
    if (!compute) return;
    setWasted(String(saved?.wasted ?? compute.defaultWasted ?? 0));
  }, [compute, saved]);

  const rows: [string, string | number][] = compute
    ? [
        ["Date", prettyDate(dateKey)],
        ["Name of the District", compute.district],
        [
          "Vaccination Start Date",
          compute.vaccinationStartDate
            ? prettyDate(compute.vaccinationStartDate)
            : "N/A",
        ],
        ["Goats Vaccinated on Date", nf.format(compute.goats)],
        ["Sheep Vaccinated on Date", nf.format(compute.sheep)],
        [
          "Wasted Vaccine Doses on",
          nf.format(saved?.wasted ?? compute.wastedFromData),
        ],
        ["Tagged Goat + Sheep on", nf.format(compute.taggedTotal)],
        ["Farmers Covered on Date", nf.format(compute.farmers)],
        ["Persons Departmental Used", nf.format(compute.personnelCounts.departmental)],
        ["Persons Semi-Government", nf.format(compute.personnelCounts.semiGovernment)],
        ["Persons Private", nf.format(compute.personnelCounts.private)],
      ]
    : [];

  const requireToken = (): string | null => {
    if (!token) {
      toast.error("Session expired", { description: "Please sign in again." });
      return null;
    }
    return token;
  };

  const handleSave = async () => {
    const t = requireToken();
    if (!t) return;
    setBusy("save");
    try {
      await saveReport({ token: t, reportDate: dateKey, wasted: Number(wasted) || 0 });
      toast.success("Daily report saved", { description: prettyDate(dateKey) });
    } catch (err) {
      toast.error("Could not save report", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleExcel = async () => {
    const t = requireToken();
    if (!t) return;
    setBusy("excel");
    try {
      const result = await excel({
        token: t,
        reportDate: dateKey,
        wasted: Number(wasted) || 0,
      });
      window.open(result.url, "_blank", "noopener");
      toast.success("Excel report generated", { description: result.fileName });
    } catch (err) {
      toast.error("Could not generate Excel", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const handlePdf = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("DISTRICT DVTR FORMAT PPR-EP", 40, 56);
      doc.setDrawColor(27, 94, 32);
      doc.line(40, 66, 555, 66);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(30);
      rows.forEach(([label, value], i) => {
        const y = 96 + i * 26;
        doc.text(String(label), 40, y);
        doc.text(String(value), 300, y);
        doc.setDrawColor(220, 220, 220);
        doc.line(40, y + 8, 555, y + 8);
      });
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(
        `Generated ${format(new Date(), "dd-MM-yyyy hh:mm a")} · PPR Field Vaccination Monitoring`,
        40,
        96 + rows.length * 26 + 16,
      );
      doc.save(
        `PPR_Daily_Report_${compute?.district ?? "District"}_${dateKey}.pdf`,
      );
      toast.success("PDF downloaded");
    } catch (err) {
      toast.error("Could not build the PDF", { description: String(err) });
    }
  };

  return (
    <div className="space-y-4">
      {/* ---- Date selector ---- */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label
            htmlFor="report-date"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Select date
          </label>
          <Input
            id="report-date"
            type="date"
            value={dateKey}
            max={isoToday()}
            onChange={(e) => e.target.value && setDateKey(e.target.value)}
            className="h-10 w-[170px] text-base"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => setDateKey(isoToday())}>
          Today
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDateKey(isoYesterday())}>
          Yesterday
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {compute
            ? `${nf.format(compute.recordsOnDate)} valid records on this date`
            : "Loading…"}
        </span>
      </div>

      {/* ---- Report sheet ---- */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border bg-primary px-4 py-3 text-center">
          <p className="font-title text-lg font-bold tracking-wide text-primary-foreground sm:text-xl">
            DISTRICT DVTR FORMAT PPR-EP
          </p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-primary-foreground/80">
            {overview.districtName} District · {overview.state}
          </p>
        </div>

        {!compute ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label} className="border-b border-border/60 last:border-0">
                  <th className="w-1/2 px-4 py-2.5 text-left align-top font-medium text-muted-foreground">
                    {label}
                  </th>
                  <td className="px-4 py-2.5 font-semibold tabular-nums">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {saved ? (
            <p>
              Saved report · wasted doses {nf.format(saved.wasted)} · by{" "}
              {saved.generatedBy}
            </p>
          ) : (
            <p>
              Wastage shown is the figure present in the source data — it is never
              invented. Administrators can record the official number.
            </p>
          )}
        </div>
      </div>

      {/* ---- Actions ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isAdmin || busy !== null || !compute}
          title={isAdmin ? "Save this report" : "Administrator only"}
        >
          {busy === "save" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileText className="size-4" />
          )}
          Generate Daily Report
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExcel}
          disabled={!isAdmin || busy !== null || !compute}
          title={isAdmin ? "Download the Excel file" : "Administrator only"}
        >
          {busy === "excel" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileDown className="size-4" />
          )}
          Download Excel
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handlePdf}
          disabled={!isAdmin || !compute}
          title={isAdmin ? "Download the PDF" : "Administrator only"}
        >
          <Printer className="size-4" />
          Download PDF
        </Button>

        {isAdmin && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Wasted doses
            <Input
              type="number"
              min={0}
              value={wasted}
              onChange={(e) => setWasted(e.target.value)}
              className="h-9 w-20 text-right tabular-nums"
            />
          </label>
        )}
        {!isAdmin && (
          <span className="text-xs text-muted-foreground">
            Sign in to Admin to export or record this report.
          </span>
        )}
      </div>

      {/* ---- Saved report history ---- */}
      {history && history.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <p className="mb-1 uppercase tracking-wider">Saved reports ({history.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {history.slice(0, 12).map((row) => (
              <button
                key={row._id}
                type="button"
                onClick={() => setDateKey(row.reportDate)}
                className={cn(
                  "rounded border px-2 py-1 tabular-nums transition-colors",
                  row.reportDate === dateKey
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border hover:bg-muted",
                )}
              >
                {prettyDate(row.reportDate)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
