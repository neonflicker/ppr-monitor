import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SettingsSource = {
  districtName: string;
  dispensaryName?: string;
  state: string;
  sheetUrl: string;
  sheetGid: string;
  requestSheetUrl: string;
  requestSheetGid: string;
  target: number | null;
  vaccinationStartDate: string | null;
  pprValues: string[];
};

export function SettingsDialog({
  open,
  onOpenChange,
  overview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overview: SettingsSource;
}) {
  const { token, expireSession } = useAdmin();
  const updateSettings = useAction(api.adminAuth.updateSettings);

  const [districtName, setDistrictName] = useState("");
  const [dispensaryName, setDispensaryName] = useState("");
  const [stateName, setStateName] = useState("");
  const [target, setTarget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetGid, setSheetGid] = useState("");
  const [requestSheetUrl, setRequestSheetUrl] = useState("");
  const [requestSheetGid, setRequestSheetGid] = useState("");
  const [pprValues, setPprValues] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDistrictName(overview.districtName);
      setDispensaryName(overview.dispensaryName ?? overview.districtName);
      setStateName(overview.state);
      setTarget(overview.target ? String(overview.target) : "");
      setStartDate(overview.vaccinationStartDate ?? "");
      setSheetUrl(overview.sheetUrl);
      setSheetGid(overview.sheetGid);
      setRequestSheetUrl(overview.requestSheetUrl);
      setRequestSheetGid(overview.requestSheetGid);
      setPprValues(overview.pprValues.join(", "));
      setError(null);
    }
    // Only re-seed when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = async () => {
    setError(null);
    if (!token) {
      expireSession();
      return;
    }
    const targetRaw = target.trim();
    const programmeTarget = targetRaw === "" ? 0 : Number(targetRaw);
    if (targetRaw !== "" && (!Number.isFinite(programmeTarget) || programmeTarget < 0)) {
      setError("Programme target must be a positive number.");
      return;
    }
    if (sheetUrl.trim() && !sheetUrl.trim().startsWith("https://docs.google.com/spreadsheets/")) {
      setError("Sheet URL must be a docs.google.com/spreadsheets link.");
      return;
    }
    if (
      requestSheetUrl.trim() &&
      !requestSheetUrl.trim().startsWith("https://docs.google.com/spreadsheets/")
    ) {
      setError("Request sheet URL must be a docs.google.com/spreadsheets link.");
      return;
    }

    setBusy(true);
    try {
      await updateSettings({
        token,
        districtName: districtName.trim(),
        dispensaryName: dispensaryName.trim(),
        state: stateName.trim(),
        sheetUrl: sheetUrl.trim(),
        sheetGid: sheetGid.trim(),
        requestSheetUrl: requestSheetUrl.trim(),
        requestSheetGid: requestSheetGid.trim(),
        programmeTarget,
        vaccinationStartDate: startDate.trim(),
        pprValues: pprValues
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0),
      });
      toast.success("Settings saved", {
        description: "Dashboard calculations now use the updated configuration.",
      });
      onOpenChange(false);
    } catch (err) {
      const message = errorMessage(err);
      if (message.startsWith("SESSION_EXPIRED")) {
        expireSession();
        toast.error("Session expired", { description: "Please sign in again." });
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-title tracking-tight">
            Data Configuration
          </DialogTitle>
          <DialogDescription>
            Programme target, source sheet and accepted PPR values. Changes apply
            to every dashboard calculation immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="target">Programme target (animals)</Label>
            <Input
              id="target"
              type="number"
              min={0}
              placeholder="e.g. 7250"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Total PPR vaccination target for the district. Leave empty to clear.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispensary">Dispensary name</Label>
            <Input
              id="dispensary"
              value={dispensaryName}
              onChange={(e) => setDispensaryName(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Operational unit shown across the dashboard and reports (e.g. SVD
              BOGINADI).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="district">District name</Label>
            <Input
              id="district"
              value={districtName}
              onChange={(e) => setDistrictName(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="startDate">Vaccination start date</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gid">Sheet tab GID (optional)</Label>
            <Input
              id="gid"
              placeholder="e.g. 0"
              value={sheetGid}
              onChange={(e) => setSheetGid(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sheetUrl">Google Sheet URL</Label>
            <Input
              id="sheetUrl"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              The sheet must be shared as “Anyone with the link → Viewer”.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="requestSheetGid">Request response tab GID</Label>
            <Input
              id="requestSheetGid"
              placeholder="e.g. 687692591"
              value={requestSheetGid}
              onChange={(e) => setRequestSheetGid(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="requestSheetUrl">Vaccination request response sheet URL</Label>
            <Input
              id="requestSheetUrl"
              value={requestSheetUrl}
              onChange={(e) => setRequestSheetUrl(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Used only to sync request responses. Share as “Anyone with the link → Viewer”.
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pprValues">Accepted PPR disease / vaccine values</Label>
            <Input
              id="pprValues"
              placeholder="PPR, PPR Vaccine, PPRV, PPR Vaccination"
              value={pprValues}
              onChange={(e) => setPprValues(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Comma separated. Only matching rows count towards PPR achievement.
              Leave empty to restore the defaults.
            </p>
          </div>
        </div>

        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save settings"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
