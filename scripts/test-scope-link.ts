/**
 * Unit tests for the bidirectional USER ↔ ALLOTTED VILLAGE filter logic.
 * Covers §15 TEST 1–8 against a fixture shaped exactly like the spec example.
 * Run: bun scripts/test-scope-link.ts
 */
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
} from "../src/lib/scopeLink.ts";

/* ---------------- fixture (mirrors the §15 example) ---------------- */

const DAKHIN = "no 2 dakhin rupahi"; // → Niltupal (single user)
const SENCHOWA = "senchowa pathar"; // → Jytotkamal (single user)
const VILLAGE_A = "village a"; // → Niltupal AND Jytotkamal (shared)
const GHOST = "ghost village"; // → no allocation row (unallocated)

const data: ScopeData = {
  available: true,
  users: [
    {
      key: "u-niltupal",
      name: "Niltupal Saikia",
      target: 450,
      villages: [DAKHIN, VILLAGE_A],
    },
    {
      key: "u-jyto",
      name: "Jytotkamal Saikia",
      target: 350,
      villages: [SENCHOWA, VILLAGE_A],
    },
  ],
  villageNames: {
    [DAKHIN]: "No.2 Dakhin Rupahi",
    [SENCHOWA]: "Senchowa Pathar",
    [VILLAGE_A]: "Village A",
  },
  villageTargets: {
    [DAKHIN]: 450,
    [SENCHOWA]: 350,
    [VILLAGE_A]: 500,
  },
  recordVillages: {
    [GHOST]: "Ghost Village",
  },
};

const ALL: Scope = { user: "ALL", village: "ALL" };

/* ---------------- tiny harness ---------------- */

let pass = 0;
let fail = 0;

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function isScope(value: unknown, user: string, village: string): boolean {
  const s = value as Scope;
  return s.user === user && s.village === village;
}

/* ---------------- TEST 1: village → auto-selects its single user ---------------- */
console.log("TEST 1 — village resolves its single user");
{
  const next = resolveVillageChange(ALL, DAKHIN, data);
  ok("selecting No.2 Dakhin Rupahi selects Niltupal", isScope(next, "u-niltupal", DAKHIN), JSON.stringify(next));
  ok("VIEWING shows Niltupal · No.2 Dakhin Rupahi", viewingLabel(next, data) === "Niltupal Saikia · No.2 Dakhin Rupahi", viewingLabel(next, data));
}

/* ---------------- TEST 2/3: user → only their villages ---------------- */
console.log("TEST 2/3 — village list narrows to the selected user");
{
  const niltupal = villageOptions(data, "u-niltupal").map(([k]) => k);
  ok("Niltupal sees No.2 Dakhin Rupahi", niltupal.includes(DAKHIN));
  ok("Niltupal sees shared Village A", niltupal.includes(VILLAGE_A));
  ok("Niltupal does not see Senchowa Pathar", !niltupal.includes(SENCHOWA));

  const jyto = villageOptions(data, "u-jyto").map(([k]) => k);
  ok("Jytotkamal sees Senchowa Pathar", jyto.includes(SENCHOWA));
  ok("Jytotkamal sees shared Village A", jyto.includes(VILLAGE_A));
  ok("Jytotkamal does not see No.2 Dakhin Rupahi", !jyto.includes(DAKHIN));
}

/* ---------------- TEST 4: user first, then village keeps user ---------------- */
console.log("TEST 4 — user first, village second");
{
  const next = resolveVillageChange({ user: "u-niltupal", village: "ALL" }, DAKHIN, data);
  ok("keeps Niltupal with his village", isScope(next, "u-niltupal", DAKHIN), JSON.stringify(next));
}

/* ---------------- TEST 5: ALL VILLAGES keeps the user ---------------- */
console.log("TEST 5 — village → ALL VILLAGES keeps the user");
{
  const next = resolveVillageChange({ user: "u-niltupal", village: DAKHIN }, "ALL", data);
  ok("stays Niltupal · All Allotted Villages", isScope(next, "u-niltupal", "ALL"), JSON.stringify(next));
  ok("VIEWING label", viewingLabel(next, data) === "Niltupal Saikia · All Allotted Villages", viewingLabel(next, data));
}

