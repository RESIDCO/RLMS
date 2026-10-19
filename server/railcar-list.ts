import { supabaseAdmin } from "./supabase";
import { parseFleetStatus } from "@shared/fleet-status";
import { carNumberSearchPattern, isOlNumberToken, splitCarNumber } from "@shared/residco-import";
import { asOne } from "@shared/lease-type";
import { hydrateOpsFlag, OPS_FLAG_FALLBACK_PREFIX } from "@shared/ops-flag";
import {
  classifyFleetQuery,
  fleetMatchLabel,
  fleetOrClause,
  fleetPatternToLike,
  summaryCarTypeKey,
} from "@shared/carTypeAliases";
import { fetchAllRows } from "./fetch-all";
import { resolveRailcarsByAnyIdentity } from "./activity-log";
import { attachFormerly } from "./prior-marks";
import { attachLatestAmNotes } from "./rider-account-comments";
import { attachFocusColumns } from "./focus-columns";

/** Columns Fleet Registry / pickers actually render — not select(*). */
export const RAILCAR_LIST_SELECT = `
id, car_number, reporting_marks, car_type, equipment_type_code, status, fleet_status, fleet_status_source, entity, active, sold_to,
rider_external_id, assignment_label, managed_category, lessee_name,
lease_start_date, lease_end_date, lease_expiry, estimated_lease_expiry, lease_expiry_snapshot_month, lease_date_source, transit_status, transit_label,
nbv, oac, oec, monthly_rent_per_car, monthly_depr_per_car, build_year, build_date,
capacity_cf, lining_material, lining, coating, mechanical_designation,
general_description, commodity, notes, data_source, lease_type, managed,
total_bv_rider, cars_on_rider_ar, commodity_family, comment_event_note,
car_initial, description, active_status, built_year, dot_code, dot_specification,
acquisition_batch_id, acquisition_date, purchase_price, needs_completion, ops_flag, ops_flag_set_at,
scrapped_at, scrap_source, umler_status, umler_status_at,
assignment:railcar_assignments(
  id, rider_id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at, assignment_status, sublessee,
  rider:riders(
    id, rider_name, schedule_number, effective_date, expiration_date, monthly_rate_pct, lessors_cost, master_lease_id,
    master_lease:master_leases(id, lease_number, agreement_number, lessor, lessee, lease_type, sold_to)
  )
)
`.replace(/\s+/g, " ").trim();

export type SearchScope = {
  cars: boolean;
  leases: boolean;
  carData: boolean;
};

const DEFAULT_SEARCH_SCOPE: SearchScope = { cars: true, leases: true, carData: false };

export type RailcarListParams = {
  search?: string;
  searchScope?: SearchScope;
  searchRiderIds?: number[];
  searchLeaseIds?: number[];
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
  ids?: number[];
  /** Resolved from rider_id / lease_id so the railcars query can filter on PK. */
  assignedRailcarIds?: number[];
  acquisition_batch_id?: number;
  needs_completion?: "yes" | "no";
  flag?: string;
  /** Filter/store flags in comment_event_note because ops_flag is not on the table yet. */
  opsFlagFallback?: boolean;
  /** Car type / equipment type code. `J31*` is a prefix. */
  carType?: string;
  /** Mechanical designation, exact or `GB*` prefix. */
  mech?: string;
  /** AAR designation, exact or prefix. */
  aar?: string;
  /**
   * Exact car-type / mechanical / alias match. Search sends `fleet=1`.
   * Omitted everywhere else so Railcars and select-all keep text search.
   */
  fleetCodes?: boolean;
  /** Set by attachFleetMatch. Not a query-string param. */
  fleetOr?: string | null;
  fleetMatch?: FleetMatchReport | null;
  fleetReady?: boolean;
  /** Open rent stop: any, Abatement, Off rent, or none. */
  openStop?: string;
  /** Program name contains. */
  program?: string;
  /** Exact car tag. */
  tag?: string;
  /** Attach rent-stop, program, note, and tag columns for the returned rows. */
  focus?: boolean;
  /** Fixed or query view whose members and notes apply to this request. */
  viewId?: number;
  /** Set once prior-mark ids have been OR'd into the search filter. */
  priorIdentityChecked?: boolean;
};

