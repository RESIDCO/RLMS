import * as XLSX from "xlsx";
import { looksLikeVcf } from "@shared/vcf-import";

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v);
}

function sheetToObjects(wb: XLSX.WorkBook): Record<string, string>[] {
  const preferred =
    wb.SheetNames.find((n) => /^V_VALID_CARS$/i.test(n)) ||
    wb.SheetNames.find((n) => /valid.?car/i.test(n)) ||
    wb.SheetNames[0];
  const ws = wb.Sheets[preferred];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }) as Record<string, unknown>[];
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[k] = cellToString(v);
    return out;
  });
}

/** Parse an uploaded VCF Excel/CSV buffer on the server. */
export function parseVcfUpload(buffer: Buffer, filename: string): Record<string, string>[] {
  const name = String(filename ?? "").toLowerCase();
  const wb = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: name.endsWith(".csv") || name.endsWith(".txt"),
  });
  const rows = sheetToObjects(wb);
  if (!rows.length) throw new Error("No data rows found in file.");
  if (!looksLikeVcf(rows)) {
    throw new Error("This does not look like a Valid Car File (need CAR_INITIAL, CAR_NUMBER, ACTIVE, ASSIGNMENT_ID).");
  }
  return rows;
}
