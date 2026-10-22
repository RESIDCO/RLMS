/* eslint-disable no-console */
/** Run: npx tsx shared/car-export-identity.test.ts */

import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import {
  CAR_EXPORT_MARK_HEADER,
  CAR_EXPORT_NUMBER_HEADER,
  CAR_EXPORT_NUMBER_NUM_FMT,
  COMMITMENT_BACKFILL_HEADERS,
  LEASE_CAR_SHEET_HEADERS,
  RAILCAR_EXPORT_KEYS,
  TURNING50_CAR_SHEET_HEADERS,
  buildKpiCarExport,
  carIdentityCells,
  commitmentBackfillRecords,
  csvCarNumberField,
  ensureLeadingCarKeys,
  exportCarNumberText,
  exportReportingMarkText,
  finalizeProgramCarExportKeys,
  isLeaseIssueCarKind,
  kpiExportKeys,
  leadCarExportTable,
  stampExcelCarNumber,
} from "./car-export-identity";
import { PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS } from "./program-export-columns";
import { inactivatePreviewToCsv, type InactivatePreviewRow } from "./inactivate-cars";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(exportReportingMarkText(" tfox ") === "TFOX", "mark is trimmed and uppercased");
ok(exportCarNumberText("3105") === "003105", "short digit number pads to six");
ok(exportCarNumberText("003105") === "003105", "stored leading zeros stay");
ok(exportCarNumberText(3105) === "003105", "a numeric 3105 is padded back to the RLMS display");
ok(exportCarNumberText("12A45") === "12A45", "a non-digit number is kept as text");
ok(exportCarNumberText("") === "", "blank number stays blank");
ok(csvCarNumberField("3105") === `"=""003105"""`, "csv writes the number as an Excel text formula");
ok(csvCarNumberField("003105") === `"=""003105"""`, "csv keeps an already padded number");

const identity = carIdentityCells({ reporting_marks: "tfox", car_number: "3105" });
ok(identity.mark === "TFOX" && identity.number === "003105", "split fields win");
const fromCombined = carIdentityCells({ car: "CKIX 001234" });
ok(fromCombined.mark === "CKIX" && fromCombined.number === "001234", "a combined car value splits into mark and number");

const kpi = buildKpiCarExport(
  [
    {
      reporting_marks: "tfox",
      car_number: "003105",
      entity: "Main",
      status_tag: "Leased",
      lessee: "Joseph Smith",
    },
  ],
  ["car", "entity", "status_tag", "lessee"],
);
ok(kpi.headers[0] === CAR_EXPORT_MARK_HEADER, "KPI column A is Reporting Mark");
ok(kpi.headers[1] === CAR_EXPORT_NUMBER_HEADER, "KPI column B is Car Number");
ok(kpi.headers.slice(2).join(",") === "entity,status_tag,lessee", "KPI columns after the number keep their order");
ok(kpi.records[0][0] === "TFOX" && kpi.records[0][1] === "003105", "KPI row writes mark and padded number");
ok(kpi.records[0][2] === "Main", "KPI entity shifts right");
ok(
  kpiExportKeys(["entity", "reason"]).join(",") === "reporting_mark,car_number,entity,reason",
  "KPI export still leads with mark and number when the picker omits car",
);

ok(RAILCAR_EXPORT_KEYS[0] === "marks", "railcar/search allow-list column A key is marks");
ok(RAILCAR_EXPORT_KEYS[1] === "car_number", "railcar/search allow-list column B key is car_number");
ok(!(RAILCAR_EXPORT_KEYS as readonly string[]).includes("car"), "railcar export has no concatenated car column");
ok(
  ensureLeadingCarKeys(["lease_type", "marks", "entity", "car_number"]).join(",") === "marks,car_number,lease_type,entity",
  "requested railcar columns put mark and number first",
);

const railcarSrc = readFileSync(new URL("../client/src/lib/railcar-csv.ts", import.meta.url), "utf8");
ok(railcarSrc.includes("RAILCAR_EXPORT_KEYS"), "railcar csv uses the shared key order");
ok(!railcarSrc.includes('${r.reporting_marks ?? ""}'), "railcar csv does not concatenate mark and number");
ok(railcarSrc.includes("csvCarNumberField"), "railcar csv writes the number as text");

ok(LEASE_CAR_SHEET_HEADERS[0] === CAR_EXPORT_MARK_HEADER && LEASE_CAR_SHEET_HEADERS[1] === CAR_EXPORT_NUMBER_HEADER, "lease car sheet leads with mark and number");
ok(LEASE_CAR_SHEET_HEADERS[2] === "Rider", "lease rider column follows the car number");
ok(
  TURNING50_CAR_SHEET_HEADERS[0] === CAR_EXPORT_MARK_HEADER && TURNING50_CAR_SHEET_HEADERS[1] === CAR_EXPORT_NUMBER_HEADER && TURNING50_CAR_SHEET_HEADERS[2] === "OL",
  "turning-50 car sheet leads with mark and number",
);

