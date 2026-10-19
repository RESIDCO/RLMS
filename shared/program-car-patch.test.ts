/* eslint-disable no-console */
/** Run: npx tsx shared/program-car-patch.test.ts */

import { deriveCompletionLevel, programCarKeepOpen } from "./programs";
import { patchColumns, patchWritesCompletedColumn, PROGRAM_COMPLETE_CF } from "./program-car-patch";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const today = new Date().toISOString().slice(0, 10);

const openCar = {
  status: "Enroute",
  outcome_reached_at: null,
  custom_fields: { __keep_open: true, shop_note: "hold" },
};
const doneCar = {
  status: "COMPLETE – ARRIVED",
  outcome_reached_at: "2026-10-01",
  custom_fields: { __complete: true, __keep_open: true },
};

function fields(cols: Record<string, unknown>): Record<string, unknown> {
  return cols.custom_fields as Record<string, unknown>;
}

const bulkSet = [openCar, doneCar].map((prior) => patchColumns({ completed: true }, prior));
ok(bulkSet.length === 2, "bulk set builds one write per selected car");
ok(bulkSet.every((cols) => !patchWritesCompletedColumn(cols)), "bulk set does not write completed or completed_at");
ok(bulkSet.every((cols) => fields(cols)[PROGRAM_COMPLETE_CF] === true), "bulk set stores __complete true");
ok(fields(bulkSet[0]).__keep_open === true && fields(bulkSet[0]).shop_note === "hold", "bulk set keeps __keep_open and other fields");
ok(bulkSet[0].outcome_reached_at === today, "bulk set stamps an outcome date when the car has none");
ok(!("outcome_reached_at" in bulkSet[1]), "bulk set leaves an existing outcome date alone");

const bulkClear = [openCar, doneCar].map((prior) => patchColumns({ completed: false }, prior));
ok(bulkClear.length === 2, "bulk clear builds one write per selected car");
ok(bulkClear.every((cols) => !patchWritesCompletedColumn(cols)), "bulk clear does not write completed or completed_at");
ok(bulkClear.every((cols) => fields(cols)[PROGRAM_COMPLETE_CF] === false), "bulk clear stores __complete false");
ok(bulkClear.every((cols) => cols.outcome_reached_at === null), "bulk clear clears the outcome date");
ok(fields(bulkClear[0]).__keep_open === true && fields(bulkClear[1]).__keep_open === true, "bulk clear keeps __keep_open");

ok(!patchWritesCompletedColumn(patchColumns({ completed: "true" }, openCar)), "string true does not write the column");
ok(fields(patchColumns({ completed: "1" }, openCar))[PROGRAM_COMPLETE_CF] === true, "1 counts as complete");
ok(fields(patchColumns({ completed: "false" }, doneCar))[PROGRAM_COMPLETE_CF] === false, "string false clears complete");

const leftComplete = patchColumns({ status: "Enroute" }, doneCar);
ok(!patchWritesCompletedColumn(leftComplete), "leaving a Complete status does not write the column");
ok(fields(leftComplete)[PROGRAM_COMPLETE_CF] === false, "leaving a Complete status clears __complete");
ok(programCarKeepOpen(leftComplete.custom_fields), "leaving Complete keeps __keep_open");

const unchecked = patchColumns({ outcome_reached: false }, doneCar);
ok(!patchWritesCompletedColumn(unchecked), "clearing the outcome checkbox does not write the column");
ok(fields(unchecked)[PROGRAM_COMPLETE_CF] === false, "clearing the outcome checkbox clears __complete");
ok(programCarKeepOpen(unchecked.custom_fields), "clearing the outcome checkbox keeps __keep_open");

ok(
  deriveCompletionLevel({ active: false, keep_open: true, status: "Enroute", completed: false, outcome_reached_at: null }) === "in_progress",
  "inactive with keep open stays in progress",
);
ok(
  deriveCompletionLevel({ active: false, keep_open: false, completed: false }) === "program_done",
  "inactive without keep open is still program done",
);
ok(
  deriveCompletionLevel({ active: true, railcar_status: "Inactive", keep_open: false }) === "program_done",
  "Inactive status is still program done",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
