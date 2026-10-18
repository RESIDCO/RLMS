import {
  effectiveCadence,
  effectiveOwner,
  handoffPct,
  isTouchActivity,
  nextTouchDue,
  touchStatus,
  type AccountBookAttention,
  type AccountBookResponse,
  type AccountBookRow,
  type AccountBookSegment,
  type TouchStatus,
} from "@shared/account-mgmt";
import { inRenewalWindow, isGovernedExpirySource, isOpenStage } from "@shared/crm";
import { fetchAllRows } from "./fetch-all";
import { loadOnRentCars, onRentIdsByRider, utcToday } from "./crm-opportunities";
import { supabaseAdmin } from "./supabase";

export type BookQuery = {
  segment: AccountBookSegment;
  owner: string;
  tier: string;
  q: string;
};

type PartyRow = { entity_id: number; label: string; kind: string };
type OwnerRow = {
  account_id: number;
  owner_of_record: string | null;
  incoming_owner: string | null;
  effective_owner: string | null;
  handoff_id: number | null;
  handoff_status: string | null;
  to_account_manager: string | null;
  meeting_scheduled: boolean | null;
  communication_completed: boolean | null;
  briefing_form_completed: boolean | null;
};
type AccountRow = {
  id: number;
  name: string;
  tier: string | null;
  touch_cadence_days: number | null;
};
type RentRow = {
  account_id: number;
  snapshot_month: string | null;
  monthly_rent_total: number | string | null;
  riders_without_summary: number | null;
};

function dateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

type PartyKind = "client" | "former" | "prospect";

function segmentOf(kind: string): PartyKind | null {
  if (kind === "client" || kind === "former" || kind === "prospect") return kind;
  return null;
}

function inSegment(segment: AccountBookSegment, kind: AccountBookSegment): boolean {
  switch (segment) {
    case "all":
      return true;
    case "mybook":
      return kind === "client" || kind === "prospect";
    case "client":
    case "former":
    case "prospect":
      return kind === segment;
    default: {
      const neverSegment: never = segment;
      return neverSegment;
    }
  }
}

function ownerMatches(filter: string, effective: string | null): boolean {
  if (!filter || filter === "any") return true;
  if (filter === "unowned") return effective == null;
  return effective === filter;
}

