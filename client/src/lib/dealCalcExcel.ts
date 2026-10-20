import * as XLSX from "xlsx";
import type { DealCalcResult } from "@shared/dealCalc";
import { dealCalcExportSheets } from "@shared/dealCalcScratch";

export function downloadDealCalcExcel(name: string, result: DealCalcResult): void {
  const sheets = dealCalcExportSheets(name, result);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheets.summary), "Summary");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheets.cashFlow), "Cash flow");
  const safe = name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "deal-calc";
  XLSX.writeFile(book, `${safe}.xlsx`);
}
