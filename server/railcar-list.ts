import { supabaseAdmin } from "./supabase";
import { parseFleetStatus } from "@shared/fleet-status";
import { splitCarNumber } from "@shared/residco-import";
import { asOne } from "@shared/lease-type";
import { hydrateOpsFlag, OPS_FLAG_FALLBACK_PREFIX } from "@shared/ops-flag";
import { fetchAllRows } from "./fetch-all";
import { resolveRailcarsByAnyIdentity } from "./activity-log";

/** Columns Fleet Registry / pickers actually render — not select(*). */
export const RAILCAR_LIST_SELECT = `
id, car_number, reporting_marks, car_type, status, fleet_status, fleet_status_source, entity, active, sold_to,
rider_external_id, assignment_label, managed_category, lessee_name,
lease_start_date, lease_end_date, lease_expiry, estimated_lease_expiry, lease_expiry_snapshot_month, transit_status, transit_label,
nbv, oac, oec, monthly_rent_per_car, monthly_depr_per_car, build_year, build_date,
capacity_cf, lining_material, lining, coating, mechanical_designation,
general_description, commodity, notes, data_source, lease_type, managed,
total_bv_rider, cars_on_rider_ar, commodity_family, comment_event_note,
car_initial, description, active_status, built_year, dot_code, dot_specification,
acquisition_batch_id, acquisition_date, purchase_price, needs_completion, ops_flag, ops_flag_set_at,
assignment:railcar_assignments(
  id, rider_id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at,
  rider:riders(
    id, rider_name, schedule_number, expiration_date, master_lease_id,
    master_lease:master_leases(id, lease_number, lessor, lease_type)
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
  /** Tile year: active cars with build_year + 50 === this year. */
  turning50?: number;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  all?: boolean;
  acquisition_batch_id?: number;
  needs_completion?: "yes" | "no";
  flag?: string;
  /** Filter/store flags in comment_event_note because ops_flag is not on the table yet. */
  opsFlagFallback?: boolean;
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
  const turning50 = num(query.turning50);
  // Rider/lease pickers need every assigned car, including active=false.
  const activeDefault = rider_id || lease_id ? "all" : "active";
  const activeRaw = String(query.active ?? activeDefault).trim();
  const truthy = (v: unknown) => v === "1" || v === "true" || v === 1 || v === true;
  return {
    search: str(query.search),
    status: str(query.status),
    entity,
    active: turning50 ? "active" : activeRaw === "all" ? "all" : (str(query.active) ?? activeDefault),
    turning50: turning50 && turning50 >= 1900 && turning50 <= 2100 ? turning50 : undefined,
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
    acquisition_batch_id: num(query.acquisition_batch_id) ?? num(query.batch),
    needs_completion:
      query.needs_completion === "yes" || query.needs_completion === "1" || query.needs_completion === "true"
        ? "yes"
        : query.needs_completion === "no" || query.needs_completion === "0" || query.needs_completion === "false"
          ? "no"
          : undefined,
    flag: str(query.flag) ?? str(query.ops_flag),
  };
}

function sanitizeOrValue(s: string) {
  return s.replace(/[,()]/g, " ").trim();
}

function safeIlikeToken(s: string) {
  return s.replace(/[%_,()]/g, "").trim();
}

/**
 * Railcars search tokens. "OFOX 6829" / "OFOX006829" / "OFOX 006829" all become
 * mark + number ANDed across fields. Digit-only tokens match car_number only
 * (not build year / NBV). Letter tokens match marks, lessee, rider/OL, assignment label.
 */
export function railcarSearchTokens(raw: string): string[] {
  const tokens: string[] = [];
  for (const part of String(raw ?? "").trim().split(/\s+/).filter(Boolean)) {
    const split = splitCarNumber(part);
    if (split.reporting_marks && split.car_number) {
      tokens.push(split.reporting_marks, split.car_number);
    } else if (split.reporting_marks) {
      tokens.push(split.reporting_marks);
    } else if (split.car_number) {
      tokens.push(split.car_number);
    } else {
      tokens.push(part);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const s = safeIlikeToken(t);
    if (!s) continue;
    const key = s.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

const SEARCH_TEXT_FIELDS = [
  "reporting_marks",
  "car_initial",
  "car_number",
  "lessee_name",
  "rider_external_id",
  "assignment_label",
] as const;

export function applySearchFilter(query: any, rawSearch: string | undefined) {
  if (!rawSearch) return query;
  const tokens = railcarSearchTokens(rawSearch);
  for (const t of tokens) {
    const hasLetter = /[a-z]/i.test(t);
    const hasDigit = /\d/.test(t);
    if (hasDigit && !hasLetter) {
      query = query.ilike("car_number", `%${t}%`);
    } else {
      query = query.or(SEARCH_TEXT_FIELDS.map((col) => `${col}.ilike.%${t}%`).join(","));
    }
  }
  return query;
}

function applyRailcarFilters(query: any, p: RailcarListParams) {
  if (p.turning50) {
    query = query.eq("active", true).eq("build_year", p.turning50 - 50);
    query = applySearchFilter(query, p.search);
    return query;
  }

  if (p.active === "active") query = query.neq("active", false);
  else if (p.active === "inactive") query = query.eq("active", false);

  if (p.entity) query = query.eq("entity", p.entity);

  if (p.acquisition_batch_id) query = query.eq("acquisition_batch_id", p.acquisition_batch_id);
  if (p.needs_completion === "yes") query = query.eq("needs_completion", true);
  if (p.needs_completion === "no") query = query.eq("needs_completion", false);

  if (p.transit === "in_transit") query = query.not("transit_status", "is", null);
  if (p.transit === "normal") query = query.is("transit_status", null);

  // Fleet status is the stored railcars.fleet_status column (not text-matching).
  const statusFleet =
    p.status === "Sold" || p.status === "Idle" || p.status === "Leased" || p.status === "Abatement" || p.status === "Active/In-Service"
      ? p.status === "Sold"
        ? "sold"
        : p.status === "Idle"
          ? "offlease"
          : p.status === "Abatement"
            ? "abatement"
            : "leased"
      : null;
  const assignedMode = statusFleet ?? p.assigned;

  if (assignedMode === "sold") {
    query = query.eq("fleet_status", "Sold");
  } else if (assignedMode === "offlease") {
    query = query.eq("fleet_status", "Idle");
  } else if (assignedMode === "leased") {
    query = query.eq("fleet_status", "Leased");
  } else if (assignedMode === "abatement") {
    query = query.eq("fleet_status", "Abatement");
  } else if (p.status) {
    query = query.eq("status", p.status);
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

  query = applySearchFilter(query, p.search);
  query = applyOpsFlagFilter(query, p.flag, p.opsFlagFallback);
  return query;
}

function applyOpsFlagFilter(query: any, flag: string | undefined, fallback?: boolean) {
  if (!flag) return query;
  if (fallback) {
    const prefix = OPS_FLAG_FALLBACK_PREFIX;
    if (flag === "none") {
      return query.or(`comment_event_note.is.null,comment_event_note.not.ilike."${prefix}%"`);
    }
    if (flag === "any") return query.ilike("comment_event_note", `${prefix}%`);
    if (flag.toLowerCase() === "interchange") {
      return query.ilike("comment_event_note", `${prefix}Interchange%`);
    }
    return query.ilike("comment_event_note", `${prefix}${flag}#%`);
  }
  if (flag === "none") return query.is("ops_flag", null);
  if (flag === "any") return query.not("ops_flag", "is", null);
  if (flag.toLowerCase() === "interchange") return query.ilike("ops_flag", "Interchange%");
  return query.ilike("ops_flag", flag);
}

