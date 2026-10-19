/**
 * Car Status (railcars.status) — lifecycle / service state.
 * Independent of Rental Status (railcars.fleet_status: Leased/Idle/Sold/Abatement).
 *
 * Bruce's rule (Oct 19): Inactive is inactive. Only the status Inactive kills
 * the asset (active=false) and freezes its data. Storage, Bad Order, Off-Lease,
 * Retired, Scrapped, and every other status keep active=true.
 * Crossing into or out of that frozen state requires a reason and a history row.
 * Reactivation is admin-only. This module does not rewrite existing rows.
 */

export const CAR_STATUS_EDIT_OPTIONS = [
  { value: "Active/In-Service", label: "Active / In-Service" },
  { value: "Storage", label: "Storage" },
  { value: "Bad Order", label: "Bad Order" },
  { value: "Off-Lease", label: "Off-Lease" },
  { value: "Retired", label: "Retired" },
  { value: "Scrapped", label: "Scrapped" },
  { value: "Inactive", label: "Inactive" },
] as const;

export type CarLifecycleStatus = (typeof CAR_STATUS_EDIT_OPTIONS)[number]["value"];

export const CAR_STATUS_HISTORY_EVENT = {
  markedInactive: "marked_inactive",
  reactivated: "reactivated",
} as const;

export type CarStatusHistoryEventType =
  (typeof CAR_STATUS_HISTORY_EVENT)[keyof typeof CAR_STATUS_HISTORY_EVENT];

export function isInactiveCarStatus(status: string | null | undefined): boolean {
  return String(status ?? "").trim() === "Inactive";
}

/**
 * True when this status keeps the car in the fleet (active=true).
 * Blank is treated as still active. Only the status Inactive exits.
 */
export function carStatusImpliesActive(status: string | null | undefined): boolean {
  return !isInactiveCarStatus(status);
}

/** Frozen asset: status Inactive, or the active flag is already false. */
export function isFrozenRailcar(car: {
  active?: boolean | null;
  status?: string | null;
}): boolean {
  return car.active === false || isInactiveCarStatus(car.status);
}

/**
 * VCF must not modify a car an operator protected (active_source = manual)
 * or a car that is already inactive. Active cars, including Storage and
 * Off-Lease, stay writable by the file.
 */
export function vcfMustNotModifyCar(car: {
  active_source?: string | null;
  active?: boolean | null;
  status?: string | null;
}): boolean {
  if (String(car.active_source ?? "").trim() === "manual") return true;
  return isFrozenRailcar(car);
}

export function fieldsImpliedByCarStatus(status: string | null | undefined): {
  status: string;
  active: boolean;
  active_status: "Active" | "Inactive";
} {
  const s = String(status ?? "").trim() || "Active/In-Service";
  if (isInactiveCarStatus(s)) {
    return { status: "Inactive", active: false, active_status: "Inactive" };
  }
  return { status: s, active: true, active_status: "Active" };
}

/**
 * Keep Car Status text consistent with a boolean ACTIVE flag (VCF import).
 * An active file row keeps Storage, Bad Order, Off-Lease, and the other
 * non-Inactive statuses. A file row that is not active does not invent the
 * killed Inactive status; it keeps a non-service status or falls back to Off-Lease.
 */
export function statusAlignedToActiveFlag(
  currentStatus: string | null | undefined,
  active: boolean,
): string {
  const cur = String(currentStatus ?? "").trim();
  if (active) {
    if (!cur || isInactiveCarStatus(cur)) return "Active/In-Service";
    return cur;
  }
  if (isInactiveCarStatus(cur)) return "Inactive";
  if (cur && cur !== "Active/In-Service") return cur;
  return "Off-Lease";
}

export function carActiveTriadIsInconsistent(row: {
  status?: string | null;
  active?: boolean | null;
  active_status?: string | null;
}): boolean {
  const implied = fieldsImpliedByCarStatus(row.status);
  if (row.active !== implied.active) return true;
  const as = String(row.active_status ?? "").trim().toLowerCase();
  if (!as) return true;
  return as !== implied.active_status.toLowerCase();
}

/** True when moving onto or off of the guarded Inactive status text. */
export function crossesInactiveBoundary(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined,
): boolean {
  return isInactiveCarStatus(fromStatus) !== isInactiveCarStatus(toStatus);
}

/**
 * History event for a status save.
 * Marking Inactive is audited even when active was already false.
 * Leaving the frozen state (Inactive, or active=false with any other status)
 * is a reactivation. Storage → Bad Order on an active car is neither.
 */
export function inactiveBoundaryEvent(
  car: { status?: string | null; active?: boolean | null },
  toStatus: string,
): CarStatusHistoryEventType | null {
  const toInactive = isInactiveCarStatus(toStatus);
  const fromInactive = isInactiveCarStatus(car.status);
  if (toInactive && !fromInactive) return CAR_STATUS_HISTORY_EVENT.markedInactive;
  if (!toInactive && isFrozenRailcar(car)) return CAR_STATUS_HISTORY_EVENT.reactivated;
  return null;
}

/**
 * Field patch for a guarded Inactive boundary transition.
 * Always includes active / active_status so the triad stays consistent.
 */
export function fieldsForInactiveBoundaryChange(toStatus: string): {
  status: string;
  active: boolean;
  active_status: string;
  active_source: "manual";
} {
  const implied = fieldsImpliedByCarStatus(toStatus);
  return {
    ...implied,
    active_source: "manual",
  };
}

/** Patch written on every Car Status save — status text + implied active/active_status. */
export function fieldsForCarStatusSave(
  toStatus: string,
  opts?: { stampManual?: boolean },
): {
  status: string;
  active: boolean;
  active_status: string;
  active_source?: "manual";
} {
  const implied = fieldsImpliedByCarStatus(toStatus);
  if (opts?.stampManual) return { ...implied, active_source: "manual" };
  return implied;
}

export function inactiveBoundaryEventType(toStatus: string): CarStatusHistoryEventType {
  return isInactiveCarStatus(toStatus)
    ? CAR_STATUS_HISTORY_EVENT.markedInactive
    : CAR_STATUS_HISTORY_EVENT.reactivated;
}
