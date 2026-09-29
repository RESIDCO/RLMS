import { asOne } from "@shared/lease-type";

export type LeaseGlanceLease = {
  id?: number | null;
  lease_number?: string | null;
  agreement_number?: string | null;
  lessor?: string | null;
  lessee?: string | null;
  lease_type?: string | null;
  sold_to?: string | null;
};

export type LeaseGlanceRider = {
  id: number;
  rider_name?: string | null;
  schedule_number?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  monthly_rate_pct?: number | string | null;
  lessors_cost?: number | string | null;
  car_count?: number | null;
  master_lease?: LeaseGlanceLease | LeaseGlanceLease[] | null;
};

export function glanceRiderFromCar(car: any, carCount?: number | null): LeaseGlanceRider | null {
  const rider = asOne(car?.assignment?.rider) as LeaseGlanceRider | null;
  if (!rider?.id) return null;
  return {
    ...rider,
    car_count: carCount ?? rider.car_count ?? car?.cars_on_rider_ar ?? null,
    master_lease: asOne(rider.master_lease),
  };
}
