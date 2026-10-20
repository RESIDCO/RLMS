/** Run: npx tsx shared/move-plan.test.ts */
import {
  idsEligibleForMove,
  moveActor,
  moveHistoryCapture,
  planMoveBatch,
  resolveWillCreate,
  withCurrentAssignmentPointer,
} from "./move-plan";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const opts = {
  toRiderId: 20,
  toRiderName: "OL200",
  olLessee: "Covia",
  typedLessee: null,
  dateSupplied: true,
  suppliedDate: "2026-10-20",
  actor: "ada@example.com",
  movedAt: "2026-10-20T16:00:00.000Z",
};

const plans = planMoveBatch(
  [
    {
      id: 1,
      label: "HWCX 1",
      found: true,
      active: true,
      status: "Active/In-Service",
      fleet_status: "Leased",
      from_rider_id: 10,
      from_rider_name: "OL100",
      from_fleet: "Old",
      rent_start_date: "2024-01-01",
      assignment_id: 9,
    },
    {
      id: 2,
      label: "HWCX 2",
      found: true,
      active: false,
      status: "Inactive",
      fleet_status: "Leased",
      from_rider_id: 10,
      from_rider_name: "OL100",
      from_fleet: "Old",
    },
    {
      id: 3,
      label: "missing",
      found: false,
    },
  ],
  opts,
);

ok(plans[0].disposition === "move", "an active car is planned to move");
ok(plans[0].before.rider_name === "OL100" && plans[0].after?.rider_name === "OL200", "preview shows before and after rider");
ok(plans[0].after?.fleet_name === "Covia", "destination lessee is the after fleet");
ok(plans[0].rent_start_impact.includes("10/20/2026"), "rent start impact names the supplied date");
ok(plans[0].status_impact.length > 0, "status impact is present");
ok(plans[1].disposition === "left_alone" && plans[1].left_alone_reason === "inactive", "inactive car is left alone");
ok(plans[1].after == null, "a left-alone car has no after state");
ok(plans[2].disposition === "left_alone" && plans[2].left_alone_reason === "blocked", "a missing car is blocked and left alone");

ok(moveActor({ email: "ada@example.com", userId: "u1", clientMovedBy: "rlms-ui" }) === "ada@example.com", "moved by is the real user, not the client label");
ok(moveActor({ email: "", userId: "user-9", clientMovedBy: "bulk-action" }) === "user-9", "user id is the fallback actor");
ok(resolveWillCreate({ label: "OL9" }) === false, "resolve does not create unless asked");
ok(resolveWillCreate({ create: true }) === true, "create: true is the explicit lease step");
ok(resolveWillCreate({ create: "true" }) === false, "a string create flag is not explicit");

const history = moveHistoryCapture({ id: 4, railcar_id: 1, moved_by: "ada@example.com" });
ok(history.table === "assignment_history" && history.before && Object.keys(history.before).length === 0, "the move-history row is an insert capture");
ok(history.after.moved_by === "ada@example.com", "history stores the real user");
const pointer = withCurrentAssignmentPointer({ lessee_name: "Covia" }, "9");
ok(pointer.current_assignment_id === "9" && pointer.lessee_name === "Covia", "the current-assignment pointer is captured with the car");

const picked = idsEligibleForMove([1, 2, 2, 3], [
  { id: 1, active: true, status: "Active/In-Service" },
  { id: 2, active: false, status: "Storage" },
]);
ok(picked.ids.join(",") === "1,3" && picked.skippedInactive === 1, "Railcars and Search leave inactive cars out of the move selection");
ok(idsEligibleForMove([8], [{ id: 8, active: true, status: "Inactive" }]).ids.length === 0, "Inactive status is not selectable for a move");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
