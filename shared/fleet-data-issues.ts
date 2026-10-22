import { isUnbucketedOperatingCar, type KpiFlagRow } from "./kpi-buckets";

/**
 * Cars behind the Fleet data issues page. Shop conflict is not an issue.
 * The badge counts distinct cars, not the sum of the cards.
 * Predicates match v_rlms_fleet_data_issue_cars.
 */

export const FLEET_ISSUE_CODES = [
  "stale_commitment",
  "no_lease_link",
  "sold_needs_tag",
  "sale_unclear",
  "sold_tag_suspect",
  "sold_missing_buyer",
  "leased_off_rent",
  "unbucketed",
  "awaiting_rent_start",
  "idle_on_ol",
  "going_on_lease_overdue",
  "lease_end_conflict",
] as const;

export type FleetIssueCode = (typeof FLEET_ISSUE_CODES)[number];

/** KPI list buckets that belong to the issues page, so Back returns there. */
export const ISSUE_LIST_BUCKETS = [
  "no_link",
  "sold_needs_tag",
  "sale_unclear",
  "sold_tag_suspect",
  "sold_missing_buyer",
  "leased_off_rent",
  "unbucketed",
  "awaiting_rent_start",
  "idle_on_ol",
  "going_on_lease_overdue",
  "lease_end_conflict",
] as const;

export function isIssueListBucket(bucket: string | null | undefined): boolean {
  return (ISSUE_LIST_BUCKETS as readonly string[]).includes(String(bucket ?? ""));
}

export const NO_LEASE_LINK_SUBTITLE = "Operating cars with no assignment row.";

export const LEASE_ENDED_WATCH_SUBTITLE =
  "Still on OL past end date, not Month to Month or a scrap program.";

export const FLEET_DATA_ISSUES_PATH = "/fleet/data-issues";

export type FleetIssueInput = KpiFlagRow & {
  railcar_id?: number | null;
  rider_expiration_date?: string | null;
  lease_end_date?: string | null;
  stale_commitment?: boolean | null;
};

function isoDate(value: string | null | undefined): string | null {
  const d = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function isGoingOnLeaseOverdue(row: FleetIssueInput, today?: string): boolean {
  if (row.is_op !== true || row.going_on_lease !== true) return false;
  const end = isoDate(row.rider_expiration_date) ?? isoDate(row.lease_end_date);
  if (!end) return false;
  const asOf = today ?? new Date().toISOString().slice(0, 10);
  return end < asOf;
}

export function isLeaseEndConflict(row: FleetIssueInput): boolean {
  if (row.is_op !== true) return false;
  const rider = isoDate(row.rider_expiration_date);
  const car = isoDate(row.lease_end_date);
  return rider != null && car != null && rider !== car;
}

export function fleetIssueCodes(row: FleetIssueInput, today?: string): FleetIssueCode[] {
  const codes: FleetIssueCode[] = [];
  if (row.stale_commitment === true && row.active === true && row.is_op === true) {
    codes.push("stale_commitment");
  }
  if (row.is_op === true && row.no_assignment === true) codes.push("no_lease_link");
  if (row.sold_needs_tag === true) codes.push("sold_needs_tag");
  if (row.sale_unclear === true) codes.push("sale_unclear");
  if (row.sold_tag_suspect === true) codes.push("sold_tag_suspect");
  if (row.sold_missing_buyer === true) codes.push("sold_missing_buyer");
  if (row.is_op === true && row.off_rent === true && row.status_tag === "Leased") codes.push("leased_off_rent");
  if (isUnbucketedOperatingCar(row)) codes.push("unbucketed");
  if (row.is_op === true && row.awaiting_rent_start === true) codes.push("awaiting_rent_start");
  if (row.is_op === true && row.status_tag === "Idle" && row.on_ol === true) codes.push("idle_on_ol");
  if (isGoingOnLeaseOverdue(row, today)) codes.push("going_on_lease_overdue");
  if (isLeaseEndConflict(row)) codes.push("lease_end_conflict");
  return codes;
}

/** Distinct cars that land on at least one issue. Overlaps count once. */
export function distinctIssueCarCount(rows: readonly FleetIssueInput[], today?: string): number {
  const ids = new Set<number>();
  rows.forEach((row, index) => {
    if (fleetIssueCodes(row, today).length === 0) return;
    ids.add(row.railcar_id ?? -(index + 1));
  });
  return ids.size;
}

export function fleetDataIssuesLabel(count: number): string {
  return `Fleet data issues (${count.toLocaleString("en-US")})`;
}
