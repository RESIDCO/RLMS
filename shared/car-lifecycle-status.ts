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

/** True when moving onto or off of the guarded Inactive status. */
export function crossesInactiveBoundary(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined,
): boolean {
  return isInactiveCarStatus(fromStatus) !== isInactiveCarStatus(toStatus);
}

/**
 * Field patch for a guarded Inactive boundary transition.
 * Non-boundary status edits should only send `{ status }` (legacy behavior).
 */
export function fieldsForInactiveBoundaryChange(toStatus: string): {
  status: string;
  active: boolean;
  active_status: string;
  active_source: "manual";
} {
  if (isInactiveCarStatus(toStatus)) {
    return {
      status: "Inactive",
      active: false,
      active_status: "Inactive",
      active_source: "manual",
    };
  }
  return {
    status: String(toStatus ?? "").trim() || "Active/In-Service",
    active: true,
    active_status: "Active",
    active_source: "manual",
  };
}

export function inactiveBoundaryEventType(toStatus: string): CarStatusHistoryEventType {
  return isInactiveCarStatus(toStatus)
    ? CAR_STATUS_HISTORY_EVENT.markedInactive
    : CAR_STATUS_HISTORY_EVENT.reactivated;
}
