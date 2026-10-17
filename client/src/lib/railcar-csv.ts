import { fleetActiveLabel } from "@/components/InactiveFleetBadge";
import { formatAmNoteSnippet } from "@/components/AmCommentThread";
import { displayRailcarStatus, displayStatusInputFromRailcar } from "@shared/fleet-status";
import { whitelistExportCols } from "@shared/column-views";

type CsvCol = { key: string; header: string; get: (r: any) => string };

function str(v: unknown) {
  return v == null ? "" : String(v);
}

export const RAILCAR_CSV_COLS: CsvCol[] = [
  { key: "car", header: "Car Number", get: (r) => `${r.reporting_marks ?? ""}${r.car_number ?? ""}` },
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
  { key: "marks", header: "Reporting Marks", get: (r) => str(r.reporting_marks) },
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
];

/** Master Car List–compatible CSV used by Railcars and Search exports. */
export function downloadRailcarsCsv(
  rows: any[],
  filename?: string,
  opts?: { keys?: Iterable<string>; all?: boolean },
) {
  const allowed = RAILCAR_CSV_COLS.map((c) => c.key);
  const requested = opts?.all ? "all" : opts?.keys ? Array.from(opts.keys) : "all";
  const keys = whitelistExportCols(allowed, requested, allowed);
  const colByKey = new Map(RAILCAR_CSV_COLS.map((c) => [c.key, c]));
  const cols = keys.map((k) => colByKey.get(k)!).filter(Boolean);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows_data = rows.map((r: any) => cols.map((c) => escape(c.get(r))).join(","));
  const csv = [cols.map((c) => escape(c.header)).join(","), ...rows_data].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `railcars-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
