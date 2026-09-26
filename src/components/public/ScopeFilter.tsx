import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isUnallocated,
  needsUserSelection,
  resolveUserChange,
  resolveVillageChange,
  usersForVillage,
  viewingLabel,
  villageOptions,
  type Scope,
  type ScopeData,
} from "@/lib/scopeLink";
import { Filter, X } from "lucide-react";

export type { Scope, ScopeUser, ScopeData } from "@/lib/scopeLink";

interface Props {
  scope: Scope;
  onChange: (next: Scope) => void;
  data: ScopeData;
}

/**
 * USER + ALLOTTED VILLAGE public filter bar — a bidirectionally linked pair.
 *  · picking a USER narrows the village list to that user's allotments.
 *  · picking a VILLAGE resolves its allocated user automatically: one user →
 *    selected; several → SELECT USER with only those candidates; none →
 *    ALL USERS + an UNALLOCATED status.
 *  · ALL USERS clears the village; ALL VILLAGES keeps the user.
 * All relationships come from the active allocation import (§14) — nothing
 * here is hardcoded.
 */
export default function ScopeFilter({ scope, onChange, data }: Props) {
  const pendingUserSelection = needsUserSelection(scope, data);
  const unallocated = isUnallocated(scope, data);

  // Dependent village list: a named user only sees their own allotments; with
  // ALL USERS every allocation village (plus record-only villages) is offered.
  const options = villageOptions(data, scope.user);

  // While a multi-user village awaits an explicit choice, the USER dropdown
  // offers only the users actually assigned to that village (§5).
  const userOptions = pendingUserSelection
    ? usersForVillage(data, scope.village)
    : data.users;

  const label = viewingLabel(scope, data);

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
              onChange(resolveUserChange(scope, value, data))
            }
          >
            <SelectTrigger className="h-10 w-full text-sm">
              {pendingUserSelection ? (
                <span className="text-muted-foreground">SELECT USER</span>
              ) : (
                <SelectValue placeholder="ALL USERS" />
              )}
            </SelectTrigger>
            <SelectContent>
              {!pendingUserSelection && <SelectItem value="ALL">ALL USERS</SelectItem>}
              {userOptions.map((user) => (
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
            onValueChange={(value) =>
              onChange(resolveVillageChange(scope, value, data))
            }
          >
            <SelectTrigger className="h-10 w-full text-sm">
              <SelectValue placeholder="ALL VILLAGES" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">
                {scope.user === "ALL" ? "ALL VILLAGES" : "ALL ALLOTTED VILLAGES"}
              </SelectItem>
              {options.map(([key, name]) => (
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
        <span className="font-semibold text-foreground">{label}</span>
        {unallocated && (
          <span className="ml-2 inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wider text-amber-700">
            Unallocated
          </span>
        )}
      </p>
    </div>
  );
}
