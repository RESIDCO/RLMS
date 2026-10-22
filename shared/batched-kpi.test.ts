/* eslint-disable no-console */
/** Run: npx tsx shared/batched-kpi.test.ts */

import { readFileSync } from "node:fs";
import { kpiHasOlLink } from "./kpi-ol-link";
import { leaseEndedWatchStatusExcluded } from "./kpi-watch";
import {
  FLEET_ISSUE_CODES,
  NO_LEASE_LINK_SUBTITLE,
  distinctIssueCarCount,
  fleetDataIssuesLabel,
  fleetIssueCodes,
  isGoingOnLeaseOverdue,
  isIssueListBucket,
  isLeaseEndConflict,
  type FleetIssueInput,
} from "./fleet-data-issues";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(!leaseEndedWatchStatusExcluded("ACTIVE"), "active lease stays on watch");
ok(leaseEndedWatchStatusExcluded("MTM"), "MTM leaves watch");
ok(leaseEndedWatchStatusExcluded("Month to Month"), "month to month leaves watch");
ok(leaseEndedWatchStatusExcluded("SCRAPPING"), "SCRAPPING leaves watch");
ok(leaseEndedWatchStatusExcluded("scrap hold"), "scrap status leaves watch");
ok(!leaseEndedWatchStatusExcluded("DESCRIPTION"), "unrelated text stays");

ok(kpiHasOlLink(true, null, null), "null statuses stay linked");
ok(kpiHasOlLink(true, "on_lease", "active"), "on-lease stays linked");
ok(!kpiHasOlLink(false, null, null), "missing assignment is not a link");
ok(!kpiHasOlLink(true, "off_lease_pending_remarketing", "active"), "ended assignment drops the link");
ok(!kpiHasOlLink(true, null, "off_lease_pending_remarketing"), "ended rider drops the link");
ok(!kpiHasOlLink(true, "on_lease", "closed"), "closed rider drops the link");

const today = "2026-10-22";
const base: FleetIssueInput = {
  railcar_id: 1,
  active: true,
  is_op: true,
  is_sold: false,
  off_rent: false,
  on_ol: true,
  status_tag: "Leased",
  open_abatement: false,
  has_open_commitment: false,
  in_open_program: false,
  going_on_lease: false,
  awaiting_rent_start: false,
  no_assignment: false,
};
ok(fleetIssueCodes(base, today).length === 0, "a clean on-rent car is not an issue");
ok(
  fleetIssueCodes({ ...base, stale_commitment: true }, today).includes("stale_commitment"),
  "stale commitment on an active operating car is an issue",
);
ok(
  !fleetIssueCodes({ ...base, stale_commitment: true, is_op: false }, today).includes("stale_commitment"),
  "stale commitment on a non-operating car is not an issue",
);
ok(
  !fleetIssueCodes({ ...base, stale_commitment: true, active: false }, today).includes("stale_commitment"),
  "stale commitment on an inactive car is not an issue",
);
ok(!fleetIssueCodes({ ...base, shop_conflict: true }, today).includes("awaiting_rent_start"), "shop conflict is not an issue code");
ok(!(FLEET_ISSUE_CODES as readonly string[]).includes("shop_conflict"), "shop conflict is not in the issue list");

const overlap: FleetIssueInput = {
  ...base,
  railcar_id: 7,
  off_rent: true,
  status_tag: "Idle",
  awaiting_rent_start: true,
};
const overlapCodes = fleetIssueCodes(overlap, today);
ok(overlapCodes.includes("awaiting_rent_start") && overlapCodes.includes("idle_on_ol"), "awaiting and idle-on-ol can both match");
ok(distinctIssueCarCount([overlap, overlap], today) === 1, "the same car on two issues counts once");
ok(
  distinctIssueCarCount([overlap, { ...base, railcar_id: 8, no_assignment: true }], today) === 2,
  "two cars count as two",
);