/**
 * Live join: railcars.rider_external_id → riders.schedule_number →
 * riders.master_lease_id → master_leases.account_id → accounts.account_manager.
 * Never stored on railcars — importers have nothing to clobber.
 */
export async function attachAccountManagerInitials<T extends { rider_external_id?: string | null }>(
  rows: T[],
): Promise<(T & { account_manager_initials: string | null })[]> {
  const keys = [
    ...new Set(rows.map((r) => String(r.rider_external_id ?? "").trim()).filter(Boolean)),
  ];
  const bySchedule = new Map<string, string | null>();
  for (let i = 0; i < keys.length; i += 200) {
    const slice = keys.slice(i, i + 200);
    const { data: riders, error } = await supabaseAdmin
      .from("riders")
      .select("schedule_number, master_lease_id")
      .in("schedule_number", slice);
    if (error) throw error;
    const mlaIds = [
      ...new Set((riders ?? []).map((r) => r.master_lease_id).filter((id): id is number => id != null)),
    ];
    const accountIdByMla = new Map<number, number | null>();
    for (let j = 0; j < mlaIds.length; j += 200) {
      const mlaSlice = mlaIds.slice(j, j + 200);
      const { data: leases, error: lErr } = await supabaseAdmin
        .from("master_leases")
        .select("id, account_id")
        .in("id", mlaSlice);
      if (lErr) {
        if (/account_id|schema cache|does not exist|could not find/i.test(lErr.message)) {
          return rows.map((r) => ({ ...r, account_manager_initials: null }));
        }
        throw lErr;
      }
      for (const l of leases ?? []) accountIdByMla.set(l.id, l.account_id ?? null);
    }
    const accountIds = [
      ...new Set([...accountIdByMla.values()].filter((id): id is number => id != null)),
    ];
    const amByAccount = new Map<number, string>();
    for (let j = 0; j < accountIds.length; j += 200) {
      const aSlice = accountIds.slice(j, j + 200);
      const { data: accounts, error: aErr } = await supabaseAdmin
        .from("accounts")
        .select("id, account_manager")
        .in("id", aSlice);
      if (aErr) {
        if (/account_manager|schema cache|does not exist|could not find/i.test(aErr.message)) {
          return rows.map((r) => ({ ...r, account_manager_initials: null }));
        }
        throw aErr;
      }
      for (const a of accounts ?? []) {
        const t = String(a.account_manager ?? "").trim();
        if (t) amByAccount.set(a.id, t);
      }
    }
    for (const row of riders ?? []) {
      const k = String(row.schedule_number ?? "").trim().toUpperCase();
      if (!k) continue;
      const aid = accountIdByMla.get(row.master_lease_id);
      bySchedule.set(k, aid != null ? amByAccount.get(aid) ?? null : null);
    }
  }
  return rows.map((r) => {
    const k = String(r.rider_external_id ?? "").trim().toUpperCase();
    const v = k ? bySchedule.get(k) : "";
    return { ...r, account_manager_initials: v || null };
  });
}

