import { splitCarNumber } from "@shared/residco-import";
import { asOne } from "@shared/lease-type";
import { hydrateOpsFlag } from "@shared/ops-flag";
import { carListSearchTokens } from "@shared/programs";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import { applySearchFilter, parseSearchScope, type SearchScope } from "./railcar-list";
import { resolveProgramCars } from "./programs";
import { resolveRailcarsByAnyIdentity } from "./activity-log";
import { attachLatestAmNotes, latestAmNotesByRiderIds } from "./rider-account-comments";

const CAR_LIMIT = 500;
const SIDE_LIMIT = 100;

const SEARCH_CAR_SELECT = `
id, car_number, reporting_marks, car_type, equipment_type_code, status, fleet_status, entity, active, mechanical_designation,
general_description, lessee_name, rider_external_id, assignment_label, managed_category, lease_type, comment_event_note,
assignment:railcar_assignments(
  id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at,
  rider:riders(
    id, rider_name, schedule_number, effective_date, expiration_date, monthly_rate_pct, lessors_cost,
    master_lease:master_leases(id, lease_number, agreement_number, lessor, lessee, lease_type, sold_to)
  )
)
`.replace(/\s+/g, " ").trim();

const SEARCH_CAR_SELECT_INNER = SEARCH_CAR_SELECT.replace(
  "assignment:railcar_assignments(",
  "assignment:railcar_assignments!inner(",
);

export type GlobalSearchResult = {
  query: string;
  terms: string[];
  railcars: any[];
  riders: any[];
  leases: any[];
  not_found: string[];
  counts: { railcars: number; riders: number; leases: number; total: number };
};

function mapCar(r: any) {
  const assignment = asOne(r.assignment);
  const rider = asOne(assignment?.rider);
  const master_lease = asOne(rider?.master_lease);
  return hydrateOpsFlag({
    ...r,
    assignment: assignment
      ? { ...assignment, rider: rider ? { ...rider, master_lease } : null }
      : null,
  });
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    const n = Array.isArray(result) ? ` rows=${result.length}` : "";
    console.log(`[search] ${label} ${Date.now() - t0}ms${n}`);
    return result;
  } catch (err) {
    console.log(`[search] ${label} ${Date.now() - t0}ms FAILED ${String((err as any)?.message ?? err)}`);
    throw err;
  }
}

function applyActiveFilter(q: any, active?: string) {
  const mode = !active || active === "active" ? "active" : active;
  if (mode === "inactive") return q.eq("active", false);
  if (mode === "all") return q;
  return q.neq("active", false);
}

async function fetchCarsByText(
  groups: string[],
  scope: SearchScope,
  active?: string,
): Promise<any[]> {
  const pages = await Promise.all(
    groups.map(async (group) => {
      let q = supabaseAdmin.from("railcars").select(SEARCH_CAR_SELECT);
      q = applySearchFilter(q, group, scope);
      q = applyActiveFilter(q, active);
      const { data, error } = await q.order("id", { ascending: true }).limit(CAR_LIMIT);
      if (error) throw error;
      return (data ?? []).map(mapCar);
    }),
  );
  return dedupeCars(pages.flat());
}

async function fetchCarsByFk(
  column: "railcar_assignments.rider_id" | "railcar_assignments.rider.master_lease_id",
  ids: number[],
  active?: string,
): Promise<any[]> {
  if (!ids.length) return [];
  let q = supabaseAdmin.from("railcars").select(SEARCH_CAR_SELECT_INNER);
  q = q.in(column, ids.slice(0, 80));
  q = applyActiveFilter(q, active);
  const { data, error } = await q.limit(CAR_LIMIT);
  if (error) {
    console.log(`[search] extra cars via ${column} skipped: ${error.message}`);
    return [];
  }
  return (data ?? []).map(mapCar);
}