export type FleetMatchReport = {
  kind: "car_type" | "mechanical" | "alias";
  label: string;
  code?: string;
  ruleId?: string;
  ruleLabel?: string;
  activeCount: number | null;
  /** How many cars the same query would return as ordinary text. */
  textCount?: number | null;
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
  const ids = String(query.ids ?? "")
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 20_000);
  const turning50 = num(query.turning50);
  // Rider/lease pickers need every assigned car, including active=false.
  const activeDefault = rider_id || lease_id ? "all" : "active";
  const activeRaw = String(query.active ?? activeDefault).trim();
  const truthy = (v: unknown) => v === "1" || v === "true" || v === 1 || v === true;
  return {
    search: str(query.search),
    searchScope: parseSearchScope(query),
    status: str(query.status),
    entity,
    active: turning50 ? "active" : activeRaw === "all" ? "all" : (str(query.active) ?? activeDefault),
    turning50: turning50 && turning50 >= 1900 && turning50 <= 2100 ? turning50 : undefined,
    assigned: str(query.assigned),
    rider: str(query.rider),
    rider_id,
    lease_id,
    ids: ids.length ? ids : undefined,
    transit: str(query.transit),
    sort: str(query.sort) ?? "car_number",
    dir: query.dir === "desc" ? "desc" : "asc",
    page: Math.max(1, num(query.page) ?? 1),
    pageSize: Math.min(500, Math.max(1, num(query.pageSize) ?? 75)),
    carType: str(query.type) ?? str(query.car_type),
    mech: str(query.mech),
    aar: str(query.aar),
    fleetCodes: truthy(query.fleet),
    openStop: str(query.open_stop),
    program: str(query.program),
    tag: str(query.tag),
    focus: truthy(query.focus),
    viewId: num(query.view_id),
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
 * The number half of an explicit mark+number pair is tagged carNumberOnly so it
 * never matches through lease/OL free text. Short digit strings are zero-padded
 * to CAR_NUMBER_WIDTH so they cannot substring-match other stored numbers.
 */
export type SearchToken = { value: string; carNumberOnly?: boolean };

function isMarkOnlyPart(part: string | undefined): boolean {
  if (!part || isOlNumberToken(part)) return false;
  const split = splitCarNumber(part);
  return Boolean(split.reporting_marks && !split.car_number);
}

export function railcarSearchTokens(raw: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  const parts = String(raw ?? "").trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (isOlNumberToken(part)) {
      tokens.push({ value: part.replace(/\s+/g, "").toUpperCase() });
      continue;
    }
    const split = splitCarNumber(part);
    if (split.reporting_marks && split.car_number) {
      tokens.push({ value: split.reporting_marks });
      tokens.push({ value: split.car_number, carNumberOnly: true });
    } else if (split.reporting_marks) {
      tokens.push({ value: split.reporting_marks });
    } else if (split.car_number) {
      const paired = isMarkOnlyPart(parts[i - 1]) || isMarkOnlyPart(parts[i + 1]);
      tokens.push({ value: split.car_number, carNumberOnly: paired || undefined });
    } else {
      tokens.push({ value: part });
    }
  }
  const seen = new Map<string, SearchToken>();
  for (const t of tokens) {
    const s = safeIlikeToken(t.value);
    if (!s) continue;
    const key = s.toUpperCase();
    const prev = seen.get(key);
    if (prev) {
      if (t.carNumberOnly) prev.carNumberOnly = true;
      continue;
    }
    seen.set(key, { value: s, carNumberOnly: t.carNumberOnly });
  }
  return Array.from(seen.values());
}

export function searchTokenValues(tokens: SearchToken[], opts?: { excludeCarNumberOnly?: boolean }): string[] {
  return tokens
    .filter((t) => !(opts?.excludeCarNumberOnly && t.carNumberOnly))
    .map((t) => t.value);
}

export function leaseSearchTokenValues(tokens: SearchToken[]): string[] {
  return searchTokenValues(tokens, { excludeCarNumberOnly: true });
}

const CAR_NUMBER_FIELDS = ["reporting_marks", "car_initial", "car_number"] as const;
const LEASE_OL_FIELDS = ["lessee_name", "rider_external_id", "assignment_label"] as const;
/**
 * Master's Car data checkbox. Used only when Search did not send `fleet=1`,
 * so Railcars and select-all keep the filters they had before this PR.
 */
const MASTER_CAR_DATA_FIELDS = [
  "car_type",
  "equipment_type_code",
  "general_description",
  "mechanical_designation",
] as const;
/** Searched for letter tokens only when Search sends `fleet=1`. */
const FLEET_FIELDS = [
  "car_type",
  "equipment_type_code",
  "aar_designation",
  "mechanical_designation",
  "general_description",
] as const;
/** Extra free text. Still behind the Car data checkbox on a fleet search. */
const NOTE_FIELDS = ["description", "notes"] as const;

