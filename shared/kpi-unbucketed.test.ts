/* eslint-disable no-console */
/** Run: npx tsx shared/kpi-unbucketed.test.ts */

import { readFileSync } from "node:fs";
import {
  IDLE_COMMITTED_SUBTITLE,
  KPI_BUCKETS,
  KPI_CAR_ROWS_VIEW,
  KPI_PRIMARY_ORDER,
  KPI_TITLES,
  UNBUCKETED_CARS_VIEW,
  idleCommitmentSeed,
  isUnbucketedOperatingCar,
  kpiBucketsForRow,
  kpiCarRowsSource,
  operatingBucketMembership,
  primaryKpiBucket,
  showUnbucketedWarning,
  unbucketedWarningLabel,
  type KpiFlagRow,
} from "./kpi-buckets";
import { kpiDrillPath } from "./kpi-drill-tiles";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const clearSeed = {
  has_open_commitment: false,
  in_open_program: false,
  going_on_lease: false,
  awaiting_rent_start: false,
} satisfies Partial<KpiFlagRow>;

const onRent: KpiFlagRow = { active: true, is_op: true, is_sold: false, off_rent: false, open_abatement: false, ...clearSeed };
const abatement: KpiFlagRow = {
  active: true,
  is_op: true,
  is_sold: false,
  off_rent: false,
  open_abatement: true,
  ...clearSeed,
  in_open_program: true,
};
const unassigned: KpiFlagRow = { active: true, is_op: true, is_sold: false, off_rent: true, open_abatement: false, ...clearSeed };

function idleWith(flag: keyof typeof clearSeed): KpiFlagRow {
  return { active: true, is_op: true, is_sold: false, off_rent: true, open_abatement: false, ...clearSeed, [flag]: true };
}

ok(operatingBucketMembership(onRent).onRent && !isUnbucketedOperatingCar(onRent), "on rent is one bucket");
ok(!kpiBucketsForRow(onRent).includes("unbucketed"), "on rent row is not tagged unbucketed");
ok(JSON.stringify(kpiBucketsForRow(onRent)) === JSON.stringify(["op", "on_rent"]), "on rent buckets unchanged");

ok(operatingBucketMembership(abatement).abatement, "abatement membership");
ok(!operatingBucketMembership(abatement).idle, "abatement outside idle even with an open program");
ok(!operatingBucketMembership(abatement).onRent, "abatement is not on rent");
ok(!isUnbucketedOperatingCar(abatement), "abatement outside off rent is bucketed");

for (const flag of ["has_open_commitment", "in_open_program", "going_on_lease", "awaiting_rent_start"] as const) {
  const row = idleWith(flag);
  const m = operatingBucketMembership(row);
  ok(m.idle && !m.unassigned && !m.abatement && !m.onRent, `${flag} is idle only`);
  ok(!isUnbucketedOperatingCar(row), `${flag} is not unbucketed`);
  ok(idleCommitmentSeed(row) === true, `${flag} seed is true`);
}

ok(operatingBucketMembership(unassigned).unassigned && !isUnbucketedOperatingCar(unassigned), "unassigned is one bucket");
ok(idleCommitmentSeed(unassigned) === false, "clear seed is false");

ok(
  isUnbucketedOperatingCar({ is_op: true, off_rent: null, open_abatement: false, ...clearSeed }),
  "null off_rent is in none of the four",
);
ok(
  isUnbucketedOperatingCar({
    is_op: true,
    off_rent: true,
    open_abatement: false,
    ...clearSeed,
    has_open_commitment: null,
  }),
  "null idle seed on an off-rent car is in none of the four",
);
ok(
  isUnbucketedOperatingCar({ is_op: true, off_rent: false, open_abatement: null, ...clearSeed }),
  "null abatement flag is not on rent",
);

const overlapIdle: KpiFlagRow = {
  active: true,
  is_op: true,
  is_sold: false,
  off_rent: true,
  open_abatement: true,
  ...clearSeed,
  has_open_commitment: true,
};
ok(isUnbucketedOperatingCar(overlapIdle), "abatement plus idle is unbucketed");
const overlapBuckets = kpiBucketsForRow(overlapIdle);
ok(overlapBuckets.includes("unbucketed") && overlapBuckets.includes("idle") && overlapBuckets.includes("rental_abatement"), "overlap keeps both non-revenue buckets");
ok(primaryKpiBucket(overlapBuckets) === "rental_abatement", "primary label stays rental abatement");

const overlapUnassigned: KpiFlagRow = {
  is_op: true,
  off_rent: true,
  open_abatement: true,
  ...clearSeed,
};
ok(
  isUnbucketedOperatingCar(overlapUnassigned) &&
    operatingBucketMembership(overlapUnassigned).unassigned &&
    operatingBucketMembership(overlapUnassigned).abatement,
  "abatement plus unassigned is unbucketed",
);

ok(!isUnbucketedOperatingCar({ is_op: false, off_rent: null, open_abatement: null }), "sold or inactive is not operating");
ok(!isUnbucketedOperatingCar({ off_rent: true }), "missing is_op is not operating");
ok(kpiBucketsForRow({ active: false, is_op: true, off_rent: null }).length === 0, "inactive sheet buckets stay empty");

// Read-only on rlms-residco, 2026-10-22: operating 14453 = on rent 14178 + abatement 1 + idle 234 + unassigned 40.
// Off rent 274 = idle 234 + unassigned 40. The same predicate returned 0 unbucketed cars.
const live = { onRent: 14178, abatement: 1, idle: 234, unassigned: 40, offRent: 274, operating: 14453 };
ok(live.idle + live.unassigned === live.offRent, "live off rent = idle + unassigned");
ok(live.onRent + live.abatement + live.idle + live.unassigned === live.operating, "live operating partition");
const liveClasses = [onRent, abatement, idleWith("has_open_commitment"), unassigned];
ok(liveClasses.every((row) => !isUnbucketedOperatingCar(row)), "each live class is bucketed, so the count is 0");