function dedupeCars(rows: any[]): any[] {
  const seen = new Set<number>();
  const out: any[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

async function fetchRidersMatching(groups: string[]): Promise<any[]> {
  const pages = await Promise.all(
    groups.map(async (group) => {
      const t = group.replace(/[%_,()]/g, "").trim();
      if (!t) return [];
      const { data, error } = await supabaseAdmin
        .from("riders")
        .select("id, rider_name, schedule_number, expiration_date, master_lease:master_leases(id, lease_number, lessor, lessee, lease_type)")
        .or(`rider_name.ilike.%${t}%,schedule_number.ilike.%${t}%`)
        .limit(SIDE_LIMIT);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, master_lease: asOne(r.master_lease) }));
    }),
  );
  const seen = new Set<number>();
  const out: any[] = [];
  for (const r of pages.flat()) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out.slice(0, SIDE_LIMIT);
}

async function fetchLeasesMatching(groups: string[]): Promise<any[]> {
  const pages = await Promise.all(
    groups.map(async (group) => {
      const t = group.replace(/[%_,()]/g, "").trim();
      if (!t) return [];
      const { data, error } = await supabaseAdmin
        .from("master_leases")
        .select("*")
        .or(`lease_number.ilike.%${t}%,lessee.ilike.%${t}%,lessor.ilike.%${t}%,agreement_number.ilike.%${t}%`)
        .limit(SIDE_LIMIT);
      if (error) throw error;
      return data ?? [];
    }),
  );
  const seen = new Set<number>();
  const out: any[] = [];
  for (const l of pages.flat()) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
  }
  return out.slice(0, SIDE_LIMIT);
}