export function parseSearchScope(query: Record<string, unknown> | undefined): SearchScope {
  const flag = (key: string, fallback: boolean) => {
    const v = query?.[key];
    if (v == null || v === "") return fallback;
    if (v === "0" || v === "false" || v === false || v === 0) return false;
    if (v === "1" || v === "true" || v === true || v === 1) return true;
    return fallback;
  };
  const cars = flag("search_cars", true);
  const leases = flag("search_leases", true);
  const carData = flag("search_car_data", false);
  if (!cars && !leases && !carData) return { ...DEFAULT_SEARCH_SCOPE };
  return { cars, leases, carData };
}

function scopeOrDefault(scope?: SearchScope): SearchScope {
  if (!scope) return { ...DEFAULT_SEARCH_SCOPE };
  if (!scope.cars && !scope.leases && !scope.carData) return { ...DEFAULT_SEARCH_SCOPE };
  return scope;
}

export async function matchingLeaseAndRiderIds(tokens: string[]): Promise<{ leaseIds: number[]; riderIds: number[] }> {
  let leaseIds: number[] | null = null;
  let riderIds: number[] | null = null;
  for (const t of tokens) {
    const [{ data: leases, error: lErr }, { data: riders, error: rErr }] = await Promise.all([
      supabaseAdmin
        .from("master_leases")
        .select("id")
        .or(`lease_number.ilike.%${t}%,agreement_number.ilike.%${t}%,lessee.ilike.%${t}%`)
        .limit(80),
      supabaseAdmin
        .from("riders")
        .select("id")
        .or(`rider_name.ilike.%${t}%,schedule_number.ilike.%${t}%`)
        .limit(80),
    ]);
    if (lErr) throw lErr;
    if (rErr) throw rErr;
    const nextLeases = (leases ?? []).map((row) => Number(row.id)).filter((n) => n > 0);
    const nextRiders = (riders ?? []).map((row) => Number(row.id)).filter((n) => n > 0);
    leaseIds = leaseIds == null ? nextLeases : leaseIds.filter((id) => nextLeases.includes(id));
    riderIds = riderIds == null ? nextRiders : riderIds.filter((id) => nextRiders.includes(id));
  }
  return { leaseIds: leaseIds ?? [], riderIds: riderIds ?? [] };
}

function uniquePositiveIds(vals: unknown[]): number[] {
  return [...new Set(vals.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
}

async function railcarIdsForRiders(riderIds: number[]): Promise<number[]> {
  const uniq = uniquePositiveIds(riderIds);
  if (!uniq.length) return [];
  const ids: number[] = [];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from("railcar_assignments")
      .select("railcar_id")
      .in("rider_id", uniq.slice(i, i + 200));
    if (error) throw error;
    for (const a of data ?? []) ids.push(Number((a as { railcar_id: number }).railcar_id));
  }
  return uniquePositiveIds(ids);
}

async function railcarIdsForRider(riderId: number): Promise<number[]> {
  return railcarIdsForRiders([riderId]);
}

async function railcarIdsForLease(leaseId: number): Promise<number[]> {
  const { data: riders, error: rErr } = await supabaseAdmin
    .from("riders")
    .select("id")
    .eq("master_lease_id", leaseId);
  if (rErr) throw rErr;
  return railcarIdsForRiders((riders ?? []).map((r: { id: number }) => r.id));
}

/** Cars on matched riders/leases — filter railcars by PK, never by embed path. */
export async function railcarIdsForSearchMatches(extra: {
  riderIds?: number[];
  leaseIds?: number[];
}): Promise<number[]> {
  const ids: number[] = [];
  if (extra.riderIds?.length) ids.push(...(await railcarIdsForRiders(extra.riderIds)));
  if (extra.leaseIds?.length) {
    const leaseIds = uniquePositiveIds(extra.leaseIds);
    for (let i = 0; i < leaseIds.length; i += 80) {
      const { data: riders, error } = await supabaseAdmin
        .from("riders")
        .select("id")
        .in("master_lease_id", leaseIds.slice(i, i + 80));
      if (error) throw error;
      ids.push(...(await railcarIdsForRiders((riders ?? []).map((r: { id: number }) => r.id))));
    }
  }
  return uniquePositiveIds(ids);
}

function idInOrClauses(ids: number[]): string[] {
  if (!ids.length) return [];
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    out.push(`id.in.(${ids.slice(i, i + 200).join(",")})`);
  }
  return out;
}

/** PK ids to restrict the railcars-rooted query. Nested embed filters cannot. */
async function railcarIdsForAssignmentFilter(p: RailcarListParams): Promise<number[] | undefined> {
  if (!p.rider_id && !p.lease_id) return p.ids?.length ? p.ids : undefined;
  if (!p.assignedRailcarIds) {
    p.assignedRailcarIds = p.rider_id
      ? await railcarIdsForRider(p.rider_id)
      : await railcarIdsForLease(p.lease_id!);
  }
  if (p.ids?.length) {
    const want = new Set(p.ids);
    return p.assignedRailcarIds.filter((id) => want.has(id));
  }
  return p.assignedRailcarIds;
}

