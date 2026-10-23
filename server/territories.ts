import { randomUUID } from "crypto";
import { annotateActorLabels } from "./actor-label";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";

const OWNER_SELECT = "initials, full_name, color_hex, is_active, sort_order";
const GEO_SELECT =
  "contact_id, company_id, contact_name, title, email, company_name, relationship_type, priority_tier, pipeline_status, account_id, account_manager, city, state_raw, zip_raw, zip5, county_fips, state_usps, lat, lng, location_status, territory_owner, split_state_unresolved";

export type TerritoryOwner = {
  initials: string;
  full_name: string;
  color_hex: string;
  is_active: boolean;
  sort_order: number;
};

export type ContactGeoRow = {
  contact_id: number;
  company_id: number;
  contact_name: string | null;
  title: string | null;
  email: string | null;
  company_name: string | null;
  relationship_type: string | null;
  priority_tier: string | null;
  pipeline_status: string | null;
  account_id: number | null;
  account_manager: string | null;
  city: string | null;
  state_raw: string | null;
  zip_raw: string | null;
  zip5: string | null;
  county_fips: string | null;
  state_usps: string | null;
  lat: number | null;
  lng: number | null;
  location_status: string;
  territory_owner: string | null;
  split_state_unresolved: boolean;
};

const BUCKETS = [
  "mapped_county",
  "state_only",
  "outside_us_canada",
  "outside_us_other",
  "no_location",
] as const;

function cleanOwner(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toUpperCase();
  return s || null;
}

function isFips5(v: string): boolean {
  return /^[0-9]{5}$/.test(v);
}

export async function getTerritoryMap() {
  const [{ data: owners, error: oErr }, assignments, counties] = await Promise.all([
    supabaseAdmin.from("territory_owners").select(OWNER_SELECT).order("sort_order"),
    fetchAllRows((from, to) =>
      supabaseAdmin.from("territory_county_assignments").select("county_fips, owner_initials").range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabaseAdmin.from("geo_counties").select("county_fips, state_usps, name").range(from, to),
    ),
  ]);
  if (oErr) throw oErr;

  const countyOwner: Record<string, string | null> = {};
  const ownerCounties = new Map<string, number>();
  const ownerStates = new Map<string, Set<string>>();
  const stateOwners = new Map<string, Set<string>>();
  const countyState = new Map<string, string>();
  for (const c of counties as { county_fips: string; state_usps: string }[]) {
    countyState.set(c.county_fips, c.state_usps);
  }
  for (const a of assignments as { county_fips: string; owner_initials: string | null }[]) {
    countyOwner[a.county_fips] = a.owner_initials;
    const st = countyState.get(a.county_fips);
    if (a.owner_initials) {
      ownerCounties.set(a.owner_initials, (ownerCounties.get(a.owner_initials) ?? 0) + 1);
      if (st) {
        if (!ownerStates.has(a.owner_initials)) ownerStates.set(a.owner_initials, new Set());
        ownerStates.get(a.owner_initials)!.add(st);
        if (!stateOwners.has(st)) stateOwners.set(st, new Set());
        stateOwners.get(st)!.add(a.owner_initials);
      }
    }
  }

  const splitStates = [...stateOwners.entries()].filter(([, set]) => set.size > 1).map(([st]) => st);
  const wholeStates: Record<string, string | null> = {};
  for (const [st, set] of stateOwners) {
    wholeStates[st] = set.size === 1 ? [...set][0] : null;
  }

  return {
    owners: (owners ?? []) as TerritoryOwner[],
    counties: countyOwner,
    countyMeta: Object.fromEntries(
      (counties as { county_fips: string; state_usps: string; name: string }[]).map((c) => [
        c.county_fips,
        { state: c.state_usps, name: c.name },
      ]),
    ),
    splitStates,
    wholeStates,
    ownerStats: (owners ?? []).map((o: TerritoryOwner) => ({
      initials: o.initials,
      counties: ownerCounties.get(o.initials) ?? 0,
      states: [...(ownerStates.get(o.initials) ?? [])].filter((st) => wholeStates[st] === o.initials).length,
    })),
  };
}

