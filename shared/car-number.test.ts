/* eslint-disable no-console */
/**
 * Run: npx tsx shared/car-number.test.ts
 */
import {
  CAR_NUMBER_WIDTH,
  defaultRemarkReason,
  describeCarNumberConflict,
  formatCarId,
  normalizeMarkAndNumber,
  normalizeStoredCarNumber,
} from "./residco-import";
import { KPI_BUCKETS, KPI_COL_LAYOUT, KPI_SORT_COLS } from "./kpi-buckets";

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
ok(
  normalizeMarkAndNumber("0FOX815215").ok &&
    (normalizeMarkAndNumber("0FOX815215") as any).reporting_marks === "OFOX" &&
    (normalizeMarkAndNumber("0FOX815215") as any).car_number === "815215",
  "leading zero mark is the letter O",
);
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

ok(formatCarId({ reporting_marks: "ELTX", car_number: "3105" }) === "ELTX 003105", "ELTX 3105 → ELTX 003105");
ok(formatCarId({ reporting_marks: "ELTX", car_number: "003105" }) === "ELTX 003105", "already padded");
ok(formatCarId({ reporting_marks: "AOKX", car_number: "495931" }) === "AOKX 495931", "AOKX 495931");
ok(formatCarId("CKIX 1750") === "CKIX 001750", "combined string pads");
ok(formatCarId("CKIX  001750") === "CKIX 001750", "collapses spaces");
ok(!/\s{2,}/.test(formatCarId("ELTX 3105")), "single space");
ok(!/\n/.test(formatCarId("ELTX 3105")), "one line");
ok(/^[A-Z]+ \d{6}$/.test(formatCarId({ reporting_marks: "OCCX", car_number: "123" })), "MARK NNNNNN");
ok(KPI_SORT_COLS[0] === "car", "car is first column");
ok(
  KPI_SORT_COLS.every((c) => KPI_COL_LAYOUT[c]?.minWidth),
  "every KPI column has a width",
);
for (const bucket of KPI_BUCKETS) {
  ok(KPI_SORT_COLS[0] === "car" && formatCarId("ELTX 3105") === "ELTX 003105", `${bucket} same car format`);
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