export function applySearchFilter(
  query: any,
  rawSearch: string | undefined,
  scope?: SearchScope,
  extra?: { railcarIds?: number[]; fleetCodes?: boolean },
) {
  if (!rawSearch) return query;
  const tokens = railcarSearchTokens(rawSearch);
  const sc = scopeOrDefault(scope);
  const fleetCodes = Boolean(extra?.fleetCodes);
  const railcarIns = idInOrClauses(extra?.railcarIds ?? []);
  for (const tok of tokens) {
    const t = tok.value;
    const ors: string[] = [];
    if (tok.carNumberOnly) {
      // Never widen a mark-paired number through lease/OL fields or rider/lease id lists.
      // Pad short digit strings so "%102%" cannot match 001020 / 310021 / etc.
      ors.push(`car_number.ilike.%${carNumberSearchPattern(t)}%`);
      ors.push(...railcarIns);
      query = query.or(ors.join(","));
      continue;
    }
    const hasLetter = /[a-z]/i.test(t);
    const hasDigit = /\d/.test(t);
    if (sc.cars) {
      if (hasDigit && !hasLetter) {
        ors.push(`car_number.ilike.%${t}%`);
      } else {
        for (const col of CAR_NUMBER_FIELDS) ors.push(`${col}.ilike.%${t}%`);
      }
    }
    if (sc.leases) {
      for (const col of LEASE_OL_FIELDS) ors.push(`${col}.ilike.%${t}%`);
    }
    if (fleetCodes && hasLetter) {
      for (const col of FLEET_FIELDS) ors.push(`${col}.ilike.%${t}%`);
    }
    if (sc.carData) {
      const fields = fleetCodes ? NOTE_FIELDS : MASTER_CAR_DATA_FIELDS;
      if (!fleetCodes || hasLetter) {
        for (const col of fields) ors.push(`${col}.ilike.%${t}%`);
      }
    }
    ors.push(...railcarIns);
    if (!ors.length) continue;
    query = query.or(ors.join(","));
  }
  return query;
}

function quoteLike(value: string) {
  return `"${value.replace(/"/g, "")}"`;
}

function applyColumnPattern(query: any, columns: string[], raw: string | undefined) {
  const like = fleetPatternToLike(raw ?? "");
  if (!like) return query;
  if (columns.length === 1) return query.ilike(columns[0], like);
  return query.or(columns.map((c) => `${c}.ilike.${quoteLike(like)}`).join(","));
}

