import { getAccount } from "./accounts";
import { listCrmActivities } from "./crm-activities";
import { listOpportunities, loadOnRentCars, onRentIdsByRider, utcToday } from "./crm-opportunities";
import { listDirectoryPeopleForAccount } from "./directory";
import { fetchAllRows } from "./fetch-all";
import { supabaseAdmin } from "./supabase";
import {
  isActiveRider,
  isGovernedExpirySource,
  isOpenStage,
  type Account360Contact,
  type Account360Ol,
  type Account360Payload,
  type Account360TimelineItem,
} from "@shared/crm";

export type CrmSummaryRow = {
  account_id: number;
  next_expiry: string | null;
  open_opps: number;
  last_activity_at: string | null;
};

export type Account360 = Account360Payload;

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

function monthAdd(isoMonth: string, add: number): string {
  const [year, month] = isoMonth.split("-").map(Number);
  const index = month - 1 + add;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = ((index % 12) + 12) % 12;
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`;
}

export async function listCrmSummary(): Promise<CrmSummaryRow[]> {
  const today = utcToday();
  const [accounts, leases, riders, cars, opps, activities] = await Promise.all([
    fetchAllRows<{ id: number }>((from, to) =>
      supabaseAdmin.from("accounts").select("id").order("id", { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ id: number; account_id: number | null; is_placeholder: boolean | null }>((from, to) =>
      supabaseAdmin.from("master_leases").select("id, account_id, is_placeholder").order("id", { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ id: number; master_lease_id: number; expiration_date: string | null; expiration_source: string | null }>((from, to) =>
      supabaseAdmin
        .from("riders")
        .select("id, master_lease_id, expiration_date, expiration_source")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    loadOnRentCars(),
    fetchAllRows<{ account_id: number; stage: string; flavor: string | null }>((from, to) =>
      supabaseAdmin.from("opportunities").select("account_id, stage, flavor").order("id", { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ account_id: number | null; occurred_at: string | null }>((from, to) =>
      supabaseAdmin.from("crm_activities").select("account_id, occurred_at").order("id", { ascending: true }).range(from, to),
    ),
  ]);

  const leaseById = new Map(leases.map((lease) => [Number(lease.id), lease]));
  const onRentRiders = new Set(onRentIdsByRider(cars).keys());
  const nextExpiry = new Map<number, string>();
  for (const rider of riders) {
    const lease = leaseById.get(Number(rider.master_lease_id));
    if (!lease || lease.is_placeholder === true || lease.account_id == null) continue;
    if (!onRentRiders.has(Number(rider.id))) continue;
    const expiry = dateOnly(rider.expiration_date);
    if (!expiry || expiry < today || !isGovernedExpirySource(rider.expiration_source)) continue;
    const prev = nextExpiry.get(Number(lease.account_id));
    if (!prev || expiry < prev) nextExpiry.set(Number(lease.account_id), expiry);
  }
  const openOpps = new Map<number, number>();
  for (const opp of opps) {
    if (!isOpenStage(opp.stage) || opp.flavor === "portfolio_bid") continue;
    openOpps.set(Number(opp.account_id), (openOpps.get(Number(opp.account_id)) ?? 0) + 1);
  }
  const lastActivity = new Map<number, string>();
  for (const activity of activities) {
    if (activity.account_id == null || !activity.occurred_at) continue;
    const prev = lastActivity.get(Number(activity.account_id));
    if (!prev || activity.occurred_at > prev) lastActivity.set(Number(activity.account_id), activity.occurred_at);
  }
  return accounts.map((account) => ({
    account_id: Number(account.id),
    next_expiry: nextExpiry.get(Number(account.id)) ?? null,
    open_opps: openOpps.get(Number(account.id)) ?? 0,
    last_activity_at: lastActivity.get(Number(account.id)) ?? null,
  }));
}

export async function getAccount360(id: number): Promise<Account360Payload | null> {
  const account = await getAccount(id);
  if (!account) return null;
  const today = utcToday();
  const [lessees, leases, opportunities, people, cars, activities, transitionRes] = await Promise.all([
    fetchAllRows<{ master_lease_id: number; account_id: number | null }>((from, to) =>
      supabaseAdmin.from("v_crm_lessee_account").select("master_lease_id, account_id").eq("account_id", id).order("master_lease_id").range(from, to),
    ),
    supabaseAdmin.from("master_leases").select("id, lessee, is_placeholder").eq("account_id", id),
    listOpportunities({ account_id: id }),
    listDirectoryPeopleForAccount(id),
    loadOnRentCars(),
    listCrmActivities({ account_id: id }),
    supabaseAdmin.from("account_transition_records").select("id, status").eq("account_id", id).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (leases.error) throw leases.error;
  if (transitionRes.error) throw transitionRes.error;

  const leaseIds = (leases.data ?? []).map((lease) => Number(lease.id));
  const leaseName = new Map((leases.data ?? []).map((lease) => [Number(lease.id), lease.lessee == null ? null : String(lease.lessee)]));
  const placeholder = new Set((leases.data ?? []).filter((lease) => lease.is_placeholder === true).map((lease) => Number(lease.id)));
  const rollup = leaseIds.length
    ? await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabaseAdmin.from("v_lease_rider_rollup").select("*").in("master_lease_id", leaseIds).order("rider_id").range(from, to),
      )
    : [];
  const riderIds = rollup.map((row) => Number(row.rider_id));
  const riderExtra = new Map<number, { expiration_source: string | null; monthly_rent_per_car: number | null; lifecycle_status: string | null }>();
  if (riderIds.length) {
    const { data, error } = await supabaseAdmin
      .from("riders")
      .select("id, expiration_source, monthly_rent_per_car, lifecycle_status")
      .in("id", riderIds);
    if (error) throw error;
    for (const row of data ?? []) {
      riderExtra.set(Number(row.id), {
        expiration_source: row.expiration_source ?? null,
        monthly_rent_per_car: num(row.monthly_rent_per_car),
        lifecycle_status: row.lifecycle_status ?? null,
      });
    }
  }
  const onRent = onRentIdsByRider(cars);
  const openByRider = new Map<number, number>();
  for (const row of opportunities) {
    if (!isOpenStage(row.stage) || row.rider_id == null || openByRider.has(row.rider_id)) continue;
    openByRider.set(row.rider_id, row.id);
  }
  const ols: Account360Ol[] = rollup.map((row) => {
    const riderId = Number(row.rider_id);
    const extra = riderExtra.get(riderId);
    return {
      rider_id: riderId,
      rider_name: row.rider_name == null ? null : String(row.rider_name),
      master_lease_id: Number(row.master_lease_id),
      lessee: leaseName.get(Number(row.master_lease_id)) ?? (row.lessee == null ? null : String(row.lessee)),
      lifecycle_status: extra?.lifecycle_status ?? (row.lifecycle_status == null ? null : String(row.lifecycle_status)),
      expiration_date: dateOnly(row.expiration_date),
      expiration_source: extra?.expiration_source ?? null,
      on_rent_cars: (onRent.get(riderId) ?? []).length,
      monthly_rent_per_car: extra?.monthly_rent_per_car ?? num(row.rider_rent_per_car),
      open_opportunity_id: openByRider.get(riderId) ?? null,
    };
  });

  let nextExpiry: string | null = null;
  let onRentCars = 0;
  const barCounts = new Map<string, number>();
  const startMonth = today.slice(0, 7);
  const endMonth = monthAdd(startMonth, 24);
  for (const ol of ols) {
    if (placeholder.has(ol.master_lease_id)) continue;
    onRentCars += ol.on_rent_cars;
    if (ol.on_rent_cars < 1 || !ol.expiration_date) continue;
    if (isGovernedExpirySource(ol.expiration_source) && ol.expiration_date >= today) {
      if (!nextExpiry || ol.expiration_date < nextExpiry) nextExpiry = ol.expiration_date;
    }
    const month = ol.expiration_date.slice(0, 7);
    if (month >= startMonth && month < endMonth) {
      barCounts.set(month, (barCounts.get(month) ?? 0) + ol.on_rent_cars);
    }
  }
  const expiryBars = Array.from({ length: 24 }, (_, index) => {
    const month = monthAdd(startMonth, index);
    return { month, cars: barCounts.get(month) ?? 0 };
  });

  const contactIds = Array.from(new Set(people.map((person) => Number(person.id)).filter((personId) => personId > 0)));
  const roles = new Map<number, string | null>();
  if (contactIds.length) {
    const { data, error } = await supabaseAdmin.from("company_contacts").select("id, function_role").in("id", contactIds);
    if (error) throw error;
    for (const row of data ?? []) roles.set(Number(row.id), row.function_role ?? null);
  }
  const grouped = new Map<string, Account360Contact[]>();
  const seen = new Set<number>();
  for (const person of people) {
    const personId = Number(person.id);
    if (seen.has(personId)) continue;
    seen.add(personId);
    const role = String(roles.get(personId) ?? "").trim() || "Unassigned";
    const contact: Account360Contact = {
      id: personId,
      name: String(person.name ?? "Contact"),
      title: person.title ?? null,
      email: person.email ?? null,
      phone: person.phone ?? null,
      company_id: person.company_id ?? null,
      company_name: person.company_name ?? null,
      function_role: roles.get(personId) ?? null,
    };
    const list = grouped.get(role) ?? [];
    list.push(contact);
    grouped.set(role, list);
  }
  const contacts = Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([role, group]) => ({ role, people: group }));

  const openOpps = opportunities.filter((row) => isOpenStage(row.stage) && row.flavor !== "portfolio_bid");
  const estValue = openOpps.reduce((sum, row) => sum + (row.est_value ?? 0), 0);
  const lastActivity = activities.reduce<string | null>((latest, row) => {
    if (!latest || row.occurred_at > latest) return row.occurred_at;
    return latest;
  }, null);

  const oppIds = opportunities.map((row) => row.id);
  const activityIds = activities.map((row) => row.id);
  const orParts = [`and(entity_type.eq.account,entity_id.eq.${id})`];
  if (oppIds.length) orParts.push(`and(entity_type.eq.opportunity,entity_id.in.(${oppIds.join(",")}))`);
  if (activityIds.length) orParts.push(`and(entity_type.eq.crm_activity,entity_id.in.(${activityIds.join(",")}))`);
  const { data: systemRows, error: systemErr } = await supabaseAdmin
    .from("activity_log")
    .select("id, action, actor, occurred_at, entity_type, detail")
    .or(orParts.join(","))
    .order("occurred_at", { ascending: false })
    .limit(40);
  if (systemErr) throw systemErr;

  const timeline: Account360TimelineItem[] = [
    ...activities.map((row) => ({
      id: `crm-${row.id}`,
      occurred_at: row.occurred_at,
      source: "crm" as const,
      label: row.kind,
      body: row.body,
      actor: row.actor,
    })),
    ...(systemRows ?? []).map((row) => ({
      id: `system-${row.id}`,
      occurred_at: String(row.occurred_at ?? ""),
      source: "system" as const,
      label: "System",
      body: String(row.action ?? "change"),
      actor: row.actor == null ? null : String(row.actor),
    })),
  ]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 30);

  const transition = transitionRes.data
    ? { id: Number(transitionRes.data.id), status: transitionRes.data.status == null ? null : String(transitionRes.data.status) }
    : null;

  return {
    account: {
      id: account.id,
      name: account.name,
      account_manager: account.account_manager,
      notes: account.notes,
      kind: lessees.length > 0 ? "client" : "prospect",
    },
    counts: {
      lessees: lessees.length,
      ols: ols.filter((ol) =>
        isActiveRider({
          lifecycle_status: ol.lifecycle_status,
          is_placeholder: placeholder.has(ol.master_lease_id),
          on_rent_nonsold_leased: ol.on_rent_cars,
        }),
      ).length,
      on_rent_cars: onRentCars,
      off_lease: ols.filter((ol) => ol.lifecycle_status === "off_lease_pending_remarketing").length,
      open_opps: openOpps.length,
      est_value: estValue,
    },
    next_expiry: nextExpiry,
    last_activity_at: lastActivity,
    expiry_bars: expiryBars,
    ols,
    contacts,
    opportunities,
    timeline,
    transition,
  };
}
