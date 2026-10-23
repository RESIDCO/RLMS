/**
 * Car-level spreadsheet identity.
 *
 * Column A is the reporting mark and column B is the car number, on every
 * car-level export. The number is the RLMS display value (digits padded to
 * six) and is written as text so Excel keeps leading zeros (003105).
 */

import { normalizeStoredCarNumber, splitCarNumber } from "./residco-import";
import { selectProgramCarExportColumns } from "./program-export-columns";
import { FOCUS_COLUMN_LABELS, RENT_STOP_COLUMN_KEYS } from "./saved-views";

export const CAR_EXPORT_MARK_HEADER = "Reporting Mark";
export const CAR_EXPORT_NUMBER_HEADER = "Car Number";

/** Excel text format. A numeric format would still be a number under the zeros. */
export const CAR_EXPORT_NUMBER_NUM_FMT = "@";

const MARK_FIELDS = ["reporting_marks", "reporting_mark", "marks", "car_initial", "mark"] as const;
const NUMBER_FIELDS = ["car_number", "number"] as const;

export type CarIdentitySource = {
  reporting_marks?: unknown;
  reporting_mark?: unknown;
  marks?: unknown;
  car_initial?: unknown;
  mark?: unknown;
  car_number?: unknown;
  number?: unknown;
  car?: unknown;
};