export async function listAccountBook(query: BookQuery): Promise<AccountBookResponse> {
  const today = utcToday();
  const [parties, accounts, owners, rents, leases, riders, cars, opps, activities] = await Promise.all([
    fetchAllRows<PartyRow>((from, to) =>
      supabaseAdmin
        .from("v_crm_party_search")
        .select("entity_id, label, kind")
        .eq("entity", "account")
        .order("entity_id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<AccountRow>((from, to) =>
      supabaseAdmin.from("accounts").select("id, name, tier, touch_cadence_days").order("id", { ascending: true }).range(from, to),
    ),
    fetchAllRows<OwnerRow>((from, to) =>
      supabaseAdmin.from("v_account_owner_effective").select("*").order("account_id", { ascending: true }).range(from, to),
    ),
    fetchAllRows<RentRow>((from, to) =>
      supabaseAdmin
        .from("v_account_rent_roll")
        .select("account_id, snapshot_month, monthly_rent_total, riders_without_summary")
        .order("account_id", { ascending: true })
        .range(from, to),
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
    fetchAllRows<{ account_id: number; stage: string }>((from, to) =>
      supabaseAdmin.from("opportunities").select("account_id, stage").order("id", { ascending: true }).range(from, to),
    ),
    fetchAllRows<{ account_id: number | null; kind: string | null; done_at: string | null; occurred_at: string | null }>((from, to) =>
      supabaseAdmin
        .from("crm_activities")
        .select("account_id, kind, done_at, occurred_at")
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const partyByAccount = new Map<number, { name: string; kind: PartyKind }>();
  for (const party of parties) {
    const kind = segmentOf(String(party.kind ?? ""));
    if (!kind) continue;
    const id = Number(party.entity_id);
    if (!partyByAccount.has(id)) partyByAccount.set(id, { name: String(party.label ?? ""), kind });
  }
  const accountById = new Map(accounts.map((row) => [Number(row.id), row]));
  const ownerById = new Map(owners.map((row) => [Number(row.account_id), row]));
  const rentById = new Map(rents.map((row) => [Number(row.account_id), row]));
  const leaseById = new Map(leases.map((lease) => [Number(lease.id), lease]));
  const onRent = onRentIdsByRider(cars);

  const onRentCars = new Map<number, number>();
  const nextExpiry = new Map<number, string>();
  const renewalRiders = new Map<number, number>();
  for (const rider of riders) {
    const lease = leaseById.get(Number(rider.master_lease_id));
    if (!lease || lease.is_placeholder === true || lease.account_id == null) continue;
    const accountId = Number(lease.account_id);
    const carsOnRider = onRent.get(Number(rider.id)) ?? [];
    if (!carsOnRider.length) continue;
    onRentCars.set(accountId, (onRentCars.get(accountId) ?? 0) + carsOnRider.length);
    const expiry = dateOnly(rider.expiration_date);
    if (!expiry || !isGovernedExpirySource(rider.expiration_source)) continue;
    if (expiry >= today) {
      const prev = nextExpiry.get(accountId);
      if (!prev || expiry < prev) nextExpiry.set(accountId, expiry);
    }
    if (inRenewalWindow(expiry, today, 6)) {
      renewalRiders.set(accountId, (renewalRiders.get(accountId) ?? 0) + 1);
    }
  }
  const openOpps = new Map<number, number>();
  for (const opp of opps) {
    if (!isOpenStage(opp.stage)) continue;
    openOpps.set(Number(opp.account_id), (openOpps.get(Number(opp.account_id)) ?? 0) + 1);
  }
  const lastTouch = new Map<number, string>();
  for (const activity of activities) {
    if (activity.account_id == null || !activity.occurred_at) continue;
    if (!isTouchActivity({ kind: activity.kind, done_at: activity.done_at })) continue;
    const id = Number(activity.account_id);
    const prev = lastTouch.get(id);
    if (!prev || activity.occurred_at > prev) lastTouch.set(id, activity.occurred_at);
  }

  const counts = { client: 0, former: 0, prospect: 0 };
  const built: AccountBookRow[] = [];
  for (const entry of Array.from(partyByAccount.entries())) {
    const accountId = entry[0];
    const party = entry[1];
    counts[party.kind] += 1;
    const account = accountById.get(accountId);
    const owner = ownerById.get(accountId);
    const record = textOrNull(owner?.owner_of_record);
    const incoming = textOrNull(owner?.incoming_owner);
    const effective = textOrNull(owner?.effective_owner) ?? effectiveOwner({ owner_of_record: record, incoming_owner: incoming });
    const tier = textOrNull(account?.tier);
    const cadence = effectiveCadence(tier, account?.touch_cadence_days ?? null);
    const last = lastTouch.get(accountId) ?? null;
    const status: TouchStatus = touchStatus({ tier, cadenceDays: cadence, lastTouchIso: last, today });
    const rent = rentById.get(accountId);
    const name = textOrNull(account?.name) ?? party.name;
    built.push({
      account_id: accountId,
      name,
      kind: party.kind,
      owner_of_record: record,
      incoming_owner: incoming,
      effective_owner: effective,
      handoff_pct: handoffPct(
        {
          to_account_manager: owner?.to_account_manager,
          meeting_scheduled: owner?.meeting_scheduled,
          communication_completed: owner?.communication_completed,
          briefing_form_completed: owner?.briefing_form_completed,
        },
        owner?.handoff_id == null ? null : Number(owner.handoff_id),
      ),
      tier,
      cadence_days: cadence,
      on_rent_cars: onRentCars.get(accountId) ?? 0,
      rent_roll: rent
        ? {
            total: Number(rent.monthly_rent_total ?? 0),
            snapshot_month: dateOnly(rent.snapshot_month),
            riders_without_summary: Number(rent.riders_without_summary ?? 0),
          }
        : null,
      next_expiry: nextExpiry.get(accountId) ?? null,
      renewal_riders_6mo: renewalRiders.get(accountId) ?? 0,
      open_opps: openOpps.get(accountId) ?? 0,
      last_touch_at: last,
      next_touch_due: nextTouchDue(last, cadence),
      touch_status: status,
    });
  }

  const unownedClients = built
    .filter((row) => row.kind === "client" && row.effective_owner == null)
    .map((row) => ({ account_id: row.account_id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const scoped = built.filter((row) => inSegment(query.segment, row.kind) && ownerMatches(query.owner, row.effective_owner));
  const attention: AccountBookAttention = {
    renewals_6mo: scoped.reduce((sum, row) => sum + row.renewal_riders_6mo, 0),
    touch_overdue: scoped.filter((row) => row.touch_status === "overdue").length,
    never_touched_tiered: scoped.filter((row) => row.touch_status === "never").length,
    handoffs_incoming: scoped.filter((row) => {
      if (!row.incoming_owner) return false;
      if (!query.owner || query.owner === "any") return true;
      if (query.owner === "unowned") return false;
      return row.incoming_owner === query.owner;
    }).length,
    unowned_clients: unownedClients,
    untiered: scoped.filter((row) => row.touch_status === "untiered").length,
  };

  const needle = query.q.trim().toLowerCase();
  const rows = scoped
    .filter((row) => {
      if (query.tier && query.tier !== "any") {
        if (query.tier === "none") {
          if (row.tier) return false;
        } else if (row.tier !== query.tier) return false;
      }
      if (!needle) return true;
      return row.name.toLowerCase().includes(needle);
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return {
    segment: query.segment,
    owner: query.owner || "any",
    tier: query.tier || "any",
    q: query.q,
    counts,
    attention,
    rows,
  };
}
