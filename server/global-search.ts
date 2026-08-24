import { displayLeaseNumber, splitCarNumber } from "@shared/residco-import";
import { asOne } from "@shared/lease-type";
import { hydrateOpsFlag } from "@shared/ops-flag";
import { carListSearchTokens } from "@shared/programs";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import { applySearchFilter } from "./railcar-list";
import { resolveProgramCars } from "./programs";
import { resolveRailcarsByAnyIdentity } from "./activity-log";

const CAR_LIMIT = 500;
const SIDE_LIMIT = 100;

const SEARCH_CAR_SELECT = `
id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, mechanical_designation,
lessee_name, rider_external_id, assignment_label, managed_category, lease_type, comment_event_note,
assignment:railcar_assignments(
  id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at,
  rider:riders(
    id, rider_name, schedule_number, expiration_date,
    master_lease:master_leases(id, lease_number, lessor, lessee, lease_type)
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

function scoreBlob(blob: string, group: string): number | null {
  const phrase = group.toLowerCase();
  const tokens = phrase.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (!tokens.every((t) => blob.includes(t))) return null;
  return blob.includes(phrase) ? 0 : 1;
}

function bestScore(blob: string, groups: string[]): number | null {
  let best: number | null = null;
  for (const g of groups) {
    const s = scoreBlob(blob, g);
    if (s == null) continue;
    best = best == null ? s : Math.min(best, s);
  }
  return best;
}

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

function carBlob(c: any) {
  return [
    c.car_number,
    c.reporting_marks,
    `${c.reporting_marks ?? ""}${c.car_number ?? ""}`,
    c.lessee_name,
    c.rider_external_id,
    c.assignment_label,
    c.assignment?.fleet_name,
    c.assignment?.rider?.rider_name,
    c.assignment?.rider?.master_lease?.lessee,
    displayLeaseNumber(c.assignment?.rider?.master_lease?.lease_number),
    c.assignment?.sub_lease_number,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function riderBlob(r: any) {
  return [
    r.rider_name,
    r.schedule_number,
    r.master_lease?.lessee,
    displayLeaseNumber(r.master_lease?.lease_number),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function leaseBlob(l: any) {
  return [displayLeaseNumber(l.lease_number), l.lease_number, l.lessee, l.lessor, l.agreement_number]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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

async function fetchCarsByText(groups: string[]): Promise<any[]> {
  const pages = await Promise.all(
    groups.map(async (group) => {
      let q = supabaseAdmin.from("railcars").select(SEARCH_CAR_SELECT);
      q = applySearchFilter(q, group);
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
): Promise<any[]> {
  if (!ids.length) return [];
  let q = supabaseAdmin.from("railcars").select(SEARCH_CAR_SELECT_INNER);
  q = q.in(column, ids.slice(0, 80));
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

async function fetchRiders(): Promise<any[]> {
  const rows = await fetchAllRows((from, to) =>
    supabaseAdmin
      .from("riders")
      .select("id, rider_name, schedule_number, expiration_date, master_lease:master_leases(id, lease_number, lessor, lessee, lease_type)")
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((r: any) => ({ ...r, master_lease: asOne(r.master_lease) }));
}

async function fetchLeases(): Promise<any[]> {
  return fetchAllRows((from, to) =>
    supabaseAdmin.from("master_leases").select("*").order("id", { ascending: true }).range(from, to),
  );
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

async function fetchCarsByIds(ids: number[]): Promise<any[]> {
  const uniq = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniq.length) return [];
  const pages: any[] = [];
  for (let i = 0; i < uniq.length; i += 80) {
    const slice = uniq.slice(i, i + 80);
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select(SEARCH_CAR_SELECT)
      .in("id", slice);
    if (error) throw error;
    pages.push(...(data ?? []).map(mapCar));
  }
  const byId = new Map(pages.map((c) => [Number(c.id), c]));
  return uniq.map((id) => byId.get(id)).filter(Boolean);
}

async function runCarListSearch(raw: string, tokens: string[]): Promise<GlobalSearchResult> {
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
  const railcars = await timed("railcars-paste-hydrate", () => fetchCarsByIds(orderedIds));
  const not_found = [
    ...resolved.not_found.map((n) => n.token),
    ...resolved.ambiguous
      .filter((a) => Boolean(splitCarNumber(a.token).reporting_marks))
      .map((a) => a.token),
  ];
  return {
    query: raw,
    terms: capped,
    railcars,
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

export async function runGlobalSearch(raw: string): Promise<GlobalSearchResult> {
  const tAll = Date.now();
  const pasteCars = carListSearchTokens(raw);
  if (pasteCars) {
    const out = await runCarListSearch(raw, pasteCars);
    console.log(
      `[search] total ${Date.now() - tAll}ms paste-cars=${pasteCars.length} found=${out.railcars.length} missing=${out.not_found.length}`,
    );
    return out;
  }

  const groups = raw.split(/[\n\r,;]+/).map((g) => g.trim()).filter(Boolean);
  const terms = groups.flatMap((g) => g.split(/\s+/).filter(Boolean));

  const [textCars, priorIds, allRiders, allLeases] = await Promise.all([
    timed("railcars-text-query", () => fetchCarsByText(groups)),
    timed("railcars-prior-identity", () => resolveRailcarsByAnyIdentity(raw)),
    timed("riders-fetch", fetchRiders),
    timed("leases-fetch", fetchLeases),
  ]);

  const tScore = Date.now();
  const matchedRiders = (allRiders ?? [])
    .map((r: any) => ({ r, score: bestScore(riderBlob(r), groups) }))
    .filter((x) => x.score != null)
    .sort((a, b) => a.score! - b.score!)
    .map((x) => x.r)
    .slice(0, SIDE_LIMIT);
  const matchedLeases = (allLeases ?? [])
    .map((l: any) => ({ l, score: bestScore(leaseBlob(l), groups) }))
    .filter((x) => x.score != null)
    .sort((a, b) => a.score! - b.score!)
    .map((x) => x.l)
    .slice(0, SIDE_LIMIT);
  console.log(
    `[search] score-riders-leases ${Date.now() - tScore}ms riders=${matchedRiders.length} leases=${matchedLeases.length}`,
  );

  const priorCars = await timed("railcars-prior-hydrate", () =>
    fetchCarsByIds(priorIds.filter((id) => !textCars.some((c) => c.id === id))),
  );
  const have = new Set([...textCars, ...priorCars].map((c) => c.id));
  const riderIds = matchedRiders.map((r: any) => r.id).filter(Boolean);
  const leaseIds = matchedLeases.map((l: any) => l.id).filter(Boolean);

  const extraCars = await timed("railcars-via-rider-lease", async () => {
    const [byRider, byLease] = await Promise.all([
      fetchCarsByFk("railcar_assignments.rider_id", riderIds),
      fetchCarsByFk("railcar_assignments.rider.master_lease_id", leaseIds),
    ]);
    return dedupeCars([...byRider, ...byLease].filter((c) => !have.has(c.id)));
  });

  const tCarScore = Date.now();
  const priorSet = new Set(priorIds);
  const matchedCars = dedupeCars([...priorCars, ...textCars, ...extraCars])
    .map((c) => ({
      c,
      score: priorSet.has(Number(c.id)) ? 0 : bestScore(carBlob(c), groups),
    }))
    .filter((x) => x.score != null)
    .sort(
      (a, b) =>
        a.score! - b.score! || String(a.c.car_number).localeCompare(String(b.c.car_number)),
    )
    .map((x) => x.c)
    .slice(0, CAR_LIMIT);
  console.log(`[search] score-railcars ${Date.now() - tCarScore}ms rows=${matchedCars.length}`);

  const countByRider = await timed("rider-car-counts", () =>
    activeCarCountsByRider(matchedRiders.map((r: any) => r.id)),
  );
  const ridersOut = matchedRiders.map((r: any) => ({
    ...r,
    car_count: countByRider.get(r.id) ?? 0,
  }));

  console.log(
    `[search] total ${Date.now() - tAll}ms q=${JSON.stringify(raw)} cars=${matchedCars.length} riders=${ridersOut.length} leases=${matchedLeases.length}`,
  );

  return {
    query: raw,
    terms,
    railcars: matchedCars,
    riders: ridersOut,
    leases: matchedLeases,
    not_found: [],
    counts: {
      railcars: matchedCars.length,
      riders: ridersOut.length,
      leases: matchedLeases.length,
      total: matchedCars.length + ridersOut.length + matchedLeases.length,
    },
  };
}
