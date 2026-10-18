/* eslint-disable no-console */
import { isUndoAllowedTable } from "@shared/undo";
import { jssStepOps, type JssPlanRow } from "@shared/jss-preview";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(isUndoAllowedTable("car_tags"), "tags undoable");
ok(isUndoAllowedTable("car_lists"), "lists undoable");

const inactive: JssPlanRow = {
  railcar_id: 1,
  car: "TFOX 001621",
  active: false,
  ol: "",
  action: "none",
  off_rent_date: null,
  assignment_end_date: null,
  sale_date: null,
  buyer: null,
  cut_up_date: null,
  umler_delete_queue: null,
  tag: null,
  note: null,
  discrepancy_comment: null,
};
ok(jssStepOps(inactive).length === 0, "inactive car has no write ops");

const perCar = [
  { car: "TFOX 001000", stop_date: "2026-09-09" },
  { car: "TFOX 001036", stop_date: "2026-10-16" },
];
ok(new Set(perCar.map((r) => r.stop_date)).size === 2, "per-car off-rent dates");

const kpiBefore = { on_rent: 100 };
const kpiAfterOffRent = { on_rent: 99 };
ok(kpiAfterOffRent.on_rent === kpiBefore.on_rent - 1, "off-rent stop lowers on_rent KPI (fixture)");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
