/* eslint-disable no-console */
/** Run: npx tsx shared/commitment.test.ts */
import {
  assignmentRentStartOnMove,
  carNumberLookupValues,
  derivedFleetStatus,
  isOffRentLink,
  isOnOl,
  isOnRent,
  isOnRentOlRider,
  parseCarDateRows,
  parseCarListText,
  statusFromAssignmentLink,
  xLesseeName,
} from "./commitment.ts";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(isOffRentLink({ hasAssignment: false }), "no assignment row is off rent");
ok(isOffRentLink({ hasAssignment: true, rider: "EA2435" }), "EA rider");
ok(isOffRentLink({ hasAssignment: true, rider: "EX1001" }), "EX rider");
ok(isOffRentLink({ hasAssignment: true, rider: "xOL1701" }), "xOL rider");
ok(isOffRentLink({ hasAssignment: true, rider: "OL1917", lesseeName: "xKBX" }), "x-lessee");
ok(isOffRentLink({ hasAssignment: true, rider: "OL1917", assignmentLabel: "(xADM) leftover" }), "x-label");
ok(
  !isOffRentLink({ hasAssignment: true, rider: "OL1917", lesseeName: "ADM", rentStartEnforced: false }),
  "NULL rent start is still on rent until enforced",
);
ok(
  isOffRentLink({ hasAssignment: true, rider: "OL1917", lesseeName: "ADM", fleetStatus: "Idle", rentStartEnforced: false }),
  "Idle + NULL rent start is off rent even before enforce",
);
ok(
  isOffRentLink({ hasAssignment: true, rider: "OL1917", lesseeName: "ADM", rentStartEnforced: true }),
  "NULL rent start is off rent once enforced",
);
ok(
  !isOffRentLink({ hasAssignment: true, rider: "OL1917", lesseeName: "ADM", rentStartDate: "2020-01-01", asOf: "2026-10-15" }),
  "OL with past rent start is on rent",
);
ok(
  isOffRentLink({ hasAssignment: true, rider: "OL1917", lesseeName: "ADM", rentStartDate: "2026-10-20", asOf: "2026-10-15" }),
  "future rent start stays off rent",
);
ok(isOnOl({ hasAssignment: true, rider: "OL2513", lesseeName: "Alpek Polyester (xTrinity)" }), "xTrinity in name is not x-lessee prefix");
ok(!isOnOl({ hasAssignment: true, rider: "OL1917", lesseeName: "xKBX" }), "x-lessee is not on_ol");
ok(isOnRentOlRider("OL1917") && !isOnRentOlRider("EA2435"), "OL vs EA");
ok(isOnRentOlRider("FL1201") && !isOnRentOlRider("XFL1201") && isOnOl({ hasAssignment: true, rider: "FL1201", rentStartEnforced: false }), "FL is on-rent like OL");
ok(isOnRent({ hasAssignment: true, rider: "OL1917", rentStartDate: "2026-10-15", asOf: "2026-10-15" }), "today counts as on rent");

ok(derivedFleetStatus({ sold: true, offRent: true, hasOpenCommitment: true }) === "Sold", "Sold never overwritten");
ok(derivedFleetStatus({ offRent: false, hasOpenCommitment: true }) === "Leased", "on rent clears to Leased");
ok(derivedFleetStatus({ offRent: true, hasOpenCommitment: true }) === "Idle", "committed Idle");
ok(derivedFleetStatus({ offRent: true, onOl: true, hasOpenCommitment: false }) === "Idle", "awaiting rent start is Idle not Unassigned");
ok(derivedFleetStatus({ offRent: true, hasOpenCommitment: false }) === "Unassigned", "available");

const parsed = parseCarListText("TFOX 000644\nTFOX000645, OFCX-3449\nBAD");
ok(parsed[0].initial === "TFOX" && parsed[0].number === "000644", "spaced mark");
ok(parsed[1].number === "000645", "glued mark");
ok(parsed[2].initial === "OFCX" && parsed[2].number === "003449", "hyphen + pad");
ok(parsed.some((p) => p.initial === "" && p.raw === "BAD"), "unparsed kept");
ok(carNumberLookupValues("644").includes("000644") && carNumberLookupValues("000644").includes("644"), "number variants");
ok(xLesseeName("KBX") === "xKBX" && xLesseeName("xKBX") === "xKBX", "x-lessee keeps prior");
ok(statusFromAssignmentLink({ hasAssignment: true, rider: "OL1917" }) === "Leased", "new OL car NULL date stays Leased until enforced");
ok(statusFromAssignmentLink({ hasAssignment: true, rider: "OL1917", fleetStatus: "Idle" }) === "Idle", "Idle tag + NULL date is awaiting");
ok(statusFromAssignmentLink({ hasAssignment: true, rider: "OL1917", rentStartEnforced: true }) === "Idle", "enforced NULL date is Idle");
const keep = assignmentRentStartOnMove({
  fromRiderId: 10, toRiderId: 10, prevDate: "2020-01-01", prevSetBy: "bruce", prevSetAt: "2026-01-01T00:00:00Z",
});
ok(keep.rent_start_date === "2020-01-01" && keep.priorDateNote === null, "same-OL fleet rename keeps rent start");
const reset = assignmentRentStartOnMove({ fromRiderId: 10, toRiderId: 11, prevDate: "2020-01-01" });
ok(reset.rent_start_date === null && reset.priorDateNote === "2020-01-01", "new OL without date clears rent start");
ok(statusFromAssignmentLink({ hasAssignment: true, rider: "OL1917", rentStartDate: "2020-01-01", asOf: "2026-10-15" }) === "Leased", "new OL car with past rent start");
const csvRows = parseCarDateRows("TFOX 000644,2024-10-18\nBAD\nTFOX 1,EA skip", "2026-01-01");
ok(csvRows[0].date === "2024-10-18" && csvRows[0].number === "000644", "csv car,date");
ok(csvRows.some((r) => r.raw === "BAD" && !r.initial), "csv bad token");
ok(statusFromAssignmentLink({ hasAssignment: true, rider: "EA2435", seedIdle: true }) === "Idle", "new car off rent seed idle");
ok(statusFromAssignmentLink({ hasAssignment: false }) === "Unassigned", "new car no link");
ok(statusFromAssignmentLink({ sold: true, hasAssignment: false }) === "Sold", "new sold car");

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log(`ok ${passed}`);
