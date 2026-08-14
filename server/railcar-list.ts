import { supabaseAdmin } from "./supabase";
import { deriveFleetStatus } from "@shared/fleet-status";
import { fetchAllRows } from "./fetch-all";

/** Columns Fleet Registry / pickers actually render — not select(*). */
export const RAILCAR_LIST_SELECT = `
id, car_number, reporting_marks, car_type, status, entity, active, sold_to,
rider_external_id, assignment_label, managed_category, lessee_name,
lease_start_date, lease_end_date, lease_expiry, transit_status, transit_label,
nbv, oac, oec, monthly_rent_per_car, monthly_depr_per_car, build_year,
capacity_cf, lining_material, lining, coating, mechanical_designation,
general_description, commodity, notes, data_source, lease_type, managed,
total_bv_rider, cars_on_rider_ar, commodity_family, comment_event_note,
car_initial, description, active_status, built_year, dot_code, dot_specification,
assignment:railcar_assignments(
  id, rider_id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at,
  rider:riders(
    id, rider_name, schedule_number, expiration_date, master_lease_id,
    master_lease:master_leases(id, lease_number, lessor)
  )
)
`.replace(/\s+/g, " ").trim();

export type RailcarListParams = {
  search?: string;
  status?: string;
  entity?: string;
  active?: string;
  assigned?: string;
  rider?: string;
  rider_id?: number;
  lease_id?: number;
  transit?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  all?: boolean;
};

export function parseRailcarListParams(query: Record<string, unknown>): RailcarListParams {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s && s !== "all" ? s : undefined;
  };
  const entityRaw = str(query.entity);
  const entity =
    entityRaw === "RPS" || entityRaw === "rps"
      ? "Rail Partners Select"
      : entityRaw === "Owned" || entityRaw === "owned"
        ? "Main"
        : entityRaw;
  const rider_id = num(query.rider_id);
  const lease_id = num(query.lease_id);
  // Rider/lease pickers need every assigned car, including active=false.
  const activeDefault = rider_id || lease_id ? "all" : "active";
  const activeRaw = String(query.active ?? activeDefault).trim();
  const truthy = (v: unknown) => v === "1" || v === "true" || v === 1 || v === true;
  return {
    search: str(query.search),
    status: str(query.status),
    entity,
    active: activeRaw === "all" ? "all" : (str(query.active) ?? activeDefault),
    assigned: str(query.assigned),
    rider: str(query.rider),
    rider_id,
    lease_id,
    transit: str(query.transit),
    sort: str(query.sort) ?? "car_number",
    dir: query.dir === "desc" ? "desc" : "asc",
    page: Math.max(1, num(query.page) ?? 1),
    pageSize: Math.min(200, Math.max(1, num(query.pageSize) ?? 75)),
    all: truthy(query.all) || truthy(query.export),
  };
}

function sanitizeOrValue(s: string) {
  return s.replace(/[,()]/g, " ").trim();
}

function applyRailcarFilters(query: any, p: RailcarListParams) {
  if (p.active === "active") query = query.neq("active", false);
  else if (p.active === "inactive") query = query.eq("active", false);

  if (p.status) query = query.eq("status", p.status);
  if (p.entity) query = query.eq("entity", p.entity);

  if (p.transit === "in_transit") query = query.not("transit_status", "is", null);
  if (p.transit === "normal") query = query.is("transit_status", null);

  const soldOr = "rider_external_id.ilike.SOLD,assignment_label.ilike.SOLD";
  if (p.assigned === "sold") {
    query = query.or(soldOr);
  } else if (p.assigned === "offlease") {
    query = query.eq("managed_category", "Idle");
    query = query.or("rider_external_id.is.null,rider_external_id.not.ilike.SOLD");
    query = query.or("assignment_label.is.null,assignment_label.not.ilike.SOLD");
  } else if (p.assigned === "leased") {
    query = query.or("managed_category.is.null,managed_category.neq.Idle");
    query = query.or("rider_external_id.is.null,rider_external_id.not.ilike.SOLD");
    query = query.or("assignment_label.is.null,assignment_label.not.ilike.SOLD");
  }

  if (p.rider_id) {
    query = query.eq("railcar_assignments.rider_id", p.rider_id);
  }
  if (p.lease_id) {
    query = query.eq("railcar_assignments.rider.master_lease_id", p.lease_id);
  }
  if (p.rider) {
    const ol = sanitizeOrValue(p.rider).toUpperCase();
    query = query.or(
      `rider_external_id.ilike.${ol},lessee_name.ilike.%${ol}%`
    );
  }

  if (p.search) {
    const q = sanitizeOrValue(p.search);
    query = query.or(
      [
        `car_number.ilike.%${q}%`,
        `reporting_marks.ilike.%${q}%`,
        `lessee_name.ilike.%${q}%`,
        `rider_external_id.ilike.%${q}%`,
        `car_type.ilike.%${q}%`,
      ].join(",")
    );
  }

  return query;
}

