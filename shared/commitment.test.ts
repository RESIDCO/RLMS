/* eslint-disable no-console */
/** Run: npx tsx shared/commitment.test.ts */
import {
  carNumberLookupValues,
  derivedFleetStatus,
  isOffRentLink,
  isOnRentOlRider,
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
ok(!isOffRentLink({ hasAssignment: true, rider: "OL1917", lesseeName: "ADM" }), "OL on rent");
ok(isOnRentOlRider("OL1917") && !isOnRentOlRider("EA2435"), "OL vs EA");

ok(derivedFleetStatus({ sold: true, offRent: true, hasOpenCommitment: true }) === "Sold", "Sold never overwritten");
ok(derivedFleetStatus({ offRent: false, hasOpenCommitment: true }) === "Leased", "on rent clears to Leased");
ok(derivedFleetStatus({ offRent: true, hasOpenCommitment: true }) === "Idle", "committed Idle");
ok(derivedFleetStatus({ offRent: true, hasOpenCommitment: false }) === "Unassigned", "available");

const parsed = parseCarListText("TFOX 000644\nTFOX000645, OFCX-3449\nBAD");
ok(parsed[0].initial === "TFOX" && parsed[0].number === "000644", "spaced mark");
ok(parsed[1].number === "000645", "glued mark");
ok(parsed[2].initial === "OFCX" && parsed[2].number === "003449", "hyphen + pad");
ok(parsed.some((p) => p.initial === "" && p.raw === "BAD"), "unparsed kept");
ok(carNumberLookupValues("644").includes("000644") && carNumberLookupValues("000644").includes("644"), "number variants");
ok(xLesseeName("KBX") === "xKBX" && xLesseeName("xKBX") === "xKBX", "x-lessee keeps prior");
ok(statusFromAssignmentLink({ hasAssignment: true, rider: "OL1917" }) === "Leased", "new car on OL");
ok(statusFromAssignmentLink({ hasAssignment: true, rider: "EA2435", seedIdle: true }) === "Idle", "new car off rent seed idle");
ok(statusFromAssignmentLink({ hasAssignment: false }) === "Unassigned", "new car no link");
ok(statusFromAssignmentLink({ sold: true, hasAssignment: false }) === "Sold", "new sold car");

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log(`ok ${passed}`);
