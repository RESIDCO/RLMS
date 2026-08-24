import { supabaseAdmin } from "./supabase";
import { fetchAllRows } from "./fetch-all";
import {
  deriveLeaseTypeFromCars,
  storedLeaseTypeFromDerived,
  type DerivedLeaseType,
} from "@shared/lease-type";

type CarLite = {
  id: number;
  lease_type: string | null;
  active: boolean | null;
  rider_id: number;
};

/**
 * Load cars joined through railcar_assignments (same path Lease Management
 * uses for car counts / RiderCars), not a loose rider_external_id string match.
 */
export async function fetchCarsByRiderId(): Promise<Map<number, CarLite[]>> {
  const rows = await fetchAllRows<{
    rider_id: number | null;
    railcars: { id: number; lease_type: string | null; active: boolean | null } | { id: number; lease_type: string | null; active: boolean | null }[] | null;
  }>((from, to) =>
    supabaseAdmin
      .from("railcar_assignments")
      .select("rider_id, railcars(id, lease_type, active)")
      .order("id", { ascending: true })
      .range(from, to),
  );

  const byRider = new Map<number, CarLite[]>();
  for (const row of rows) {
    const riderId = Number(row.rider_id);
    if (!Number.isFinite(riderId) || riderId <= 0) continue;
    const car = Array.isArray(row.railcars) ? row.railcars[0] : row.railcars;
    if (!car?.id) continue;
    const list = byRider.get(riderId) ?? [];
    list.push({
      id: car.id,
      lease_type: car.lease_type ?? null,
      active: car.active ?? null,
      rider_id: riderId,
    });
    byRider.set(riderId, list);
  }
  return byRider;
}

export function deriveLeaseTypesForRidersAndLeases(
  riders: Array<{ id: number; master_lease_id: number | null }>,
  carsByRider: Map<number, CarLite[]>,
): {
  byRiderId: Map<number, DerivedLeaseType>;
  byLeaseId: Map<number, DerivedLeaseType>;
} {
  const byRiderId = new Map<number, DerivedLeaseType>();
  const carsByLease = new Map<number, CarLite[]>();

  for (const r of riders) {
    const cars = carsByRider.get(r.id) ?? [];
    byRiderId.set(r.id, deriveLeaseTypeFromCars(cars));
    const mlaId = Number(r.master_lease_id);
    if (!Number.isFinite(mlaId) || mlaId <= 0) continue;
    const bucket = carsByLease.get(mlaId) ?? [];
    bucket.push(...cars);
    carsByLease.set(mlaId, bucket);
  }

  const byLeaseId = new Map<number, DerivedLeaseType>();
  for (const [mlaId, cars] of carsByLease) {
    byLeaseId.set(mlaId, deriveLeaseTypeFromCars(cars));
  }
  return { byRiderId, byLeaseId };
}

export function attachDerivedLeaseTypes<T extends { id: number; master_lease_id?: number | null; riders?: Array<{ id: number; master_lease_id?: number | null }> }>(
  leases: T[],
  byRiderId: Map<number, DerivedLeaseType>,
  byLeaseId: Map<number, DerivedLeaseType>,
): T[] {
  return leases.map((l) => {
    const derived = byLeaseId.get(l.id) ?? deriveLeaseTypeFromCars([]);
    const riders = (l.riders ?? []).map((r) => {
      const rd = byRiderId.get(r.id) ?? deriveLeaseTypeFromCars([]);
      return {
        ...r,
        lease_type: rd.label,
        lease_type_mixed: rd.mixed,
        lease_type_breakdown: rd.breakdown,
        lease_type_from_inactive: rd.fromInactive,
      };
    });
    return {
      ...l,
      lease_type: derived.label,
      lease_type_mixed: derived.mixed,
      lease_type_breakdown: derived.breakdown,
      lease_type_from_inactive: derived.fromInactive,
      riders,
    };
  });
}

export { storedLeaseTypeFromDerived };