ok(COMMITMENT_BACKFILL_HEADERS[0] === CAR_EXPORT_MARK_HEADER && COMMITMENT_BACKFILL_HEADERS[1] === CAR_EXPORT_NUMBER_HEADER, "program commitment backfill leads with mark and number");
ok(
  commitmentBackfillRecords([{ reporting_marks: "ckix", car_number: "12", railcar_id: 9, program_name: "Shop" }])[0][1] === "000012",
  "backfill number is padded text",
);

const issue = leadCarExportTable(
  ["railcar_id", "car", "fleet_status", "car_lessee"],
  [{ railcar_id: 4, car: "TFOX 003105", fleet_status: "Leased", car_lessee: "Joseph Smith" }],
);
ok(issue.headers[0] === CAR_EXPORT_MARK_HEADER && issue.headers[1] === CAR_EXPORT_NUMBER_HEADER, "data-issue car csv leads with mark and number");
ok(issue.records[0].join("|") === "TFOX|003105|4|Leased|Joseph Smith", "data-issue row splits the combined car and shifts the rest");
ok(!issue.headers.includes("car"), "combined car column is not repeated");
ok(isLeaseIssueCarKind("ea_on_rent") && isLeaseIssueCarKind("rent_mismatch") && !isLeaseIssueCarKind("duplicates"), "only per-car issue kinds are reshaped");

const lesseeIssue = leadCarExportTable(
  ["k", "lessee", "active_cars"],
  [{ k: "acme", lessee: "Acme", active_cars: 2 }],
);
ok(lesseeIssue.headers[0] === CAR_EXPORT_MARK_HEADER, "helper itself always leads; callers skip it for non-car issues");

ok((PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS as readonly string[]).includes("car_number"), "car number is a standard program column");
ok((PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS as readonly string[]).includes("marks"), "reporting mark is a standard program column");

const programKeys = finalizeProgramCarExportKeys(
  ["status", "notes", "cf:paint", "completion"],
  [{ status: "", notes: "", "cf:paint": "", completion: "" }],
  true,
);
ok(programKeys[0] === "marks" && programKeys[1] === "car_number", "program export puts mark and number in A and B");
ok(programKeys.includes("status") && programKeys.includes("completion"), "standard program columns stay when empty");
ok(!programKeys.includes("notes") && !programKeys.includes("cf:paint"), "only-columns-with-data still drops empty optional columns");

const programOff = finalizeProgramCarExportKeys(
  ["notes", "marks", "status", "car_number"],
  [{ notes: "", marks: "TFOX", status: "", car_number: "" }],
  false,
);
ok(programOff.join(",") === "marks,car_number,notes,status", "toggle off keeps every column and still leads with identity");

const programSrc = readFileSync(new URL("../server/programs.ts", import.meta.url), "utf8");
ok(programSrc.includes("CAR_EXPORT_MARK_HEADER") && programSrc.includes("CAR_EXPORT_NUMBER_HEADER"), "program export headers use the shared names");
ok(programSrc.includes("finalizeProgramCarExportKeys"), "program export uses the shared column order");
ok(programSrc.includes("stampExcelCarNumber"), "program workbook writes the car number as text");

const inactive: InactivatePreviewRow = {
  id: 7,
  car: "TFOX 003105",
  status: "ready",
  message: "Ready to inactivate.",
  blockers: [],
  active: true,
  car_status: "Active",
  assignment: null,
  rent_stop: null,
  programs: [],
  commitment: null,
};
const inactiveCsv = inactivatePreviewToCsv([inactive]);
ok(inactiveCsv.startsWith(`"${CAR_EXPORT_MARK_HEADER}","${CAR_EXPORT_NUMBER_HEADER}"`), "inactivate preview leads with mark and number");
ok(inactiveCsv.includes(`"=""003105"""`), "inactivate preview keeps the leading zeros");

const wb = new ExcelJS.Workbook();
const sheet = wb.addWorksheet("cars");
sheet.addRow([CAR_EXPORT_MARK_HEADER, CAR_EXPORT_NUMBER_HEADER, "Lease Type"]);
const data = sheet.addRow(["TFOX", "003105", "Full Service Lease"]);
stampExcelCarNumber(data.getCell(2), "003105");
const loaded = new ExcelJS.Workbook();
await loaded.xlsx.load(await wb.xlsx.writeBuffer());
const out = loaded.getWorksheet("cars");
const headerValues = (out?.getRow(1).values as unknown[] | undefined)?.slice(1).map((value) => String(value ?? "")) ?? [];
const numberCell = out?.getRow(2).getCell(2);
ok(headerValues[0] === CAR_EXPORT_MARK_HEADER && headerValues[1] === CAR_EXPORT_NUMBER_HEADER, "xlsx header order round-trips");
ok(String(numberCell?.value ?? "") === "003105", "xlsx car number round-trips as 003105");
ok(numberCell?.numFmt === CAR_EXPORT_NUMBER_NUM_FMT, "xlsx car number format is text");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
