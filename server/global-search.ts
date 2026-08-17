import { displayLeaseNumber } from "@shared/residco-import";
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import { applySearchFilter } from "./railcar-list";

const CAR_LIMIT = 500;
const SIDE_LIMIT = 100;

const SEARCH_CAR_SELECT = `
id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, mechanical_designation,
lessee_name, rider_external_id, assignment_label, managed_category,
assignment:railcar_assignments(
  id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at,
  rider:riders(
    id, rider_name, schedule_number, expiration_date,
    master_lease:master_leases(id, lease_number, lessor, lessee)
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

function applyFleetActive(q: any, fleetActive: string) {
  if (fleetActive === "inactive") return q.eq("active", false);
  if (fleetActive !== "all") return q.neq("active", false);
  return q;
}

function mapCar(r: any) {
  return {
    ...r,
    assignment: Array.isArray(r.assignment) ? r.assignment[0] ?? null : r.assignment,
  };
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

async function fetchCarsByText(groups: string[], fleetActive: string): Promise<any[]> {
  const pages = await Promise.all(
    groups.map(async (group) => {
      let q = supabaseAdmin.from("railcars").select(SEARCH_CAR_SELECT);
      q = applyFleetActive(q, fleetActive);
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
  fleetActive: string,
): Promise<any[]> {
  if (!ids.length) return [];
  let q = supabaseAdmin.from("railcars").select(SEARCH_CAR_SELECT_INNER);
  q = applyFleetActive(q, fleetActive);
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
  return fetchAllRows((from, to) =>
    supabaseAdmin
      .from("riders")
      .select("id, rider_name, schedule_number, expiration_date, master_lease:master_leases(id, lease_number, lessor, lessee)")
      .order("id", { ascending: true })
      .range(from, to),
  );
}

async function fetchLeases(): Promise<any[]> {
  return fetchAllRows((from, to) =>
    supabaseAdmin.from("master_leases").select("*").order("id", { ascending: true }).range(from, to),
  );
}

async function activeCarCountsByRider(riderIds: number[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (!riderIds.length) return counts;
  const { data, error } = await supabaseAdmin
    .from("railcar_assignments")
    .select("rider_id, railcars!inner(id, active)")
    .in("rider_id", riderIds.slice(0, 80))
    .eq("railcars.active", true);
  if (error) {
    const fallback = await supabaseAdmin.from("railcar_assignments").select("rider_id").in("rider_id", riderIds.slice(0, 80));
    if (fallback.error) throw fallback.error;
    for (const row of fallback.data ?? []) {
      const id = Number((row as { rider_id?: number }).rider_id);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }
  for (const row of data ?? []) {
    const id = Number((row as { rider_id?: number }).rider_id);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function runGlobalSearch(raw: string, fleetActive: string): Promise<GlobalSearchResult> {
  const tAll = Date.now();
  const groups = raw.split(",").map((g) => g.trim()).filter(Boolean);
  const terms = groups.flatMap((g) => g.split(/\s+/).filter(Boolean));

  const [textCars, allRiders, allLeases] = await Promise.all([
    timed("railcars-text-query", () => fetchCarsByText(groups, fleetActive)),
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

  const have = new Set(textCars.map((c) => c.id));
  const riderIds = matchedRiders.map((r: any) => r.id).filter(Boolean);
  const leaseIds = matchedLeases.map((l: any) => l.id).filter(Boolean);

  const extraCars = await timed("railcars-via-rider-lease", async () => {
    const [byRider, byLease] = await Promise.all([
      fetchCarsByFk("railcar_assignments.rider_id", riderIds, fleetActive),
      fetchCarsByFk("railcar_assignments.rider.master_lease_id", leaseIds, fleetActive),
    ]);
    return dedupeCars([...byRider, ...byLease].filter((c) => !have.has(c.id)));
  });

  const tCarScore = Date.now();
  const matchedCars = dedupeCars([...textCars, ...extraCars])
    .map((c) => ({ c, score: bestScore(carBlob(c), groups) }))
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
    counts: {
      railcars: matchedCars.length,
      riders: ridersOut.length,
      leases: matchedLeases.length,
      total: matchedCars.length + ridersOut.length + matchedLeases.length,
    },
  };
}
