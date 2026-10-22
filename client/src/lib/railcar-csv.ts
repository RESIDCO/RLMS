import { fleetActiveLabel } from "@/components/InactiveFleetBadge";
import { formatAmNoteSnippet } from "@/components/AmCommentThread";
import { displayRailcarStatus, displayStatusInputFromRailcar } from "@shared/fleet-status";
import { whitelistExportCols } from "@shared/column-views";
import { formatLastNoteWhen, lastNoteForRow } from "@shared/lineage-notes";
import {
  CAR_EXPORT_MARK_HEADER,
  CAR_EXPORT_NUMBER_HEADER,
  RAILCAR_EXPORT_KEYS,
  csvCarNumberField,
  ensureLeadingCarKeys,
  exportCarNumberText,
  exportReportingMarkText,
  type RailcarExportKey,
} from "@shared/car-export-identity";

type CsvCol = { key: RailcarExportKey; header: string; get: (r: any) => string };

function str(v: unknown) {
  return v == null ? "" : String(v);
}

const RAILCAR_CSV_DEFS: CsvCol[] = [
  { key: "marks", header: CAR_EXPORT_MARK_HEADER, get: (r) => exportReportingMarkText(r.reporting_marks) },
  { key: "car_number", header: CAR_EXPORT_NUMBER_HEADER, get: (r) => exportCarNumberText(r.car_number) },
  { key: "rider_external_id", header: "Rider ID", get: (r) => str(r.rider_external_id) },
  { key: "lessee", header: "Lessee", get: (r) => str(r.lessee_name ?? r.assignment?.fleet_name) },
  { key: "entity", header: "Entity", get: (r) => str(r.entity) },
  { key: "active", header: "Active", get: (r) => fleetActiveLabel(r.active) || str(r.active_status) },
  { key: "data_source", header: "Data Source", get: (r) => str(r.data_source) },
  { key: "type", header: "Car Type", get: (r) => str(r.car_type) },
  { key: "description", header: "Description", get: (r) => str(r.description ?? r.general_description) },
  { key: "assignment_label", header: "Assignment", get: (r) => str(r.assignment_label) },
  { key: "lease_type", header: "Lease Type", get: (r) => str(r.lease_type) },
  { key: "lease_start_date", header: "Start Date", get: (r) => str(r.lease_start_date) },
  { key: "lease_end_date", header: "End Date", get: (r) => str(r.lease_end_date) },
  { key: "lease_expiry", header: "Lease Expiry", get: (r) => str(r.lease_expiry) },
  { key: "nbv", header: "NBV Per Car ($)", get: (r) => r.nbv != null ? String(r.nbv) : "" },
  { key: "oec", header: "Net Equipment Cost Per Car ($)", get: (r) => r.oec != null ? String(r.oec) : "" },
  { key: "monthly_rent_per_car", header: "Monthly Rent P/C ($)", get: (r) => r.monthly_rent_per_car != null ? String(r.monthly_rent_per_car) : "" },
  { key: "monthly_depr_per_car", header: "Monthly Depr P/C ($)", get: (r) => r.monthly_depr_per_car != null ? String(r.monthly_depr_per_car) : "" },
  { key: "total_bv_rider", header: "Total BV — Rider ($)", get: (r) => r.total_bv_rider != null ? String(r.total_bv_rider) : "" },
  { key: "cars_on_rider_ar", header: "Cars on Rider (AR)", get: (r) => r.cars_on_rider_ar != null ? String(r.cars_on_rider_ar) : "" },
  { key: "commodity_family", header: "Commodity Family", get: (r) => str(r.commodity_family) },
  { key: "commodity", header: "Commodity", get: (r) => str(r.commodity) },
  { key: "build_year", header: "Build Year", get: (r) => str(r.build_year ?? r.built_year) },
  { key: "lining", header: "Lining", get: (r) => str(r.lining ?? r.lining_material) },
  { key: "mech_designation", header: "Mech Desig.", get: (r) => str(r.mechanical_designation) },
  { key: "dot_code", header: "DOT Code", get: (r) => str(r.dot_code ?? r.dot_specification) },
  { key: "comment_event_note", header: "Comment / Event Note", get: (r) => str(r.comment_event_note) },
  { key: "account_manager_initials", header: "Acct Mgr", get: (r) => str(r.account_manager_initials) },
  { key: "am_note", header: "Latest AM Note", get: (r) => formatAmNoteSnippet(r.am_note) },
  { key: "managed_category", header: "Managed Category", get: (r) => str(r.managed_category) },
  { key: "status", header: "Car Status", get: (r) => str(r.status) },
  { key: "rental_status", header: "Rental Status", get: (r) => displayRailcarStatus(displayStatusInputFromRailcar(r)) },
  { key: "ops_flag", header: "Flag", get: (r) => str(r.ops_flag) },
  { key: "transit_status", header: "Transit Status", get: (r) => str(r.transit_status) },
  { key: "transit_label", header: "Transit Label", get: (r) => str(r.transit_label) },
  { key: "rider", header: "Rider Name", get: (r) => str(r.assignment?.rider?.rider_name) },
  { key: "schedule_number", header: "Schedule #", get: (r) => str(r.assignment?.rider?.schedule_number) },
  { key: "lease", header: "MLA Lease #", get: (r) => str(r.assignment?.rider?.master_lease?.lease_number) },
  { key: "lessor", header: "Lessor", get: (r) => str(r.assignment?.rider?.master_lease?.lessor) },
  { key: "expires", header: "Expiration Date", get: (r) => str(r.assignment?.rider?.expiration_date) },
  { key: "oac", header: "OAC", get: (r) => r.oac != null ? String(r.oac) : "" },
  { key: "open_stop_type", header: "Rent stop", get: (r) => str(r.open_stop_type) },
  { key: "open_stop_since", header: "Stop since", get: (r) => str(r.open_stop_since) },
  { key: "open_stop_days", header: "Days stopped", get: (r) => r.open_stop_days != null ? String(r.open_stop_days) : "" },
  { key: "open_stop_expected", header: "Expected resume", get: (r) => str(r.open_stop_expected) },
  { key: "open_stop_reason", header: "Stop reason", get: (r) => str(r.open_stop_reason) },
  { key: "program_name", header: "Program", get: (r) => str(r.program_name) },
  { key: "program_status", header: "Program status", get: (r) => str(r.program_status) },
  { key: "program_milestone", header: "Milestone", get: (r) => [r.program_milestone, r.program_milestone_at].filter(Boolean).join(" ") },
  { key: "program_note", header: "Program note", get: (r) => str(r.program_note) },
  { key: "scrapped_at", header: "Scrapped", get: (r) => str(r.scrapped_at) },
  { key: "umler_status", header: "UMLER status", get: (r) => str(r.umler_status) },
  { key: "latest_note", header: "Last note", get: (r) => {
    const note = lastNoteForRow(r);
    if (!note) return "";
    const when = formatLastNoteWhen(note.at);
    return when ? `${when} ${note.text}` : note.text;
  } },
  { key: "tags", header: "Tags", get: (r) => Array.isArray(r.tags) ? r.tags.join(", ") : str(r.tags) },
  { key: "view_note", header: "View note", get: (r) => str(r.view_note) },
];

