/* eslint-disable no-console */
/** Run: npx tsx shared/programs-v2.test.ts */

import { pickEarliestOpenProgram, shouldCreateProgramCommitment } from "./commitment";
import {
  displayTypeFromCategory,
  deriveCompletionLevel,
  frozenProgramCarAcceptsPatch,
  isArrivedMilestone,
  isCarDone,
  isTerminalMilestone,
  overlayLifecycle,
  parseCarPasteList,
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

ok(isArrivedMilestone("Arrived at industry"), "arrived is destination");
ok(isArrivedMilestone("COMPLETE - Arrived Lessee"), "arrived lessee");
ok(!isArrivedMilestone("Enroute"), "enroute is not done");
ok(isTerminalMilestone("On rent"), "on rent is terminal");
ok(!isArrivedMilestone("On rent"), "on rent is not arrival");
ok(parseCarPasteList("TFOX 2248\nTFOX 000430, KBX 123").length === 3, "paste list splits");
ok(parseCarPasteList("TFOX\t3297").join("|") === "TFOX 003297", "tab + zero-pad");
ok(parseCarPasteList("TFOX  3297\nTFOX 003297").length === 1, "spaces and pad collapse to one car");

ok(isCarDone({ active: false }), "fleet inactive is program done");
ok(isCarDone({ active: true, railcar_status: "Inactive" }), "Inactive status is program done");
ok(!isCarDone({ active: true, railcar_status: "Off-Lease" }), "an active Off-Lease car is not program done");
ok(!isCarDone({ active: false, keep_open: true }), "keep open is not done by inactivity");
ok(isCarDone({ active: false, keep_open: true, outcome_reached_at: "2026-10-17" }), "keep open plus outcome is program done");
ok(isCarDone({ active: true, railcar_status: "Inactive", keep_open: true, milestone: "On rent" }), "keep open plus a done milestone is program done");
ok(deriveCompletionLevel({ active: false, keep_open: true, status: "Enroute" }) === "in_progress", "keep open with a status stays in progress");
ok(deriveCompletionLevel({ active: false, status: "Enroute" }) === "program_done", "inactive fleet car is program done");
ok(isCarDone({ active: false, exited_date: "2026-10-01" }), "program exit is program done");
ok(!frozenProgramCarAcceptsPatch({ active: false }, { status: "Enroute" }), "a frozen car rejects a status edit");
ok(frozenProgramCarAcceptsPatch({ active: false, custom_fields: { __keep_open: true } }, { status: "Enroute" }), "keep open accepts a status edit");
ok(frozenProgramCarAcceptsPatch({ active: false }, { custom_fields: { __keep_open: true } }), "turning keep open on is allowed");
ok(frozenProgramCarAcceptsPatch({ active: true, railcar_status: "Storage" }, { status: "Enroute" }), "an active Storage car accepts a status edit");
ok(!frozenProgramCarAcceptsPatch({ active: false }, null), "exit stays blocked until keep open");
ok(isCarDone({ active: true, milestone: "On rent" }), "on rent is program done");
ok(isCarDone({ active: true, milestones: [{ milestone: "Scrapped" }] }), "scrapped trail is program done");
ok(!isCarDone({ active: true, milestone: "Work complete" }), "work complete is not program done");
ok(isCarDone({ active: true, outcome_reached_at: "2026-10-17" }), "outcome date is program done");
ok(isCarDone({ active: true, completed: true }), "legacy complete checkbox is program done");
ok(!isCarDone({ active: true, completed: false }), "active open is remaining");
ok(deriveCompletionLevel({ active: true, completed: true }) === "program_done", "completed → program_done");
ok(deriveCompletionLevel({ active: true, outcome_reached_at: "2026-10-17" }) === "program_done", "outcome → program_done");
ok(isCarDone({ active: true, scrapped_at: "2026-09-18" }), "active car with scrapped_at is program done");
ok(deriveCompletionLevel({ active: true, scrapped_at: "2026-09-18" }) === "program_done", "scrapped_at → program_done");
ok(deriveCompletionLevel({ active: true, keep_open: true, scrapped_at: "2026-09-18", status: "Enroute" }) === "program_done", "keep open does not override scrapped_at");
ok(deriveCompletionLevel({ active: true, scrapped_at: "  " }) === "not_started", "blank scrapped_at is not program done");
ok(deriveCompletionLevel({ active: true, scrapped_at: null }) === "not_started", "null scrapped_at is not program done");
ok(!isCarDone({ active: true, status: "Complete" }), "status text alone is not program done");
ok(!isCarDone({ active: true, status: "Sold" }), "Sold status text is not program done");
ok(deriveCompletionLevel({ active: true, status: "COMPLETE - Arrived Lessee" }) === "in_progress", "status text is not done");
ok(deriveCompletionLevel({ active: true, status: "Enroute" }) === "in_progress", "status is in progress");
ok(deriveCompletionLevel({ active: true, milestone: "Work complete" }) === "work_done", "work complete level");
ok(deriveCompletionLevel({ active: true }) === "not_started", "blank is not started");

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
