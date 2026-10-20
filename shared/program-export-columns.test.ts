/* eslint-disable no-console */
/** Run: npx tsx shared/program-export-columns.test.ts */

import {
  PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS,
  isEmptyProgramExportValue,
  parseOnlyColumnsWithData,
  selectProgramCarExportColumns,
  withOnlyColumnsWithData,
} from "./program-export-columns";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const keys = ["marks", "flag_tag", "status", "notes", "cf:paint", "car_number", "joined_date"];
const rows = [
  {
    marks: "",
    flag_tag: "   ",
    status: "",
    notes: null,
    "cf:paint": "N/A",
    car_number: " ",
    joined_date: null,
  },
  {
    marks: null,
    flag_tag: "",
    status: "",
    notes: "hold",
    "cf:paint": "—",
    car_number: "",
    joined_date: "",
  },
];

const filtered = selectProgramCarExportColumns(keys, rows, true);
ok(
  filtered.join(",") === "marks,status,notes,car_number,joined_date",
  "empty optional dropped, one value kept, empty core kept, order preserved",
);

const unchanged = selectProgramCarExportColumns(keys, rows, false);
ok(unchanged.join(",") === keys.join(","), "toggle off is unchanged output");
ok(unchanged.length === keys.length && unchanged.every((key, i) => key === keys[i]), "toggle off keeps order");

const shopKeys = ["marks", "shop", "cf:lessee", "repair_cost_total"];
const shopRows = [
  { marks: "TFOX", shop: "", "cf:lessee": "", repair_cost_total: null },
  { marks: "TFOX", shop: "  ", "cf:lessee": null, repair_cost_total: "   " },
  { marks: "", shop: "Metalico", "cf:lessee": "  n/a  ", repair_cost_total: null },
];
ok(
  selectProgramCarExportColumns(shopKeys, shopRows).join(",") === "marks,shop",
  "a single populated optional column stays and empty custom columns drop",
);

ok(
  selectProgramCarExportColumns(["status", "joined_date", "program"], [{ status: "", joined_date: null, program: "   " }]).join(",")
    === "status,joined_date,program",
  "core identity columns stay when every cell is empty",
);

ok(
  selectProgramCarExportColumns(
    ["notes", "cf:ok", "repair_cost_total"],
    [{ notes: "", "cf:ok": false, repair_cost_total: 0 }],
  ).join(",") === "cf:ok,repair_cost_total",
  "explicit false and zero are data",
);

ok(selectProgramCarExportColumns(["flag_tag", "notes"], []).join(",") === "", "no rows drops every optional column");
ok(
  selectProgramCarExportColumns(["marks", "notes"], []).join(",") === "marks",
  "no rows still keeps core columns",
);

ok(isEmptyProgramExportValue(null) && isEmptyProgramExportValue(undefined), "null is empty");
ok(isEmptyProgramExportValue("") && isEmptyProgramExportValue(" \t "), "blank and whitespace are empty");
ok(isEmptyProgramExportValue("N/A") && isEmptyProgramExportValue("—") && isEmptyProgramExportValue("–"), "default-empty placeholders are empty");
ok(!isEmptyProgramExportValue(0) && !isEmptyProgramExportValue(false) && !isEmptyProgramExportValue("No"), "zero, false, and No are values");
ok(!isEmptyProgramExportValue("Watch"), "text is a value");

for (const key of ["marks", "car_number", "program", "status", "milestone_at", "arrived_at", "program_done_at", "joined_date", "exited_date"]) {
  ok((PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS as readonly string[]).includes(key), `${key} is always included`);
}
for (const key of ["flag_tag", "notes", "shop", "repair_cost_total", "completed", "ol_snapshot"]) {
  ok(!(PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS as readonly string[]).includes(key), `${key} is optional`);
}

ok(parseOnlyColumnsWithData(undefined) && parseOnlyColumnsWithData("") && parseOnlyColumnsWithData("1"), "default and on stay on");
ok(!parseOnlyColumnsWithData("0") && !parseOnlyColumnsWithData("false") && !parseOnlyColumnsWithData(["off"]), "explicit off");
ok(withOnlyColumnsWithData("/api/programs/export?ids=1", true) === "/api/programs/export?ids=1&only_with_data=1", "on appends 1");
ok(withOnlyColumnsWithData("/api/programs/9/export", false) === "/api/programs/9/export?only_with_data=0", "off appends 0");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
