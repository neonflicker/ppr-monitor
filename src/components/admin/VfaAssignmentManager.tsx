import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import { useAction } from "convex/react";
import { Loader2, Save, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type AssignmentOptions = { staff: string[]; rows: Array<{ village: string; normalizedVillage: string; candidates: string[]; assigned: string[] }> };

export default function VfaAssignmentManager() {
  const { token, expireSession } = useAdmin();
  const fetchOptions = useAction(api.adminAuth.villageVfaAssignmentOptions);
  const save = useAction(api.adminAuth.saveVillageVfaAssignment);
  const [data, setData] = useState<AssignmentOptions | null>(null);
  const [village, setVillage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    void fetchOptions({ token }).then((options) => setData(options)).catch((error) => {
      const message = errorMessage(error);
      if (message.startsWith("SESSION_EXPIRED")) expireSession();
      toast.error("Could not load assignments", { description: message });
    });
  }, [token, fetchOptions, expireSession]);

  const toggle = (name: string) => setSelected((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  const edit = (row: NonNullable<typeof data>["rows"][number]) => {
    setVillage(row.village);
    setSelected(row.assigned.length ? row.assigned : row.candidates.length === 1 ? row.candidates : []);
  };
  const submit = async () => {
    if (!token) { expireSession(); return; }
    setBusy(true);
    try {
      await save({ token, village, vfaNames: selected });
      setVillage(""); setSelected([]);
      setData(await fetchOptions({ token }));
      toast.success(selected.length > 1 ? "Multiple VFAs saved; requests will show Admin review needed." : selected.length ? "Village VFA assignment saved." : "Village saved as not assigned.");
    } catch (error) {
      const message = errorMessage(error);
      if (message.startsWith("SESSION_EXPIRED")) expireSession();
      toast.error("Assignment not saved", { description: message });
    } finally { setBusy(false); }
  };

  return <section className="space-y-4">
    <header><h2 className="font-title text-xl font-bold uppercase tracking-tight">Village-to-VFA assignments</h2><p className="text-sm text-muted-foreground">Existing User &amp; Village Allocation rows are shown as candidates. Confirm one VFA, leave unassigned, or preserve multiple names to flag ambiguity rather than selecting randomly.</p></header>
    {!data ? <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin" /></div> : <>
      <div className="rounded-md border border-border bg-card p-4">
        <label className="block max-w-xl space-y-1 text-sm"><span>Village name (case and extra spaces are normalized)</span><Input value={village} onChange={(event) => setVillage(event.target.value)} placeholder="Enter village" /></label>
        <div className="mt-3 flex flex-wrap gap-2">{data.staff.map((name) => <label key={name} className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-sm"><input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} />{name}</label>)}</div>
        <p className="mt-2 text-xs text-muted-foreground">No selection means “Not Assigned”; selecting more than one deliberately marks an ambiguous assignment for Admin review.</p>
        <Button className="mt-3" onClick={() => void submit()} disabled={busy || !village.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save assignment</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-card"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-muted/70"><tr><th className="p-3">Village</th><th className="p-3">Allocation candidates</th><th className="p-3">Admin assignment</th><th className="p-3">Edit</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.normalizedVillage} className="border-t border-border"><td className="p-3">{row.village}</td><td className="p-3">{row.candidates.join(", ") || "—"}</td><td className="p-3">{row.assigned.length > 1 ? <span className="text-amber-700">Ambiguous: {row.assigned.join(", ")}</span> : row.assigned[0] ?? (row.candidates.length === 1 ? row.candidates[0] : row.candidates.length ? <span className="text-amber-700">Ambiguous · Admin review</span> : "Not Assigned")}</td><td className="p-3"><Button size="sm" variant="outline" onClick={() => edit(row)}><Users className="size-3" />Review</Button></td></tr>)}</tbody></table>{data.rows.length === 0 && <p className="p-5 text-center text-sm text-muted-foreground">No village assignments imported yet. Add an explicit assignment above.</p>}</div>
    </>}
  </section>;
}
