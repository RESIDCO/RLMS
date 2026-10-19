/* eslint-disable no-console */
/** Run: npx tsx shared/money.test.ts */

import ExcelJS from "exceljs";
import {
  AUDITED_PROGRAM_MONEY_KEYS,
  USD_EXCEL_NUM_FMT,
  excelMoneyValue,
  formatMoneyCell,
  formatUsd,
  isProgramMoneyField,
  moneyNumber,
  parseUsdInput,
} from "./money";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(formatUsd(12686.96) === "$12,686.96", "USD commas and 2 decimals");
ok(formatUsd("12686.9") === "$12,686.90", "string money still gets 2 decimals");
ok(formatUsd(0) === "$0.00", "zero is a real amount");
ok(formatUsd(null) === "", "null stays blank");
ok(formatUsd(undefined) === "", "undefined stays blank");
ok(formatUsd("") === "", "empty string stays blank");
ok(formatUsd("pending") === "", "non-numeric is not a dollar figure");
ok(formatMoneyCell("pending") === "pending", "a non-numeric leftover stays visible");
ok(formatMoneyCell(null) === "", "money cell blank for null");
ok(parseUsdInput("") === null, "clearing the input stores null");
ok(parseUsdInput("$12,686.96") === 12686.96, "parse strips $ and commas");
ok(parseUsdInput("abc") === undefined, "invalid input does not replace the stored value");
ok(moneyNumber(12686.96) === 12686.96, "numbers pass through");

const stored = { original_code6: 12686.96 };
formatUsd(stored.original_code6);
ok(stored.original_code6 === 12686.96, "formatting does not change the stored value");

const money = excelMoneyValue(12686.96);
ok(money.value === 12686.96 && money.numFmt === USD_EXCEL_NUM_FMT, "excel keeps the number and a currency format");
ok(excelMoneyValue(null).value == null && excelMoneyValue(null).numFmt == null, "excel null stays an empty cell");

const wb = new ExcelJS.Workbook();
const sheet = wb.addWorksheet("Program");
const cell = sheet.getCell("A1");
cell.value = money.value;
cell.numFmt = money.numFmt ?? USD_EXCEL_NUM_FMT;
ok(typeof cell.value === "number" && cell.value === 12686.96, "worksheet cell is numeric");
ok(cell.numFmt === "$#,##0.00", "worksheet numFmt is currency");

for (const key of AUDITED_PROGRAM_MONEY_KEYS) {
  ok(isProgramMoneyField({ field_key: key, field_type: key === "repair" ? "number" : "currency" }, key), `${key} is money`);
}
ok(isProgramMoneyField({ field_key: "original_code6", label: "Original Code 6", field_type: "currency" }), "original code 6");
ok(isProgramMoneyField({ field_key: "original_code7", label: "Original Code 7", field_type: "currency" }), "original code 7");
ok(isProgramMoneyField({ field_key: "original_brc_total", label: "Original total BRC", field_type: "currency" }), "original BRC total");
ok(isProgramMoneyField({ field_key: "final_brc_total", label: "Final total BRC", field_type: "currency" }), "final BRC total");
ok(isProgramMoneyField({ field_key: "final_code6", label: "Final Code 6", field_type: "currency" }), "final code 6");
ok(isProgramMoneyField({ field_key: "spend", label: "Spend", field_type: "text" }), "spend label is money");
ok(isProgramMoneyField({ field_key: "resp_6_costs", label: "Resp 6 costs", field_type: "number" }), "Resp 6 costs label is money");
ok(
  !isProgramMoneyField({
    field_key: "original_code6_lessee_approval",
    label: "Original Code 6 lessee approval",
    field_type: "date",
  }),
  "Code 6 approval date is not money",
);
ok(isProgramMoneyField({ field_key: "notes", label: "Notes", field_type: "text" }) === false, "notes are not money");
ok(isProgramMoneyField(null, "repair"), "repair column is money");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
