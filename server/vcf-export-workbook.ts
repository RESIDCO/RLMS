import ExcelJS from "exceljs";
import {
  V_VALID_EXPORT_COLUMN_WIDTHS,
  V_VALID_EXPORT_HEADERS,
  excelNumFmtForHeader,
  exportRowToValues,
  type VValidExportRow,
} from "@shared/vcf-export";

/**
 * Streaming ExcelJS WorksheetWriter: `views` is read-only (options only).
 * `autoFilter` and column width/numFmt are writable properties.
 */
export async function writeVcfExportWorkbook(tmpPath: string, rows: VValidExportRow[]): Promise<number> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: tmpPath,
    useStyles: true,
    useSharedStrings: false,
  });
  const last = Math.max(1, rows.length + 1);
  const sheet = workbook.addWorksheet("V_VALID_CARS", {
    views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: last, column: V_VALID_EXPORT_HEADERS.length },
  };
  V_VALID_EXPORT_HEADERS.forEach((h, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = V_VALID_EXPORT_COLUMN_WIDTHS[i] ?? 12;
    const fmt = excelNumFmtForHeader(h);
    if (fmt) col.numFmt = fmt;
  });

  const header = sheet.addRow([...V_VALID_EXPORT_HEADERS]);
  header.font = { bold: true };
  header.commit();
  for (const row of rows) {
    sheet.addRow(exportRowToValues(row)).commit();
  }
  await workbook.commit();
  return rows.length;
}
