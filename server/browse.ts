/**
 * Dashboard / search drill-down: lessee or entity → OLs → cars.
 * Counts follow the Dashboard operating-fleet convention (active, not Sold).
 */
import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import { isOperatingFleetCar, parseFleetStatus, deriveFleetStatus } from "@shared/fleet-status";
import { carOlCode, carLesseeName } from "@shared/lease-authority";

export const ENTITY_DB: Record<string, string> = {
  rps: "Rail Partners Select",
  main: "Main",
  coal: "Coal",
};

/** `main` browse is RESIDCO-owned (Main + Coal), matching the dashboard tile. `coal` stays Coal-only. */
export function entityDbValues(slug: string): string[] | undefined {
  const k = slug.toLowerCase();
  if (k === "main") return ["Main", "Coal"];
  if (k === "coal") return ["Coal"];
  if (k === "rps") return ["Rail Partners Select"];
  const one = ENTITY_DB[k];
  return one ? [one] : undefined;
}

const CAR_LIST_SELECT =
  "id, car_number, reporting_marks, car_type, status, fleet_status, entity, active, lessee_name, rider_external_id, assignment_label, managed_category, sold_to, lease_type";

const CAR_EXPORT_SELECT =
  `${CAR_LIST_SELECT}, nbv, oac, oec, capacity_cf, lining_material, lining, coating, build_year, built_year`;