async function countActiveFleetOr(orClause: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("railcars")
    .select("id", { count: "exact", head: true })
    .or(orClause)
    .neq("active", false);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Car-type codes and mechanical designations match exactly (case-insensitive),
 * not as substrings. A mechanical-shaped token with zero cars falls back to
 * text search so "BNSF" still finds the lessee. Alias phrases always use the rule.
 */
export async function resolveFleetMatch(search: string | undefined): Promise<{
  orClause: string | null;
  match: FleetMatchReport | null;
}> {
  const cls = classifyFleetQuery(search ?? "");
  switch (cls.kind) {
    case "text":
      return { orClause: null, match: null };
    case "alias":
    case "car_type":
    case "mechanical": {
      const orClause = fleetOrClause(cls);
      if (!orClause) return { orClause: null, match: null };
      const activeCount = await countActiveFleetOr(orClause);
      if (cls.kind !== "alias" && activeCount <= 0) return { orClause: null, match: null };
      return {
        orClause,
        match: {
          kind: cls.kind,
          label: fleetMatchLabel(cls, cls.kind === "alias" ? undefined : activeCount),
          code: cls.kind === "alias" ? undefined : cls.code,
          ruleId: cls.kind === "alias" ? cls.rule.id : undefined,
          ruleLabel: cls.kind === "alias" ? cls.rule.label : undefined,
          activeCount,
        },
      };
    }
    default: {
      const _never: never = cls;
      return _never;
    }
  }
}

async function countTextMatches(p: RailcarListParams): Promise<number> {
  const plain: RailcarListParams = {
    ...p,
    fleetCodes: false,
    fleetReady: true,
    fleetOr: null,
    fleetMatch: null,
    searchRiderIds: undefined,
    searchLeaseIds: undefined,
  };
  let q = supabaseAdmin.from("railcars").select("id", { count: "exact", head: true });
  q = await applyRailcarFilters(q, plain);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function attachFleetMatch(p: RailcarListParams) {
  if (p.fleetReady) return;
  p.fleetReady = true;
  if (!p.fleetCodes || !p.search || p.ids?.length) {
    p.fleetOr = null;
    p.fleetMatch = null;
    return;
  }
  const resolved = await resolveFleetMatch(p.search);
  p.fleetOr = resolved.orClause;
  p.fleetMatch = resolved.match;
  if (!p.fleetMatch || !p.fleetOr) return;
  try {
    p.fleetMatch = { ...p.fleetMatch, textCount: await countTextMatches(p) };
  } catch (err) {
    console.log(`[railcars] text-count skipped: ${String((err as { message?: string })?.message ?? err)}`);
  }
}

async function applyRailcarFilters(query: any, p: RailcarListParams) {
  await attachFleetMatch(p);
  const scope = scopeOrDefault(p.searchScope);
  if (p.search && !p.fleetOr && !p.ids?.length && scope.leases && p.searchRiderIds == null && p.searchLeaseIds == null) {
    const matched = await matchingLeaseAndRiderIds(leaseSearchTokenValues(railcarSearchTokens(p.search)));
    p.searchRiderIds = matched.riderIds;
    p.searchLeaseIds = matched.leaseIds;
  }
  let searchRailcarIds: number[] | undefined;
  if (p.searchRiderIds?.length || p.searchLeaseIds?.length) {
    searchRailcarIds = await railcarIdsForSearchMatches({
      riderIds: p.searchRiderIds,
      leaseIds: p.searchLeaseIds,
    });
  }
  if (p.search && !p.fleetOr && !p.ids?.length && !p.priorIdentityChecked) {
    p.priorIdentityChecked = true;
    const prior = (await resolveRailcarsByAnyIdentity(p.search)).slice(0, 80);
    if (prior.length) searchRailcarIds = [...new Set([...(searchRailcarIds ?? []), ...prior])];
  }
  const extra = { railcarIds: searchRailcarIds };

  if (p.turning50) {
    query = query.eq("active", true).eq("build_year", p.turning50 - 50);
    query = applySearchFilter(query, p.search, scope, { ...extra, fleetCodes: p.fleetCodes });
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
    p.status === "Sold" || p.status === "Idle" || p.status === "Leased" || p.status === "Abatement" || p.status === "Unassigned" || p.status === "Active/In-Service"
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
  } else if (assignedMode === "unassigned") {
    query = query.eq("fleet_status", "Unassigned");
  } else if (p.status) {
    query = query.eq("status", p.status);
  }

  const restrictIds = await railcarIdsForAssignmentFilter(p);
  const focusIds = await railcarIdsForFocusFilters(p);
  let limitIds = restrictIds;
  if (focusIds) {
    const allow = new Set(focusIds);
    limitIds = limitIds ? limitIds.filter((id) => allow.has(id)) : focusIds;
  }
  if (limitIds) {
    query = query.in("id", limitIds.length ? limitIds : [-1]);
  }
  if (p.openStop === "none") {
    const openIds = await openStopRailcarIds();
    if (openIds.length) query = query.not("id", "in", `(${openIds.join(",")})`);
  }
  if (p.rider) {
    const ol = sanitizeOrValue(p.rider).toUpperCase();
    query = query.or(
      `rider_external_id.ilike.${ol},lessee_name.ilike.%${ol}%`
    );
  }

  if (p.carType) query = applyColumnPattern(query, ["car_type", "equipment_type_code"], p.carType);
  if (p.mech) query = applyColumnPattern(query, ["mechanical_designation"], p.mech);
  if (p.aar) query = applyColumnPattern(query, ["aar_designation"], p.aar);

  if (p.fleetOr) query = query.or(p.fleetOr);
  else query = p.ids?.length ? query : applySearchFilter(query, p.search, scope, { ...extra, fleetCodes: p.fleetCodes });
  query = applyOpsFlagFilter(query, p.flag, p.opsFlagFallback);
  return query;
}

async function openStopRailcarIds(type?: string): Promise<number[]> {
  let q = supabaseAdmin.from("car_rent_stops").select("railcar_id").is("actual_resume_date", null);
  if (type && type !== "any") q = q.eq("type", type);
  const { data, error } = await q;
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((row) => Number(row.railcar_id)).filter((id) => id > 0)));
}