function mapRow(r: any) {
  const assignmentRaw = asOne(r.assignment);
  const rider = asOne(assignmentRaw?.rider);
  const assignment = assignmentRaw
    ? { ...assignmentRaw, rider: rider ? { ...rider, master_lease: asOne(rider.master_lease) } : null }
    : null;
  return hydrateOpsFlag({
    ...r,
    assignment,
    fleet_status: parseFleetStatus(r.fleet_status) ?? r.fleet_status ?? null,
  });
}

function assignmentEmbed(p: RailcarListParams, select = RAILCAR_LIST_SELECT) {
  const inner = p.assigned === "assigned" || p.rider_id || p.lease_id;
  const rel = inner ? "railcar_assignments!inner" : "railcar_assignments";
  let out = select.replace("assignment:railcar_assignments(", `assignment:${rel}(`);
  // Nested filter on rider.master_lease_id 500s unless riders is an inner embed.
  if (p.lease_id) {
    out = out.replace("rider:riders(", "rider:riders!inner(");
  }
  return out;
}

function selectWithoutOptionalDateCols(select: string) {
  return select
    .replace(/\s*estimated_lease_expiry,?\s*/g, " ")
    .replace(/\s*lease_expiry_snapshot_month,?\s*/g, " ")
    .replace(/\s*build_date,?\s*/g, " ")
    .replace(/\s*acquisition_batch_id,?\s*/g, " ")
    .replace(/\s*acquisition_date,?\s*/g, " ")
    .replace(/\s*purchase_price,?\s*/g, " ")
    .replace(/\s*needs_completion,?\s*/g, " ")
    .replace(/\s*ops_flag_set_at,?\s*/g, " ")
    .replace(/\s*ops_flag,?\s*/g, " ");
}