ok(
  isGoingOnLeaseOverdue(
    { ...base, going_on_lease: true, rider_expiration_date: "2026-01-01" },
    today,
  ),
  "past going-on-lease end is overdue",
);
ok(
  !isGoingOnLeaseOverdue(
    { ...base, going_on_lease: true, rider_expiration_date: "2026-12-01" },
    today,
  ),
  "future going-on-lease end is not overdue",
);
ok(
  isLeaseEndConflict({ ...base, rider_expiration_date: "2026-01-01", lease_end_date: "2026-06-01" }),
  "different rider and car ends conflict",
);
ok(
  !isLeaseEndConflict({ ...base, rider_expiration_date: "2026-01-01", lease_end_date: "2026-01-01" }),
  "matching ends are not a conflict",
);
ok(!isLeaseEndConflict({ ...base, rider_expiration_date: "2026-01-01" }), "one blank end is not a conflict");

ok(NO_LEASE_LINK_SUBTITLE === "Operating cars with no assignment row.", "no lease link wording drops Off Rent");
ok(!NO_LEASE_LINK_SUBTITLE.toLowerCase().includes("off rent"), "subtitle does not say off rent");
ok(fleetDataIssuesLabel(13) === "Fleet data issues (13)", "badge label");
ok(isIssueListBucket("awaiting_rent_start") && !isIssueListBucket("idle"), "awaiting list returns to issues; idle stays makeup");

const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
const issues = readFileSync("client/src/pages/FleetDataIssues.tsx", "utf8");
for (const id of [
  "kpi-total-fleet",
  "kpi-idle",
  "kpi-rental-abatement",
  "kpi-active-assignments",
  "kpi-unassigned",
  "kpi-in-program",
  "kpi-utilization",
  "kpi-sold",
  "kpi-mtm",
  "kpi-going-on-lease",
  "kpi-watch",
  "kpi-riders",
]) {
  ok(dash.includes(`testId="${id}"`) || dash.includes(`data-testid="${id}"`), `dashboard keeps ${id}`);
}
for (const id of [
  "kpi-shop-conflict",
  "kpi-awaiting-rent",
  "kpi-stale",
  "kpi-no-link",
  "kpi-sold-needs-tag",
  "kpi-sale-unclear",
  "kpi-sold-tag-suspect",
  "kpi-sold-missing-buyer",
  "kpi-leased-off-rent",
  "kpi-unbucketed",
]) {
  ok(!dash.includes(`testId="${id}"`) && !dash.includes(`data-testid="${id}"`), `dashboard drops ${id}`);
  ok(issues.includes(`testId="${id}"`) || id === "kpi-shop-conflict", `issues page has ${id}`);
}
ok(!issues.includes('testId="kpi-shop-conflict"'), "shop conflict card is not on the issues page");
ok(dash.includes('data-testid="fleet-data-issues-badge"'), "dashboard badge");
ok(dash.includes("kpi-idle-awaiting-rent"), "idle card reaches awaiting rent start");
ok(issues.includes("NO_LEASE_LINK_SUBTITLE"), "issues page uses the new no-link subtitle");
ok(issues.includes('testId="kpi-idle-on-ol"'), "idle on OL review is an issue card");
ok(issues.includes('testId="kpi-gol-overdue"'), "overdue going on lease is an issue card");
ok(issues.includes('testId="kpi-lease-end-conflict"'), "date conflict is an issue card");

const cars = readFileSync("client/src/pages/KpiCarList.tsx", "utf8");
ok(cars.includes("AwaitingPasteCars"), "paste tool stays on the awaiting list");
ok(cars.includes("isIssueListBucket"), "issue lists link back to the issues page");