async function programRailcarIds(text: string): Promise<number[]> {
  const safe = text.replace(/[%_,()]/g, "").trim();
  if (!safe) return [];
  const { data: programs, error } = await supabaseAdmin.from("programs").select("id").ilike("name", `%${safe}%`).limit(100);
  if (error) throw error;
  const programIds = (programs ?? []).map((row) => Number(row.id)).filter((id) => id > 0);
  if (!programIds.length) return [];
  const { data, error: carError } = await supabaseAdmin
    .from("program_cars")
    .select("railcar_id")
    .in("program_id", programIds)
    .is("exited_date", null);
  if (carError) throw carError;
  return Array.from(new Set((data ?? []).map((row) => Number(row.railcar_id)).filter((id) => id > 0)));
}

async function tagRailcarIds(tag: string): Promise<number[]> {
  const { data, error } = await supabaseAdmin.from("car_tags").select("railcar_id").eq("tag", tag);
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((row) => Number(row.railcar_id)).filter((id) => id > 0)));
}

/** Include-list for open stop / program / tag. `none` is applied separately so it can exclude a short id list. */
async function railcarIdsForFocusFilters(p: RailcarListParams): Promise<number[] | undefined> {
  const sets: number[][] = [];
  if (p.openStop && p.openStop !== "none") sets.push(await openStopRailcarIds(p.openStop));
  if (p.program) sets.push(await programRailcarIds(p.program));
  if (p.tag) sets.push(await tagRailcarIds(p.tag));
  if (!sets.length) return undefined;
  let ids = new Set(sets[0]);
  for (const next of sets.slice(1)) {
    const allow = new Set(next);
    ids = new Set(Array.from(ids).filter((id) => allow.has(id)));
  }
  return Array.from(ids);
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

async function attachAccountJoins<T extends { rider_external_id?: string | null; assignment?: unknown }>(
  rows: T[],
) {
  const [withAm, withNotes] = await Promise.all([
    attachAccountManagerInitials(rows),
    attachLatestAmNotes(rows),
  ]);
  return withAm.map((r, i) => ({ ...r, am_note: withNotes[i]?.am_note ?? null }));
}

const FOCUS_FIELD_KEYS = [
  "open_stop_type",
  "open_stop_since",
  "open_stop_days",
  "open_stop_expected",
  "open_stop_reason",
  "open_stop_note",
  "program_name",
  "program_extra",
  "program_status",
  "program_milestone",
  "program_milestone_at",
  "program_note",
  "latest_note",
  "latest_note_at",
  "latest_note_actor",
  "tags",
  "view_note",
] as const;

/** Account joins and, when requested, focus columns run together for the page being returned. */
async function finishRows<T extends { id: number; notes?: string | null; rider_external_id?: string | null; assignment?: unknown }>(
  rows: T[],
  p: RailcarListParams,
) {
  const [joined, focused] = await Promise.all([
    attachAccountJoins(rows),
    p.focus ? attachFocusColumns(rows, { viewId: p.viewId }) : Promise.resolve(null),
  ]);
  const badged = await attachFormerly(joined, p.search);
  if (!focused) return badged;
  const byId = new Map(focused.map((row) => [row.id, row]));
  return badged.map((row) => {
    const extra = byId.get((row as { id: number }).id);
    if (!extra) return row;
    const focus: Record<string, unknown> = {};
    for (const key of FOCUS_FIELD_KEYS) focus[key] = extra[key];
    return { ...row, ...focus };
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
  const inner = p.assigned === "assigned";
  const rel = inner ? "railcar_assignments!inner" : "railcar_assignments";
  return select.replace("assignment:railcar_assignments(", `assignment:${rel}(`);
}

function selectWithoutOptionalDateCols(select: string) {
  return select
    .replace(/\s*estimated_lease_expiry,?\s*/g, " ")
    .replace(/\s*lease_expiry_snapshot_month,?\s*/g, " ")
    .replace(/\s*lease_date_source,?\s*/g, " ")
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
  return /estimated_lease_expiry|lease_expiry_snapshot_month|lease_date_source|build_date|acquisition_batch_id|acquisition_date|purchase_price|needs_completion|ops_flag/i.test(msg);
}

export async function queryRailcars(p: RailcarListParams) {
  // Rider/lease lists: never hit the fat select (those columns 400) or fetchAllRows
  // (3 concurrent OFFSET pages). Those two together re-introduced 15s timeouts after
  // the ID-first filter landed.
  if (p.rider_id || p.lease_id) {
    const slim = assignmentEmbed(p, selectWithoutOptionalDateCols(RAILCAR_LIST_SELECT));
    return await queryRailcarsByAssignedIds({ ...p, opsFlagFallback: true }, slim);
  }
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
  const data = await fetchAllRows<{ id: number }>(async (from, to) => {
    let q = supabaseAdmin.from("railcars").select(slim).order("id", { ascending: true }).range(from, to);
    q = await applyRailcarFilters(q, p);
    return q;
  });
  return data.map((r) => r.id);
}

function orderRailcarQuery(query: any, p: RailcarListParams) {
  const orderCol = p.sort === "id" ? "id" : "car_number";
  const ordered = query.order(orderCol, { ascending: p.dir !== "desc" });
  if (orderCol === "id") return ordered;
  return ordered.order("id", { ascending: true });
}

async function queryRailcarsByAssignedIds(p: RailcarListParams, select: string) {
  const ids = await railcarIdsForAssignmentFilter(p);
    if (!ids?.length) {
    return { rows: [] as any[], total_count: 0, page: 1, pageSize: p.pageSize ?? 0, match: p.fleetMatch ?? null };
  }
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const slice = ids.slice(i, i + 150);
    let q = orderRailcarQuery(
      supabaseAdmin.from("railcars").select(select),
      p,
    );
    q = await applyRailcarFilters(q, { ...p, assignedRailcarIds: slice });
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data ?? []).map(mapRow));
  }
  const merged = await finishRows(rows, p);
  if (p.all) return { rows: merged, total_count: merged.length, page: 1, pageSize: merged.length, match: p.fleetMatch ?? null };
  const start = ((p.page ?? 1) - 1) * (p.pageSize ?? merged.length);
  return {
    rows: merged.slice(start, start + (p.pageSize ?? merged.length)),
    total_count: merged.length,
    page: p.page ?? 1,
    pageSize: p.pageSize ?? merged.length,
    match: p.fleetMatch ?? null,
  };
}

