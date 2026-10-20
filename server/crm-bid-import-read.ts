import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { BidImportError, type ImportCell, type ImportGrid } from "@shared/bid-import";

function plainCell(value: ExcelJS.CellValue): ImportCell {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("");
    }
    if ("result" in value) {
      const result = value.result;
      if (result == null) return null;
      if (result instanceof Date || typeof result === "number" || typeof result === "boolean") return result;
      return String(result);
    }
    if ("text" in value && value.text != null) return String(value.text);
    if ("hyperlink" in value && "text" in value) return String(value.text ?? "");
  }
  return String(value);
}

export async function gridsFromXlsx(bytes: Uint8Array): Promise<ImportGrid[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes));
  } catch {
    throw new BidImportError(400, "Could not read that .xlsx file");
  }
  return workbook.worksheets.map((sheet) => {
    const width = Math.max(sheet.columnCount, 1);
    const rows: ImportCell[][] = [];
    for (let r = 1; r <= sheet.rowCount; r += 1) {
      const source = sheet.getRow(r);
      const row: ImportCell[] = [];
      for (let c = 1; c <= width; c += 1) row.push(plainCell(source.getCell(c).value));
      rows.push(row);
    }
    return { name: sheet.name, rows };
  });
}

export function gridsFromCsv(bytes: Uint8Array, name: string): ImportGrid[] {
  let records: string[][];
  try {
    records = parseCsv(Buffer.from(bytes), {
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
    }) as string[][];
  } catch {
    throw new BidImportError(400, "Could not read that .csv file");
  }
  const rows = records.map((record) => record.map((cell) => (cell == null ? null : String(cell))));
  const base = name.replace(/\.[^.]+$/, "") || "Sheet";
  return [{ name: base, rows }];
}
