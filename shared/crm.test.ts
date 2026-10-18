/* eslint-disable no-console */
/** Run: npx tsx shared/crm.test.ts */

import { isUndoAllowedTable, UNDO_ALLOWED_TABLES } from "./undo";
import {
  addMonthsIso,
  isRenewalCandidate,
  lostNeedsReason,
  mostCommonValue,
  renewalExclusion,
  type RenewalRiderInput,
  wonReletNeedsRemarket,
} from "./crm";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const TODAY = "2026-10-18";

function rider(overrides: Partial<RenewalRiderInput> = {}): RenewalRiderInput {
  return {
    lifecycle_status: "active",
    is_placeholder: false,
    expiration_date: "2027-04-18",
    expiration_source: "asset_report",
    on_rent_nonsold_leased: 4,
    has_open_renewal: false,
    ...overrides,
  };
}

ok(addMonthsIso("2026-10-18", 12) === "2027-10-18", "12 months from 18 Oct");
ok(addMonthsIso("2026-10-18", 6) === "2027-04-18", "6 months from 18 Oct");
ok(addMonthsIso("2026-10-18", 18) === "2028-04-18", "18 months from 18 Oct");
ok(addMonthsIso("2026-01-31", 1) === "2026-02-28", "month clamp non-leap");
ok(addMonthsIso("2024-01-31", 1) === "2024-02-29", "month clamp leap");

ok(isRenewalCandidate(rider(), { today: TODAY, months: 12 }), "baseline candidate");
ok(renewalExclusion(rider({ is_placeholder: true }), { today: TODAY, months: 12 }) === "placeholder", "placeholder excluded");
ok(renewalExclusion(rider({ lifecycle_status: null }), { today: TODAY, months: 12 }) === "lifecycle", "null lifecycle excluded");
ok(renewalExclusion(rider({ lifecycle_status: "closed" }), { today: TODAY, months: 12 }) === "lifecycle", "closed excluded");
ok(
  renewalExclusion(rider({ lifecycle_status: "off_lease_pending_remarketing" }), { today: TODAY, months: 12 }) === "lifecycle",
  "off lease excluded",
);
ok(renewalExclusion(rider({ on_rent_nonsold_leased: 0 }), { today: TODAY, months: 12 }) === "on_rent", "sold / zero on-rent excluded");
ok(renewalExclusion(rider({ expiration_source: "car_records" }), { today: TODAY, months: 12 }) === "expiry_source", "car_records excluded");
ok(renewalExclusion(rider({ expiration_source: null }), { today: TODAY, months: 12 }) === "expiry_source", "null source excluded");
ok(renewalExclusion(rider({ expiration_date: null }), { today: TODAY, months: 12 }) === "window", "null expiry excluded");
ok(isRenewalCandidate(rider({ expiration_source: "asset_report_multi_term" }), { today: TODAY, months: 12 }), "multi_term included");
ok(renewalExclusion(rider({ has_open_renewal: true }), { today: TODAY, months: 12 }) === "open_renewal", "open renewal excluded");

ok(isRenewalCandidate(rider({ expiration_date: TODAY }), { today: TODAY, months: 12 }), "window includes today");
ok(isRenewalCandidate(rider({ expiration_date: "2027-10-17" }), { today: TODAY, months: 12 }), "window includes day before end");
ok(renewalExclusion(rider({ expiration_date: "2027-10-18" }), { today: TODAY, months: 12 }) === "window", "window excludes today+months");
ok(renewalExclusion(rider({ expiration_date: "2026-10-17" }), { today: TODAY, months: 12 }) === "window", "past expiry excluded");
ok(isRenewalCandidate(rider({ expiration_date: "2027-04-17" }), { today: TODAY, months: 6 }), "6 month inside edge");
ok(renewalExclusion(rider({ expiration_date: "2027-04-18" }), { today: TODAY, months: 6 }) === "window", "6 month exclusive end");
ok(isRenewalCandidate(rider({ expiration_date: "2028-04-17" }), { today: TODAY, months: 18 }), "18 month inside edge");
ok(renewalExclusion(rider({ expiration_date: "2028-04-18" }), { today: TODAY, months: 18 }) === "window", "18 month exclusive end");

ok(lostNeedsReason("lost", null), "lost without reason");
ok(lostNeedsReason("lost", ""), "lost with blank reason");
ok(lostNeedsReason("lost", "   "), "lost with whitespace reason");
ok(!lostNeedsReason("lost", "rate"), "lost with reason is ok");
ok(!lostNeedsReason("won", null), "won does not need a loss reason");
ok(!lostNeedsReason("identified", null), "open stage does not need a loss reason");

ok(wonReletNeedsRemarket({ type: "relet", stage: "won", won_rider_id: null }), "won relet without successor");
ok(!wonReletNeedsRemarket({ type: "relet", stage: "won", won_rider_id: 12 }), "won relet with successor");
ok(!wonReletNeedsRemarket({ type: "renewal", stage: "won", won_rider_id: null }), "won renewal is not a remarket");

ok(mostCommonValue(["T", "H", "T", null, " "]) === "T", "most common car type");
ok(mostCommonValue(["B", "A", "A", "B"]) === "A", "tie breaks alphabetically");
ok(mostCommonValue([null, " "]) === null, "no car type");

const previous = [
  "railcars",
  "car_commitments",
  "car_rent_stops",
  "program_cars",
  "program_car_milestones",
  "programs",
  "railcar_assignments",
  "assignment_history",
  "car_status_history",
  "car_tags",
  "car_lists",
  "car_list_members",
  "riders",
  "master_leases",
  "attachments",
];
for (const table of previous) ok(isUndoAllowedTable(table), `${table} stays undoable`);
ok(isUndoAllowedTable("opportunities"), "opportunities undoable");
ok(isUndoAllowedTable("crm_activities"), "crm_activities undoable");
ok(UNDO_ALLOWED_TABLES.includes("attachments"), "attachments remains on the allowlist");
ok(UNDO_ALLOWED_TABLES.indexOf("attachments") < UNDO_ALLOWED_TABLES.indexOf("opportunities"), "CRM tables appended after attachments");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