async function extraCarsByPriorIdentity(p: RailcarListParams, select: string, haveIds: Set<number>) {
  if (!p.search || p.fleetOr || p.priorIdentityChecked) return [];
  const ids = (await resolveRailcarsByAnyIdentity(p.search)).filter((id) => !haveIds.has(id));
  if (!ids.length) return [];
  let q = supabaseAdmin.from("railcars").select(select).in("id", ids.slice(0, 80));
  q = await applyRailcarFilters(q, {
    ...p,
    search: undefined,
    fleetOr: null,
    fleetMatch: null,
    fleetReady: true,
  });
  const { data, error } = await q;
  if (error) {
    console.log(`[railcars] prior-identity hydrate skipped: ${error.message}`);
    return [];
  }
  return (data ?? []).map(mapRow);
}

async function queryRailcarsWithSelect(p: RailcarListParams, select: string) {
  const db = supabaseAdmin;

  if (p.assigned === "nolink") {
    // Left-anti-join: cars with no assignment row.
    const assigned = await fetchAllRows<{ railcar_id: number }>((from, to) =>
      db.from("railcar_assignments").select("railcar_id").order("railcar_id").range(from, to)
    );
    const assignedSet = new Set(assigned.map((a) => a.railcar_id));
    const all = await fetchAllRows(async (from, to) => {
      let q = orderRailcarQuery(db.from("railcars").select(select), p).range(from, to);
      q = await applyRailcarFilters(q, { ...p, assigned: undefined });
      return q;
    });
    const rows = all.map(mapRow).filter((r: any) => !assignedSet.has(r.id) && !r.assignment);
    const extra = await extraCarsByPriorIdentity(p, select, new Set(rows.map((r: any) => r.id)));
    const merged = await finishRows(extra.length ? [...extra, ...rows] : rows, p);
    if (p.all) return { rows: merged, total_count: merged.length, page: 1, pageSize: merged.length, match: p.fleetMatch ?? null };
    const start = (p.page! - 1) * p.pageSize!;
    return {
      rows: merged.slice(start, start + p.pageSize!),
      total_count: merged.length,
      page: p.page,
      pageSize: p.pageSize,
      match: p.fleetMatch ?? null,
    };
  }

  if (p.all) {
    const data = await fetchAllRows(async (from, to) => {
      let q = orderRailcarQuery(db.from("railcars").select(select), p).range(from, to);
      q = await applyRailcarFilters(q, p);
      return q;
    });
    const rows = data.map(mapRow);
    const extra = await extraCarsByPriorIdentity(p, select, new Set(rows.map((r: any) => r.id)));
    const merged = await finishRows(extra.length ? [...extra, ...rows] : rows, p);
    return { rows: merged, total_count: merged.length, page: 1, pageSize: merged.length, match: p.fleetMatch ?? null };
  }

  const from = (p.page! - 1) * p.pageSize!;
  const to = from + p.pageSize! - 1;
  let q = orderRailcarQuery(
    db.from("railcars").select(select, { count: "estimated" }),
    p,
  ).range(from, to);
  q = await applyRailcarFilters(q, p);
  const { data, error, count } = await q;
  if (error) throw error;
  const rows = (data ?? []).map(mapRow);
  const extra = await extraCarsByPriorIdentity(p, select, new Set(rows.map((r: any) => r.id)));
  const merged = await finishRows(extra.length ? [...extra, ...rows] : rows, p);
  return {
    rows: merged,
    total_count: (count ?? 0) + extra.length,
    page: p.page,
    pageSize: p.pageSize,
    match: p.fleetMatch ?? null,
  };
}