async function activeCarCountsByRider(riderIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  const ids = riderIds.filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return counts;
  try {
    const rows = await fetchAllRows<{ rider_id: number }>((from, to) =>
      supabaseAdmin
        .from("railcar_assignments")
        .select("id, rider_id, railcars!inner(id, active)")
        .in("rider_id", ids)
        .eq("railcars.active", true)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const row of rows) {
      const id = Number(row.rider_id);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  } catch (err) {
    console.log(`[search] rider-car-counts inner join failed, using assignments only: ${String((err as any)?.message ?? err)}`);
    const rows = await fetchAllRows<{ rider_id: number }>((from, to) =>
      supabaseAdmin
        .from("railcar_assignments")
        .select("id, rider_id")
        .in("rider_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const row of rows) {
      const id = Number(row.rider_id);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }
}

async function fetchCarsByIds(ids: number[], active?: string): Promise<any[]> {
  const uniq = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniq.length) return [];
  const pages: any[] = [];
  for (let i = 0; i < uniq.length; i += 80) {
    const slice = uniq.slice(i, i + 80);
    let q = supabaseAdmin.from("railcars").select(SEARCH_CAR_SELECT).in("id", slice);
    q = applyActiveFilter(q, active);
    const { data, error } = await q;
    if (error) throw error;
    pages.push(...(data ?? []).map(mapCar));
  }
  const byId = new Map(pages.map((c) => [Number(c.id), c]));
  return uniq.map((id) => byId.get(id)).filter(Boolean);
}

async function runCarListSearch(raw: string, tokens: string[], active?: string): Promise<GlobalSearchResult> {
  const capped = tokens.slice(0, CAR_LIMIT);
  const resolved = await timed("railcars-paste-resolve", () =>
    resolveProgramCars({ text: capped.join("\n") }),
  );
  const orderedIds: number[] = [];
  const seen = new Set<number>();
  const pushId = (id: number) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    orderedIds.push(id);
  };
  for (const m of resolved.matched) pushId(m.railcar_id);
  // Bare numbers may match several marks — keep them all. Mark-scoped tokens must not fan out.
  for (const a of resolved.ambiguous) {
    if (splitCarNumber(a.token).reporting_marks) continue;
    for (const m of a.matches) pushId(m.railcar_id);
  }
  const railcars = await timed("railcars-paste-hydrate", () => fetchCarsByIds(orderedIds, active));
  const railcarsWithNotes = await attachLatestAmNotes(railcars);
  const not_found = [
    ...resolved.not_found.map((n) => n.token),
    ...resolved.ambiguous
      .filter((a) => Boolean(splitCarNumber(a.token).reporting_marks))
      .map((a) => a.token),
  ];
  return {
    query: raw,
    terms: capped,
    railcars: railcarsWithNotes,
    riders: [],
    leases: [],
    not_found,
    counts: {
      railcars: railcars.length,
      riders: 0,
      leases: 0,
      total: railcars.length,
    },
  };
}

export async function runGlobalSearch(
  raw: string,
  opts?: { active?: string; searchScope?: SearchScope },
): Promise<GlobalSearchResult> {
  const tAll = Date.now();
  const active = opts?.active ?? "active";
  const scope = opts?.searchScope ?? parseSearchScope({});
  const pasteCars = carListSearchTokens(raw);
  if (pasteCars) {
    const out = await runCarListSearch(raw, pasteCars, active);
    console.log(
      `[search] total ${Date.now() - tAll}ms paste-cars=${pasteCars.length} found=${out.railcars.length} missing=${out.not_found.length}`,
    );
    return out;
  }

  const groups = raw.split(/[\n\r,;]+/).map((g) => g.trim()).filter(Boolean);
  const terms = groups.flatMap((g) => g.split(/\s+/).filter(Boolean));

  const [textCars, priorIds, matchedRiders, matchedLeases] = await Promise.all([
    timed("railcars-text-query", () => fetchCarsByText(groups, scope, active)),
    timed("railcars-prior-identity", () => resolveRailcarsByAnyIdentity(raw)),
    timed("riders-query", () => (scope.leases ? fetchRidersMatching(groups) : Promise.resolve([]))),
    timed("leases-query", () => (scope.leases ? fetchLeasesMatching(groups) : Promise.resolve([]))),
  ]);

  const priorCars = await timed("railcars-prior-hydrate", () =>
    fetchCarsByIds(priorIds.filter((id) => !textCars.some((c) => c.id === id)), active),
  );
  const have = new Set([...textCars, ...priorCars].map((c) => c.id));
  const riderIds = matchedRiders.map((r: any) => r.id).filter(Boolean);
  const leaseIds = matchedLeases.map((l: any) => l.id).filter(Boolean);

  const extraCars = scope.leases
    ? await timed("railcars-via-rider-lease", async () => {
        const [byRider, byLease] = await Promise.all([
          fetchCarsByFk("railcar_assignments.rider_id", riderIds, active),
          fetchCarsByFk("railcar_assignments.rider.master_lease_id", leaseIds, active),
        ]);
        return dedupeCars([...byRider, ...byLease].filter((c) => !have.has(c.id)));
      })
    : [];

  const priorSet = new Set(priorIds);
  const matchedCars = dedupeCars([...priorCars, ...textCars, ...extraCars])
    .sort(
      (a, b) =>
        Number(priorSet.has(Number(b.id))) - Number(priorSet.has(Number(a.id))) ||
        String(a.car_number).localeCompare(String(b.car_number)),
    )
    .slice(0, CAR_LIMIT);

  const countByRider = await timed("rider-car-counts", () =>
    activeCarCountsByRider(matchedRiders.map((r: any) => r.id)),
  );
  const notesByRider = await latestAmNotesByRiderIds(matchedRiders.map((r: any) => r.id));
  const ridersOut = matchedRiders.map((r: any) => ({
    ...r,
    car_count: countByRider.get(r.id) ?? 0,
    am_note: notesByRider.get(r.id) ?? null,
  }));
  const carsOut = await attachLatestAmNotes(matchedCars);

  console.log(
    `[search] total ${Date.now() - tAll}ms q=${JSON.stringify(raw)} cars=${carsOut.length} riders=${ridersOut.length} leases=${matchedLeases.length}`,
  );

  return {
    query: raw,
    terms,
    railcars: carsOut,
    riders: ridersOut,
    leases: matchedLeases,
    not_found: [],
    counts: {
      railcars: carsOut.length,
      riders: ridersOut.length,
      leases: matchedLeases.length,
      total: carsOut.length + ridersOut.length + matchedLeases.length,
    },
  };
}