/* ---------------- TEST 6: ALL USERS resets the village ---------------- */
console.log("TEST 6 — user → ALL USERS resets village");
{
  const next = resolveUserChange({ user: "u-niltupal", village: DAKHIN }, "ALL", data);
  ok("resets to ALL USERS / ALL VILLAGES", isScope(next, "ALL", "ALL"), JSON.stringify(next));
  ok("VIEWING label", viewingLabel(next, data) === "All Users · All Villages", viewingLabel(next, data));
}

/* ---------------- TEST 7: shared village → SELECT USER, no silent pick ---------------- */
console.log("TEST 7 — village shared by two users");
{
  const next = resolveVillageChange(ALL, VILLAGE_A, data);
  ok("does NOT silently pick a user", isScope(next, "ALL", VILLAGE_A), JSON.stringify(next));
  ok("needs SELECT USER prompt", needsUserSelection(next, data));
  const candidates = usersForVillage(data, VILLAGE_A).map((u) => u.key);
  ok("offers only the two assigned users", candidates.length === 2 && candidates.includes("u-niltupal") && candidates.includes("u-jyto"), candidates.join(","));
  ok("VIEWING shows Multiple Users", viewingLabel(next, data) === "Multiple Users · Village A", viewingLabel(next, data));

  const pickN = resolveUserChange(next, "u-niltupal", data);
  ok("choosing Niltupal keeps Village A", isScope(pickN, "u-niltupal", VILLAGE_A), JSON.stringify(pickN));
  const pickJ = resolveUserChange(next, "u-jyto", data);
  ok("choosing Jytotkamal keeps Village A", isScope(pickJ, "u-jyto", VILLAGE_A), JSON.stringify(pickJ));
}

/* ---------------- TEST 8: unallocated village ---------------- */
console.log("TEST 8 — unallocated village");
{
  const next = resolveVillageChange(ALL, GHOST, data);
  ok("stays ALL USERS with the village", isScope(next, "ALL", GHOST), JSON.stringify(next));
  ok("flagged UNALLOCATED, no invented user", isUnallocated(next, data));
  ok("not a SELECT USER case", !needsUserSelection(next, data));
  ok("VIEWING label", viewingLabel(next, data) === "All Users · Ghost Village", viewingLabel(next, data));
}

/* ---------------- extra invariants (§2, §6, §11, §16) ---------------- */
console.log("Extra — shared-village user switch, record villages, idempotence");
{
  const keep = resolveUserChange({ user: "u-niltupal", village: VILLAGE_A }, "u-jyto", data);
  ok("switching user keeps a shared village", isScope(keep, "u-jyto", VILLAGE_A), JSON.stringify(keep));

  const drop = resolveUserChange({ user: "u-niltupal", village: DAKHIN }, "u-jyto", data);
  ok("switching to a user without that village resets village", isScope(drop, "u-jyto", "ALL"), JSON.stringify(drop));

  const allVillages = villageOptions(data, "ALL").map(([k]) => k);
  ok("ALL USERS also offers record-only villages", allVillages.includes(DAKHIN) && allVillages.includes(GHOST), allVillages.join(","));

  const again = resolveVillageChange(resolveVillageChange(ALL, DAKHIN, data), DAKHIN, data);
  ok("village transition is idempotent (no ping-pong)", isScope(again, "u-niltupal", DAKHIN), JSON.stringify(again));

  const usersFirst = resolveUserChange(resolveVillageChange(ALL, VILLAGE_A, data), "u-jyto", data);
  ok("village → SELECT USER → user selection keeps village (§2)", isScope(usersFirst, "u-jyto", VILLAGE_A), JSON.stringify(usersFirst));
}

/* ---------------- summary ---------------- */
console.log(`\n${pass}/${pass + fail} assertions passed`);
if (fail > 0) process.exit(1);
