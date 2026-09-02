import { fleetActiveLabel } from "@/components/InactiveFleetBadge";
import { formatAmNoteSnippet } from "@/components/AmCommentThread";
import { displayRailcarStatus, displayStatusInputFromRailcar } from "@shared/fleet-status";

/** Master Car List–compatible CSV used by Railcars and Search exports. */
export function downloadRailcarsCsv(rows: any[], filename?: string) {
  const headers = [
    "Car Number", "Rider ID", "Lessee", "Entity", "Active", "Data Source",
    "Car Type", "Description", "Assignment", "Lease Type",
    "Start Date", "End Date", "Lease Expiry",
    "NBV Per Car ($)", "Net Equipment Cost Per Car ($)",
    "Monthly Rent P/C ($)", "Monthly Depr P/C ($)",
    "Total BV — Rider ($)", "Cars on Rider (AR)",
    "Commodity Family", "Commodity",
    "Build Year", "Lining", "Mech Desig.", "DOT Code",
    "Comment / Event Note",
    "Acct Mgr",
    "Latest AM Note",
    "Managed Category", "Reporting Marks", "Car Status", "Rental Status", "Flag", "Transit Status", "Transit Label",
    "Rider Name", "Schedule #", "MLA Lease #", "Lessor", "Expiration Date",
    "OAC",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const get = (r: any, k: string) => (r[k] == null ? "" : String(r[k]));
  const rows_data = rows.map((r: any) => [
    `${r.reporting_marks ?? ""}${r.car_number ?? ""}`,
    get(r, "rider_external_id"),
    r.lessee_name ?? r.assignment?.fleet_name ?? "",
    r.entity ?? "",
    fleetActiveLabel(r.active) || (r.active_status ?? ""),
    get(r, "data_source"),
    r.car_type ?? "",
    r.description ?? r.general_description ?? "",
    get(r, "assignment_label"),
    r.lease_type ?? "",
    get(r, "lease_start_date"),
    get(r, "lease_end_date"),
    get(r, "lease_expiry"),
    r.nbv != null ? String(r.nbv) : "",
    r.oec != null ? String(r.oec) : "",
    r.monthly_rent_per_car != null ? String(r.monthly_rent_per_car) : "",
    r.monthly_depr_per_car != null ? String(r.monthly_depr_per_car) : "",
    r.total_bv_rider != null ? String(r.total_bv_rider) : "",
    r.cars_on_rider_ar != null ? String(r.cars_on_rider_ar) : "",
    get(r, "commodity_family"),
    get(r, "commodity"),
    r.build_year ?? r.built_year ?? "",
    r.lining ?? r.lining_material ?? "",
    r.mechanical_designation ?? "",
    r.dot_code ?? r.dot_specification ?? "",
    get(r, "comment_event_note"),
    r.account_manager_initials ?? "",
    formatAmNoteSnippet(r.am_note),
    r.managed_category ?? "",
    r.reporting_marks ?? "",
    r.status ?? "",
    displayRailcarStatus(displayStatusInputFromRailcar(r)),
    r.ops_flag ?? "",
    r.transit_status ?? "",
    r.transit_label ?? "",
    r.assignment?.rider?.rider_name ?? "",
    r.assignment?.rider?.schedule_number ?? "",
    r.assignment?.rider?.master_lease?.lease_number ?? "",
    r.assignment?.rider?.master_lease?.lessor ?? "",
    r.assignment?.rider?.expiration_date ?? "",
    r.oac != null ? String(r.oac) : "",
  ].map(escape).join(","));
  const csv = [headers.map(escape).join(","), ...rows_data].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `railcars-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