export type RailcarSummary = {
  total: number;
  by_type: { key: string; count: number }[];
  by_entity: { key: string; count: number }[];
  by_status: { key: string; count: number }[];
  match: FleetMatchReport | null;
};

function bumpCount(map: Map<string, number>, key: string) {
  const k = key.trim() || "—";
  map.set(k, (map.get(k) ?? 0) + 1);
}

function rankedCounts(map: Map<string, number>) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Same filters as the list. Head count, used by saved-view buttons. */
export async function countRailcars(p: RailcarListParams): Promise<number> {
  let q = supabaseAdmin.from("railcars").select("id", { count: "exact", head: true });
  q = await applyRailcarFilters(q, p);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Same filters as the list. Grouped counts for the summary above the grid. */
export async function queryRailcarSummary(p: RailcarListParams): Promise<RailcarSummary> {
  await attachFleetMatch(p);
  const select = "id, car_type, equipment_type_code, entity, fleet_status";
  const data = await fetchAllRows<{
    id: number;
    car_type: string | null;
    equipment_type_code: string | null;
    entity: string | null;
    fleet_status: string | null;
  }>(async (from, to) => {
    let q = supabaseAdmin.from("railcars").select(select).order("id", { ascending: true }).range(from, to);
    q = await applyRailcarFilters(q, p);
    return q;
  });
  const byType = new Map<string, number>();
  const byEntity = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const row of data) {
    bumpCount(byType, summaryCarTypeKey(row.car_type, row.equipment_type_code));
    bumpCount(byEntity, String(row.entity ?? ""));
    bumpCount(byStatus, String(row.fleet_status ?? ""));
  }
  return {
    total: data.length,
    by_type: rankedCounts(byType),
    by_entity: rankedCounts(byEntity),
    by_status: rankedCounts(byStatus),
    match: p.fleetMatch ?? null,
  };
}

const RIDER_CAR_FLAT_SELECT = [
  "id", "car_number", "reporting_marks", "car_type", "status", "fleet_status",
  "entity", "active", "lease_type", "lessee_name", "rider_external_id", "assignment_label",
  "nbv", "oac", "oec", "capacity_cf", "lining_material", "lining", "coating",
  "build_year", "built_year", "comment_event_note",
].join(", ");

/** Two indexed lookups — no PostgREST nested embed (those still seq-scan under load). */
export async function listCarsAssignedToRider(riderId: number, active: string = "active") {
  const [{ data: assigns, error: aErr }, { data: riderRow, error: rErr }] = await Promise.all([
    supabaseAdmin
      .from("railcar_assignments")
      .select("id, rider_id, fleet_name, railcar_id")
      .eq("rider_id", riderId),
    supabaseAdmin
      .from("riders")
      .select("id, rider_name, schedule_number, master_lease_id, master_lease:master_leases(id, lease_number, lessee, lease_type, sold_to)")
      .eq("id", riderId)
      .maybeSingle(),
  ]);
  if (aErr) throw aErr;
  if (rErr) throw rErr;
  const ids = uniquePositiveIds((assigns ?? []).map((a: { railcar_id: number }) => a.railcar_id));
  if (!ids.length) return [];
  const cars: any[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select(RIDER_CAR_FLAT_SELECT)
      .in("id", ids.slice(i, i + 150));
    if (error) throw error;
    cars.push(...(data ?? []));
  }
  const byId = new Map(cars.map((c) => [c.id, c]));
  const rider = riderRow
    ? { ...riderRow, master_lease: asOne((riderRow as any).master_lease) }
    : null;
  const rows = (assigns ?? [])
    .map((a: any) => {
      const car = byId.get(a.railcar_id);
      if (!car) return null;
      return hydrateOpsFlag({
        ...car,
        assignment: {
          id: a.id,
          rider_id: a.rider_id,
          fleet_name: a.fleet_name,
          rider,
        },
        fleet_status: parseFleetStatus(car.fleet_status) ?? car.fleet_status ?? null,
      });
    })
    .filter(Boolean);
  if (active === "inactive") return rows.filter((r: any) => r.active === false);
  if (active === "all") return rows;
  return rows.filter((r: any) => r.active !== false);
}
