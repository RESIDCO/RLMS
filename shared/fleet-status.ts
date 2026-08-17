/**
 * Derived fleet_status for active cars (§5 follow-on).
 * Sold / Idle / Leased are independent checks — never one shared heuristic bucket.
 *
 * - Sold: `rider_external_id` OR `assignment_label` (OR assignment `fleet_name` in TS)
 *   equals the literal string "SOLD" (case-insensitive). These cars stay `active=true`
 *   for repair billing but are excluded from Total Fleet / utilization.
 *   This is NOT `railcars.sold_to`, NOT a managed_category value, and NOT a financial
 *   snapshot comparison — see `isSoldAssignment` and SQL `rlms_fleet_kpis`.
 *   Fragility note: matching is exact after trim/upper — typos, trailing spaces that
 *   survive trim oddly, or alternate labels ("Sold - Buyer") silently miss the Sold bucket.
 * - Idle: `managed_category === 'Idle'` (VCF §4.2 canonical) and not Sold.
 * - Leased: otherwise (any other managed_category / real rider).
 *
 * Inactive cars (active !== true) are out of scope — callers keep separate treatment.
 */

export type FleetStatus = "Sold" | "Idle" | "Leased";

export type FleetStatusInput = {
  active?: boolean | null;
  rider_external_id?: string | null;
  assignment_label?: string | null;
  fleet_name?: string | null;
  managed_category?: string | null;
};

/** True when the current rider / assignment label is the SOLD marker (~770 cars). */
export function isSoldAssignment(input: {
  rider_external_id?: string | null;
  assignment_label?: string | null;
  fleet_name?: string | null;
}): boolean {
  const rider = String(input.rider_external_id ?? "").trim().toUpperCase();
  if (rider === "SOLD") return true;
  const label = String(input.assignment_label ?? "").trim().toUpperCase();
  if (label === "SOLD") return true;
  const fleet = String(input.fleet_name ?? "").trim().toUpperCase();
  if (fleet === "SOLD") return true;
  return false;
}

/** True when VCF-canonical managed_category is Idle. */
export function isIdleManagedCategory(managed_category: string | null | undefined): boolean {
  return String(managed_category ?? "").trim() === "Idle";
}

/**
 * Classify an active car. Returns null when active !== true
 * (inactive cars keep existing separate treatment).
 */
export function deriveFleetStatus(input: FleetStatusInput): FleetStatus | null {
  if (input.active !== true) return null;
  if (isSoldAssignment(input)) return "Sold";
  if (isIdleManagedCategory(input.managed_category)) return "Idle";
  return "Leased";
}

/** Operating fleet = active and not Sold. */
export function isOperatingFleetCar(input: FleetStatusInput): boolean {
  return input.active === true && deriveFleetStatus(input) !== "Sold";
}
