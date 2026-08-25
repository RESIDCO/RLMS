/**
 * Write Asset-Report-governed lease/OL dates onto riders and onto every car
 * currently assigned to that OL. V_Valid car dates are used only when the
 * Asset Report has no row for the OL.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./fetch-all";
import { riderLeaseGovernancePayload } from "@shared/rider-import-guard";
import {
  buildAssetReportExpirations,
  buildCarFallbackExpirations,
  lookupGovernedForRider,
  normalizeOlKey,
  resolveGovernedExpiration,
  type AssetReportFinRow,
  type LeaseDateSource,
} from "@shared/lease-governance";
import { carOlCode } from "@shared/lease-authority";

const CAR_ID_CHUNK = 150;

export type GovernLeaseDatesResult = {
  latestSnapshot: string | null;
  ridersScanned: number;
  ridersUpdated: number;
  olsWithAsset: number;
  olsWithCarFallback: number;
  carsScanned: number;
  carsUpdated: number;
  carsUnchanged: number;
  sourceColumns: boolean;
};

function asIso(v: unknown): string | null {
  const s = String(v ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function probeSourceColumns(db: SupabaseClient): Promise<{ riders: boolean; cars: boolean }> {
  const [r, c] = await Promise.all([
    db.from("riders").select("id, expiration_source, expiration_snapshot_month").limit(1),
    db.from("railcars").select("id, lease_date_source").limit(1),
  ]);
  return {
    riders: !r.error,
    cars: !c.error,
  };
}

export async function governLeaseDates(db: SupabaseClient): Promise<GovernLeaseDatesResult> {
  const cols = await probeSourceColumns(db);

  const finSelect = cols.riders
    ? "snapshot_month, rider_id, lessee, months_until_lease_exp, lease_exp_date"
    : "snapshot_month, rider_id, lessee, months_until_lease_exp";

  const [finRows, riders, cars] = await Promise.all([
    fetchAllRows<AssetReportFinRow>((from, to) =>
      db
        .from("rider_financial_summary")
        .select(finSelect)
        .order("id", { ascending: true })
        .range(from, to)
    ).catch(async () =>
      fetchAllRows<AssetReportFinRow>((from, to) =>
        db
          .from("rider_financial_summary")
          .select("snapshot_month, rider_id, lessee, months_until_lease_exp")
          .order("id", { ascending: true })
          .range(from, to)
      )
    ),
    fetchAllRows((from, to) =>
      db
        .from("riders")
        .select(
          cols.riders
            ? "id, rider_name, schedule_number, expiration_date, effective_date, expiration_source, expiration_snapshot_month"
            : "id, rider_name, schedule_number, expiration_date, effective_date"
        )
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      db
        .from("railcars")
        .select(
          cols.cars
            ? "id, active, rider_external_id, lease_start_date, lease_end_date, lease_expiry, estimated_lease_expiry, lease_expiry_snapshot_month, lease_date_source"
            : "id, active, rider_external_id, lease_start_date, lease_end_date, lease_expiry, estimated_lease_expiry, lease_expiry_snapshot_month"
        )
        .eq("active", true)
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const { latestSnap, byOl: assetByOl } = buildAssetReportExpirations(finRows);
  const carFallbackByOl = buildCarFallbackExpirations(cars as any[]);

  const startByOl = new Map<string, string>();
  for (const r of riders as any[]) {
    const start = asIso(r.effective_date);
    if (!start) continue;
    for (const k of [normalizeOlKey(r.rider_name), normalizeOlKey(r.schedule_number)].filter(Boolean)) {
      if (!startByOl.has(k)) startByOl.set(k, start);
    }
  }

  let ridersUpdated = 0;
  let olsWithAsset = 0;
  let olsWithCarFallback = 0;
  for (const r of riders as any[]) {
    const governed = lookupGovernedForRider(r, assetByOl, carFallbackByOl);
    if (!governed) continue;
    if (governed.source === "asset_report") olsWithAsset += 1;
    else olsWithCarFallback += 1;

    const nextExp = governed.expiration_date;
    const nextSource = governed.source;
    const nextSnap = governed.source === "asset_report" ? governed.snapshot_month : null;
    const prevExp = asIso(r.expiration_date);
    const prevSource = String(r.expiration_source ?? "") || null;
    const prevSnap = asIso(r.expiration_snapshot_month);
    if (
      prevExp === nextExp &&
      (!cols.riders || (prevSource === nextSource && prevSnap === nextSnap))
    ) {
      continue;
    }

    const patch = cols.riders
      ? riderLeaseGovernancePayload({
          expiration_date: nextExp,
          expiration_source: nextSource,
          expiration_snapshot_month: nextSnap,
        })
      : riderLeaseGovernancePayload({ expiration_date: nextExp });
    const { error } = await db.from("riders").update(patch).eq("id", r.id);
    if (error) throw error;
    ridersUpdated += 1;
  }

  type CarPatch = {
    lease_end_date: string;
    lease_expiry: string;
    estimated_lease_expiry: string;
    lease_expiry_snapshot_month: string | null;
    lease_start_date?: string;
    lease_date_source?: LeaseDateSource;
  };

  const groups = new Map<string, { ids: number[]; patch: CarPatch }>();
  let carsUnchanged = 0;
  for (const c of cars as any[]) {
    const ol = carOlCode(c);
    if (!ol) {
      carsUnchanged += 1;
      continue;
    }
    const governed = resolveGovernedExpiration(ol, assetByOl, carFallbackByOl);
    if (!governed) {
      carsUnchanged += 1;
      continue;
    }
    const start = startByOl.get(normalizeOlKey(ol)) ?? null;
    const patch: CarPatch = {
      lease_end_date: governed.expiration_date,
      lease_expiry: governed.expiration_date,
      estimated_lease_expiry: governed.expiration_date,
      lease_expiry_snapshot_month:
        governed.source === "asset_report" ? governed.snapshot_month : null,
    };
    if (start) patch.lease_start_date = start;
    if (cols.cars) patch.lease_date_source = governed.source;

    const sameEnd =
      asIso(c.lease_end_date) === patch.lease_end_date &&
      asIso(c.lease_expiry) === patch.lease_expiry &&
      asIso(c.estimated_lease_expiry) === patch.estimated_lease_expiry &&
      asIso(c.lease_expiry_snapshot_month) === patch.lease_expiry_snapshot_month &&
      (!patch.lease_start_date || asIso(c.lease_start_date) === patch.lease_start_date) &&
      (!cols.cars || String(c.lease_date_source ?? "") === governed.source);
    if (sameEnd) {
      carsUnchanged += 1;
      continue;
    }
    const fp = JSON.stringify(patch);
    const g = groups.get(fp);
    if (g) g.ids.push(c.id);
    else groups.set(fp, { ids: [c.id], patch });
  }

  let carsUpdated = 0;
  for (const { ids, patch } of Array.from(groups.values())) {
    for (let i = 0; i < ids.length; i += CAR_ID_CHUNK) {
      const slice = ids.slice(i, i + CAR_ID_CHUNK);
      const { error } = await db.from("railcars").update(patch).in("id", slice);
      if (error) throw error;
      carsUpdated += slice.length;
    }
  }

  return {
    latestSnapshot: latestSnap,
    ridersScanned: riders.length,
    ridersUpdated,
    olsWithAsset: assetByOl.size,
    olsWithCarFallback,
    carsScanned: cars.length,
    carsUpdated,
    carsUnchanged,
    sourceColumns: cols.riders && cols.cars,
  };
}
