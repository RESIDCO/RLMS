/* eslint-disable no-console */
/** Run: npx tsx shared/car-lifecycle-status.test.ts */

import {
  carStatusImpliesActive,
  fieldsForCarStatusSave,
  fieldsImpliedByCarStatus,
  inactiveBoundaryEvent,
  isFrozenRailcar,
  statusAlignedToActiveFlag,
  vcfMustNotModifyCar,
} from "./car-lifecycle-status";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const keepActive = ["Active/In-Service", "Storage", "Bad Order", "Off-Lease", "Retired", "Scrapped", "Shop"];
for (const status of keepActive) {
  const implied = fieldsImpliedByCarStatus(status);
  ok(implied.active === true && implied.active_status === "Active" && implied.status === status, `${status} stays active`);
  ok(carStatusImpliesActive(status), `${status} implies active`);
}

const killed = fieldsImpliedByCarStatus("Inactive");
ok(killed.active === false && killed.active_status === "Inactive" && killed.status === "Inactive", "Inactive sets active=false");
ok(!carStatusImpliesActive("Inactive"), "Inactive does not imply active");
ok(fieldsImpliedByCarStatus("  ").status === "Active/In-Service" && fieldsImpliedByCarStatus("").active === true, "blank status stays active");

ok(statusAlignedToActiveFlag("Storage", true) === "Storage", "active file keeps Storage");
ok(statusAlignedToActiveFlag("Bad Order", true) === "Bad Order", "active file keeps Bad Order");
ok(statusAlignedToActiveFlag("Inactive", true) === "Active/In-Service", "active file does not leave a car Inactive");
ok(statusAlignedToActiveFlag("Active/In-Service", false) === "Off-Lease", "inactive file does not invent Inactive");
ok(statusAlignedToActiveFlag("Storage", false) === "Storage", "inactive file keeps Storage text");
ok(statusAlignedToActiveFlag("Inactive", false) === "Inactive", "inactive file keeps Inactive text");

ok(isFrozenRailcar({ active: false, status: "Storage" }), "active=false is frozen");
ok(isFrozenRailcar({ active: true, status: "Inactive" }), "Inactive status is frozen");
ok(!isFrozenRailcar({ active: true, status: "Off-Lease" }), "Off-Lease active car is not frozen");

ok(inactiveBoundaryEvent({ status: "Storage", active: true }, "Bad Order") == null, "Storage to Bad Order is not audited");
ok(inactiveBoundaryEvent({ status: "Storage", active: true }, "Inactive") === "marked_inactive", "entering Inactive is audited");
ok(inactiveBoundaryEvent({ status: "Inactive", active: false }, "Storage") === "reactivated", "leaving Inactive is a reactivation");
ok(inactiveBoundaryEvent({ status: "Storage", active: false }, "Storage") === "reactivated", "clearing a false active flag is a reactivation");
ok(inactiveBoundaryEvent({ status: "Inactive", active: false }, "Inactive") == null, "Inactive to Inactive is not a new event");

const storageSave = fieldsForCarStatusSave("Storage");
ok(storageSave.active === true && storageSave.active_source == null, "Storage save does not stamp manual");
const killSave = fieldsForCarStatusSave("Inactive", { stampManual: true });
ok(killSave.active === false && killSave.active_source === "manual", "Inactive save stamps manual");

ok(vcfMustNotModifyCar({ active_source: "manual", active: true, status: "Storage" }), "manual cars are skipped");
ok(vcfMustNotModifyCar({ active_source: "auto", active: false, status: "Storage" }), "active=false is skipped");
ok(vcfMustNotModifyCar({ active_source: "auto", active: true, status: "Inactive" }), "Inactive status is skipped");
ok(!vcfMustNotModifyCar({ active_source: "auto", active: true, status: "Off-Lease" }), "active Off-Lease can be updated");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
