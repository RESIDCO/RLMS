import ExcelJS from "exceljs";
import { whitelistExportCols } from "@shared/column-views";
import { RAILCAR_CSV_COLS } from "@/lib/railcar-csv";

export type SearchExportMeta = {
  query: string;
  filters: string;
  notFound: string[];
  inactive: { id?: number; reporting_marks?: string | null; car_number?: string | null; status?: string | null }[];
  ambiguous: { token: string; matches: { id: number; label: string }[] }[];
  summary: {
    total: number;
    by_type: { key: string; count: number }[];
    by_entity: { key: string; count: number }[];
    by_status: { key: string; count: number }[];
  } | null;
};

function etNow(d = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function colsFor(keys: Iterable<string>) {
  const allowed = RAILCAR_CSV_COLS.map((c) => c.key);
  const picked = whitelistExportCols(allowed, Array.from(keys), allowed);
  const byKey = new Map(RAILCAR_CSV_COLS.map((c) => [c.key, c]));
  return picked.map((k) => byKey.get(k)).filter((c): c is (typeof RAILCAR_CSV_COLS)[number] => Boolean(c));
}

export async function downloadSearchXlsx(
  rows: any[],
  keys: Iterable<string>,
  meta: SearchExportMeta,
  filename?: string,
) {
  const cols = colsFor(keys);
  const wb = new ExcelJS.Workbook();
  const results = wb.addWorksheet("Results");
  results.addRow([
    `Query: ${meta.query || ""}`,
    `Filters: ${meta.filters || "none"}`,
    `Date (ET): ${etNow()}`,
  ]);
  results.addRow(cols.map((c) => c.header));
  for (const row of rows) results.addRow(cols.map((c) => c.get(row)));

  const summary = wb.addWorksheet("Summary");
  summary.addRow(["Group", "Value", "Count"]);
  summary.addRow(["Total", "", meta.summary?.total ?? rows.length]);
  for (const row of meta.summary?.by_type ?? []) summary.addRow(["Car type", row.key, row.count]);
  for (const row of meta.summary?.by_entity ?? []) summary.addRow(["Owner", row.key, row.count]);
  for (const row of meta.summary?.by_status ?? []) summary.addRow(["Fleet status", row.key, row.count]);

  const missing = wb.addWorksheet("Not in RLMS");
  missing.addRow(["Token"]);
  for (const token of meta.notFound) missing.addRow([token]);

  const inactive = wb.addWorksheet("Inactive matches");
  inactive.addRow(["Id", "Marks", "Number", "Status"]);
  for (const row of meta.inactive) {
    inactive.addRow([row.id ?? "", row.reporting_marks ?? "", row.car_number ?? "", row.status ?? ""]);
  }

  const ambiguous = wb.addWorksheet("Ambiguous");
  ambiguous.addRow(["Token", "Matches"]);
  for (const row of meta.ambiguous) {
    ambiguous.addRow([row.token, row.matches.map((m) => m.label || m.id).join("; ")]);
  }

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename ?? `search_results_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}