export async function getTerritoryHistory(opts: { county?: string; state?: string; limit: number }) {
  let q = supabaseAdmin
    .from("territory_change_log")
    .select("id, change_set_id, county_fips, from_owner, to_owner, changed_by, changed_at, note")
    .order("changed_at", { ascending: false })
    .limit(Math.min(5000, Math.max(1, opts.limit * 80)));
  if (opts.county && isFips5(opts.county)) q = q.eq("county_fips", opts.county);
  const { data, error } = await q;
  if (error) throw error;
  let rows = data ?? [];
  if (opts.state) {
    const st = opts.state.trim().toUpperCase();
    const { data: inState } = await supabaseAdmin.from("geo_counties").select("county_fips").eq("state_usps", st);
    const allow = new Set((inState ?? []).map((r: { county_fips: string }) => r.county_fips));
    rows = rows.filter((r) => allow.has(r.county_fips));
  }
  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = grouped.get(r.change_set_id) ?? [];
    list.push(r);
    grouped.set(r.change_set_id, list);
  }
  const sets = [...grouped.entries()]
    .map(([change_set_id, items]) => ({
      change_set_id,
      changed_at: items[0]?.changed_at,
      changed_by: items[0]?.changed_by,
      note: items[0]?.note,
      counties: items.length,
      from_owners: [...new Set(items.map((i) => i.from_owner).filter(Boolean))],
      to_owners: [...new Set(items.map((i) => i.to_owner).filter(Boolean))],
    }))
    .sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)))
    .slice(0, opts.limit);
  return { change_sets: await annotateActorLabels(sets, (set) => set.changed_by) };
}

async function countiesForState(state: string): Promise<string[]> {
  const st = state.trim().toUpperCase();
  const { data, error } = await supabaseAdmin.from("geo_counties").select("county_fips").eq("state_usps", st);
  if (error) throw error;
  return (data ?? []).map((r: { county_fips: string }) => r.county_fips);
}

