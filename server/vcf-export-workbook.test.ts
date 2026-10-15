/* eslint-disable no-console */
/** Run: npx tsx server/vcf-export-workbook.test.ts */

import { mkdtemp, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import ExcelJS from "exceljs";
import {
  EXCEL_DATE_FMT,
  EXCEL_NUM_FMT_6,
  V_VALID_EXPORT_HEADERS,
  type VValidExportRow,
} from "../shared/vcf-export.ts";
import { writeVcfExportWorkbook } from "./vcf-export-workbook.ts";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const empty = Object.fromEntries(V_VALID_EXPORT_HEADERS.map((h) => [h, ""])) as VValidExportRow;
const sample: VValidExportRow = {
  ...empty,
  CAR_INITIAL: "OFCX",
  CAR_NUMBER: 75192,
  ASSIGNMENT_ID: 266,
  CLIENT_ID: 12,
  START_DATE: "2006-08-06",
  END_DATE: "4000-12-31",
  ACTIVE: -1,
  Entity: "Rail Partners Select",
  Lessee: "Carmeuse Lime & Stone",
};

const dir = await mkdtemp(join(tmpdir(), "vcf-export-"));
const path = join(dir, "out.xlsx");
try {
  await writeVcfExportWorkbook(path, [sample]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheet = wb.getWorksheet("V_VALID_CARS");
  ok(!!sheet, "sheet V_VALID_CARS");
  if (!sheet) throw new Error("missing sheet");
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
  ok(headers.length === 27, "27 headers");
  ok(headers[1] === " UPDATE NEEDED NEXT VCF", "leading space on needed-next");
  ok(headers.every((h, i) => h === V_VALID_EXPORT_HEADERS[i]), "header order");
  const view = sheet.views?.[0];
  ok(view?.state === "frozen" && view?.ySplit === 1, "frozen top row");
  const af = sheet.autoFilter as { from?: { row: number; col?: number; column?: number }; to?: { row: number }; ref?: string } | string | undefined;
  const afRef = typeof af === "string" ? af : af && "ref" in af ? String(af.ref) : "";
  ok(
    afRef === "A1:AA2" ||
      (typeof af === "object" && af?.from?.row === 1 && af?.to?.row === 2),
    `autofilter ${JSON.stringify(af)}`,
  );
  ok(sheet.getColumn(5).numFmt === EXCEL_NUM_FMT_6, "CAR_NUMBER 000000");
  ok(sheet.getColumn(7).numFmt === EXCEL_NUM_FMT_6, "ASSIGNMENT_ID 000000");
  ok(sheet.getColumn(13).numFmt === EXCEL_NUM_FMT_6, "CLIENT_ID 000000");
  ok(sheet.getColumn(9).numFmt === EXCEL_DATE_FMT, "START_DATE mm/dd/yyyy");
  ok(sheet.getColumn(10).numFmt === EXCEL_DATE_FMT, "END_DATE mm/dd/yyyy");
  const data = sheet.getRow(2);
  ok(data.getCell(5).value === 75192, "CAR_NUMBER numeric");
  ok(data.getCell(12).value === -1, "ACTIVE numeric");
  const start = data.getCell(9).value;
  const end = data.getCell(10).value;
  ok(start instanceof Date, "START_DATE is Date");
  ok(end instanceof Date, "END_DATE is Date");
  if (start instanceof Date) ok(start.getFullYear() === 2006 && start.getMonth() === 7 && start.getDate() === 6, "start 2006-08-06");
  if (end instanceof Date) ok(end.getFullYear() === 4000 && end.getMonth() === 11 && end.getDate() === 31, "end 4000-12-31");
} finally {
  await unlink(path).catch(() => undefined);
}

if (failed) {
  console.error(`FAILED ${failed} / ${passed + failed}`);
  process.exit(1);
}
console.log(`ok ${passed}`);
