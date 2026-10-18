/* eslint-disable no-console */
/** Run: npx tsx shared/account-mgmt.test.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  accountRentRoll,
  effectiveCadence,
  effectiveOwner,
  isTouchActivity,
  nextTouchDue,
  rentRollLabel,
  tierFromBriefingTrack,
  touchStatus,
} from "./account-mgmt";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const tracks: Array<[string | null, string | null]> = [
  ["Track 1", "track_1"],
  ["Track 1 - Tier 1", "track_1"],
  ["Track 2", "track_2"],
  ["Track 3", "track_3"],
  ["Call-then-email", null],
  ["Direct call / email / in person", null],
  [null, null],
];
for (const [input, expected] of tracks) {
  ok(tierFromBriefingTrack(input) === expected, `tierFromBriefingTrack ${JSON.stringify(input)}`);
}

ok(effectiveCadence("track_1", null) === 30, "track 1 default 30");
ok(effectiveCadence("track_2", null) === 60, "track 2 default 60");
ok(effectiveCadence("track_3", null) === 90, "track 3 default 90");
ok(effectiveCadence("track_1", 45) === 45, "override wins");
ok(effectiveCadence(null, null) === null, "untiered cadence is null");

const today = "2026-10-18";
ok(nextTouchDue(null, 30) === null, "no touch means no due date");
ok(nextTouchDue("2026-10-18", null) === null, "no cadence means no due date");
ok(nextTouchDue("2026-10-18", 30) === "2026-11-17", "due 30 days later");

ok(touchStatus({ tier: "track_1", cadenceDays: 30, lastTouchIso: today, today }) === "ok", "0 days since touch is ok");
ok(touchStatus({ tier: "track_1", cadenceDays: 30, lastTouchIso: "2026-10-11", today }) === "ok", "7 days since touch is still ok");
ok(touchStatus({ tier: "track_1", cadenceDays: 30, lastTouchIso: "2026-09-23", today }) === "due_soon", "25 days ago on track 1 is due soon");
ok(touchStatus({ tier: "track_1", cadenceDays: 30, lastTouchIso: "2026-09-18", today }) === "due_soon", "30 days ago is due today");
ok(touchStatus({ tier: "track_1", cadenceDays: 30, lastTouchIso: "2026-09-17", today }) === "overdue", "31 days ago on track 1 is overdue");
ok(touchStatus({ tier: "track_1", cadenceDays: 30, lastTouchIso: null, today }) === "never", "tiered with no touch is never");
ok(touchStatus({ tier: null, cadenceDays: null, lastTouchIso: null, today }) === "untiered", "no tier is untiered");
ok(touchStatus({ tier: null, cadenceDays: 30, lastTouchIso: "2026-01-01", today }) === "untiered", "untiered is not overdue");

ok(isTouchActivity({ kind: "call" }), "call counts");
ok(isTouchActivity({ kind: "meeting" }), "meeting counts");
ok(isTouchActivity({ kind: "email" }), "email counts");
ok(isTouchActivity({ kind: "note" }), "note counts");
ok(isTouchActivity({ kind: "task", done_at: "2026-10-01" }), "done task counts");
ok(!isTouchActivity({ kind: "task", done_at: null }), "open task does not count");

ok(effectiveOwner({ owner_of_record: null, incoming_owner: null }) === null, "no owners");
ok(effectiveOwner({ owner_of_record: "KB", incoming_owner: null }) === "KB", "official only");
ok(effectiveOwner({ owner_of_record: null, incoming_owner: "FF" }) === "FF", "incoming only");
ok(effectiveOwner({ owner_of_record: "KB", incoming_owner: "FF" }) === "FF", "incoming wins");

ok(rentRollLabel("2026-10-01") === "per import as of 2026-10-01", "rent label");
ok(rentRollLabel(null) === "per import as of —", "missing snapshot label");

const roll = accountRentRoll(
  [
    { rider_name: "OL1919", account_id: 10, is_placeholder: false },
    { rider_name: "OL1000", account_id: 10, is_placeholder: false },
    { rider_name: "IDLE", account_id: 99, is_placeholder: true },
  ],
  [
    { rider_id: "OL1919", former_deal: "xOL1244", monthly_rent_total: 1000 },
    { rider_id: "OL1919", former_deal: "xOL1932", monthly_rent_total: 250 },
    { rider_id: "1919", monthly_rent_total: 999999 },
    { rider_id: "EA2312", monthly_rent_total: 10 },
    { rider_id: "OL1816", monthly_rent_total: 20 },
    { rider_id: "OL2611", monthly_rent_total: 30 },
    { rider_id: "IDLE", monthly_rent_total: 5 },
  ],
);
const account = roll.accounts.find((row) => row.account_id === 10);
ok(account?.monthly_rent_total === 1250, "OL1919 xOL1244 and xOL1932 sum on the rider name");
ok(account?.monthly_rent_total !== 0, "a numeric riders.id does not match the import key");
ok(account?.riders_in_import === 1 && account?.riders_without_summary === 1, "OL1000 is on the account and missing from the import");
ok(!roll.accounts.some((row) => row.account_id === 99), "placeholder rent is not an account total");
ok(
  roll.unmatched.map((row) => row.rider_name).join(",") === "1919,EA2312,OL1816,OL2611",
  "numeric id plus EA2312, OL1816, and OL2611 stay unmatched",
);
ok(roll.unmatched.find((row) => row.rider_name === "EA2312")?.monthly_rent_total === 10, "EA2312 rent is kept");
ok(!roll.unmatched.some((row) => row.rider_name === "OL1919" || row.rider_name === "IDLE"), "names with a rider row are not unmatched");

const sql = readFileSync(resolve("migrations/20261112_account_mgmt_am1.sql"), "utf8");
const executable = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
ok(/apply after the security lockdown stages/i.test(sql), "migration says apply after lockdown");
ok(/retaken right after AM-1/i.test(sql), "migration says retake the ACL snapshot if it goes first");
ok(sql.includes("sum(f.monthly_rent_total)"), "rent roll sums every slice");
ok(executable.includes("f.rider_id = ar.rider_name"), "rent roll joins on the rider name");
ok(!executable.includes("rider_id::text"), "rent roll does not cast riders.id");
ok(executable.includes("unmatched_rider_name"), "unmatched import names stay in the view");
ok(!/distinct\s+on/i.test(sql), "rent roll does not collapse rows");
ok(!/data-quality/i.test(sql), "no import data-quality flag");
ok(!/rent_events/i.test(executable), "no rent_events statement");
ok(!/alter table public\.riders/i.test(executable), "no riders DDL");
ok(!/alter table public\.master_leases/i.test(executable), "no master_leases DDL");
ok(!/v_lease_/i.test(executable), "no lease view statement");
ok(!/rlms_apply_jsonb_patch|rlms_undo_change_group/i.test(executable), "no undo function statement");
ok(sql.includes("DEPRECATED (AM-1, Oct 2026)"), "status_tag comment");
ok(!/^\s*update\s+/im.test(executable), "no data update");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