const RAILCAR_CSV_BY_KEY = new Map(RAILCAR_CSV_DEFS.map((col) => [col.key, col]));

/** Column order for a full export. Callers that pass visible keys still get mark then number in front. */
export const RAILCAR_CSV_COLS: CsvCol[] = RAILCAR_EXPORT_KEYS.map((key) => {
  const col = RAILCAR_CSV_BY_KEY.get(key);
  if (!col) throw new Error(`Missing railcar export column ${key}`);
  return col;
});

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return text.includes(",") || text.includes('"') || text.includes("\n") ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Master Car List–compatible CSV used by Railcars and Search exports. */
export function downloadRailcarsCsv(
  rows: any[],
  filename?: string,
  opts?: { keys?: Iterable<string>; all?: boolean },
) {
  const allowed = RAILCAR_CSV_COLS.map((c) => c.key);
  const requested = opts?.all ? "all" : opts?.keys ? Array.from(opts.keys) : "all";
  const keys = ensureLeadingCarKeys(whitelistExportCols(allowed, requested, allowed));
  const cols = keys.map((key) => RAILCAR_CSV_BY_KEY.get(key as RailcarExportKey)).filter((col): col is CsvCol => Boolean(col));
  const rowsData = rows.map((row) => cols.map((col) => (
    col.key === "car_number" ? csvCarNumberField(col.get(row)) : csvEscape(col.get(row))
  )).join(","));
  const csv = [cols.map((col) => csvEscape(col.header)).join(","), ...rowsData].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `railcars-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
