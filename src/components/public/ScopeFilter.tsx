import { Button } from "@/components/ui/button";
import { Filter, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface Scope {
  user: string; // "ALL" or user key
  village: string; // "ALL" or village key
}

export interface ScopeUser {
  key: string;
  name: string;
  target: number;
  villages: string[];
}

export interface ScopeData {
  available: boolean;
  users: ScopeUser[];
  /** normalised village key → display name (active allocation) */
  villageNames: Record<string, string>;
  /** normalised village key → total allocated target */
  villageTargets: Record<string, number>;
}

interface Props {
  scope: Scope;
  onChange: (next: Scope) => void;
  data: ScopeData;
}

/**
 * USER + ALLOTTED VILLAGE public filter bar.
 * Defaults are ALL USERS / ALL VILLAGES; the village list is dependent on the
 * selected user. Nothing here is hardcoded — everything comes from the active
 * allocation import.
 */
export default function ScopeFilter({ scope, onChange, data }: Props) {
  const selectedUser =
    scope.user !== "ALL" ? data.users.find((u) => u.key === scope.user) : undefined;

  // Dependent village list: only villages allotted to the selected user.
  const villageOptions =
    scope.user === "ALL"
      ? Object.entries(data.villageNames)
      : (selectedUser?.villages ?? []).map((key) => [key, data.villageNames[key] ?? key]);

  const viewingLabel = (() => {
    const userLabel =
      scope.user === "ALL"
        ? "All Users"
        : (selectedUser?.name ?? scope.user);
    const villageLabel =
      scope.village === "ALL"
        ? scope.user === "ALL"
          ? "All Villages"
          : "All Allotted Villages"
        : (data.villageNames[scope.village] ?? scope.village);
    return `${userLabel} · ${villageLabel}`;
  })();

  const isFiltered = scope.user !== "ALL" || scope.village !== "ALL";

  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[190px] flex-1 space-y-1 sm:max-w-[240px]">
          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            User
          </label>
          <Select
            value={scope.user}
            onValueChange={(value) =>
              onChange({ user: value, village: "ALL" })
            }
          >
            <SelectTrigger className="h-10 w-full text-sm">
              <SelectValue placeholder="ALL USERS" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL USERS</SelectItem>
              {data.users.map((user) => (
                <SelectItem key={user.key} value={user.key}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[190px] flex-1 space-y-1 sm:max-w-[240px]">
          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Allotted Village
          </label>
          <Select
            value={scope.village}
            onValueChange={(value) => onChange({ ...scope, village: value })}
          >
            <SelectTrigger className="h-10 w-full text-sm">
              <SelectValue placeholder="ALL VILLAGES" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">
                {scope.user === "ALL" ? "ALL VILLAGES" : "ALL ALLOTTED VILLAGES"}
              </SelectItem>
              {villageOptions.map(([key, name]) => (
                <SelectItem key={key} value={key}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isFiltered && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange({ user: "ALL", village: "ALL" })}
          >
            <X className="size-4" />
            Clear Filters
          </Button>
        )}

        <div className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Filter className="size-3.5" />
          {data.available ? "Scope from allocation file" : "No allocation file yet"}
        </div>
      </div>

      <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
        VIEWING:{" "}
        <span className="font-semibold text-foreground">{viewingLabel}</span>
      </p>
    </div>
  );
}
