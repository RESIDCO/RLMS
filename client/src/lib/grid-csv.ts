import { csvCarNumberField, csvField } from "@shared/car-export-identity";

/** Download a small grid as CSV. Indexes in `textColumns` are written so Excel keeps leading zeros. */
export function downloadGridCsv(filename: string, headers: string[], records: string[][], textColumns: number[] = []) {
  const text = new Set(textColumns);
  const lines = [
    headers.map((cell) => csvField(cell)).join(","),
    ...records.map((row) => row.map((cell, index) => (text.has(index) ? csvCarNumberField(cell) : csvField(cell))).join(",")),
  ];
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
