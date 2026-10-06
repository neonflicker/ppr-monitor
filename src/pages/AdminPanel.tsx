import AdminStatus from "@/components/admin/AdminStatus";
import BharatUpload from "@/components/admin/BharatUpload";
import DataValidation from "@/components/admin/DataValidation";
import ImportHistory from "@/components/admin/ImportHistory";
import NoticeManager from "@/components/admin/NoticeManager";
import TargetAllocation from "@/components/admin/TargetAllocation";
import UserVillageAllocation from "@/components/admin/UserVillageAllocation";
import { Mark } from "@/components/Mark";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAdmin } from "@/hooks/use-admin";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { format } from "date-fns";
import {
  Bell,
  ClipboardCheck,
  ExternalLink,
  History,
  Loader2,
  LogOut,
  Settings2,
  Target,
  UploadCloud,
  Users,
  Gauge,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

type TabId =
  | "status"
  | "upload"
  | "allocation"
  | "targets"
  | "history"
  | "validation"
  | "notices"
  | "settings";

const TABS: { id: TabId; label: string; icon: typeof Gauge }[] = [
  { id: "status", label: "Status", icon: Gauge },
  { id: "upload", label: "BharatPashudhan Import", icon: UploadCloud },
  { id: "allocation", label: "User & Village Allocation", icon: Users },
  { id: "targets", label: "Manual Village Targets", icon: Target },
  { id: "history", label: "Import History", icon: History },
  { id: "validation", label: "Data Validation", icon: ClipboardCheck },
  { id: "notices", label: "Notice Board", icon: Bell },
  { id: "settings", label: "Programme Configuration", icon: Settings2 },
];

export default function AdminPanel() {
  const { state, logout } = useAdmin();
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const overview = useQuery(api.stats.overview, { todayKey });
  const [tab, setTab] = useState<TabId>("status");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const adminName =
    state.status === "authenticated" ? state.admin.username : "Administrator";

  const body = (current: TabId): ReactNode => {
    if (!overview) {
      return (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      );
    }
    switch (current) {
      case "status":
        return <AdminStatus overview={overview} onOpenSettings={() => setTab("settings")} />;
      case "upload":
        return <BharatUpload overview={overview} />;
      case "allocation":
        return <UserVillageAllocation />;
      case "targets":
        return <TargetAllocation />;
      case "history":
        return <ImportHistory />;
      case "validation":
        return <DataValidation />;
      case "notices":
        return <NoticeManager />;
      case "settings":
        return (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-card p-5 text-sm">
              <p className="text-muted-foreground">
                Programme settings, district name, source sheet, PPR disease values,
                default wastage and the personnel classification lists used by the
                daily report.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Row label="Dispensary" value={overview.dispensaryName} />
                <Row label="District" value={`${overview.districtName}, ${overview.state}`} />
                <Row label="Vaccination start" value={overview.vaccinationStartDate ?? "Not set"} />
                <Row
                  label="Departmental personnel"
                  value={String(overview.personnelDepartmental.length)}
                />
                <Row
                  label="Semi-government personnel"
                  value={String(overview.personnelSemiGovernment.length)}
                />
                <Row
                  label="Private personnel"
                  value={String(overview.personnelPrivate.length)}
                />
                <Row label="Default wasted doses" value={String(overview.defaultWasted)} />
              </div>
              <div className="mt-4">
                <Button size="sm" onClick={() => setSettingsOpen(true)}>
                  <Settings2 className="size-4" />
                  Open settings
                </Button>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen">
      {/* ---------------- Header ---------------- */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Mark className="size-9 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-title text-base font-bold tracking-tight sm:text-lg">
                  ADMIN · PPR DATA MANAGEMENT
                </h1>
                <span className="sticker rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Restricted
                </span>
              </div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {overview?.dispensaryName ?? "Dispensary"} · {overview?.districtName ?? "District"}, {overview?.state ?? ""} · signed in as{" "}
                {adminName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link to="/">
                <ExternalLink className="size-4" />
                <span className="hidden sm:inline">View public dashboard</span>
                <span className="sm:hidden">Dashboard</span>
              </Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void logout()}>
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>

        {/* ---------------- Tabs ---------------- */}
        <div className="border-t border-border bg-background/95">
          <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-2 py-1.5 sm:px-6">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors",
                    tab === item.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {body(tab)}
      </main>

      {overview && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          overview={overview}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
