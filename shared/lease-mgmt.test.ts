/* eslint-disable no-console */
import { displayRiderCode, isPlaceholderLessee, isStandardRiderNumber, riderNumberDigits } from "./lease-mgmt";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(isStandardRiderNumber("OL2543"), "OL2543 valid");
ok(isStandardRiderNumber("EA1739"), "EA1739 valid");
ok(!isStandardRiderNumber("OL1220a"), "suffix rejected");
ok(!isStandardRiderNumber("FL1203"), "FL is non-standard");
ok(riderNumberDigits("OL2543") === "2543", "digits");
ok(isPlaceholderLessee("xKBX Rail LLC"), "x prefix");
ok(isPlaceholderLessee("xCSX"), "xCSX sold-to prefix");
ok(isPlaceholderLessee("IDLE (xDow)"), "idle");
ok(isPlaceholderLessee("Available"), "available");
ok(!isPlaceholderLessee("Xcel Energy"), "Xcel Energy is not a placeholder");
ok(!isPlaceholderLessee("Alpek Polyester (xTrinity)"), "parenthetical x-sold-to is not a placeholder lessee");
ok(!isPlaceholderLessee("Georgia Pacific"), "real lessee");
ok(displayRiderCode({ lifecycle_status: "off_lease_pending_remarketing", number_digits: "1739", rider_name: "OL1739" }) === "EA1739", "EA from lifecycle");
ok(displayRiderCode({ lifecycle_status: "active", number_digits: "1739", rider_name: "EA1739" }) === "OL1739", "OL from lifecycle");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
