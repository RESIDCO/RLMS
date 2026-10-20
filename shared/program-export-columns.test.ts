/* eslint-disable no-console */
/** Run: npx tsx shared/program-export-columns.test.ts */

import {
  PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS,
  isEmptyProgramDateValue,
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
  filtered.join(",") === "marks,status,notes,cf:paint,car_number,joined_date",
  "empty optional dropped, N/A text kept, empty core kept, order preserved",
);

const unchanged = selectProgramCarExportColumns(keys, rows, false);
ok(unchanged.join(",") === keys.join(","), "toggle off is unchanged output");
ok(unchanged.length === keys.length && unchanged.every((key, i) => key === keys[i]), "toggle off keeps order");
ok(selectProgramCarExportColumns(keys, rows).join(",") === keys.join(","), "omitted flag leaves every column");

const shopKeys = ["marks", "shop", "cf:lessee", "repair_cost_total"];
const shopRows = [
  { marks: "TFOX", shop: "", "cf:lessee": "", repair_cost_total: null },
  { marks: "TFOX", shop: "  ", "cf:lessee": null, repair_cost_total: "   " },
  { marks: "", shop: "Metalico", "cf:lessee": "  n/a  ", repair_cost_total: null },
];
ok(
  selectProgramCarExportColumns(shopKeys, shopRows, true).join(",") === "marks,shop,cf:lessee",
  "one shop value stays, N/A text stays, blank repair cost drops",
);

ok(
  selectProgramCarExportColumns(["status", "joined_date", "program"], [{ status: "", joined_date: null, program: "   " }], true).join(",")
    === "status,joined_date,program",
  "core identity columns stay when every cell is empty",
);

ok(
  selectProgramCarExportColumns(
    ["notes", "cf:ok", "repair_cost_total"],
    [{ notes: "", "cf:ok": false, repair_cost_total: 0 }],
    true,
  ).join(",") === "cf:ok,repair_cost_total",
  "explicit false and zero are data",
);

const dateKeys = new Set(["cf:arrived_shop_date", "joined_date"]);
ok(
  selectProgramCarExportColumns(
    ["cf:arrived_shop_date", "cf:note", "shop"],
    [
      { "cf:arrived_shop_date": "N/A", "cf:note": "N/A", shop: "" },
      { "cf:arrived_shop_date": "not-a-date", "cf:note": "n.a.", shop: "   " },
    ],
    true,
    dateKeys,
  ).join(",") === "cf:note",
  "invalid dates drop and N/A text stays",
);
ok(
  selectProgramCarExportColumns(
    ["cf:arrived_shop_date", "cf:note"],
    [
      { "cf:arrived_shop_date": "", "cf:note": "   " },
      { "cf:arrived_shop_date": "2024-03-01", "cf:note": null },
    ],
    true,
    dateKeys,
  ).join(",") === "cf:arrived_shop_date",
  "a date column with one valid value stays",
);

ok(selectProgramCarExportColumns(["flag_tag", "notes"], [], true).join(",") === "", "no rows drops every optional column");
ok(
  selectProgramCarExportColumns(["marks", "notes"], [], true).join(",") === "marks",
  "no rows still keeps core columns",
);

ok(isEmptyProgramExportValue(null) && isEmptyProgramExportValue(undefined), "null is empty");
ok(isEmptyProgramExportValue("") && isEmptyProgramExportValue(" \t "), "blank and whitespace are empty");
ok(isEmptyProgramExportValue(new Date(NaN)), "invalid Date is empty");
ok(!isEmptyProgramExportValue("N/A") && !isEmptyProgramExportValue("n/a") && !isEmptyProgramExportValue("#N/A"), "N/A text is data");
ok(!isEmptyProgramExportValue("—") && !isEmptyProgramExportValue("–"), "dash placeholders are data");
ok(!isEmptyProgramExportValue(0) && !isEmptyProgramExportValue(false) && !isEmptyProgramExportValue("No"), "zero, false, and No are values");
ok(!isEmptyProgramExportValue("Watch"), "text is a value");

ok(isEmptyProgramDateValue(null) && isEmptyProgramDateValue("") && isEmptyProgramDateValue("  "), "blank dates are empty");
ok(isEmptyProgramDateValue("N/A") && isEmptyProgramDateValue("not-a-date") && isEmptyProgramDateValue(new Date(NaN)), "invalid dates are empty");
ok(!isEmptyProgramDateValue("2024-03-01") && !isEmptyProgramDateValue("03/01/2024"), "parsed dates are values");

for (const key of ["marks", "car_number", "program", "status", "milestone_at", "arrived_at", "program_done_at", "joined_date", "exited_date"]) {
  ok((PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS as readonly string[]).includes(key), `${key} is always included`);
}
for (const key of ["flag_tag", "notes", "shop", "repair_cost_total", "completed", "ol_snapshot"]) {
  ok(!(PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS as readonly string[]).includes(key), `${key} is optional`);
}

ok(!parseOnlyColumnsWithData(undefined) && !parseOnlyColumnsWithData(null) && !parseOnlyColumnsWithData(""), "missing param is off");
ok(parseOnlyColumnsWithData("1") && parseOnlyColumnsWithData(" 1 ") && parseOnlyColumnsWithData(["1"]), "only 1 turns the filter on");
ok(
  !parseOnlyColumnsWithData("0") && !parseOnlyColumnsWithData("true") && !parseOnlyColumnsWithData("yes") && !parseOnlyColumnsWithData(["off"]),
  "other values stay off",
);
ok(withOnlyColumnsWithData("/api/programs/export?ids=1", true) === "/api/programs/export?ids=1&only_with_data=1", "on appends 1");
ok(withOnlyColumnsWithData("/api/programs/9/export", false) === "/api/programs/9/export?only_with_data=0", "off appends 0");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
