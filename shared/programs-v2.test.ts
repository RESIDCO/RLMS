/* eslint-disable no-console */
/** Run: npx tsx shared/programs-v2.test.ts */

import { pickEarliestOpenProgram, shouldCreateProgramCommitment } from "./commitment";
import {
  displayTypeFromCategory,
  isCarDone,
  overlayLifecycle,
  readyToClose,
  isProgramStale,
} from "./programs";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(overlayLifecycle({ closed_date: "2026-01-01", lifecycle: "active" }) === "closed", "closed_date wins");
ok(overlayLifecycle({ closed_date: null, lifecycle: "complete" as any }) === "active", "#4 complete is not closed");
ok(overlayLifecycle({ closed_date: null, lifecycle: "draft" }) === "draft", "draft kept");
ok(overlayLifecycle({ closed_date: null, lifecycle: "cancelled" }) === "cancelled", "cancelled kept");

ok(displayTypeFromCategory("EOLR (End-of-Lease Return)") === "Return", "EOLR → Return");
ok(displayTypeFromCategory("NLD (New Lessee Delivery)") === "New Assignment", "NLD → New Assignment");
ok(displayTypeFromCategory("Remark") === "Repair", "Remark → Repair");
ok(displayTypeFromCategory("Qualifications") === "Quals", "Quals");

ok(isCarDone({ active: false }), "inactive is done");
ok(isCarDone({ active: true, outcome_reached_at: "2026-10-01" }), "outcome is done");
ok(isCarDone({ active: true, completed: true }), "legacy completed is done");
ok(!isCarDone({ active: true, completed: false }), "active open is remaining");

ok(readyToClose({ lifecycle: "active", remaining: 0, total_open_links: 14 }), "14/14 ready");
ok(!readyToClose({ lifecycle: "active", remaining: 5, total_open_links: 106 }), "Olin not ready");
ok(!readyToClose({ lifecycle: "closed", remaining: 0, total_open_links: 14 }), "closed not ready badge");

ok(isProgramStale({ lifecycle: "active", target_completion_date: null }), "no date is stale");
ok(!isProgramStale({ lifecycle: "active", target_completion_date: "2099-01-01" }), "future not stale");

const earliest = pickEarliestOpenProgram([
  { program_id: 2, joined_date: "2026-02-01", id: 20 },
  { program_id: 1, joined_date: "2026-01-01", id: 10 },
]);
ok(earliest?.program_id === 1, "earliest joined program wins");

ok(shouldCreateProgramCommitment({ active: true, is_op: true, off_rent: true }), "off-rent op gets commitment");
ok(!shouldCreateProgramCommitment({ active: true, is_op: true, off_rent: false }), "on-rent no commitment");
ok(!shouldCreateProgramCommitment({ active: false, is_op: true, off_rent: true }), "inactive no commitment");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
