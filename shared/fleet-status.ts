/**
 * Derived fleet_status for active cars (§5 follow-on).
 * Sold / Idle / Leased are independent checks — never one shared heuristic bucket.
 *
 * - Sold (primary): `assignment_label` contains "sold" (case-insensitive), e.g.
 *   "Sold to Progress Rail", "xOL1707 - SOLD". Confirmed no false-positive labels
 *   in the active fleet as of 2026-08-17 (7 distinct values, 848 cars).
 * - Sold (secondary): `rider_external_id` is exactly "SOLD" (kept for data that
 *   may set the OL code without a sold phrase in the label).
 * - Also treats assignment `fleet_name` containing "sold" the same way.
 *   This is NOT `railcars.sold_to`, NOT a managed_category value, and NOT a
 *   financial snapshot comparison — see `isSoldAssignment` and SQL `rlms_fleet_kpis`.
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

/** True when assignment/rider indicates the car is Sold (kept active for billing). */
export function isSoldAssignment(input: {
  rider_external_id?: string | null;
  assignment_label?: string | null;
  fleet_name?: string | null;
}): boolean {
  const label = String(input.assignment_label ?? "").toUpperCase();
  if (label.includes("SOLD")) return true;
  const fleet = String(input.fleet_name ?? "").toUpperCase();
  if (fleet.includes("SOLD")) return true;
  const rider = String(input.rider_external_id ?? "").trim().toUpperCase();
  if (rider === "SOLD") return true;
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
