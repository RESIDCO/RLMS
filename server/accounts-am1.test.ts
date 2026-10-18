/* eslint-disable no-console */
/** Run: npx tsx server/accounts-am1.test.ts */

import { applyAccountUpdate, type AccountWriteDeps } from "./account-write";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function statusOf(err: unknown): number | null {
  return err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : null;
}

const before = {
  id: 13,
  name: "Carmeuse Lime & Stone",
  notes: null,
  account_manager: null,
  tier: null,
  touch_cadence_days: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function deps(owners: string[]): { deps: AccountWriteDeps; recorded: Record<string, unknown>[] } {
  const recorded: Record<string, unknown>[] = [];
  return {
    recorded,
    deps: {
      async get() {
        return { ...before };
      },
      async update(_id, updates) {
        return { ...before, ...updates, updated_at: "2026-10-18T00:00:00Z" };
      },
      async insert() {
        throw new Error("not used");
      },
      async activeOwners() {
        return new Set(owners);
      },
      async record(opts) {
        recorded.push(opts as unknown as Record<string, unknown>);
      },
      async inGroup(_actor, fn) {
        const row = await fn();
        return { ...row, change_group: "group-1" };
      },
    },
  };
}

const good = deps(["BH", "FF"]);
const saved = await applyAccountUpdate(13, { account_manager: "BH", tier: "track_1", touch_cadence_days: 45 }, "editor-1", good.deps);
ok(saved?.change_group === "group-1", "updateAccount returns change_group");
ok(good.recorded.length === 1, "updateAccount records one change");
const change = good.recorded[0] as { before: Record<string, unknown>; after: Record<string, unknown>; entity_type: string; table: string };
ok(change.entity_type === "account" && change.table === "accounts", "change is an account row");
ok(!("updated_at" in change.before) && !("updated_at" in change.after), "updated_at is not in before/after");
ok(change.after.account_manager === "BH" && change.after.tier === "track_1", "after has the new owner and tier");

const badOwner = deps(["BH"]);
let ownerStatus: number | null = null;
try {
  await applyAccountUpdate(13, { account_manager: "ZZ" }, "editor-1", badOwner.deps);
} catch (err) {
  ownerStatus = statusOf(err);
}
ok(ownerStatus === 400 && badOwner.recorded.length === 0, "bad owner is 400 and writes nothing");

const inactive = deps(["BH"]);
let inactiveStatus: number | null = null;
try {
  await applyAccountUpdate(13, { account_manager: "FF" }, "editor-1", inactive.deps);
} catch (err) {
  inactiveStatus = statusOf(err);
}
ok(inactiveStatus === 400, "inactive territory owner is 400");

const cleared = deps(["BH"]);
const nulled = await applyAccountUpdate(13, { account_manager: null }, "editor-1", cleared.deps);
ok(nulled != null && (cleared.recorded[0] as { after: { account_manager: null } }).after.account_manager === null, "null owner is allowed");

const badTier = deps(["BH"]);
let tierStatus: number | null = null;
try {
  await applyAccountUpdate(13, { tier: "gold" }, "editor-1", badTier.deps);
} catch (err) {
  tierStatus = statusOf(err);
}
ok(tierStatus === 400 && badTier.recorded.length === 0, "bad tier is 400");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
