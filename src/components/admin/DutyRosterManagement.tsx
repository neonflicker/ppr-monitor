import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import { useAction } from "convex/react";
import { format } from "date-fns";
import { Archive, FileText, Loader2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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
  pdfUrl: string | null;
};

function datesInRange(start: string, end: string): string[] {
  const result: string[] = [];
  const date = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (date <= last && result.length < 370) {
    result.push(format(date, "yyyy-MM-dd"));
    date.setDate(date.getDate() + 1);
  }
  return result;
}

export default function DutyRosterManagement() {
  const { token, expireSession } = useAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadUrlAction = useAction(api.dutyRosters.createUploadUrl);
  const createDraft = useAction(api.dutyRosters.createDraft);
  const listAction = useAction(api.dutyRosters.list);
  const personnelAction = useAction(api.dutyRosters.personnel);
  const publishAction = useAction(api.dutyRosters.publish);
  const archiveAction = useAction(api.dutyRosters.archive);
  const [rows, setRows] = useState<Roster[]>([]);
  const [staff, setStaff] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [start, setStart] = useState(format(new Date(), "yyyy-MM-01"));
  const [end, setEnd] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedId, setSelectedId] = useState<Id<"rosters"> | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [replaceId, setReplaceId] = useState<string>("");
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

  const chooseFile = (next: File | undefined) => {
    if (!next) return;
    if (next.type !== "application/pdf" && !next.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Choose a PDF file.");
      return;
    }      setFile(next);
      setPreviewUrl((current) => { if (current?.startsWith("blob:")) URL.revokeObjectURL(current); return URL.createObjectURL(next); });
  };

  const upload = async () => {
    if (!token || !file) return;
    setBusy(true);
    try {
      const signedUrl = await uploadUrlAction({ token });
      const response = await fetch(signedUrl, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!response.ok) throw new Error("PDF upload failed.");
      const { storageId } = await response.json() as { storageId: Id<"_storage"> };
      const draft = await createDraft({ token, storageId, fileName: file.name, effectiveStart: start, effectiveEnd: end });
      setSelectedId(draft.rosterId);
      setEntries(datesInRange(start, end).map((date) => ({ date, officeStaff: "", fieldStaff: [] })));
      setFile(null);
      setPreviewUrl(draft.storageUrl);
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
      toast.success("PDF uploaded. Review every day’s staffing before publication.");
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith("SESSION_EXPIRED")) expireSession();
      toast.error("Could not upload roster", { description: message });
    } finally { setBusy(false); }
  };

  const openDraft = (row: Roster) => {
    setSelectedId(row._id);
    setStart(row.effectiveStart);
    setEnd(row.effectiveEnd);
    setEntries(row.entries.length ? row.entries : datesInRange(row.effectiveStart, row.effectiveEnd).map((date) => ({ date, officeStaff: "", fieldStaff: [] })));
    setPreviewUrl(row.pdfUrl);
  };

  const updateEntry = (index: number, patch: Partial<Entry>) => setEntries((current) => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  const publish = async () => {
    if (!token || !selected) return;
    setBusy(true);
    try {
      await publishAction({ token, rosterId: selected._id, entries, ...(replaceId ? { replacePublishedId: replaceId as Id<"rosters"> } : {}) });
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

  return (
    <section className="space-y-5">
      <header>
        <h2 className="font-title text-xl font-bold uppercase tracking-tight">DUTY ROSTER MANAGEMENT</h2>
        <p className="text-sm text-muted-foreground">Upload the original roster PDF, then review the daily assignments. Text extraction is not assumed; nothing is published until all staffing is reviewed and validated.</p>
      </header>
      <div className="grid gap-4 rounded-md border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1 text-sm"><span>Effective from</span><Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className="space-y-1 text-sm"><span>Effective through</span><Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><FileText className="size-4" />Choose PDF</Button>
          <Button type="button" onClick={() => void upload()} disabled={!file || busy}><UploadCloud className="size-4" />{busy ? "Uploading…" : "Upload duty roster PDF"}</Button>
        </div>
        {file && <p className="text-xs text-muted-foreground sm:col-span-3">Selected: {file.name}. Upload stores the untouched original PDF.</p>}
      </div>
      {previewUrl && <div className="overflow-hidden rounded-md border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm"><span className="font-medium">PDF preview · {selected?.fileName ?? file?.name}</span><a className="text-primary underline" href={previewUrl} target="_blank" rel="noreferrer">Open full PDF</a></div><iframe title="Duty roster PDF preview" src={previewUrl} className="h-[420px] w-full" />{!selected && file && <Button className="m-3" onClick={() => void upload()} disabled={busy}>Upload this PDF to begin review</Button>}</div>}
      {selected?.status === "draft" && <div className="space-y-3 rounded-md border border-border bg-card p-4">
        <div><h3 className="font-semibold">Review daily staffing · {selected.fileName}</h3><p className="text-xs text-muted-foreground">Select one office-duty VFA and exactly three distinct field-duty VFAs per date. Staff options come from current PPR personnel records.</p></div>
        {staff.length === 0 && <p className="text-sm text-destructive">No active personnel names are available from PPR records; publication is blocked until valid staff records exist.</p>}
        <div className="space-y-3">{entries.map((entry, index) => <div key={entry.date} className="grid gap-2 rounded border border-border/70 p-3 sm:grid-cols-[110px_1fr_1.5fr] sm:items-center"><div className="text-sm"><strong>{entry.date}</strong><div className="text-xs text-muted-foreground">{format(new Date(`${entry.date}T12:00:00`), "EEEE")}</div></div><label className="space-y-1 text-xs"><span>Office / dispensary</span><select value={entry.officeStaff} onChange={(event) => updateEntry(index, { officeStaff: event.target.value })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="">Select VFA</option>{staff.map((person) => <option key={person} value={person}>{person}</option>)}</select></label><label className="space-y-1 text-xs"><span>Field duty · comma-separated names (3)</span><Input list="roster-staff" value={entry.fieldStaff.join(", ")} onChange={(event) => updateEntry(index, { fieldStaff: event.target.value.split(",").map((name) => name.trim()).filter(Boolean) })} placeholder="Choose 3 names from active personnel" /></label></div>)}</div>
        <datalist id="roster-staff">{staff.map((person) => <option key={person} value={person} />)}</datalist>
        <p className="text-xs text-muted-foreground">Distribution summary: {entries.length} roster dates · {entries.length} office-duty assignments · {entries.reduce((total, row) => total + row.fieldStaff.length, 0)} field-duty assignments entered. The expected total is three field staff per date.</p>
        {publishedOverlaps.length > 0 && <label className="block max-w-xl space-y-1 text-sm"><span>Existing published roster overlaps. Select the exact version to replace:</span><select value={replaceId} onChange={(event) => setReplaceId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3"><option value="">Choose published version…</option>{publishedOverlaps.map((row) => <option key={row._id} value={row._id}>{row.fileName} · {row.effectiveStart} to {row.effectiveEnd}</option>)}</select></label>}
        <Button onClick={() => void publish()} disabled={busy || !entries.length || !staff.length || (publishedOverlaps.length > 0 && !replaceId)}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Publish / replace reviewed roster</Button>
      </div>}
      <div className="overflow-x-auto rounded-md border border-border bg-card"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/70"><tr><th className="p-3">Roster</th><th className="p-3">Effective period</th><th className="p-3">Status</th><th className="p-3">Uploaded / published</th><th className="p-3">Controls</th></tr></thead><tbody>{rows.map((row) => <tr key={row._id} className="border-t border-border"><td className="p-3">{row.fileName}</td><td className="p-3">{row.effectiveStart} – {row.effectiveEnd}</td><td className="p-3 capitalize">{row.status}</td><td className="p-3">{format(row.publishedAt ?? row.uploadedAt, "d MMM yyyy, hh:mm a")}</td><td className="space-x-2 p-3">{row.pdfUrl && <a href={row.pdfUrl} target="_blank" rel="noreferrer" className="text-primary underline">View PDF</a>}{row.status === "draft" && <Button size="sm" variant="outline" onClick={() => openDraft(row)}>Review</Button>}{row.status === "published" && <Button size="sm" variant="outline" onClick={() => void archive(row._id)}><Archive className="size-3" />Archive</Button>}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-5 text-center text-sm text-muted-foreground">No rosters uploaded yet.</p>}</div>
    </section>
  );
}