function mapRow(r: any) {
  const assignment = Array.isArray(r.assignment) ? r.assignment[0] ?? null : r.assignment;
  const fleet_status = deriveFleetStatus({
    active: r.active,
    rider_external_id: r.rider_external_id,
    assignment_label: r.assignment_label,
    fleet_name: assignment?.fleet_name ?? null,
    managed_category: r.managed_category,
  });
  return { ...r, assignment, fleet_status };
}

function assignmentEmbed(p: RailcarListParams) {
  const inner = p.assigned === "assigned" || p.rider_id || p.lease_id;
  const rel = inner ? "railcar_assignments!inner" : "railcar_assignments";
  return RAILCAR_LIST_SELECT.replace("assignment:railcar_assignments(", `assignment:${rel}(`);
}

export async function queryRailcars(p: RailcarListParams) {
  const db = supabaseAdmin;
  const select = assignmentEmbed(p);
  const orderCol = p.sort === "car_number" || p.sort === "id" ? p.sort : "car_number";

  if (p.assigned === "unassigned") {
    // Left-anti-join: cars with no assignment row.
    const assigned = await fetchAllRows<{ railcar_id: number }>((from, to) =>
      db.from("railcar_assignments").select("railcar_id").order("railcar_id").range(from, to)
    );
    const assignedSet = new Set(assigned.map((a) => a.railcar_id));
    const all = await fetchAllRows((from, to) => {
      let q = db.from("railcars").select(select).order(orderCol, { ascending: p.dir !== "desc" }).range(from, to);
      q = applyRailcarFilters(q, { ...p, assigned: undefined });
      return q;
    });
    const rows = all.map(mapRow).filter((r: any) => !assignedSet.has(r.id) && !r.assignment);
    if (p.all) return { rows, total_count: rows.length, page: 1, pageSize: rows.length };
    const start = (p.page! - 1) * p.pageSize!;
    return {
      rows: rows.slice(start, start + p.pageSize!),
      total_count: rows.length,
      page: p.page,
      pageSize: p.pageSize,
    };
  }

  if (p.all) {
    const data = await fetchAllRows((from, to) => {
      let q = db.from("railcars").select(select).order(orderCol, { ascending: p.dir !== "desc" }).range(from, to);
      q = applyRailcarFilters(q, p);
      return q;
    });
    const rows = data.map(mapRow);
    return { rows, total_count: rows.length, page: 1, pageSize: rows.length };
  }

  const from = (p.page! - 1) * p.pageSize!;
  const to = from + p.pageSize! - 1;
  let q = db
    .from("railcars")
    .select(select, { count: "exact" })
    .order(orderCol, { ascending: p.dir !== "desc" })
    .range(from, to);
  q = applyRailcarFilters(q, p);
  const { data, error, count } = await q;
  if (error) throw error;
  return {
    rows: (data ?? []).map(mapRow),
    total_count: count ?? 0,
    page: p.page,
    pageSize: p.pageSize,
  };
}