export function normalizeOl(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function olKeyFromLabel(raw: string | null | undefined): string | null {
  const n = normalizeOl(raw);
  if (!n || n === "SOLD") return null;
  const m = n.match(/^(OL\d+)/);
  return m ? m[1] : n;
}

function operatingCar(row: any): boolean {
  const fleet_status =
    parseFleetStatus(row.fleet_status) ??
    deriveFleetStatus({
      active: row.active,
      fleet_status: row.fleet_status,
      rider_external_id: row.rider_external_id,
      assignment_label: row.assignment_label,
      managed_category: row.managed_category,
    });
  return isOperatingFleetCar({
    active: row.active,
    fleet_status,
    rider_external_id: row.rider_external_id,
    assignment_label: row.assignment_label,
    managed_category: row.managed_category,
  });
}

function mapCarListRow(c: any) {
  const fleet_status =
    parseFleetStatus(c.fleet_status) ??
    deriveFleetStatus({
      active: c.active,
      fleet_status: c.fleet_status,
      rider_external_id: c.rider_external_id,
      assignment_label: c.assignment_label,
      managed_category: c.managed_category,
    });
  return {
    id: c.id,
    car_number: c.car_number,
    reporting_marks: c.reporting_marks,
    car_type: c.car_type,
    status: c.status,
    entity: c.entity,
    active: c.active,
    fleet_status,
    lessee_name: carLesseeName(c),
    rider_external_id: carOlCode(c),
    lease_type: c.lease_type ?? null,
  };
}

type RiderMeta = {
  id: number;
  rider_name: string;
  schedule_number: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  monthly_rate_pct: number | null;
  monthly_rent_per_car: number | null;
  lessors_cost: number | null;
  lease_type: string | null;
  lease_number: string | null;
  agreement_number: string | null;
  lessor: string | null;
  lessee: string | null;
};

async function loadRiderIndex(): Promise<Map<string, RiderMeta>> {
  const rows = await fetchAllRows<any>((from, to) =>
    supabaseAdmin
      .from("riders")
      .select(
        "id, rider_name, schedule_number, effective_date, expiration_date, monthly_rate_pct, monthly_rent_per_car, lessors_cost, master_lease:master_leases(id, lease_number, agreement_number, lessor, lessee, lease_type)",
      )
      .order("id", { ascending: true })
      .range(from, to),
  );
  const byKey = new Map<string, RiderMeta>();
  for (const r of rows) {
    const ml = Array.isArray(r.master_lease) ? r.master_lease[0] : r.master_lease;
    const meta: RiderMeta = {
      id: r.id,
      rider_name: r.rider_name,
      schedule_number: r.schedule_number,
      effective_date: r.effective_date,
      expiration_date: r.expiration_date,
      monthly_rate_pct: r.monthly_rate_pct != null ? Number(r.monthly_rate_pct) : null,
      monthly_rent_per_car: r.monthly_rent_per_car != null ? Number(r.monthly_rent_per_car) : null,
      lessors_cost: r.lessors_cost != null ? Number(r.lessors_cost) : null,
      lease_type: ml?.lease_type ?? null,
      lease_number: ml?.lease_number ?? null,
      agreement_number: ml?.agreement_number ?? null,
      lessor: ml?.lessor ?? null,
      lessee: ml?.lessee ?? null,
    };
    const keys = [olKeyFromLabel(r.rider_name), olKeyFromLabel(r.schedule_number), normalizeOl(r.rider_name)].filter(
      Boolean,
    ) as string[];
    for (const k of keys) {
      if (!byKey.has(k)) byKey.set(k, meta);
    }
  }
  return byKey;
}

async function fetchOperatingCars(
  filter: { lessee?: string; entity?: string | string[]; ol?: string; buildYear?: number },
  opts?: { extra?: boolean },
) {
  const cars = await fetchAllRows<any>((from, to) => {
    let q = supabaseAdmin
      .from("railcars")
      .select(opts?.extra ? CAR_EXPORT_SELECT : CAR_LIST_SELECT)
      .eq("active", true)
      .order("id", { ascending: true })
      .range(from, to);
    if (filter.lessee) q = q.eq("lessee_name", filter.lessee);
    if (Array.isArray(filter.entity) && filter.entity.length) q = q.in("entity", filter.entity);
    else if (typeof filter.entity === "string" && filter.entity) q = q.eq("entity", filter.entity);
    if (filter.ol) q = q.eq("rider_external_id", filter.ol);
    if (filter.buildYear != null) q = q.eq("build_year", filter.buildYear);
    return q;
  });
  return cars.filter(operatingCar);
}

function riderRowForOl(ol: string | null, index: Map<string, RiderMeta>, carCount: number) {
  const key = ol ? normalizeOl(ol) : "";
  const meta = key ? index.get(key) ?? index.get(olKeyFromLabel(ol) ?? "") : null;
  return {
    ol: ol || "Unassigned",
    rider_id: meta?.id ?? null,
    rider_name: meta?.rider_name ?? (ol || "Unassigned"),
    lease_type: meta?.lease_type ?? null,
    effective_date: meta?.effective_date ?? null,
    expiration_date: meta?.expiration_date ?? null,
    lease_number: meta?.lease_number ?? null,
    agreement_number: meta?.agreement_number ?? null,
    lessor: meta?.lessor ?? null,
    lessee: meta?.lessee ?? null,
    car_count: carCount,
  };
}

export async function browseGroup(kind: "lessee" | "entity", key: string) {
  const entityValues = kind === "entity" ? entityDbValues(key) ?? [key] : undefined;
  const lessee = kind === "lessee" ? key : undefined;
  const cars = await fetchOperatingCars({ lessee, entity: entityValues });
  const index = await loadRiderIndex();
  const buckets = new Map<string, number>();
  for (const c of cars) {
    const ol = carOlCode(c) || "Unassigned";
    buckets.set(ol, (buckets.get(ol) ?? 0) + 1);
  }
  const riders = Array.from(buckets.entries())
    .map(([ol, count]) => riderRowForOl(ol === "Unassigned" ? null : ol, index, count))
    .sort((a, b) => b.car_count - a.car_count || a.ol.localeCompare(b.ol));
  return {
    kind,
    key: kind === "entity" ? (entityValues?.[0] ?? key) : key,
    entity_slug: kind === "entity" ? key.toLowerCase() : null,
    car_count: cars.length,
    riders,
  };
}

export async function browseOl(code: string, filter?: { lessee?: string; entity?: string }) {
  const isUnassigned = !code || /^unassigned$/i.test(code);
  const ol = isUnassigned ? null : (olKeyFromLabel(code) ?? normalizeOl(code));
  const entityValues = filter?.entity ? entityDbValues(filter.entity) ?? [filter.entity] : undefined;
  const cars = await fetchOperatingCars({
    lessee: filter?.lessee,
    entity: entityValues,
    ol: ol ?? undefined,
  }).then((rows) => {
    if (!isUnassigned) return rows;
    return rows.filter((c) => !carOlCode(c));
  });
  const index = await loadRiderIndex();
  const summary = riderRowForOl(ol, index, cars.length);
  return {
    ...summary,
    cars: cars.map(mapCarListRow).sort((a, b) => String(a.car_number).localeCompare(String(b.car_number))),
  };
}

export async function browseTurning50(year: number, ol?: string) {
  const cars = await fetchOperatingCars({ buildYear: year - 50 });
  const index = await loadRiderIndex();
  const base = { year, build_year: year - 50, car_count: cars.length };

  if (!ol) {
    const buckets = new Map<string, number>();
    for (const c of cars) {
      const key = carOlCode(c) || "Unassigned";
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const riders = Array.from(buckets.entries())
      .map(([key, count]) => riderRowForOl(key === "Unassigned" ? null : key, index, count))
      .sort((a, b) => b.car_count - a.car_count || a.ol.localeCompare(b.ol));
    return { ...base, riders };
  }

  const isUnassigned = /^unassigned$/i.test(ol);
  const filtered = cars.filter((c) => {
    const code = carOlCode(c);
    if (isUnassigned) return !code;
    return code === ol || normalizeOl(code) === normalizeOl(ol);
  });
  const summary = riderRowForOl(isUnassigned ? null : ol, index, filtered.length);
  return {
    year,
    build_year: year - 50,
    ...summary,
    cars: filtered.map(mapCarListRow).sort((a, b) => String(a.car_number).localeCompare(String(b.car_number))),
  };
}

export type Turning50ExportCar = ReturnType<typeof mapCarListRow> & {
  nbv: number | null;
  oac: number | null;
  oec: number | null;
  capacity_cf: number | null;
  lining: string;
  build_year: number | null;
};

export type Turning50ExportOl = ReturnType<typeof riderRowForOl> & {
  cars: Turning50ExportCar[];
};

function liningOf(c: any): string {
  return c.lining_material || c.lining || c.coating || "";
}

function mapExportCar(c: any): Turning50ExportCar {
  const n = (v: unknown) => {
    if (v == null || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  return {
    ...mapCarListRow(c),
    nbv: n(c.nbv),
    oac: n(c.oac),
    oec: n(c.oec),
    capacity_cf: n(c.capacity_cf),
    lining: liningOf(c),
    build_year: n(c.build_year) ?? n(c.built_year),
  };
}

export async function loadTurning50Export(
  year: number,
  opts?: { ols?: string[]; carIds?: number[] },
): Promise<{ year: number; build_year: number; riders: Turning50ExportOl[] }> {
  const cars = await fetchOperatingCars({ buildYear: year - 50 }, { extra: true });
  const wantOls = (opts?.ols ?? []).map((s) => normalizeOl(s)).filter(Boolean);
  const wantOlSet = new Set(wantOls);
  const wantIds = new Set((opts?.carIds ?? []).filter((n) => Number.isFinite(n) && n > 0));
  const filtered = cars.filter((c) => {
    if (wantIds.size && !wantIds.has(Number(c.id))) return false;
    if (!wantOlSet.size) return true;
    const code = normalizeOl(carOlCode(c) || "Unassigned");
    return wantOlSet.has(code) || wantOlSet.has(normalizeOl(olKeyFromLabel(carOlCode(c)) ?? ""));
  });
  const index = await loadRiderIndex();
  const buckets = new Map<string, any[]>();
  for (const c of filtered) {
    const key = carOlCode(c) || "Unassigned";
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }
  const riders = Array.from(buckets.entries())
    .map(([key, list]) => {
      const row = riderRowForOl(key === "Unassigned" ? null : key, index, list.length);
      const mapped = list
        .map(mapExportCar)
        .sort((a, b) => String(a.car_number).localeCompare(String(b.car_number)));
      return { ...row, cars: mapped };
    })
    .sort((a, b) => b.car_count - a.car_count || a.ol.localeCompare(b.ol));
  return { year, build_year: year - 50, riders };
}

/** Distinct cars on any non-completed program. Fleet status / active is ignored. */
export async function countInProgram(): Promise<number> {
  const { data: programs, error: pErr } = await supabaseAdmin
    .from("programs")
    .select("id")
    .neq("status", "complete");
  if (pErr) throw pErr;
  const programIds = (programs ?? [])
    .map((p: any) => Number(p.id))
    .filter((id: number) => Number.isFinite(id) && id > 0);
  if (!programIds.length) return 0;

  const seen = new Set<number>();
  const CHUNK = 200;
  for (let i = 0; i < programIds.length; i += CHUNK) {
    const slice = programIds.slice(i, i + CHUNK);
    const links = await fetchAllRows<{ railcar_id: number }>((from, to) =>
      supabaseAdmin
        .from("program_cars")
        .select("railcar_id")
        .in("program_id", slice)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const l of links) {
      const id = Number(l.railcar_id);
      if (Number.isFinite(id) && id > 0) seen.add(id);
    }
  }
  return seen.size;
}
