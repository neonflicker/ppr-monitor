/**
 * Bidirectional USER ↔ ALLOTTED VILLAGE linking for the public filter bar.
 *
 * Every transition is a pure, single-pass function: one handler call applies
 * at most one rule and returns the next Scope, so the two dropdowns can never
 * ping-pong into an update loop (village → user → village → …). All
 * relationships come from the active allocation import (ScopeData) — nothing
 * is hardcoded, so a new Excel/CSV upload changes the behaviour automatically.
 */

export interface Scope {
  /** "ALL" or an allocation user key */
  user: string;
  /** "ALL" or a normalised village key */
  village: string;
}

export interface ScopeUser {
  key: string;
  name: string;
  target: number;
  villages: string[];
}

export interface ScopeData {
  /** an allocation file has been imported */
  available: boolean;
  /** users from the active allocation file */
  users: ScopeUser[];
  /** normalised village key → display name (active allocation) */
  villageNames: Record<string, string>;
  /** normalised village key → total allocated target */
  villageTargets: Record<string, number>;
  /** normalised village key → display name for villages that have vaccination
   *  records but no allocation row. Selectable, but never assigned a user. */
  recordVillages?: Record<string, string>;
}

/** Users the active allocation file assigns to a village (§3, §14). */
export function usersForVillage(
  data: ScopeData,
  villageKey: string,
): ScopeUser[] {
  if (villageKey === "ALL") return [];
  return data.users.filter((u) => u.villages.includes(villageKey));
}

/**
 * Village options for the dropdown: allocation villages first (plus any
 * vaccination-record village that was never allocated, when no user is
 * selected). A named user only ever sees their own allotments (§6).
 */
export function villageOptions(
  data: ScopeData,
  userKey: string,
): [string, string][] {
  const options: [string, string][] = [];
  const seen = new Set<string>();
  const push = (key: string, name: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    options.push([key, name]);
  };

  if (userKey === "ALL") {
    for (const [key, name] of Object.entries(data.villageNames)) push(key, name);
    for (const [key, name] of Object.entries(data.recordVillages ?? {})) {
      push(key, name);
    }
    return options;
  }

  const user = data.users.find((u) => u.key === userKey);
  for (const key of user?.villages ?? []) {
    push(key, data.villageNames[key] ?? data.recordVillages?.[key] ?? key);
  }
  return options;
}

/**
 * USER dropdown changed (§6, §8, §9):
 *  · ALL USERS → village scope no longer exists → reset to ALL VILLAGES.
 *  · a named user → keep the selected village when that user is allocated to
 *    it (shared villages survive a user switch), otherwise reset to ALL.
 * Never re-enters the village rule, so no loops.
 */
export function resolveUserChange(
  prev: Scope,
  userKey: string,
  data: ScopeData,
): Scope {
  if (userKey === "ALL") return { user: "ALL", village: "ALL" };
  const user = data.users.find((u) => u.key === userKey);
  const keepVillage =
    prev.village !== "ALL" && (user?.villages ?? []).includes(prev.village);
  return { user: userKey, village: keepVillage ? prev.village : "ALL" };
}

/**
 * VILLAGE dropdown changed (§1, §4, §5, §8, §12):
 *  · ALL VILLAGES → keep the current user (§8).
 *  · the current user is allocated to it → keep them (§6/TEST 4).
 *  · exactly one assigned user → auto-select them, village preserved (§1/§4).
 *  · multiple assigned users → NEVER guess: leave user = "ALL" so the UI can
 *    offer a SELECT USER prompt with only those candidates (§5).
 *  · no assigned user → keep ALL USERS and surface UNALLOCATED (§12);
 *    no user is ever invented.
 */
export function resolveVillageChange(
  prev: Scope,
  villageKey: string,
  data: ScopeData,
): Scope {
  if (villageKey === "ALL") return { user: prev.user, village: "ALL" };

  const assigned = usersForVillage(data, villageKey);
  if (prev.user !== "ALL" && assigned.some((u) => u.key === prev.user)) {
    return { user: prev.user, village: villageKey };
  }
  if (assigned.length === 1) {
    return { user: assigned[0].key, village: villageKey };
  }
  return { user: "ALL", village: villageKey };
}

/** A multi-user village is selected and no user has been chosen yet (§5). */
export function needsUserSelection(scope: Scope, data: ScopeData): boolean {
  return (
    scope.user === "ALL" &&
    scope.village !== "ALL" &&
    usersForVillage(data, scope.village).length > 1
  );
}

/** The selected village has no allocation row at all (§12). */
export function isUnallocated(scope: Scope, data: ScopeData): boolean {
  return (
    scope.village !== "ALL" && usersForVillage(data, scope.village).length === 0
  );
}

/** Display name for a village key, allocation first, records second. */
export function villageLabel(data: ScopeData, villageKey: string): string {
  if (villageKey === "ALL") return "All Villages";
  return (
    data.villageNames[villageKey] ??
    data.recordVillages?.[villageKey] ??
    villageKey
  );
}

/** VIEWING label — always derived from the actual filter state (§13). */
export function viewingLabel(scope: Scope, data: ScopeData): string {
  const userLabel =
    scope.user === "ALL"
      ? needsUserSelection(scope, data)
        ? "Multiple Users"
        : "All Users"
      : (data.users.find((u) => u.key === scope.user)?.name ?? scope.user);

  const villageLabel_ =
    scope.village === "ALL"
      ? scope.user === "ALL"
        ? "All Villages"
        : "All Allotted Villages"
      : villageLabel(data, scope.village);

  return `${userLabel} · ${villageLabel_}`;
}
