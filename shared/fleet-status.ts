/**
 * Rental status (stored as railcars.fleet_status): Leased / Idle / Sold / Abatement.
 *
 * Idle = still owned by RESIDCO, not currently on rent.
 * Sold  = no longer owned by RESIDCO, still tracked (active) until remarked.
 * Leased = on rent.
 * Abatement = still leased (lease has not ended); rent is temporarily paused.
 *   Netted out of Active Cars and fleet Utilization (2026-08-25); still in Total Fleet.
 *
 * Live KPIs and UI read the stored column. Text-matching of assignment_label /
 * managed_category is ONLY for the one-time backfill and for auto-deriving
 * new/updated import rows where fleet_status_source = 'auto'.
 */

export type FleetStatus = "Sold" | "Idle" | "Leased" | "Abatement";
export type FleetStatusSource = "auto" | "manual";

export const FLEET_STATUSES: FleetStatus[] = ["Leased", "Idle", "Sold", "Abatement"];

/** Entity assigned counts — Abatement still counts as on-lease for RPS/Main util bars. */
export function countsAsLeasedForKpi(status: FleetStatus | string | null | undefined): boolean {
  return status === "Leased" || status === "Abatement";
}

/** Active Cars KPI: strict Leased tag (Idle, Abatement, Sold, Unassigned are other tiles). */
export function isLeasedFleetStatus(status: FleetStatus | string | null | undefined): boolean {
  return status === "Leased";
}

export type FleetStatusInput = {
  active?: boolean | null;
  fleet_status?: FleetStatus | string | null;
  rider_external_id?: string | null;
  assignment_label?: string | null;
  fleet_name?: string | null;
  managed_category?: string | null;
};

export function parseFleetStatus(raw: unknown): FleetStatus | null {
  const s = String(raw ?? "").trim();
  if (s === "Sold" || s === "Idle" || s === "Leased" || s === "Abatement") return s;
  return null;
}

/** True when assignment/rider text indicates Sold — backfill / auto-import only. */
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

/** True when VCF-canonical managed_category is Idle — backfill / auto-import only. */
export function isIdleManagedCategory(managed_category: string | null | undefined): boolean {
  return String(managed_category ?? "").trim() === "Idle";
}

/**
 * One-time / import auto value. Matches the backfill CASE in
 * migrations/20260817_fleet_status_column.sql (active Sold/Idle, else Leased).
 */
export function autoFleetStatusFromLegacyText(input: {
  active?: boolean | null;
  rider_external_id?: string | null;
  assignment_label?: string | null;
  fleet_name?: string | null;
  managed_category?: string | null;
}): FleetStatus {
  if (input.active === true && isSoldAssignment(input)) return "Sold";
  if (input.active === true && isIdleManagedCategory(input.managed_category)) return "Idle";
  return "Leased";
}

/**
 * Classify a car from the stored column. Falls back to legacy text only when
 * the column is missing (pre-migration). Returns null when inactive and the
 * column is also missing (callers keep separate inactive treatment).
 */
export function deriveFleetStatus(input: FleetStatusInput): FleetStatus | null {
  const stored = parseFleetStatus(input.fleet_status);
  if (stored) return stored;
  if (input.active !== true) return null;
  return autoFleetStatusFromLegacyText(input);
}

/** Operating fleet = active and not Sold. */
export function isOperatingFleetCar(input: FleetStatusInput): boolean {
  if (input.active !== true) return false;
  return deriveFleetStatus(input) !== "Sold";
}

export type DisplayStatusInput = FleetStatusInput & {
  status?: string | null;
};

/**
 * Badge / column label: stored fleet_status (Leased / Idle / Sold / Abatement).
 * Inactive cars still show their stored fleet_status — lifecycle Off-Lease
 * stays on railcars.status, not this column.
 */
export function displayRailcarStatus(car: DisplayStatusInput): string {
  const stored = parseFleetStatus(car.fleet_status);
  if (stored) return stored;
  const derived = deriveFleetStatus(car);
  if (derived) return derived;
  const raw = String(car.status ?? "").trim();
  if (car.active === false) return raw || "Off-Lease";
  return raw || "—";
}

/** Normalize a railcar API/list row for displayRailcarStatus. */
export function displayStatusInputFromRailcar(r: {
  active?: boolean | null;
  status?: string | null;
  fleet_status?: FleetStatus | string | null;
  rider_external_id?: string | null;
  assignment_label?: string | null;
  managed_category?: string | null;
  fleet_name?: string | null;
  assignment?: { fleet_name?: string | null } | null;
}): DisplayStatusInput {
  return {
    active: r.active,
    status: r.status,
    fleet_status: parseFleetStatus(r.fleet_status) ?? r.fleet_status ?? null,
    rider_external_id: r.rider_external_id,
    assignment_label: r.assignment_label,
    fleet_name: r.assignment?.fleet_name ?? r.fleet_name ?? null,
    managed_category: r.managed_category,
  };
}
