/**
 * Programs car-sheet export columns.
 *
 * Opt-in for the Programs Excel report only. Railcar CSV, Search CSV/XLSX,
 * and Lease exports do not call this.
 *
 * The program name is the worksheet tab (and Summary "Project Files"), so
 * there is no car-sheet program column. `program` is still always-include
 * if a caller ever emits that key.
 */

import { isBlankValue, isNaValue } from "./program-tracker-sync";

/**
 * Identity, status, and key dates. These stay on the sheet even when every
 * exported cell is blank. Every other key — optional core columns (flag,
 * notes, shop, OL, repair cost, complete) and custom `cf:*` columns — is
 * dropped when no exported row has a value.
 */
export const PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS = [
  "marks",
  "car_number",
  "program",
  "status",
  "completion",
  "milestone",
  "milestone_at",
  "work_complete_at",
  "arrived_at",
  "program_done_step",
  "program_done_at",
  "joined_date",
  "exited_date",
] as const;

export type ProgramCarExportAlwaysColumn = (typeof PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS)[number];

const ALWAYS = new Set<string>(PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS);

/**
 * Placeholder glyphs stored in place of a blank. N/A markers are handled by
 * the tracker blank rule (`isNaValue`). A real zero, an explicit false, or
 * the text "No" is data.
 */
export const PROGRAM_EXPORT_DEFAULT_EMPTY_TOKENS = ["—", "–"] as const;

const DEFAULT_EMPTY = new Set(
  PROGRAM_EXPORT_DEFAULT_EMPTY_TOKENS.map((token) => token.toLowerCase()),
);

/** Null, empty, whitespace-only, or a default-empty placeholder. */
export function isEmptyProgramExportValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "boolean") return false;
  if (value instanceof Date) return Number.isNaN(value.getTime());
  const text = typeof value === "string" ? value : String(value);
  if (isBlankValue(text) || isNaValue(text)) return true;
  return DEFAULT_EMPTY.has(text.trim().toLowerCase());
}

/**
 * Keep `keys` in their existing order.
 * `onlyColumnsWithData` defaults to true. False returns the same keys unchanged.
 */
export function selectProgramCarExportColumns(
  keys: readonly string[],
  rows: readonly (Readonly<Record<string, unknown>>)[],
  onlyColumnsWithData = true,
): string[] {
  if (!onlyColumnsWithData) return [...keys];
  return keys.filter((key) => {
    if (ALWAYS.has(key)) return true;
    return rows.some((row) => !isEmptyProgramExportValue(row[key]));
  });
}

/** Missing or unrecognized values stay on (the export default). */
export function parseOnlyColumnsWithData(raw: unknown): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === "") return true;
  const s = String(value).trim().toLowerCase();
  return s !== "0" && s !== "false" && s !== "off" && s !== "no";
}

export function withOnlyColumnsWithData(url: string, onlyColumnsWithData: boolean): string {
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}only_with_data=${onlyColumnsWithData ? "1" : "0"}`;
}
