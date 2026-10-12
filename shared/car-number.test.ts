/* eslint-disable no-console */
/**
 * Run: npx tsx shared/car-number.test.ts
 */
import {
  CAR_NUMBER_WIDTH,
  defaultRemarkReason,
  describeCarNumberConflict,
  normalizeMarkAndNumber,
  normalizeStoredCarNumber,
} from "./residco-import";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(CAR_NUMBER_WIDTH === 6, "width is 6");
ok(normalizeStoredCarNumber("32115").ok === true && (normalizeStoredCarNumber("32115") as any).car_number === "032115", "pads 32115");
ok(normalizeStoredCarNumber("032115").ok === true && (normalizeStoredCarNumber("032115") as any).car_number === "032115", "keeps 032115");
ok(normalizeStoredCarNumber("0321157").ok === false, "rejects 7 digits");
ok(normalizeStoredCarNumber("32A15").ok === false, "rejects letters");
ok(normalizeMarkAndNumber("OFOX 32115").ok === true, "mark+unpadded ok");
ok(
  normalizeMarkAndNumber("OFOX 32115").ok &&
    (normalizeMarkAndNumber("OFOX 32115") as any).car_number === "032115" &&
    (normalizeMarkAndNumber("OFOX 32115") as any).reporting_marks === "OFOX",
  "OFOX 32115 → OFOX 032115",
);
ok(normalizeMarkAndNumber("OFOX32115").ok && (normalizeMarkAndNumber("OFOX32115") as any).car_number === "032115", "concatenated pads");
ok(!normalizeMarkAndNumber("OFOX").ok, "marks only rejected");
ok(
  defaultRemarkReason("CEFX 032115", "OFOX 032115") ===
    "Remarked from CEFX 032115 to OFOX 032115",
  "auto reason",
);
ok(
  describeCarNumberConflict({
    id: 23603,
    reporting_marks: "OFOX",
    car_number: "032115",
    status: "Off-Lease",
    entity: "Main",
    active: false,
  }).includes("record 23603") &&
    describeCarNumberConflict({
      id: 23603,
      reporting_marks: "OFOX",
      car_number: "032115",
      status: "Off-Lease",
      entity: "Main",
      active: false,
    }).startsWith("OFOX 032115 already exists"),
  "conflict names the other record",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
