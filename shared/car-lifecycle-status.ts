/**
 * Car Status (railcars.status) — lifecycle / service state.
 * Independent of Rental Status (railcars.fleet_status: Leased/Idle/Sold/Abatement).
 *
 * "Inactive" is a deliberate fleet-membership exit: sets active=false.
 * Other values keep their historical no-guard edit behavior; only Inactive
 * transitions flip active / active_status and require a reason + history row.
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

/** Only Active/In-Service implies fleet membership active=true. */
export function carStatusImpliesActive(status: string | null | undefined): boolean {
  return String(status ?? "").trim() === "Active/In-Service";
}

export function fieldsImpliedByCarStatus(status: string | null | undefined): {
  status: string;
  active: boolean;
  active_status: "Active" | "Inactive";
} {
  const s = String(status ?? "").trim() || "Active/In-Service";
  if (carStatusImpliesActive(s)) {
    return { status: s, active: true, active_status: "Active" };
  }
  return { status: s, active: false, active_status: "Inactive" };
}

/**
 * Keep Car Status text consistent with a boolean ACTIVE flag (VCF import).
 * Does not invent Inactive (guarded); uses Off-Lease as the historical inactive status
 * only when the current text still says Active/In-Service.
 */
export function statusAlignedToActiveFlag(
  currentStatus: string | null | undefined,
  active: boolean,
): string {
  const cur = String(currentStatus ?? "").trim();
  if (active) {
    return carStatusImpliesActive(cur) ? cur : "Active/In-Service";
  }
  if (cur && !carStatusImpliesActive(cur)) return cur;
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

/** True when moving onto or off of the guarded Inactive status. */
export function crossesInactiveBoundary(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined,
): boolean {
  return isInactiveCarStatus(fromStatus) !== isInactiveCarStatus(toStatus);
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