function isMissingOptionalDateColumn(err: unknown) {
  const msg = String((err as any)?.message ?? err ?? "");
  return /estimated_lease_expiry|lease_expiry_snapshot_month|build_date|acquisition_batch_id|acquisition_date|purchase_price|needs_completion|ops_flag/i.test(msg);
}

export async function queryRailcars(p: RailcarListParams) {
  try {
    return await queryRailcarsWithSelect(p, assignmentEmbed(p));
  } catch (err) {
    if (!isMissingOptionalDateColumn(err)) throw err;
    return await queryRailcarsWithSelect(
      { ...p, opsFlagFallback: true },
      assignmentEmbed(p, selectWithoutOptionalDateCols(RAILCAR_LIST_SELECT)),
    );
  }
}

/** IDs matching the current filter (all pages) — for select-all-matching bulk actions. */
export async function queryRailcarIds(p: RailcarListParams): Promise<number[]> {
  try {
    return await queryRailcarIdsWithParams(p);
  } catch (err) {
    if (!isMissingOptionalDateColumn(err)) throw err;
    return await queryRailcarIdsWithParams({ ...p, opsFlagFallback: true });
  }
}

async function queryRailcarIdsWithParams(p: RailcarListParams): Promise<number[]> {
  const slim = assignmentEmbed(p, "id, assignment:railcar_assignments(id)");
  if (p.assigned === "unassigned") {
    const result = await queryRailcarsWithSelect({ ...p, all: true, page: 1, pageSize: 1 }, slim);
    return result.rows.map((r: any) => r.id);
  }
  const data = await fetchAllRows<{ id: number }>((from, to) => {
    let q = supabaseAdmin.from("railcars").select(slim).order("id", { ascending: true }).range(from, to);
    q = applyRailcarFilters(q, p);
    return q;
  });
  return data.map((r) => r.id);
}

async function extraCarsByPriorIdentity(p: RailcarListParams, select: string, haveIds: Set<number>) {
  if (!p.search) return [];
  const ids = (await resolveRailcarsByAnyIdentity(p.search)).filter((id) => !haveIds.has(id));
  if (!ids.length) return [];
  let q = supabaseAdmin.from("railcars").select(select).in("id", ids.slice(0, 80));
  q = applyRailcarFilters(q, { ...p, search: undefined });
  const { data, error } = await q;
  if (error) {
    console.log(`[railcars] prior-identity hydrate skipped: ${error.message}`);
    return [];
  }
  return (data ?? []).map(mapRow);
}

async function queryRailcarsWithSelect(p: RailcarListParams, select: string) {
  const db = supabaseAdmin;
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
    const extra = await extraCarsByPriorIdentity(p, select, new Set(rows.map((r: any) => r.id)));
    const merged = await attachAccountManagerInitials(extra.length ? [...extra, ...rows] : rows);
    if (p.all) return { rows: merged, total_count: merged.length, page: 1, pageSize: merged.length };
    const start = (p.page! - 1) * p.pageSize!;
    return {
      rows: merged.slice(start, start + p.pageSize!),
      total_count: merged.length,
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
    const extra = await extraCarsByPriorIdentity(p, select, new Set(rows.map((r: any) => r.id)));
    const merged = await attachAccountManagerInitials(extra.length ? [...extra, ...rows] : rows);
    return { rows: merged, total_count: merged.length, page: 1, pageSize: merged.length };
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
  const rows = (data ?? []).map(mapRow);
  const extra = await extraCarsByPriorIdentity(p, select, new Set(rows.map((r: any) => r.id)));
  const merged = await attachAccountManagerInitials(extra.length ? [...extra, ...rows] : rows);
  return {
    rows: merged,
    total_count: (count ?? 0) + extra.length,
    page: p.page,
    pageSize: p.pageSize,
  };
}
