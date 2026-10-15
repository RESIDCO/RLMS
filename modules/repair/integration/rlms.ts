/**
 * Sole integration layer that may read RLMS (`public`) data for the repair module.
 *
 * Allowed sources (brief §2):
 *   v_valid_export_rows, railcars, master_leases, riders,
 *   railcar_assignments, assignment_history, RLMS DV module (dv_*).
 *
 * READ-ONLY. Never INSERT/UPDATE/DELETE against public.* from this module.
 */
import { q } from "../db";
import type { CarsRefRow, VcfCheckResult } from "../types";

const ALLOWED_PUBLIC_READ = new Set([
  "v_valid_export_rows",
  "railcars",
  "master_leases",
  "riders",
  "railcar_assignments",
  "assignment_history",
  "dv_ab_codes",
  "dv_calculations",
  "dv_calculation_ab_items",
  "dv_car_dep_rates",
  "dv_cost_factors",
  "dv_salvage_quarters",
]);

export function assertAllowedPublicRead(table: string): void {
  if (!ALLOWED_PUBLIC_READ.has(table)) {
    throw new Error(
      `[repair/integration] Refusing to read public.${table} — not in allowlist`,
    );
  }
}

function normalizeMark(mark: string): string {
  return mark.trim().toUpperCase();
}

function normalizeCarNumber(num: string): string {
  return num.trim();
}

/** Lookup via repair.cars_ref (view). Prefer this from services. */
export async function getCarsRef(
  carMark: string,
  carNumber: string,
): Promise<CarsRefRow | null> {
  const mark = normalizeMark(carMark);
  const number = normalizeCarNumber(carNumber);
  const padded = number.replace(/\D/g, "").padStart(6, "0");
  const { rows } = await q<CarsRefRow>(
    `SELECT
       rlms_railcar_id, car_mark, car_number, active_flag, in_vcf,
       lease_rider, current_assignment, current_assignment_id,
       lessee_name, remarks, fleet_status, managed, managed_category,
       entity_source
     FROM repair.cars_ref
     WHERE upper(car_mark) = $2
       AND (
         car_number = $1
         OR lpad(regexp_replace(COALESCE(car_number, ''), '[^0-9]', '', 'g'), 6, '0') = $3
       )
     ORDER BY CASE WHEN car_number = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [number, mark, padded],
  );
  return rows[0] ?? null;
}

/**
 * VCF hard rule. Heuristic: cars_ref.in_vcf (active=1 in v_valid_export_rows).
 * Refine when open item Q1 lands.
 */
export async function assertCarInVcf(
  carMark: string,
  carNumber: string,
): Promise<VcfCheckResult> {
  const mark = normalizeMark(carMark);
  const number = normalizeCarNumber(carNumber);

  if (!mark || !number) {
    return {
      ok: false,
      reason: "Car mark and car number are required for the VCF check.",
      carMark: mark,
      carNumber: number,
    };
  }

  const car = await getCarsRef(mark, number);
  if (!car) {
    return {
      ok: false,
      reason: `Car ${mark} ${number} was not found in RLMS.`,
      carMark: mark,
      carNumber: number,
    };
  }
  if (!car.in_vcf) {
    return {
      ok: false,
      reason: `Car ${mark} ${number} is not in the Valid Car File (VCF). Bad orders, estimates, and invoices are allowed only for VCF cars.`,
      carMark: mark,
      carNumber: number,
    };
  }
  return { ok: true, car };
}

export async function listVcfRowsForCar(
  carMark: string,
  carNumber: string,
  limit = 20,
) {
  assertAllowedPublicRead("v_valid_export_rows");
  const mark = normalizeMark(carMark);
  const number = normalizeCarNumber(carNumber);
  const { rows } = await q(
    `SELECT car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date
     FROM public.v_valid_export_rows
     WHERE car_number = $1 AND upper(coalesce(car_initial, '')) = $2
     LIMIT $3`,
    [number, mark, limit],
  );
  return rows;
}
