/**
 * Gate in front of rlms_is_on_ol / isOnOl.
 * Matches public.rlms_kpi_has_ol_link. Null statuses stay linked, so the KPI
 * delta is 0 until an ended assignment or rider status is written (OL2222).
 */

const ENDED_ASSIGNMENT = "off_lease_pending_remarketing";
const ENDED_LIFECYCLE = new Set(["off_lease_pending_remarketing", "closed"]);

export function assignmentStillOnLease(
  assignmentStatus: string | null | undefined,
  lifecycleStatus: string | null | undefined,
): boolean {
  if ((assignmentStatus ?? "") === ENDED_ASSIGNMENT) return false;
  if (ENDED_LIFECYCLE.has(lifecycleStatus ?? "")) return false;
  return true;
}

export function kpiHasOlLink(
  hasAssignment: boolean | null | undefined,
  assignmentStatus: string | null | undefined,
  lifecycleStatus: string | null | undefined,
): boolean {
  if (hasAssignment !== true) return false;
  return assignmentStillOnLease(assignmentStatus, lifecycleStatus);
}