function firstText(values: readonly unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/** Uppercase mark, or blank. Display only. */
export function exportReportingMarkText(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

/**
 * Car number as RLMS shows it. Digit strings pad to six characters.
 * Anything else is kept as text and is never coerced with Number().
 */
export function exportCarNumberText(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const norm = normalizeStoredCarNumber(text);
  if (norm.ok) return norm.car_number;
  return text;
}

export function carIdentityCells(source: CarIdentitySource): { mark: string; number: string } {
  const markRaw = firstText([
    source.reporting_marks,
    source.reporting_mark,
    source.marks,
    source.car_initial,
    source.mark,
  ]);
  const numberRaw = firstText([source.car_number, source.number]);
  if (markRaw || numberRaw) {
    return {
      mark: exportReportingMarkText(markRaw),
      number: exportCarNumberText(numberRaw),
    };
  }
  const split = splitCarNumber(source.car ?? "");
  return {
    mark: exportReportingMarkText(split.reporting_marks),
    number: exportCarNumberText(split.car_number),
  };
}

/** Quote a CSV field. */
export function csvField(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * CSV cell Excel opens as text. `="003105"` displays as 003105, including the zeros.
 * Already-padded text is left padded; short digit strings are padded first.
 */
export function csvCarNumberField(raw: unknown): string {
  const text = exportCarNumberText(raw);
  if (!text) return csvField("");
  return `"=""${text.replace(/"/g, '""')}"""`;
}

export function csvRow(cells: readonly unknown[], textIndexes: readonly number[] = []): string {
  const text = new Set(textIndexes);
  return cells.map((cell, index) => (text.has(index) ? csvCarNumberField(cell) : csvField(cell))).join(",");
}

export type ExcelTextCell = { value: unknown; numFmt?: string };

/** Force one worksheet cell to the RLMS car number as text. */
export function stampExcelCarNumber(cell: ExcelTextCell, raw: unknown): void {
  cell.value = exportCarNumberText(raw);
  cell.numFmt = CAR_EXPORT_NUMBER_NUM_FMT;
}

/** Move mark and number keys to the front without duplicating them. */
export function ensureLeadingCarKeys(
  keys: readonly string[],
  markKey = "marks",
  numberKey = "car_number",
): string[] {
  const rest = keys.filter((key) => key !== markKey && key !== numberKey);
  return [markKey, numberKey, ...rest];
}

/**
 * Program car sheets. Identity stays in A/B even when `cols` omits it.
 * `onlyColumnsWithData` still drops empty optional columns; car number is standard
 * and is kept by the always-include set.
 */
export function finalizeProgramCarExportKeys(
  keys: readonly string[],
  rows: readonly (Readonly<Record<string, unknown>>)[],
  onlyColumnsWithData = false,
  dateKeys?: ReadonlySet<string>,
): string[] {
  const lead = ensureLeadingCarKeys(keys);
  const selected = dateKeys
    ? selectProgramCarExportColumns(lead, rows, onlyColumnsWithData, dateKeys)
    : selectProgramCarExportColumns(lead, rows, onlyColumnsWithData);
  return ensureLeadingCarKeys(selected);
}

export const KPI_EXPORT_DATA_KEYS = [
  "entity",
  "status_tag",
  "derived_status",
  "current_lease",
  "lessee",
  "legal_owner",
  "buyer",
  "commitment",
  "rent_start_date",
  "last_ol",
  "reason",
  ...RENT_STOP_COLUMN_KEYS,
] as const;

export type KpiExportDataKey = (typeof KPI_EXPORT_DATA_KEYS)[number];
export type KpiExportKey = "reporting_mark" | "car_number" | KpiExportDataKey;

const KPI_DATA_KEY_SET = new Set<string>(KPI_EXPORT_DATA_KEYS);

function isKpiDataKey(key: string): key is KpiExportDataKey {
  return KPI_DATA_KEY_SET.has(key);
}

/** `car` in the column picker becomes Reporting Mark + Car Number. Other keys stay in order. */
export function kpiExportKeys(requested: readonly string[] | null | undefined): KpiExportKey[] {
  const source = requested == null ? ["car", ...KPI_EXPORT_DATA_KEYS] : requested;
  const rest: KpiExportDataKey[] = [];
  const seen = new Set<string>();
  for (const key of source) {
    if (key === "car" || key === "reporting_mark" || key === "car_number") continue;
    if (!isKpiDataKey(key) || seen.has(key)) continue;
    seen.add(key);
    rest.push(key);
  }
  return ["reporting_mark", "car_number", ...rest];
}

export function kpiExportHeader(key: KpiExportKey): string {
  switch (key) {
    case "reporting_mark":
      return CAR_EXPORT_MARK_HEADER;
    case "car_number":
      return CAR_EXPORT_NUMBER_HEADER;
    case "entity":
    case "status_tag":
    case "derived_status":
    case "current_lease":
    case "lessee":
    case "legal_owner":
    case "buyer":
    case "commitment":
    case "rent_start_date":
    case "last_ol":
    case "reason":
      return key;
    case "open_stop_type":
    case "open_stop_since":
    case "open_stop_days":
    case "open_stop_expected":
    case "open_stop_reason":
    case "open_stop_note":
      return FOCUS_COLUMN_LABELS[key];
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

export function kpiExportCell(row: CarIdentitySource & Record<string, unknown>, key: KpiExportKey): string {
  switch (key) {
    case "reporting_mark":
      return carIdentityCells(row).mark;
    case "car_number":
      return carIdentityCells(row).number;
    case "entity":
    case "status_tag":
    case "derived_status":
    case "current_lease":
    case "lessee":
    case "legal_owner":
    case "buyer":
    case "commitment":
    case "rent_start_date":
    case "last_ol":
    case "reason":
    case "open_stop_type":
    case "open_stop_since":
    case "open_stop_days":
    case "open_stop_expected":
    case "open_stop_reason":
    case "open_stop_note": {
      const value = row[key];
      return value == null ? "" : String(value);
    }
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

export function buildKpiCarExport(
  rows: readonly (CarIdentitySource & Record<string, unknown>)[],
  requested: readonly string[] | null | undefined,
): { headers: string[]; records: string[][] } {
  const keys = kpiExportKeys(requested);
  return {
    headers: keys.map(kpiExportHeader),
    records: rows.map((row) => keys.map((key) => kpiExportCell(row, key))),
  };
}

/**
 * Railcar and Search exports. Visible-column order is applied by the caller.
 * `car` (mark concatenated with number) is not a column.
 */
export const RAILCAR_EXPORT_KEYS = [
  "marks",
  "car_number",
  "rider_external_id",
  "lessee",
  "entity",
  "active",
  "data_source",
  "type",
  "description",
  "assignment_label",
  "lease_type",
  "lease_start_date",
  "lease_end_date",
  "lease_expiry",
  "nbv",
  "oec",
  "monthly_rent_per_car",
  "monthly_depr_per_car",
  "total_bv_rider",
  "cars_on_rider_ar",
  "commodity_family",
  "commodity",
  "build_year",
  "lining",
  "mech_designation",
  "dot_code",
  "comment_event_note",
  "account_manager_initials",
  "am_note",
  "managed_category",
  "status",
  "rental_status",
  "ops_flag",
  "transit_status",
  "transit_label",
  "rider",
  "schedule_number",
  "lease",
  "lessor",
  "expires",
  "oac",
  "open_stop_type",
  "open_stop_since",
  "open_stop_days",
  "open_stop_expected",
  "open_stop_reason",
  "open_stop_note",
  "program_name",
  "program_status",
  "program_milestone",
  "program_note",
  "scrapped_at",
  "umler_status",
  "latest_note",
  "tags",
  "view_note",
] as const;

export type RailcarExportKey = (typeof RAILCAR_EXPORT_KEYS)[number];

export const LEASE_CAR_SHEET_HEADERS = [
  CAR_EXPORT_MARK_HEADER,
  CAR_EXPORT_NUMBER_HEADER,
  "Rider",
  "Lessee",
  "Rental Status",
  "Entity",
  "NBV",
  "OAC",
  "Net Equip. Cost",
  "Capacity",
  "Lining",
  "Build Year",
  "Lease Type",
] as const;

export const TURNING50_CAR_SHEET_HEADERS = [
  CAR_EXPORT_MARK_HEADER,
  CAR_EXPORT_NUMBER_HEADER,
  "OL",
  "Lease Type",
  "Entity",
  "Status",
  "Type",
  "Lessee",
  "Build Year",
  "NBV",
  "OAC",
  "Net Equip. Cost",
  "Capacity",
  "Lining",
] as const;

export const COMMITMENT_BACKFILL_HEADERS = [
  CAR_EXPORT_MARK_HEADER,
  CAR_EXPORT_NUMBER_HEADER,
  "railcar_id",
  "program_id",
  "program_name",
  "needs_commitment",
  "in_multiple_programs",
  "open_program_count",
] as const;

/** Lease-management data-issue views that are one row per car. */
export const LEASE_ISSUE_CAR_KINDS = ["ea_on_rent", "unlinked", "lessee_mismatch", "rent_mismatch"] as const;

export function isLeaseIssueCarKind(kind: string): boolean {
  return (LEASE_ISSUE_CAR_KINDS as readonly string[]).includes(kind);
}

function identityFromHeaderRow(row: Record<string, unknown>, headers: readonly string[]): { mark: string; number: string } {
  const markKey = headers.find((header) => (MARK_FIELDS as readonly string[]).includes(header));
  const numberKey = headers.find((header) => (NUMBER_FIELDS as readonly string[]).includes(header));
  const combinedKey = headers.find((header) => header === "car" || header === "Car");
  return carIdentityCells({
    reporting_marks: markKey ? row[markKey] : undefined,
    car_number: numberKey ? row[numberKey] : undefined,
    car: combinedKey ? row[combinedKey] : undefined,
  });
}

/**
 * Put Reporting Mark and Car Number in A and B.
 * Drops a combined `car` column and raw mark/number field names so they are not repeated.
 */
export function leadCarExportTable(
  headers: readonly string[],
  rows: readonly Record<string, unknown>[],
): { headers: string[]; records: string[][] } {
  const drop = new Set<string>([
    CAR_EXPORT_MARK_HEADER,
    CAR_EXPORT_NUMBER_HEADER,
    "car",
    "Car",
    ...MARK_FIELDS,
    ...NUMBER_FIELDS,
  ]);
  const rest = headers.filter((header) => !drop.has(header));
  return {
    headers: [CAR_EXPORT_MARK_HEADER, CAR_EXPORT_NUMBER_HEADER, ...rest],
    records: rows.map((row) => {
      const identity = identityFromHeaderRow(row, headers);
      return [identity.mark, identity.number, ...rest.map((header) => (row[header] == null ? "" : String(row[header])))];
    }),
  };
}

export function commitmentBackfillRecords(rows: readonly Record<string, unknown>[]): string[][] {
  return rows.map((row) => {
    const identity = carIdentityCells(row);
    return [
      identity.mark,
      identity.number,
      row.railcar_id == null ? "" : String(row.railcar_id),
      row.program_id == null ? "" : String(row.program_id),
      row.program_name == null ? "" : String(row.program_name),
      row.needs_commitment == null ? "" : String(row.needs_commitment),
      row.in_multiple_programs == null ? "" : String(row.in_multiple_programs),
      row.open_program_count == null ? "" : String(row.open_program_count),
    ];
  });
}