ok(IDLE_COMMITTED_SUBTITLE === "Off rent with an open Commitment, an open program, a Going on lease label, or awaiting rent start.", "idle subtitle");
ok(unbucketedWarningLabel(3) === "Unbucketed cars: 3", "warning label");
ok(!showUnbucketedWarning(0) && !showUnbucketedWarning(null) && !showUnbucketedWarning(undefined), "hide at zero");
ok(showUnbucketedWarning(1), "show when stranded");
ok(kpiDrillPath("unbucketed") === "/kpi/cars?bucket=unbucketed", "unbucketed drill path");
ok(KPI_TITLES.unbucketed === "Unbucketed cars", "unbucketed title");
ok(KPI_TITLES.off_rent === "Off Rent", "off rent title remains for the list");
ok(KPI_BUCKETS.includes("off_rent") && KPI_BUCKETS.includes("unbucketed"), "both buckets exist");
ok(!KPI_PRIMARY_ORDER.includes("unbucketed"), "unbucketed does not take over primary labels");

for (const bucket of ["op", "off_rent", "idle", "unassigned", "on_rent", "rental_abatement", "mtm"]) {
  ok(kpiCarRowsSource(bucket) === KPI_CAR_ROWS_VIEW, `${bucket} list still reads ${KPI_CAR_ROWS_VIEW}`);
}
ok(kpiCarRowsSource("unbucketed") === UNBUCKETED_CARS_VIEW, "unbucketed reads its own view");

const cars = readFileSync("server/kpi-cars.ts", "utf8");
ok(cars.includes('if (bucket === "off_rent") return q.eq("is_op", true).eq("off_rent", true);'), "off rent list filter unchanged");
ok(
  cars.includes('.or("has_open_commitment.eq.true,in_open_program.eq.true,going_on_lease.eq.true,awaiting_rent_start.eq.true")'),
  "idle list filter unchanged",
);
ok(cars.includes('.eq("awaiting_rent_start", false);'), "unassigned list filter unchanged");
ok(
  cars.includes('if (bucket === "on_rent") return q.eq("is_op", true).eq("off_rent", false).eq("open_abatement", false);'),
  "on rent list filter unchanged",
);
ok(cars.includes('if (bucket === "rental_abatement") return q.eq("is_op", true).eq("open_abatement", true);'), "abatement list filter unchanged");
ok(cars.includes("fromKpiRows(opts.bucket)"), "list and export share the bucket source");
ok(!cars.includes('.from("v_rlms_kpi_car_rows")'), "no hardcoded row source bypasses unbucketed");

const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
ok(!dash.includes('testId="kpi-off-rent"'), "off rent card removed");
ok(!dash.includes('kpiDrillPath("off_rent")'), "off rent drill removed");
ok(dash.includes("IDLE_COMMITTED_SUBTITLE"), "idle card uses the shared subtitle");
ok(dash.includes('data-testid="kpi-unbucketed"'), "unbucketed chip");
ok(dash.includes("showUnbucketedWarning"), "chip hidden at zero");
ok(dash.includes('testId="kpi-idle"') && dash.includes('testId="kpi-rental-abatement"'), "idle and abatement cards remain");
ok(dash.includes('testId="kpi-unassigned"') && dash.includes('testId="kpi-active-assignments"'), "unassigned and active cards remain");

const routes = readFileSync("server/routes.ts", "utf8");
ok(routes.includes("off_rent_count: Number(sqlKpis.off_rent)"), "dashboard still returns off_rent_count");
ok(routes.includes("off_rent_main:"), "dashboard still returns the off rent split");
ok(routes.includes('from("v_rlms_unbucketed_cars")'), "dashboard counts the unbucketed view");

const sql = readFileSync("migrations/20261122_unbucketed_operating_cars.sql", "utf8");
ok(sql.includes("CREATE OR REPLACE VIEW public.v_rlms_unbucketed_cars"), "migration creates the view");
ok(sql.includes("v.is_op IS TRUE"), "view is operating cars only");
ok(sql.includes("v.off_rent IS FALSE AND v.open_abatement IS FALSE"), "sql on rent");
ok(sql.includes("v.open_abatement IS TRUE"), "sql abatement");
ok(
  sql.includes("(v.has_open_commitment OR v.in_open_program OR v.going_on_lease OR v.awaiting_rent_start) IS TRUE"),
  "sql idle seed",
);
ok(
  sql.includes("(v.has_open_commitment OR v.in_open_program OR v.going_on_lease OR v.awaiting_rent_start) IS FALSE"),
  "sql unassigned seed",
);
ok(sql.includes(") = 0") && sql.includes(") > 1"), "sql flags none and overlap");
ok(/GRANT SELECT ON public\.v_rlms_unbucketed_cars TO authenticated, service_role;/.test(sql), "explicit grant");
ok(!/create\s+or\s+replace\s+function\s+public\.rlms_fleet_kpis/i.test(sql), "does not replace fleet kpis");
for (const name of [
  "rlms_apply_jsonb_patch",
  "rlms_undo_change_group",
  "rlms_referenced_outside_group",
  "rlms_fk_outside_group",
  "rent_events",
]) {
  ok(!sql.includes(name), `migration does not mention ${name}`);
}
ok(!/\b(insert|update|delete|truncate)\b/i.test(sql), "migration is read-only");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