export async function assignTerritories(body: {
  groups?: { counties?: string[]; owner?: string | null }[];
  state?: string;
  owner?: string | null;
  note?: string;
}, who: string) {
  const groups: { counties: string[]; owner: string | null }[] = [];
  if (body.state) {
    const counties = await countiesForState(body.state);
    if (!counties.length) {
      const err = new Error("Unknown state");
      (err as Error & { status: number }).status = 400;
      throw err;
    }
    groups.push({ counties, owner: cleanOwner(body.owner) });
  }
  for (const g of body.groups ?? []) {
    const counties = [...new Set((g.counties ?? []).map((c) => String(c)).filter(isFips5))];
    if (counties.length) groups.push({ counties, owner: cleanOwner(g.owner) });
  }
  if (!groups.length) {
    const err = new Error("No counties to assign");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const cs = randomUUID();
  const { data, error } = await supabaseAdmin.rpc("assign_territory_groups", {
    p_groups: groups,
    p_who: who,
    p_note: body.note?.trim() || null,
    p_cs: cs,
  });
  if (error) throw error;
  return data ?? { change_set_id: cs };
}

export async function revertTerritoryChangeSet(changeSetId: string, who: string) {
  const cs = randomUUID();
  const { data, error } = await supabaseAdmin.rpc("revert_territory_change_set", {
    p_old_cs: changeSetId,
    p_who: who,
    p_new_cs: cs,
  });
  if (error) throw error;
  return data ?? { change_set_id: cs };
}

type ContactFilters = {
  relationship_type?: string;
  priority_tier?: string;
  pipeline_status?: string;
  owner?: string;
  q?: string;
  linked_to_ol?: boolean;
  location_status?: string;
  county?: string;
  state?: string;
};

function applyRowFilters(rows: ContactGeoRow[], f: ContactFilters): ContactGeoRow[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.relationship_type && r.relationship_type !== f.relationship_type) return false;
    if (f.priority_tier && r.priority_tier !== f.priority_tier) return false;
    if (f.pipeline_status && r.pipeline_status !== f.pipeline_status) return false;
    if (f.owner && r.territory_owner !== f.owner) return false;
    if (f.location_status === "split_state_unresolved") {
      if (!r.split_state_unresolved) return false;
    } else if (f.location_status && r.location_status !== f.location_status) return false;
    if (f.county && r.county_fips !== f.county) return false;
    if (f.state && r.state_usps !== f.state.toUpperCase()) return false;
    if (q) {
      const hay = `${r.company_name ?? ""} ${r.contact_name ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

async function loadContactGeo(): Promise<ContactGeoRow[]> {
  return fetchAllRows((from, to) =>
    supabaseAdmin.from("v_contact_geo").select(GEO_SELECT).range(from, to),
  ) as Promise<ContactGeoRow[]>;
}

async function contactIdsWithOl(): Promise<Set<number>> {
  const links = await fetchAllRows((from, to) =>
    supabaseAdmin.from("contact_lease_links").select("company_contact_id").not("company_contact_id", "is", null).range(from, to),
  );
  return new Set(
    (links as { company_contact_id: number | null }[])
      .map((l) => l.company_contact_id)
      .filter((id): id is number => id != null),
  );
}

export async function getTerritoryContacts(f: ContactFilters) {
  let rows = await loadContactGeo();
  const linked = await contactIdsWithOl();
  if (f.linked_to_ol) rows = rows.filter((r) => linked.has(r.contact_id));
  const filtered = applyRowFilters(rows, f);

  const buckets: Record<string, number> = {
    mapped_county: 0,
    state_only: 0,
    outside_us_canada: 0,
    outside_us_other: 0,
    no_location: 0,
    split_state_unresolved: 0,
  };
  const byCounty = new Map<string, number>();
  const byZip = new Map<string, { zip: string; lat: number; lng: number; count: number }>();
  for (const r of filtered) {
    if (BUCKETS.includes(r.location_status as (typeof BUCKETS)[number])) {
      buckets[r.location_status] += 1;
    }
    if (r.split_state_unresolved) buckets.split_state_unresolved += 1;
    if (r.county_fips) byCounty.set(r.county_fips, (byCounty.get(r.county_fips) ?? 0) + 1);
    if (r.zip5 && r.lat != null && r.lng != null) {
      const cur = byZip.get(r.zip5);
      if (cur) cur.count += 1;
      else byZip.set(r.zip5, { zip: r.zip5, lat: Number(r.lat), lng: Number(r.lng), count: 1 });
    }
  }
  const total = filtered.length;
  const bucketSum = BUCKETS.reduce((n, k) => n + buckets[k], 0);
  return {
    total,
    buckets,
    bucket_sum: bucketSum,
    counties: Object.fromEntries(byCounty),
    zips: [...byZip.values()],
    linked_ol_count: filtered.filter((r) => linked.has(r.contact_id)).length,
  };
}

export async function listTerritoryContacts(f: ContactFilters & { offset?: number; limit?: number }) {
  let rows = await loadContactGeo();
  const linked = await contactIdsWithOl();
  if (f.linked_to_ol) rows = rows.filter((r) => linked.has(r.contact_id));
  const filtered = applyRowFilters(rows, f);
  const offset = Math.max(0, f.offset ?? 0);
  const limit = Math.min(200, Math.max(1, f.limit ?? 80));
  const page = filtered.slice(offset, offset + limit);

  const ids = page.map((r) => r.contact_id);
  const olByContact = new Map<number, string[]>();
  if (ids.length) {
    const { data: links } = await supabaseAdmin
      .from("contact_lease_links")
      .select("company_contact_id, master_lease_id, rider_id")
      .in("company_contact_id", ids);
    const mlaIds = [...new Set((links ?? []).map((l: { master_lease_id: number | null }) => l.master_lease_id).filter(Boolean))] as number[];
    const riderIds = [...new Set((links ?? []).map((l: { rider_id: number | null }) => l.rider_id).filter(Boolean))] as number[];
    const mlaMap = new Map<number, string>();
    const riderMap = new Map<number, string>();
    if (mlaIds.length) {
      const { data } = await supabaseAdmin.from("master_leases").select("id, lease_number").in("id", mlaIds);
      for (const m of data ?? []) mlaMap.set(m.id, m.lease_number ?? String(m.id));
    }
    if (riderIds.length) {
      const { data } = await supabaseAdmin.from("riders").select("id, rider_name, schedule_number").in("id", riderIds);
      for (const r of data ?? []) riderMap.set(r.id, r.schedule_number || r.rider_name || String(r.id));
    }
    for (const l of links ?? []) {
      const cid = l.company_contact_id as number;
      const labels = olByContact.get(cid) ?? [];
      if (l.rider_id && riderMap.get(l.rider_id)) labels.push(riderMap.get(l.rider_id)!);
      else if (l.master_lease_id && mlaMap.get(l.master_lease_id)) labels.push(mlaMap.get(l.master_lease_id)!);
      olByContact.set(cid, labels);
    }
  }

  return {
    total: filtered.length,
    offset,
    limit,
    rows: page.map((r) => ({
      ...r,
      has_ol_link: linked.has(r.contact_id),
      ol_numbers: olByContact.get(r.contact_id) ?? [],
    })),
  };
}

export async function createTerritoryOwner(body: { initials: string; full_name: string; color_hex: string; sort_order?: number }) {
  const initials = cleanOwner(body.initials);
  if (!initials || initials.length < 2 || initials.length > 4) {
    const err = new Error("Initials must be 2–4 letters");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const { data, error } = await supabaseAdmin
    .from("territory_owners")
    .insert({
      initials,
      full_name: String(body.full_name ?? "").trim() || initials,
      color_hex: String(body.color_hex ?? "").trim(),
      sort_order: Number.isFinite(body.sort_order) ? body.sort_order : 100,
    })
    .select(OWNER_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function patchTerritoryOwner(initials: string, patch: { full_name?: string; color_hex?: string; is_active?: boolean; sort_order?: number }) {
  const key = cleanOwner(initials);
  if (!key) {
    const err = new Error("Invalid initials");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.full_name != null) upd.full_name = String(patch.full_name).trim();
  if (patch.color_hex != null) upd.color_hex = String(patch.color_hex).trim();
  if (patch.is_active != null) upd.is_active = Boolean(patch.is_active);
  if (patch.sort_order != null) upd.sort_order = Number(patch.sort_order);
  const { data, error } = await supabaseAdmin
    .from("territory_owners")
    .update(upd)
    .eq("initials", key)
    .select(OWNER_SELECT)
    .single();
  if (error) throw error;
  return data;
}