const watch = readFileSync("server/commitment.ts", "utf8");
ok(watch.includes("leaseEndedWatchStatusExcluded"), "watch list uses the scrap exclusion");
ok(watch.includes("assignmentStatus: assignment?.assignment_status"), "commitment on-OL check reads assignment status");
ok(watch.includes("riderLifecycleStatus: rider?.lifecycle_status"), "commitment on-OL check reads rider lifecycle");
const rentStart = readFileSync("server/rent-start.ts", "utf8");
ok(rentStart.includes("assignmentStatus: assignment?.assignment_status"), "rent-start on-OL check reads assignment status");
ok(rentStart.includes("riderLifecycleStatus: rider?.lifecycle_status"), "rent-start on-OL check reads rider lifecycle");

const migrations = [
  "supabase/migrations/20261022180000_watch_exclude_scrapping.sql",
  "supabase/migrations/20261022180100_kpi_off_lease_assignment.sql",
  "supabase/migrations/20261022180200_fleet_data_issue_cars.sql",
];
const sql = migrations.map((path) => readFileSync(path, "utf8")).join("\n");
ok(sql.includes("coalesce(v.lease_status, '') !~* 'SCRAP'"), "watch SQL excludes SCRAP");
ok(sql.includes("fe36996c988eb4913630512417f5fe39"), "K1 stores the function baseline");
ok(sql.includes("does not match the K1 baseline"), "K1 raises when the live function drifted");
ok(sql.includes("off_lease_pending_remarketing"), "K2 names the ended assignment");
ok(sql.includes("rlms_kpi_has_ol_link"), "K2 gates the OL link");
ok(sql.includes("b1910c6f1b309dcfb500088d4ea5139a"), "K2 stores the view baseline");
ok(sql.includes("does not match the K2 baseline"), "K2 raises when the live view drifted");
ok(
  sql.includes("GRANT EXECUTE ON FUNCTION public.rlms_kpi_has_ol_link(boolean, text, text) TO service_role"),
  "K2 helper grants service_role",
);
ok(
  sql.includes("REVOKE ALL ON FUNCTION public.rlms_kpi_has_ol_link(boolean, text, text) FROM PUBLIC, anon, authenticated"),
  "K2 helper is revoked from anon and authenticated",
);
ok(
  !/GRANT EXECUTE ON FUNCTION public\.rlms_kpi_has_ol_link\(boolean, text, text\) TO[^;]*\banon\b/.test(sql),
  "K2 helper is not granted to anon",
);
ok(sql.includes("JOIN public.v_rlms_car_kpi v ON v.railcar_id = cc.railcar_id"), "stale commitments join the car KPI");
ok(
  /stale_commitment[\s\S]*AND v\.active IS TRUE\s+AND v\.is_op IS TRUE/.test(sql),
  "stale commitments are limited to active operating cars",
);
ok(sql.includes("'awaiting_rent_start'::text"), "awaiting rent start stays in the badge");
ok(sql.includes("'idle_on_ol'::text"), "idle on OL stays in the badge");
ok(sql.includes("security_invoker = true"), "new views are security invoker");
ok(sql.includes("GRANT SELECT ON public.v_rlms_fleet_data_issue_cars TO service_role"), "issue view grants service_role");
ok(sql.includes("GRANT EXECUTE ON FUNCTION public.rlms_fleet_data_issue_counts() TO service_role"), "count function grants service_role");
ok(!/GRANT SELECT ON public\.v_rlms_fleet_data_issue_cars TO[^;]*authenticated/.test(sql), "issue view is not granted to authenticated");
ok(!/CREATE OR REPLACE FUNCTION public\.rlms_fleet_kpis\(\)/.test(sql), "wrapper rlms_fleet_kpis is not replaced");
for (const name of [
  "rlms_apply_jsonb_patch",
  "rlms_undo_change_group",
  "rlms_referenced_outside_group",
  "rlms_fk_outside_group",
  "rent_events",
]) {
  ok(!sql.includes(name), `migrations do not mention ${name}`);
}
ok(!/supabase\.co|service_role_key|eyJ/.test(sql), "migrations contain no secrets");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
