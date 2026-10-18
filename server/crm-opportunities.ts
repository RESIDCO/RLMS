import { fetchAllRows } from "./fetch-all";
import { recordChange, withChangeGroup, withChangeGroupResult } from "./change-log";
import { CrmHttpError } from "./crm-error";
import { supabaseAdmin } from "./supabase";
import {
  isActiveRider,
  isLossReason,
  isOpenStage,
  isOpportunitySource,
  isOpportunityStage,
  isOpportunityType,
  isRenewalCandidate,
  lostNeedsReason,
  mostCommonValue,
  remarketRiderUrl,
  renewalAutoNotes,
  wonReletNeedsRemarket,
  type OpportunityRow,
  type OpportunitySource,
  type OpportunityStage,
  type OpportunityType,
  type RenewalPreviewRow,
  type RenewalRunResult,
  type WatchRow,
} from "@shared/crm";

type RiderFact = {
  id: number;
  rider_name: string | null;
  master_lease_id: number;
  lifecycle_status: string | null;
  expiration_date: string | null;
  expiration_source: string | null;
  lease_status: string | null;
  monthly_rent_per_car: number | null;
};

type LeaseFact = {
  id: number;
  account_id: number | null;
  is_placeholder: boolean;
  lessee: string | null;
};

type AccountFact = {
  id: number;
  name: string;
  account_manager: string | null;
};

export type OnRentCar = { riderId: number; railcarId: number };

const ON_RENT_TTL_MS = 30_000;
let onRentCache: { at: number; cars: OnRentCar[] } | null = null;

function dateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value: unknown): number | null {
  const n = num(value);
  return n == null ? null : Math.trunc(n);
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function positiveInt(value: unknown): number | null {
  const n = intOrNull(value);
  return n != null && n > 0 ? n : null;
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function httpError(status: number, message: string, body: Record<string, unknown> = {}): CrmHttpError {
  return new CrmHttpError(status, message, body);
}

function mapOpportunity(row: Record<string, unknown>): OpportunityRow {
  return {
    id: Number(row.id),
    account_id: Number(row.account_id),
    master_lease_id: positiveInt(row.master_lease_id),
    rider_id: positiveInt(row.rider_id),
    company_id: positiveInt(row.company_id),
    type: String(row.type) as OpportunityRow["type"],
    stage: String(row.stage) as OpportunityRow["stage"],
    owner: textOrNull(row.owner),
    source: String(row.source) as OpportunityRow["source"],
    car_type: textOrNull(row.car_type),
    car_count: intOrNull(row.car_count),
    current_rate: num(row.current_rate),
    target_rate: num(row.target_rate),
    term_months: intOrNull(row.term_months),
    est_value: num(row.est_value),
    expiry_date: dateOnly(row.expiry_date),
    new_expiry_date: dateOnly(row.new_expiry_date),
    expected_close: dateOnly(row.expected_close),
    won_rider_id: positiveInt(row.won_rider_id),
    sublessee_note: textOrNull(row.sublessee_note),
    competitor: textOrNull(row.competitor),
    loss_reason: isLossReason(row.loss_reason) ? row.loss_reason : null,
    notes: row.notes == null ? null : String(row.notes),
    created_by: textOrNull(row.created_by),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    closed_at: row.closed_at == null ? null : String(row.closed_at),
  };
}

/**
 * On-rent, non-Sold, Leased cars.
 * `v_rlms_kpi_car_rows.status_tag` is that view's fleet_status. On 18 Oct 2026
 * it matched `railcars.fleet_status = 'Leased'` for this population (14,171).
 * Renewal car counts are confirmed against railcars.fleet_status before insert.
 */
export async function loadOnRentCars(): Promise<OnRentCar[]> {
  if (onRentCache && Date.now() - onRentCache.at < ON_RENT_TTL_MS) return onRentCache.cars;
  const rows = await fetchAllRows<{
    rider_id: number | null;
    railcar_id: number | null;
    is_sold: boolean | null;
    status_tag: string | null;
  }>((from, to) =>
    supabaseAdmin
      .from("v_rlms_kpi_car_rows")
      .select("rider_id, railcar_id, is_sold, status_tag")
      .eq("on_rent", true)
      .order("railcar_id", { ascending: true })
      .range(from, to),
  );
  const cars: OnRentCar[] = [];
  for (const row of rows) {
    const riderId = Number(row.rider_id);
    const railcarId = Number(row.railcar_id);
    if (!Number.isFinite(riderId) || riderId <= 0 || !Number.isFinite(railcarId) || railcarId <= 0) continue;
    if (row.is_sold === true) continue;
    if (row.status_tag !== "Leased") continue;
    cars.push({ riderId, railcarId });
  }
  onRentCache = { at: Date.now(), cars };
  return cars;
}

export function onRentIdsByRider(cars: OnRentCar[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const car of cars) {
    const list = map.get(car.riderId);
    if (list) list.push(car.railcarId);
    else map.set(car.riderId, [car.railcarId]);
  }
  return map;
}

async function loadRiders(): Promise<RiderFact[]> {
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabaseAdmin
      .from("riders")
      .select("id, rider_name, master_lease_id, lifecycle_status, expiration_date, expiration_source, lease_status, monthly_rent_per_car")
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => ({
    id: Number(row.id),
    rider_name: textOrNull(row.rider_name),
    master_lease_id: Number(row.master_lease_id),
    lifecycle_status: textOrNull(row.lifecycle_status),
    expiration_date: dateOnly(row.expiration_date),
    expiration_source: textOrNull(row.expiration_source),
    lease_status: textOrNull(row.lease_status),
    monthly_rent_per_car: num(row.monthly_rent_per_car),
  }));
}

async function loadLeases(): Promise<Map<number, LeaseFact>> {
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabaseAdmin
      .from("master_leases")
      .select("id, account_id, is_placeholder, lessee")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const map = new Map<number, LeaseFact>();
  for (const row of rows) {
    map.set(Number(row.id), {
      id: Number(row.id),
      account_id: positiveInt(row.account_id),
      is_placeholder: row.is_placeholder === true,
      lessee: textOrNull(row.lessee),
    });
  }
  return map;
}

async function loadAccounts(): Promise<Map<number, AccountFact>> {
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabaseAdmin
      .from("accounts")
      .select("id, name, account_manager")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const map = new Map<number, AccountFact>();
  for (const row of rows) {
    map.set(Number(row.id), {
      id: Number(row.id),
      name: String(row.name ?? ""),
      account_manager: textOrNull(row.account_manager),
    });
  }
  return map;
}

async function companyIdByAccount(): Promise<Map<number, number | null>> {
  const rows = await fetchAllRows<{ id: number; account_id: number | null }>((from, to) =>
    supabaseAdmin
      .from("companies")
      .select("id, account_id")
      .not("account_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const grouped = new Map<number, number[]>();
  for (const row of rows) {
    if (row.account_id == null) continue;
    const list = grouped.get(Number(row.account_id)) ?? [];
    list.push(Number(row.id));
    grouped.set(Number(row.account_id), list);
  }
  const out = new Map<number, number | null>();
  for (const [accountId, ids] of Array.from(grouped.entries())) out.set(accountId, ids.length === 1 ? ids[0] : null);
  return out;
}

async function openRenewalRiderIds(): Promise<Set<number>> {
  const rows = await fetchAllRows<{ rider_id: number | null; type: string; stage: string }>((from, to) =>
    supabaseAdmin
      .from("opportunities")
      .select("rider_id, type, stage")
      .eq("type", "renewal")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const ids = new Set<number>();
  for (const row of rows) {
    if (!isOpenStage(row.stage) || row.rider_id == null) continue;
    ids.add(Number(row.rider_id));
  }
  return ids;
}

async function leasedCarTypes(railcarIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  for (let i = 0; i < railcarIds.length; i += 200) {
    const slice = railcarIds.slice(i, i + 200);
    const { data, error } = await supabaseAdmin.from("railcars").select("id, fleet_status, car_type").in("id", slice);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.fleet_status !== "Leased") continue;
      out.set(Number(row.id), textOrNull(row.car_type));
    }
  }
  return out;
}

async function selectRenewals(months: number, today: string): Promise<RenewalPreviewRow[]> {
  const [cars, riders, leases, accounts, companies, openRenewals] = await Promise.all([
    loadOnRentCars(),
    loadRiders(),
    loadLeases(),
    loadAccounts(),
    companyIdByAccount(),
    openRenewalRiderIds(),
  ]);
  const byRider = onRentIdsByRider(cars);
  const prelim: Array<RenewalPreviewRow & { railcarIds: number[] }> = [];
  for (const rider of riders) {
    const lease = leases.get(rider.master_lease_id);
    const railcarIds = byRider.get(rider.id) ?? [];
    const selected = isRenewalCandidate(
      {
        lifecycle_status: rider.lifecycle_status,
        is_placeholder: lease?.is_placeholder === true,
        expiration_date: rider.expiration_date,
        expiration_source: rider.expiration_source,
        on_rent_nonsold_leased: railcarIds.length,
        has_open_renewal: openRenewals.has(rider.id),
      },
      { today, months },
    );
    if (!selected || !lease?.account_id || !rider.expiration_date || !rider.expiration_source) continue;
    const account = accounts.get(lease.account_id);
    prelim.push({
      rider_id: rider.id,
      rider_name: rider.rider_name,
      master_lease_id: rider.master_lease_id,
      account_id: lease.account_id,
      account_name: account?.name ?? null,
      company_id: companies.get(lease.account_id) ?? null,
      owner: account?.account_manager ?? null,
      car_count: railcarIds.length,
      car_type: null,
      current_rate: rider.monthly_rent_per_car,
      expiry_date: rider.expiration_date,
      expiration_source: rider.expiration_source,
      notes: renewalAutoNotes(rider.expiration_source),
      railcarIds,
    });
  }

  const allIds = prelim.flatMap((row) => row.railcarIds);
  const types = await leasedCarTypes(allIds);
  const rows: RenewalPreviewRow[] = [];
  for (const row of prelim) {
    const kept = row.railcarIds.filter((id) => types.has(id));
    if (!kept.length) continue;
    const { railcarIds: _ids, ...rest } = row;
    rows.push({
      ...rest,
      car_count: kept.length,
      car_type: mostCommonValue(kept.map((id) => types.get(id) ?? null)),
    });
  }
  rows.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.rider_id - b.rider_id);
  return rows;
}

function summarize(rows: RenewalPreviewRow[]) {
  return {
    riders: rows.length,
    cars: rows.reduce((sum, row) => sum + row.car_count, 0),
    accounts: new Set(rows.map((row) => row.account_id)).size,
  };
}

export async function generateRenewals(opts: { months: number; dryRun: boolean; actor: string }): Promise<RenewalRunResult> {
  const months = opts.months;
  if (!Number.isFinite(months) || months <= 0 || months > 120) {
    throw httpError(400, "months must be between 1 and 120");
  }
  const today = utcToday();
  const rows = await selectRenewals(months, today);
  const totals = summarize(rows);
  if (opts.dryRun) {
    return { dry_run: true, months, today, ...totals, created: 0, rows, change_group: null };
  }
  const created = await withChangeGroup(opts.actor, async (group) => {
    let n = 0;
    for (const row of rows) {
      const payload = {
        account_id: row.account_id,
        master_lease_id: row.master_lease_id,
        rider_id: row.rider_id,
        company_id: row.company_id,
        type: "renewal",
        stage: "identified",
        owner: row.owner,
        source: "auto_expiry",
        car_type: row.car_type,
        car_count: row.car_count,
        current_rate: row.current_rate,
        expiry_date: row.expiry_date,
        notes: row.notes,
        created_by: opts.actor,
      };
      const { data, error } = await supabaseAdmin.from("opportunities").insert(payload).select("*").single();
      if (error) {
        if (error.code === "23505") continue;
        throw error;
      }
      await recordChange({
        table: "opportunities",
        pk: Number(data.id),
        before: {},
        after: data,
        action: "create_opportunity",
        entity_type: "opportunity",
        entity_id: Number(data.id),
        rider_id: row.rider_id,
        actor: opts.actor,
        detail: { type: "renewal", source: "auto_expiry" },
      });
      n += 1;
    }
    return { n, group };
  });
  onRentCache = null;
  return {
    dry_run: false,
    months,
    today,
    ...totals,
    created: created.n,
    rows,
    change_group: created.group,
  };
}

async function unsoldByRider(riderIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (let i = 0; i < riderIds.length; i += 80) {
    const slice = riderIds.slice(i, i + 80);
    const rows = await fetchAllRows<{ rider_id: number | null; railcar_id: number | null; is_sold: boolean | null }>((from, to) =>
      supabaseAdmin
        .from("v_rlms_kpi_car_rows")
        .select("rider_id, railcar_id, is_sold")
        .in("rider_id", slice)
        .order("railcar_id", { ascending: true })
        .range(from, to),
    );
    for (const row of rows) {
      if (row.is_sold === true || row.rider_id == null) continue;
      const id = Number(row.rider_id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export async function listOpportunityWatch(): Promise<{
  holdover: WatchRow[];
  check_date: WatchRow[];
  off_lease: WatchRow[];
  unclassified: WatchRow[];
  returns_watch_url: string;
}> {
  const today = utcToday();
  const [cars, riders, leases, accounts] = await Promise.all([
    loadOnRentCars(),
    loadRiders(),
    loadLeases(),
    loadAccounts(),
  ]);
  const byRider = onRentIdsByRider(cars);
  const holdover: WatchRow[] = [];
  const checkDate: WatchRow[] = [];
  const unclassified: WatchRow[] = [];
  const offLeaseRiders: RiderFact[] = [];

  for (const rider of riders) {
    const lease = leases.get(rider.master_lease_id);
    if (!lease || lease.is_placeholder) continue;
    const onRent = (byRider.get(rider.id) ?? []).length;
    const active = isActiveRider({
      lifecycle_status: rider.lifecycle_status,
      is_placeholder: lease.is_placeholder,
      on_rent_nonsold_leased: onRent,
    });
    const account = lease.account_id != null ? accounts.get(lease.account_id) : undefined;
    const base = {
      rider_id: rider.id,
      rider_name: rider.rider_name,
      master_lease_id: rider.master_lease_id,
      lessee: lease.lessee,
      account_id: lease.account_id,
      account_name: account?.name ?? null,
      owner: account?.account_manager ?? null,
      expiration_date: rider.expiration_date,
      expiration_source: rider.expiration_source,
      lease_status: rider.lease_status,
      on_rent_cars: onRent,
      unsold_cars: 0,
    };
    const past = rider.expiration_date != null && rider.expiration_date < today && onRent >= 1;
    const mtm = rider.lease_status != null && /mtm/i.test(rider.lease_status);
    if (active && (past || mtm)) {
      holdover.push({
        ...base,
        bucket: "holdover",
        reason: past && mtm ? "On rent past expiry and MTM" : past ? "On rent past expiry" : "MTM",
      });
    }
    if (active && onRent >= 1 && (rider.expiration_source == null || rider.expiration_source === "car_records")) {
      checkDate.push({
        ...base,
        bucket: "check_date",
        reason: rider.expiration_source == null ? "No governed expiry" : "car_records expiry",
      });
    }
    if (rider.lifecycle_status == null && active) {
      unclassified.push({
        ...base,
        bucket: "unclassified",
        reason: "Null lifecycle, on rent",
      });
    }
    if (rider.lifecycle_status === "off_lease_pending_remarketing") offLeaseRiders.push(rider);
  }

  const unsold = await unsoldByRider(offLeaseRiders.map((rider) => rider.id));
  const offLease: WatchRow[] = [];
  for (const rider of offLeaseRiders) {
    const count = unsold.get(rider.id) ?? 0;
    if (count < 1) continue;
    const lease = leases.get(rider.master_lease_id);
    const account = lease?.account_id != null ? accounts.get(lease.account_id) : undefined;
    offLease.push({
      rider_id: rider.id,
      rider_name: rider.rider_name,
      master_lease_id: rider.master_lease_id,
      lessee: lease?.lessee ?? null,
      account_id: lease?.account_id ?? null,
      account_name: account?.name ?? null,
      owner: account?.account_manager ?? null,
      expiration_date: rider.expiration_date,
      expiration_source: rider.expiration_source,
      lease_status: rider.lease_status,
      on_rent_cars: (byRider.get(rider.id) ?? []).length,
      unsold_cars: count,
      bucket: "off_lease",
      reason: "EA with unsold cars",
    });
  }

  const byName = (a: WatchRow, b: WatchRow) => String(a.rider_name ?? "").localeCompare(String(b.rider_name ?? ""));
  holdover.sort(byName);
  checkDate.sort(byName);
  offLease.sort(byName);
  unclassified.sort(byName);
  return {
    holdover,
    check_date: checkDate,
    off_lease: offLease,
    unclassified,
    returns_watch_url: "#/returns/watch",
  };
}

export type OpportunityFilters = {
  account_id?: number;
  rider_id?: number;
  owner?: string;
  stage?: string;
  type?: string;
  open?: boolean;
};

export async function listOpportunities(filters: OpportunityFilters): Promise<OpportunityRow[]> {
  let query = supabaseAdmin.from("opportunities").select("*").order("updated_at", { ascending: false }).limit(1000);
  if (filters.account_id) query = query.eq("account_id", filters.account_id);
  if (filters.rider_id) query = query.eq("rider_id", filters.rider_id);
  if (filters.owner === "__unassigned__") query = query.is("owner", null);
  else if (filters.owner) query = query.eq("owner", filters.owner);
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.open) query = query.not("stage", "in", "(won,lost)");
  const { data, error } = await query;
  if (error) throw error;
  return attachRiderNames((data ?? []).map((row) => mapOpportunity(row as Record<string, unknown>)));
}

async function loadRiderNames(ids: number[]): Promise<Map<number, string | null>> {
  const names = new Map<number, string | null>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    const { data, error } = await supabaseAdmin.from("riders").select("id, rider_name").in("id", slice);
    if (error) throw error;
    for (const row of data ?? []) names.set(Number(row.id), textOrNull(row.rider_name));
  }
  return names;
}

async function attachRiderNames(rows: OpportunityRow[]): Promise<OpportunityRow[]> {
  const ids = rows.flatMap((row) => (row.rider_id == null ? [] : [row.rider_id]));
  if (!ids.length) return rows.map((row) => ({ ...row, rider_name: null }));
  const names = await loadRiderNames(ids);
  return rows.map((row) => ({
    ...row,
    rider_name: row.rider_id == null ? null : names.get(row.rider_id) ?? null,
  }));
}

async function riderContext(riderId: number): Promise<{ master_lease_id: number; account_id: number | null }> {
  const { data, error } = await supabaseAdmin.from("riders").select("id, master_lease_id").eq("id", riderId).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(400, "Rider not found");
  const { data: lease, error: leaseErr } = await supabaseAdmin
    .from("master_leases")
    .select("id, account_id")
    .eq("id", data.master_lease_id)
    .maybeSingle();
  if (leaseErr) throw leaseErr;
  return { master_lease_id: Number(data.master_lease_id), account_id: positiveInt(lease?.account_id) };
}

function cleanWrite(body: Record<string, unknown>, partial: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const take = (key: string, value: unknown) => {
    if (partial && !(key in body)) return;
    out[key] = value;
  };
  if (!partial || "type" in body) {
    if (!isOpportunityType(body.type)) throw httpError(400, "Invalid opportunity type");
    take("type", body.type);
  }
  if (!partial || "stage" in body) {
    const stage = body.stage == null || body.stage === "" ? "identified" : body.stage;
    if (!isOpportunityStage(stage)) throw httpError(400, "Invalid opportunity stage");
    take("stage", stage);
  }
  if (!partial || "source" in body) {
    const source = body.source == null || body.source === "" ? "manual" : body.source;
    if (!isOpportunitySource(source)) throw httpError(400, "Invalid opportunity source");
    take("source", source);
  }
  if (!partial || "owner" in body) take("owner", textOrNull(body.owner));
  if (!partial || "car_type" in body) take("car_type", textOrNull(body.car_type));
  if (!partial || "car_count" in body) take("car_count", intOrNull(body.car_count));
  if (!partial || "current_rate" in body) take("current_rate", num(body.current_rate));
  if (!partial || "target_rate" in body) take("target_rate", num(body.target_rate));
  if (!partial || "term_months" in body) take("term_months", intOrNull(body.term_months));
  if (!partial || "est_value" in body) take("est_value", num(body.est_value));
  if (!partial || "expiry_date" in body) take("expiry_date", dateOnly(body.expiry_date));
  if (!partial || "new_expiry_date" in body) take("new_expiry_date", dateOnly(body.new_expiry_date));
  if (!partial || "expected_close" in body) take("expected_close", dateOnly(body.expected_close));
  if (!partial || "company_id" in body) take("company_id", positiveInt(body.company_id));
  if (!partial || "sublessee_note" in body) take("sublessee_note", textOrNull(body.sublessee_note));
  if (!partial || "competitor" in body) take("competitor", textOrNull(body.competitor));
  if (!partial || "loss_reason" in body) {
    if (body.loss_reason == null || body.loss_reason === "") take("loss_reason", null);
    else if (!isLossReason(body.loss_reason)) throw httpError(400, "Invalid loss reason");
    else take("loss_reason", body.loss_reason);
  }
  if (!partial || "notes" in body) take("notes", body.notes == null ? null : String(body.notes));
  if (!partial || "won_rider_id" in body) take("won_rider_id", positiveInt(body.won_rider_id));
  if (!partial || "master_lease_id" in body) take("master_lease_id", positiveInt(body.master_lease_id));
  if (!partial || "rider_id" in body) take("rider_id", positiveInt(body.rider_id));
  return out;
}

export async function createOpportunity(body: Record<string, unknown>, actor: string): Promise<OpportunityRow & { change_group: string }> {
  const accountId = positiveInt(body.account_id);
  if (!accountId) throw httpError(400, "account_id is required");
  const { data: account, error: accountErr } = await supabaseAdmin
    .from("accounts")
    .select("id, account_manager")
    .eq("id", accountId)
    .maybeSingle();
  if (accountErr) throw accountErr;
  if (!account) throw httpError(400, "Account not found");

  const patch = cleanWrite({ ...body, stage: body.stage ?? "identified", source: body.source ?? "manual" }, false);
  let masterLeaseId = positiveInt(patch.master_lease_id);
  const riderId = positiveInt(patch.rider_id);
  if (riderId) {
    const ctx = await riderContext(riderId);
    masterLeaseId = ctx.master_lease_id;
    if (ctx.account_id != null && ctx.account_id !== accountId) {
      throw httpError(400, "Rider belongs to a different account");
    }
  }
  if (!("owner" in body) || textOrNull(body.owner) == null) {
    patch.owner = textOrNull(account.account_manager);
  }
  patch.account_id = accountId;
  patch.master_lease_id = masterLeaseId;
  patch.rider_id = riderId;
  patch.created_by = actor;
  const stage = String(patch.stage);
  const loss = textOrNull(patch.loss_reason);
  if (lostNeedsReason(stage, loss)) throw httpError(400, "Lost opportunities require a loss_reason");
  if (String(patch.type) === "renewal" && stage === "won" && !dateOnly(patch.new_expiry_date)) {
    throw httpError(400, "Won renewal requires new_expiry_date");
  }
  if (stage === "won" || stage === "lost") patch.closed_at = new Date().toISOString();
  if (wonReletNeedsRemarket({ type: String(patch.type), stage, won_rider_id: positiveInt(patch.won_rider_id) })) {
    throw httpError(409, "Run remarket in Lease Management", {
      needs_remarket: true,
      rider_url: remarketRiderUrl(riderId),
    });
  }

  const result = await withChangeGroupResult(actor, async () => {
    const { data, error } = await supabaseAdmin.from("opportunities").insert(patch).select("*").single();
    if (error) {
      if (error.code === "23514") throw httpError(400, "Lost opportunities require a loss_reason");
      throw error;
    }
    await recordChange({
      table: "opportunities",
      pk: Number(data.id),
      before: {},
      after: data,
      action: "create_opportunity",
      entity_type: "opportunity",
      entity_id: Number(data.id),
      rider_id: riderId,
      actor,
      detail: { type: data.type, stage: data.stage },
    });
    return mapOpportunity(data as Record<string, unknown>);
  });
  return result;
}

export async function patchOpportunity(
  id: number,
  body: Record<string, unknown>,
  actor: string,
): Promise<OpportunityRow & { change_group: string }> {
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, "Invalid opportunity");
  const { data: before, error: beforeErr } = await supabaseAdmin.from("opportunities").select("*").eq("id", id).maybeSingle();
  if (beforeErr) throw beforeErr;
  if (!before) throw httpError(404, "Opportunity not found");

  const patch = cleanWrite(body, true);
  let riderId = positiveInt("rider_id" in patch ? patch.rider_id : before.rider_id);
  if ("rider_id" in body) {
    if (riderId) {
      const ctx = await riderContext(riderId);
      patch.master_lease_id = ctx.master_lease_id;
      if (ctx.account_id != null && ctx.account_id !== Number(before.account_id)) {
        throw httpError(400, "Rider belongs to a different account");
      }
    } else {
      patch.master_lease_id = null;
    }
  }
  const next: Record<string, unknown> = { ...before, ...patch };
  const stage = String(next.stage);
  const type = String(next.type) as OpportunityType;
  if (!isOpportunityType(type) || !isOpportunityStage(stage)) throw httpError(400, "Invalid opportunity");
  if (lostNeedsReason(stage, textOrNull(next.loss_reason))) throw httpError(400, "Lost opportunities require a loss_reason");
  if (type === "renewal" && stage === "won" && !dateOnly(next.new_expiry_date)) {
    throw httpError(400, "Won renewal requires new_expiry_date");
  }
  const wonRiderId = positiveInt(next.won_rider_id);
  if (wonReletNeedsRemarket({ type, stage, won_rider_id: wonRiderId })) {
    throw httpError(409, "Run remarket in Lease Management", {
      needs_remarket: true,
      rider_url: remarketRiderUrl(riderId),
    });
  }
  if ((stage === "won" || stage === "lost") && before.stage !== stage) {
    patch.closed_at = new Date().toISOString();
  }
  if (type === "renewal" && stage === "won" && "new_expiry_date" in body) {
    patch.new_expiry_date = dateOnly(body.new_expiry_date);
  }
  patch.updated_at = new Date().toISOString();
  riderId = positiveInt("rider_id" in patch ? patch.rider_id : before.rider_id);

  const result = await withChangeGroupResult(actor, async () => {
    const { data, error } = await supabaseAdmin.from("opportunities").update(patch).eq("id", id).select("*").single();
    if (error) {
      if (error.code === "23514") throw httpError(400, "Lost opportunities require a loss_reason");
      throw error;
    }
    await recordChange({
      table: "opportunities",
      pk: id,
      before,
      after: data,
      action: "update_opportunity",
      entity_type: "opportunity",
      entity_id: id,
      rider_id: riderId,
      actor,
      detail: { type: data.type, stage: data.stage },
    });
    return mapOpportunity(data as Record<string, unknown>);
  });
  return result;
}

export type { OpportunitySource, OpportunityStage };
