/* eslint-disable no-console */
/** Run: npx tsx script/am1-data.test.ts */

import {
  AM1_OWNER_ASSIGNMENTS,
  AM1_STAY_UNOWNED,
  executeAm1Plans,
  ownerSignoffTable,
  parseAm1Part,
  planOwnerAssignments,
  planOwnerRow,
  planTierRow,
  plannedWrites,
  writesForPart,
  type OwnerLive,
} from "./am1-plan";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(AM1_OWNER_ASSIGNMENTS.length === 12, "twelve owner rows");
ok(AM1_OWNER_ASSIGNMENTS.filter((row) => row.owner === "BH").length === 9, "nine BH");
ok(AM1_OWNER_ASSIGNMENTS.filter((row) => row.owner === "FF").length === 3, "three FF");
ok(!AM1_OWNER_ASSIGNMENTS.some((row) => row.account_id === 29 || row.account_id === 244), "29 and 244 are not assigned");
ok(AM1_STAY_UNOWNED.map((row) => row.account_id).join() === "29,244", "stay-unowned list");

const ready = new Map<number, OwnerLive>();
for (const row of AM1_OWNER_ASSIGNMENTS) {
  ready.set(row.account_id, { current_owner: null, handoff_status: "open", to_account_manager: row.owner });
}
const first = planOwnerAssignments(ready);
ok(first.every((row) => row.action === "set"), "blank official owner with a matching open handoff is set");
ok(first.every((row) => row.current === "(blank)"), "sign-off shows the current owner as blank");
const table = ownerSignoffTable(first);
ok(table.split("\n").length === 13, "preview lists all 12 lessee rows plus a header");
ok(table.includes("Alpek Polyester (xTrinity)") && table.includes("US Gypsum"), "preview names the accounts");

const again = planOwnerAssignments(new Map(AM1_OWNER_ASSIGNMENTS.map((row) => [row.account_id, {
  current_owner: row.owner,
  handoff_status: "open",
  to_account_manager: row.owner,
}])));
ok(again.every((row) => row.action === "skip" && row.reason === "skipped: already set"), "re-run after apply changes nothing");

const human = planOwnerRow(
  { account_id: 13, name: "Carmeuse Lime & Stone", owner: "BH" },
  { current_owner: "FF", handoff_status: "open", to_account_manager: "BH" },
);
ok(human.action === "skip" && human.reason === "skipped: already set", "a different official owner is not overwritten");

const mismatch = planOwnerRow(
  { account_id: 13, name: "Carmeuse Lime & Stone", owner: "BH" },
  { current_owner: null, handoff_status: "open", to_account_manager: "FF" },
);
ok(mismatch.action === "skip" && mismatch.reason.includes("incoming"), "mismatched incoming owner is skipped");

const protectedOwner = planOwnerRow(
  { account_id: 29, name: "TotalEnergies Petrochemicals", owner: "BH" },
  { current_owner: null, handoff_status: "open", to_account_manager: "BH" },
);
ok(protectedOwner.action === "skip" && protectedOwner.reason.includes("protected"), "account 29 is never touched");
const protectedTier = planTierRow({
  account_id: 244,
  name: "Waelz Sustainable Products",
  current_tier: null,
  briefing_track: "Track 1",
  segment: "client",
});
ok(protectedTier.action === "skip", "account 244 is never touched");

const tierSet = planTierRow({
  account_id: 1,
  name: "Example",
  current_tier: null,
  briefing_track: "Track 2",
  segment: "client",
});
ok(tierSet.action === "set" && tierSet.next === "track_2", "mapped briefing seeds a tier");
const unmapped = planTierRow({
  account_id: 2,
  name: "Other",
  current_tier: null,
  briefing_track: "Call-then-email",
  segment: "former",
});
ok(unmapped.action === "unmapped" && unmapped.next === null, "unmapped track stays blank");

let writes = 0;
const dry = await executeAm1Plans({
  apply: false,
  env: {},
  writes: plannedWrites(first, [tierSet]),
  write: async () => {
    writes += 1;
    return { change_group: "nope" };
  },
});
ok(!dry.applied && writes === 0, "dry run writes nothing");

let refused = false;
try {
  await executeAm1Plans({
    apply: true,
    env: {},
    writes: plannedWrites(first, []),
    write: async () => {
      writes += 1;
      return { change_group: "nope" };
    },
  });
} catch (err) {
  refused = err instanceof Error && err.message.includes("AM1_APPLY_OK");
}
ok(refused && writes === 0, "--apply without AM1_APPLY_OK=bruce refuses before any write");

ok(parseAm1Part(["node", "am1-data.ts"]) === "owners", "default --part is owners");
ok(parseAm1Part(["node", "am1-data.ts", "--part", "tiers"]) === "tiers", "--part tiers is explicit");
ok(parseAm1Part(["node", "am1-data.ts", "--apply", "--part", "all"]) === "all", "--part all is explicit");
const both = plannedWrites(first, [tierSet]);
const ownerOnly = writesForPart(both, parseAm1Part(["node", "am1-data.ts"]));
ok(ownerOnly.length === 12 && ownerOnly.every((row) => row.group === "owners"), "default part does not seed tiers");
const tierOnly = writesForPart(both, "tiers");
ok(tierOnly.length === 1 && tierOnly[0]?.group === "tiers", "explicit tiers part seeds tiers");
let tierWrites = 0;
const tierDry = await executeAm1Plans({
  apply: false,
  env: {},
  writes: tierOnly,
  write: async () => {
    tierWrites += 1;
    return { change_group: "nope" };
  },
});
ok(!tierDry.applied && tierWrites === 0, "tier part stays dry-run without --apply");
let tierRefused = false;
try {
  await executeAm1Plans({
    apply: true,
    env: {},
    writes: tierOnly,
    write: async () => {
      tierWrites += 1;
      return { change_group: "nope" };
    },
  });
} catch (err) {
  tierRefused = err instanceof Error && err.message.includes("AM1_APPLY_OK");
}
ok(tierRefused && tierWrites === 0, "tier --apply uses the same AM1_APPLY_OK gate");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
