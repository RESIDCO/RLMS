import { KPI_TITLES } from "./kpi-buckets";

/** Dashboard KPI drills that open /kpi/cars. Counts are acceptance targets after sale_unclear view fix. */
export const KPI_DRILL_TILES = [
  { testId: "kpi-total-fleet", bucket: "op", expectedCount: 14513 },
  { testId: "kpi-off-rent", bucket: "off_rent", expectedCount: 295 },
  { testId: "kpi-idle", bucket: "idle", expectedCount: 249 },
  { testId: "kpi-active-assignments", bucket: "on_rent", expectedCount: 14218 },
  { testId: "kpi-unassigned", bucket: "unassigned", expectedCount: 46 },
  { testId: "kpi-awaiting-rent", bucket: "awaiting_rent_start", expectedCount: 80 },
  { testId: "kpi-mtm", bucket: "mtm", expectedCount: 37 },
  { testId: "kpi-going-on-lease", bucket: "going_on_lease", expectedCount: 6 },
  { testId: "kpi-no-link", bucket: "no_link", expectedCount: 8 },
  { testId: "kpi-sold-needs-tag", bucket: "sold_needs_tag", expectedCount: 188 },
  { testId: "kpi-sold-tag-suspect", bucket: "sold_tag_suspect", expectedCount: 2 },
  { testId: "kpi-sold-missing-buyer", bucket: "sold_missing_buyer", expectedCount: 1 },
  { testId: "kpi-sale-unclear", bucket: "sale_unclear", expectedCount: 0 },
  { testId: "kpi-leased-off-rent", bucket: "leased_off_rent", expectedCount: 90 },
  { testId: "kpi-rental-abatement", bucket: "rental_abatement", expectedCount: 0 },
] as const;

export function kpiDrillPath(bucket: string) {
  return `/kpi/cars?bucket=${encodeURIComponent(bucket)}`;
}

export function kpiDrillTitle(bucket: string) {
  return KPI_TITLES[bucket] ?? bucket;
}
