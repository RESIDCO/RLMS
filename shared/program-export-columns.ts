/**
 * Programs car-sheet export columns.
 *
 * Opt-in for the Programs Excel report only. Railcar CSV, Search CSV/XLSX,
 * and Lease exports do not call this.
 *
 * The program name is the worksheet tab (and Summary "Project Files"), so
 * there is no car-sheet program column. `program` is still always-include
 * if a caller ever emits that key.
 *
 * A missing `only_with_data` query is off. The client sends `1` or `0`
 * explicitly. Only `1` turns the filter on.
 */

import { parseProgramDate } from "./program-dates";

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

/** Core date columns. Custom date fields are added by the export caller. */
export const PROGRAM_CAR_EXPORT_DATE_COLUMNS = [
  "milestone_at",
  "work_complete_at",
  "arrived_at",
  "program_done_at",
  "joined_date",
  "exited_date",
] as const;

const ALWAYS = new Set<string>(PROGRAM_CAR_EXPORT_ALWAYS_COLUMNS);

/** Null, blank, whitespace-only, or an invalid Date. Text such as "N/A" is data. */
export function isEmptyProgramExportValue(value: unknown): boolean {
  if (value == null) return true;
  if (value instanceof Date) return Number.isNaN(value.getTime());
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number" || typeof value === "boolean") return false;
  return String(value).trim() === "";
}

/** A date cell is empty when it is blank or does not parse as a program date. */
export function isEmptyProgramDateValue(value: unknown): boolean {
  if (isEmptyProgramExportValue(value)) return true;
  return parseProgramDate(value) == null;
}

/**
 * Keep `keys` in their existing order.
 * `onlyColumnsWithData` defaults to false so a missing flag leaves the sheet unchanged.
 */
export function selectProgramCarExportColumns(
  keys: readonly string[],
  rows: readonly (Readonly<Record<string, unknown>>)[],
  onlyColumnsWithData = false,
  dateKeys: ReadonlySet<string> = new Set(PROGRAM_CAR_EXPORT_DATE_COLUMNS),
): string[] {
  if (!onlyColumnsWithData) return [...keys];
  return keys.filter((key) => {
    if (ALWAYS.has(key)) return true;
    const empty = dateKeys.has(key) ? isEmptyProgramDateValue : isEmptyProgramExportValue;
    return rows.some((row) => !empty(row[key]));
  });
}

/** Only the explicit value `1` enables the filter. Missing and every other value stay off. */
export function parseOnlyColumnsWithData(raw: unknown): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return false;
  return String(value).trim() === "1";
}

export function withOnlyColumnsWithData(url: string, onlyColumnsWithData: boolean): string {
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}only_with_data=${onlyColumnsWithData ? "1" : "0"}`;
}
