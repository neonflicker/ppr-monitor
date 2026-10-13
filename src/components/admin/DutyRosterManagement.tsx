import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseDutyRosterText, type DutyEntry } from "@/convex/lib/dutyRosterParser";
import { useAdmin } from "@/hooks/use-admin";
import { parseDutyRosterWorksheet } from "@/lib/dutyRosterExcelParser";
import { assignFieldStaff, canonicalStaffName, completeMonthlyEntries, getMonthlyScheduleWarnings, inferRosterMonth, monthDates, monthPeriod, weekdayForDate } from "@/lib/dutyRosterSchedule";
import { errorMessage } from "@/lib/convex-errors";
import { useAction } from "convex/react";
import { format } from "date-fns";
import { Archive, FileSpreadsheet, FileText, Loader2, ShieldAlert, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

type Entry = { date: string; officeStaff: string; fieldStaff: string[] };
type Roster = {
  _id: Id<"rosters">;
  fileName: string;
  effectiveStart: string;
  effectiveEnd: string;
  entries: Entry[];
  status: "draft" | "published" | "archived";
  uploadedAt: number;
  publishedAt?: number;
  originalUrl: string | null;
  importIssues?: string[];
};

function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const date = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (date <= last && dates.length < 370) {
    dates.push(format(date, "yyyy-MM-dd"));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

function assignmentErrors(entry: Entry, staff: string[], allEntries: Entry[], start: string, end: string) {
  const names = [entry.officeStaff, ...entry.fieldStaff].filter(Boolean);
  const unique = new Set(names.map((name) => name.toLowerCase().trim())).size === names.length;
  const dateValue = new Date(`${entry.date}T12:00:00Z`);
  const hasValidDate = Boolean(entry.date) && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(entry.date) && Number.isFinite(dateValue.getTime()) && dateValue.toISOString().slice(0, 10) === entry.date;
  const duplicateDate = Boolean(entry.date) && allEntries.filter((row) => row.date === entry.date).length > 1;
  return [
    !hasValidDate ? "Enter a valid date." : "",
    hasValidDate && (entry.date < start || entry.date > end) ? "Date is outside the effective period." : "",
    duplicateDate ? "Duplicate roster date." : "",
    !entry.officeStaff ? "Select one office staff member." : "",
    entry.fieldStaff.length !== 3 ? "Assign exactly three field staff." : "",
    !unique ? "Assignments must be distinct." : "",
    ...names.filter((name) => !canonicalStaffName(name, staff)).map((name) => `Unrecognized staff: ${name}.`),
  ].filter(Boolean);
}

export default function DutyRosterManagement() {
  const { token, expireSession } = useAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);
  const uploadUrlAction = useAction(api.dutyRosters.createUploadUrl);
  const createDraft = useAction(api.dutyRosters.createDraft);
  const saveDraft = useAction(api.dutyRosters.saveDraft);
  const listAction = useAction(api.dutyRosters.list);
  const personnelAction = useAction(api.dutyRosters.personnel);
  const publishAction = useAction(api.dutyRosters.publish);
  const forcePublishAction = useAction(api.dutyRosters.forcePublish);
  const archiveAction = useAction(api.dutyRosters.archive);
  const removeRosterAction = useAction(api.dutyRosters.remove);
  const [rows, setRows] = useState<Roster[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Roster | null>(null);
  const [forcePublishTarget, setForcePublishTarget] = useState<Roster | null>(null);
  const [deletingId, setDeletingId] = useState<Id<"rosters"> | null>(null);
  const [staff, setStaff] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [excelPreviewUrl, setExcelPreviewUrl] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [parsedSheetName, setParsedSheetName] = useState("");
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const initialMonth = format(new Date(), "yyyy-MM");
  const initialPeriod = monthPeriod(initialMonth)!;
  const [rosterMonth, setRosterMonth] = useState(initialMonth);
  const monthManuallySelected = useRef(false);
  const [start, setStart] = useState(initialPeriod.start);
  const [end, setEnd] = useState(initialPeriod.end);
  const [selectedId, setSelectedId] = useState<Id<"rosters"> | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [replaceId, setReplaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = rows.find((row) => row._id === selectedId) ?? null;
  const publishedOverlaps = useMemo(() => rows.filter((row) => row.status === "published" && row.effectiveStart <= end && row.effectiveEnd >= start), [rows, start, end]);

  const refresh = async () => {
    if (!token) return;
    const [rosters, people] = await Promise.all([listAction({ token }), personnelAction({ token })]);
    setRows(rosters as Roster[]);
    setStaff(people);
  };
  useEffect(() => {
    if (token) void refresh().catch((error) => toast.error(errorMessage(error)));
    // refresh uses stable Convex actions; load after session arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => () => { if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { if (excelPreviewUrl) URL.revokeObjectURL(excelPreviewUrl); }, [excelPreviewUrl]);

  const choosePdf = (next?: File) => {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".pdf")) { toast.error("Choose a PDF file."); return; }
    setFile(next);
    setSelectedId(null);
    setWorkbook(null);
    setParsedSheetName("");
    setImportIssues([]);
    setExcelPreviewUrl(null);
    setPreviewUrl((old) => { if (old?.startsWith("blob:")) URL.revokeObjectURL(old); return URL.createObjectURL(next); });
  };

  const reviewWorksheet = (book: XLSX.WorkBook, name: string) => {
    const sheet = book.Sheets[name];
    if (!sheet) { toast.error("Select a worksheet to review."); return; }
    const result = parseDutyRosterWorksheet(sheet, staff);
    const detectedMonth = inferRosterMonth(result.entries, "", "");
    const selectedMonth = monthManuallySelected.current ? rosterMonth : detectedMonth || rosterMonth;
    setRosterMonth(selectedMonth);
    const period = monthPeriod(selectedMonth);
    const complete = completeMonthlyEntries(selectedMonth, staff, result.entries);
    const monthEntries = complete.entries.filter((entry) => entry.date.slice(0, 7) === selectedMonth);
    const outOfMonth = getMonthlyScheduleWarnings(result.entries, selectedMonth);
    const issues = [...result.issues, ...outOfMonth];
    if (complete.removedOctoberExtra) issues.push("Removed the erroneous 2026-09-30 entry from the October 2026 roster; 01-10-2026 through 31-10-2026 remain aligned to their original dates.");
    setImportIssues([...new Set(issues)]);
    setParsedSheetName(name);
    if (period) { setStart(period.start); setEnd(period.end); }
    setEntries(monthEntries);
    if (issues.length) toast.warning("Review the flagged workbook rows before saving.", { description: `${issues.length} import issue${issues.length === 1 ? "" : "s"} found.` });
    else if (monthEntries.length) toast.success(`Read ${monthEntries.length} monthly assignments from ${name}.`);
    else toast.error("No roster assignments were found on this worksheet.");
  };

  const chooseExcel = async (next?: File) => {
    if (!next) return;
    if (!/\.(xlsx|xls)$/i.test(next.name)) { toast.error("Choose an .xlsx or .xls workbook."); return; }
    setFile(next);
    setSelectedId(null);
    monthManuallySelected.current = false;
    setEntries([]);
    setImportIssues([]);
    setParsedSheetName("");
    setPreviewUrl(null);
    setExcelPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(next); });
    setBusy(true);
    try {
      const book = XLSX.read(await next.arrayBuffer(), { type: "array", cellDates: true });
      if (!book.SheetNames.length) throw new Error("The workbook has no worksheets.");
      setWorkbook(book);
      setSheetName(book.SheetNames[0]);
      if (book.SheetNames.length === 1) reviewWorksheet(book, book.SheetNames[0]);
      else toast.info("Workbook opened. Select the roster worksheet, then choose Review worksheet.");
    } catch (error) {
      setWorkbook(null);
      toast.error("Could not read Excel workbook", { description: errorMessage(error) });
    } finally { setBusy(false); }
  };

  const uploadPdf = async () => {
    if (!token || !file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setBusy(true);
    try {
      let extractedEntries: DutyEntry[] = [];
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
      try {
        const text = await parser.getText({ lineEnforce: true, cellSeparator: " | " });
        extractedEntries = parseDutyRosterText(text.text, staff).filter((entry) => entry.date >= start && entry.date <= end);
      } catch {
        toast.info("PDF text could not be extracted. Enter the daily assignments from the preview.");
      } finally { await parser.destroy(); }
      const period = monthPeriod(rosterMonth);
      const effectiveStart = period?.start ?? start;
      const effectiveEnd = period?.end ?? end;
      const monthlyEntries = completeMonthlyEntries(rosterMonth, staff, extractedEntries).entries
        .filter((entry) => entry.date.slice(0, 7) === rosterMonth);
      const signedUrl = await uploadUrlAction({ token });
      const response = await fetch(signedUrl, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!response.ok) throw new Error("PDF upload failed.");
      const { storageId } = await response.json() as { storageId: Id<"_storage"> };
      const draft = await createDraft({ token, storageId, fileName: file.name, effectiveStart, effectiveEnd, entries: monthlyEntries });
      setSelectedId(draft.rosterId);
      setStart(effectiveStart);
      setEnd(effectiveEnd);
      setEntries(monthlyEntries);
      setFile(null);
      setPreviewUrl(draft.storageUrl);
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
      toast.success(extractedEntries.length ? `PDF uploaded. Extracted ${extractedEntries.length} daily assignments; review each before publishing.` : "PDF uploaded. No reliable text assignments were extracted; enter the schedule from the PDF preview.");
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith("SESSION_EXPIRED")) expireSession();
      toast.error("Could not upload roster", { description: message });
    } finally { setBusy(false); }
  };

  const uploadExcel = async () => {
    if (!token || !file || !workbook || !parsedSheetName) return;
    setBusy(true);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sourceHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const uploadUrl = await uploadUrlAction({ token, sourceHash });
      const contentType = file.name.toLowerCase().endsWith(".xls") ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": contentType }, body: file });
      if (!response.ok) throw new Error("Excel workbook upload failed.");
      const { storageId } = await response.json() as { storageId: Id<"_storage"> };
      const expectedPeriod = monthPeriod(rosterMonth);
      const effectiveStart = expectedPeriod?.start ?? start;
      const effectiveEnd = expectedPeriod?.end ?? end;
      const reviewedEntries = [...entries].filter((entry) => entry.date.slice(0, 7) === rosterMonth).sort((a, b) => a.date.localeCompare(b.date));
      const draft = await createDraft({ token, storageId, fileName: file.name, effectiveStart, effectiveEnd, entries: reviewedEntries, sourceHash, importIssues });
      setSelectedId(draft.rosterId);
      setEntries(reviewedEntries);
      setStart(effectiveStart);
      setEnd(effectiveEnd);
      setFile(null);
      setWorkbook(null);
      setParsedSheetName("");
      setPreviewUrl(draft.storageUrl);
      setExcelPreviewUrl(null);
      if (excelRef.current) excelRef.current.value = "";
      await refresh();
      toast.success(`Excel roster saved as a draft with ${reviewedEntries.length} imported assignments. Review and publish when ready.`);
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith("SESSION_EXPIRED")) expireSession();
      toast.error("Could not upload Excel roster", { description: message });
    } finally { setBusy(false); }
  };

  const openDraft = (row: Roster) => {
    setSelectedId(row._id);
    setFile(null);
    setWorkbook(null);
    setParsedSheetName("");
    setImportIssues(row.importIssues ?? []);
    setStart(row.effectiveStart);
    setEnd(row.effectiveEnd);
    const month = inferRosterMonth(row.entries, row.effectiveStart, row.effectiveEnd);
    monthManuallySelected.current = true;
    setRosterMonth(month);
    const period = monthPeriod(month);
    const isSingleMonth = row.effectiveStart.slice(0, 7) === row.effectiveEnd.slice(0, 7);
    const normalized = isSingleMonth ? completeMonthlyEntries(month, staff, row.entries).entries : row.entries;
    setEntries(isSingleMonth ? normalized.filter((entry) => entry.date.slice(0, 7) === month) : [...row.entries].sort((a, b) => a.date.localeCompare(b.date)));
    if (isSingleMonth && period && month === "2026-10" && (row.effectiveStart !== period.start || row.effectiveEnd !== period.end || row.entries.some((entry) => entry.date === "2026-09-30"))) {
      setStart(period.start);
      setEnd(period.end);
      const nextIssues = [...new Set([...(row.importIssues ?? []), "Corrected the October 2026 editing period to 01-10-2026 through 31-10-2026 and removed the 30-09-2026 entry from this editor."])];
      setImportIssues(nextIssues);
      if (token) {
        void saveDraft({ token, rosterId: row._id, effectiveStart: period.start, effectiveEnd: period.end, entries: normalized.filter((entry) => entry.date.slice(0, 7) === month), importIssues: nextIssues })
          .then(() => refresh())
          .then(() => toast.success("Corrected the October 2026 draft to 31 daily rows; no assignments were shifted."))
          .catch((error) => toast.error("Could not persist the October draft correction", { description: errorMessage(error) }));
      }
    }
    setPreviewUrl(row.originalUrl);
    setExcelPreviewUrl(null);
  };
  const updateEntry = (index: number, patch: Partial<Entry>) => setEntries((current) => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  const changeOfficeStaff = (index: number, officeStaff: string) => setEntries((current) => current.map((entry, i) => i === index
    ? { ...entry, officeStaff, fieldStaff: canonicalStaffName(officeStaff, staff) ? assignFieldStaff(officeStaff, staff) : [] }
    : entry));
  const changeMonth = (month: string) => {
    const period = monthPeriod(month);
    if (!period) return;
    const completed = completeMonthlyEntries(month, staff, entries);
    monthManuallySelected.current = true;
    setRosterMonth(month);
    setStart(period.start);
    setEnd(period.end);
    setEntries(completed.entries.filter((entry) => entry.date.slice(0, 7) === month));
    if (completed.removedOctoberExtra) setImportIssues((current) => [...current, "Removed the erroneous 2026-09-30 entry; October dates and assignments were not shifted."]);
  };
  const saveCurrentDraft = async () => {
    if (!token || !selected || selected.status !== "draft" || busy) return;
    setBusy(true);
    try {
      await saveDraft({ token, rosterId: selected._id, effectiveStart: start, effectiveEnd: end, entries, importIssues });
      await refresh();
      toast.success("Roster draft saved with the current edited assignments.");
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith("SESSION_EXPIRED")) expireSession();
      toast.error("Could not save roster draft", { description: message });
    } finally { setBusy(false); }
  };
  const forcePublish = async () => {
    if (!token || !forcePublishTarget || busy) return;
    const target = forcePublishTarget;
    const targetStart = selectedId === target._id ? start : target.effectiveStart;
    const targetEnd = selectedId === target._id ? end : target.effectiveEnd;
    const overlappingIds = rows
      .filter((row) => row.status === "published" && row._id !== target._id && row.effectiveStart <= targetEnd && row.effectiveEnd >= targetStart)
      .map((row) => row._id);
    setBusy(true);
    try {
      if (selectedId === target._id) await saveDraft({ token, rosterId: target._id, effectiveStart: start, effectiveEnd: end, entries, importIssues });
      const result = await forcePublishAction({ token, rosterId: target._id, confirmedReplaceIds: overlappingIds });
      setSelectedId(null);
      setForcePublishTarget(null);
      const superseded = result.superseded.length
        ? ` Superseded: ${result.superseded.map((row) => row.fileName).join(", ")}.`
        : " No existing roster was superseded.";
      toast.success(`${result.alreadyPublished ? "Roster was already published" : "Roster published"}: ${result.fileName} · ${result.dateCount} dates · ${result.effectiveStart} to ${result.effectiveEnd}.${superseded}`);
      try {
        await refresh();
      } catch (error) {
        toast.error("Publication succeeded, but the Admin roster list could not refresh", { description: errorMessage(error) });
      }
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith("SESSION_EXPIRED")) expireSession();
      toast.error("Roster not published", { description: message });
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!token || !selected) return;
    setBusy(true);
    try {
      await publishAction({ token, rosterId: selected._id, entries, effectiveStart: start, effectiveEnd: end, ...(replaceId ? { replacePublishedId: replaceId as Id<"rosters"> } : {}) });
      await refresh();
      setSelectedId(null);
      toast.success("Duty roster published.");
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith("SESSION_EXPIRED")) expireSession();
      toast.error("Roster not published", { description: message });
    } finally { setBusy(false); }
  };
  const archive = async (rosterId: Id<"rosters">) => {
    if (!token) return;
    try { await archiveAction({ token, rosterId }); await refresh(); toast.success("Roster archived."); }
    catch (error) { const message = errorMessage(error); if (message.startsWith("SESSION_EXPIRED")) expireSession(); toast.error(message); }
  };
  const deleteRoster = async () => {
    if (!token || !deleteTarget || deletingId) return;
    const target = deleteTarget;
    setDeletingId(target._id);
    try {
      await removeRosterAction({ token, rosterId: target._id });
      setRows((current) => current.filter((row) => row._id !== target._id));
      if (selectedId === target._id) {
        setSelectedId(null);
        setEntries([]);
        setPreviewUrl(null);
        setImportIssues([]);
      }
      setDeleteTarget(null);
      toast.success(`Deleted roster “${target.fileName}”.`);
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith("SESSION_EXPIRED")) expireSession();
      toast.error("Could not delete roster", { description: message });
    } finally { setDeletingId(null); }
  };

  return (
    <section className="space-y-5">
      <header>
        <h2 className="font-title text-xl font-bold uppercase tracking-tight">DUTY ROSTER MANAGEMENT</h2>
        <p className="text-sm text-muted-foreground">Import a workbook for automatic date-wise prefill, or upload the original roster PDF. Review and correct assignments using active staff records before publishing; unreadable and uncertain rows remain flagged for manual review.</p>
      </header>
      <div className="grid gap-4 rounded-md border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1 text-sm"><span>Roster month</span><Input type="month" value={rosterMonth} onChange={(event) => changeMonth(event.target.value)} /></label>
        <div className="space-y-1 text-sm"><span>Effective period</span><p className="h-9 rounded-md border border-input bg-muted/40 px-3 py-2 tabular-nums">{start} – {end}</p></div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => choosePdf(event.target.files?.[0])} />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><FileText className="size-4" />Choose PDF</Button>
          <Button type="button" onClick={() => void uploadPdf()} disabled={!file || !file.name.toLowerCase().endsWith(".pdf") || busy}><UploadCloud className="size-4" />{busy ? "Uploading…" : "Upload duty roster PDF"}</Button>
          <Button type="button" variant="outline" onClick={() => excelRef.current?.click()}><FileSpreadsheet className="size-4" />Upload Excel Roster</Button>
        </div>
        {file && <p className="text-xs text-muted-foreground sm:col-span-3">Selected: {file.name}. Original file is retained unchanged.</p>}
      </div>
      <input ref={excelRef} type="file" accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => void chooseExcel(event.target.files?.[0])} />
      {workbook && file && <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4"><div className="min-w-56 flex-1 space-y-1 text-sm"><label htmlFor="roster-worksheet">Workbook worksheet</label><select id="roster-worksheet" value={sheetName} onChange={(event) => setSheetName(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3">{workbook.SheetNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></div><Button type="button" variant="outline" onClick={() => reviewWorksheet(workbook, sheetName)} disabled={busy}><FileSpreadsheet className="size-4" />Review worksheet</Button><a href={excelPreviewUrl ?? undefined} download={file.name} className="text-sm font-medium text-primary underline">Download original workbook</a></div>}
      {previewUrl && selected && <div className="overflow-hidden rounded-md border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm"><span className="font-medium">{selected.fileName}</span><a className="text-primary underline" href={previewUrl} target="_blank" rel="noopener noreferrer">Open / download original</a></div>{selected.fileName.toLowerCase().endsWith(".pdf") && <iframe title="Duty roster PDF preview" src={previewUrl} className="h-[420px] w-full" />}</div>}
      {(selected?.status === "draft" || (workbook !== null && parsedSheetName !== "") || (workbook !== null && importIssues.length > 0)) && <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div><h3 className="font-semibold">Review daily staffing · {selected?.fileName ?? `${file?.name} · ${parsedSheetName || "choose worksheet"}`}</h3><p className="text-xs text-muted-foreground">Imported assignments remain editable. October 2026 uses exactly 01–31 October; out-of-month source rows are flagged and omitted without shifting assignments. Change one office selection to update only that date’s other active VFAs.</p></div>
        {importIssues.length > 0 && <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><p className="font-semibold">Source rows need review · {importIssues.length} issue{importIssues.length === 1 ? "" : "s"}</p><ul className="max-h-40 list-inside list-disc overflow-y-auto">{importIssues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul></div>}
        {staff.length === 0 && <p className="text-sm text-destructive">No active personnel names are available; publication is blocked until valid personnel records exist.</p>}
        {workbook && entries.length > 0 && <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-muted/70"><tr><th className="p-2">Date</th><th className="p-2">Dispensary duty</th><th className="p-2">Vaccination / field duty</th><th className="p-2">Review</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={`preview-${entry.date}-${index}`} className="border-t border-border"><td className="p-2">{entry.date}</td><td className="p-2">{entry.officeStaff || "—"}</td><td className="p-2">{entry.fieldStaff.join(", ") || "—"}</td><td className="p-2 text-xs">{assignmentErrors(entry, staff, entries, start, end).join(" ") || "Ready"}</td></tr>)}</tbody></table></div>}
        <div className="space-y-3">{entries.map((entry, index) => {
          const errors = assignmentErrors(entry, staff, entries, start, end);
          return <div key={`${entry.date}-${index}`} className={`grid gap-2 rounded border p-3 sm:grid-cols-[110px_1fr_1.5fr] sm:items-center ${errors.length ? "border-destructive/50 bg-destructive/5" : "border-border/70"}`}>
            <div className="space-y-1 text-sm"><Input aria-label={`Duty date row ${index + 1}`} type="date" value={entry.date} onChange={(event) => updateEntry(index, { date: event.target.value })} className="h-8 px-2" /><div className="text-xs text-muted-foreground">{weekdayForDate(entry.date)}</div>{errors.map((error) => <div key={error} className="mt-1 text-xs text-destructive">{error}</div>)}</div>
            <label className="space-y-1 text-xs"><span>Office / dispensary</span><select value={entry.officeStaff} onChange={(event) => changeOfficeStaff(index, event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="">Select VFA</option>{staff.map((person) => <option key={person} value={person}>{person}</option>)}</select></label>
            <div className="space-y-1 text-xs"><span>Vaccination / field duty · automatically assigned (3)</span><div className="min-h-9 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm leading-6">{entry.fieldStaff.length ? entry.fieldStaff.join(", ") : "Select a recognized office-duty VFA to fill the other active staff."}</div></div>
          </div>;
        })}</div>
        {entries.length === 0 && <p className="text-sm text-destructive">No date rows were found. Select the effective period above, then add assignment rows for manual completion.</p>}
        {workbook && !selected && entries.length === 0 && <Button type="button" variant="outline" onClick={() => setEntries(datesInRange(start, end).map((date) => ({ date, officeStaff: "", fieldStaff: [] })))}>Create manual date rows for this period</Button>}
        <p className="text-xs text-muted-foreground">Distribution summary: {entries.length} roster dates · {entries.filter((entry) => entry.officeStaff.trim()).length} office assignments · {entries.reduce((total, entry) => total + entry.fieldStaff.length, 0)} field assignments entered.</p>
        {publishedOverlaps.length > 0 && <label className="block max-w-xl space-y-1 text-sm"><span>Existing published roster overlaps. Select the version to replace:</span><select value={replaceId} onChange={(event) => setReplaceId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3"><option value="">Choose published version…</option>{publishedOverlaps.map((row) => <option key={row._id} value={row._id}>{row.fileName} · {row.effectiveStart} to {row.effectiveEnd}</option>)}</select></label>}
        {workbook && !selected && <Button onClick={() => void uploadExcel()} disabled={busy || !parsedSheetName}>{busy ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}Save Excel draft for review</Button>}
        {selected?.status === "draft" && <div className="flex flex-wrap gap-3 border-t border-border pt-3">
          <Button type="button" variant="outline" onClick={() => void saveCurrentDraft()} disabled={busy}>Save Draft</Button>
          <Button onClick={() => void publish()} disabled={busy || !entries.length || !staff.length || entries.some((entry) => assignmentErrors(entry, staff, entries, start, end).length > 0) || (publishedOverlaps.length > 0 && !replaceId)}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Publish / replace reviewed roster</Button>
          <Button type="button" variant="destructive" className="font-bold" onClick={() => setForcePublishTarget(selected)} disabled={busy || !selected.entries.length}>
            <ShieldAlert className="size-4" /> PUBLISH ROSTER ANYWAY
          </Button>
        </div>}
      </div>}
      <div className="overflow-x-auto rounded-md border border-border bg-card"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/70"><tr><th className="p-3">Roster</th><th className="p-3">Effective period</th><th className="p-3">Status</th><th className="p-3">Uploaded / published</th><th className="p-3">Controls</th></tr></thead><tbody>{rows.map((row) => <tr key={row._id} className="border-t border-border"><td className="p-3"><div>{row.fileName}</div>{Boolean(row.importIssues?.length) && <details className="mt-1 max-w-sm text-xs text-amber-700"><summary className="cursor-pointer font-medium">{row.importIssues!.length} retained import warning{row.importIssues!.length === 1 ? "" : "s"} · review</summary><ul className="mt-1 max-h-36 list-inside list-disc overflow-y-auto">{row.importIssues!.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul></details>}</td><td className="p-3">{row.effectiveStart} – {row.effectiveEnd}</td><td className="p-3 capitalize">{row.status}</td><td className="p-3">{format(row.publishedAt ?? row.uploadedAt, "d MMM yyyy, hh:mm a")}</td><td className="space-x-2 p-3">{row.originalUrl && <a href={row.originalUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">View original file</a>}{row.status === "draft" && <Button size="sm" variant="outline" onClick={() => openDraft(row)}>Review</Button>}{row.status === "published" && <Button size="sm" variant="outline" onClick={() => void archive(row._id)}><Archive className="size-3" />Archive</Button>}<Button size="sm" variant="destructive" onClick={() => setDeleteTarget(row)} disabled={deletingId === row._id}><Trash2 className="size-3" />Delete</Button></td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-5 text-center text-sm text-muted-foreground">No rosters uploaded yet.</p>}      </div>
      <AlertDialog open={forcePublishTarget !== null} onOpenChange={(open) => { if (!open && !busy) setForcePublishTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force-publish imported roster?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>The saved imported assignments will be published verbatim, without replacing staff names or applying the personnel directory. Existing import warnings will remain available in Admin.</p>
                <p><span className="font-medium text-foreground">Roster:</span> {forcePublishTarget?.fileName}</p>
                <p><span className="font-medium text-foreground">Effective period:</span> {forcePublishTarget?.effectiveStart} – {forcePublishTarget?.effectiveEnd}</p>
                <p><span className="font-medium text-foreground">Imported dates:</span> {forcePublishTarget?.entries.length}</p>
                {rows.filter((row) => row.status === "published" && row._id !== forcePublishTarget?._id && row.effectiveStart <= (selectedId === forcePublishTarget?._id ? end : forcePublishTarget?.effectiveEnd ?? "") && row.effectiveEnd >= (selectedId === forcePublishTarget?._id ? start : forcePublishTarget?.effectiveStart ?? "")).length > 0 && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive"><p className="font-semibold">This roster supersedes existing published coverage on overlapping dates. Previous rosters and original files will be retained:</p><ul className="mt-1 list-inside list-disc">{rows.filter((row) => row.status === "published" && row._id !== forcePublishTarget?._id && row.effectiveStart <= (selectedId === forcePublishTarget?._id ? end : forcePublishTarget?.effectiveEnd ?? "") && row.effectiveEnd >= (selectedId === forcePublishTarget?._id ? start : forcePublishTarget?.effectiveStart ?? "")).map((row) => <li key={row._id}>{row.fileName} ({row.effectiveStart} – {row.effectiveEnd})</li>)}</ul></div>}
                <p>Only the roster status and publication audit are updated; vaccination and request data are untouched.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void forcePublish(); }} disabled={busy} className="bg-destructive text-white hover:bg-destructive/90">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
              {busy ? "Publishing…" : "Confirm force publish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deletingId) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete uploaded roster?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p><span className="font-medium text-foreground">Filename:</span> {deleteTarget?.fileName}</p>
                <p><span className="font-medium text-foreground">Effective period:</span> {deleteTarget?.effectiveStart} – {deleteTarget?.effectiveEnd}</p>
                <p><span className="font-medium text-foreground">Current status:</span> <span className="capitalize">{deleteTarget?.status}</span></p>
                {deleteTarget?.status === "published" && <p className="font-medium text-destructive">Warning: deleting a published roster will remove it from the public dashboard immediately.</p>}
                <p>This permanently deletes this roster and its reviewed assignments. Other rosters and vaccination/personnel data are not affected.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void deleteRoster(); }} disabled={deletingId !== null} className="bg-destructive text-white hover:bg-destructive/90">
              {deletingId ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {deletingId ? "Deleting…" : "Delete roster"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
