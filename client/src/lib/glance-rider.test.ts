/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/glance-rider.test.ts */

import { glanceRiderFromCar } from "./glance-rider";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(glanceRiderFromCar({}) === null, "no assignment is not a glance rider");
ok(glanceRiderFromCar({ assignment: { rider: { id: 9, rider_name: "OL 1" } } })?.id === 9, "nested rider id");
ok(
  glanceRiderFromCar({ assignment: { rider: { id: 2 } }, cars_on_rider_ar: 12 })?.car_count === 12,
  "falls back to cars_on_rider_ar",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
