import { KPI_TITLES } from "./kpi-buckets";

/**
 * Dashboard KPI drills that open /kpi/cars. Off Rent is not a tile; its list bucket remains.
 * expectedCount is the production figure on 2026-10-22: rlms_fleet_kpis(), except
 * leased_off_rent which is the row count of v_kpi_preview_retag. The UI does not read it.
 */
export const KPI_DRILL_TILES = [
  { testId: "kpi-total-fleet", bucket: "op", expectedCount: 14446 },
  { testId: "kpi-idle", bucket: "idle", expectedCount: 309 },
  { testId: "kpi-active-assignments", bucket: "on_rent", expectedCount: 14096 },
  { testId: "kpi-unassigned", bucket: "unassigned", expectedCount: 40 },
  { testId: "kpi-awaiting-rent", bucket: "awaiting_rent_start", expectedCount: 154 },
  { testId: "kpi-mtm", bucket: "mtm", expectedCount: 34 },
  { testId: "kpi-going-on-lease", bucket: "going_on_lease", expectedCount: 0 },
  { testId: "kpi-no-link", bucket: "no_link", expectedCount: 1 },
  { testId: "kpi-sold-needs-tag", bucket: "sold_needs_tag", expectedCount: 0 },
  { testId: "kpi-sold-tag-suspect", bucket: "sold_tag_suspect", expectedCount: 0 },
  { testId: "kpi-sold-missing-buyer", bucket: "sold_missing_buyer", expectedCount: 0 },
  { testId: "kpi-sale-unclear", bucket: "sale_unclear", expectedCount: 0 },
  { testId: "kpi-leased-off-rent", bucket: "leased_off_rent", expectedCount: 0 },
  { testId: "kpi-rental-abatement", bucket: "rental_abatement", expectedCount: 1 },
] as const;

export function kpiDrillPath(bucket: string) {
  return `/kpi/cars?bucket=${encodeURIComponent(bucket)}`;
}

export function kpiDrillTitle(bucket: string) {
  return KPI_TITLES[bucket] ?? bucket;
}
