/* eslint-disable no-console */
/** Run: npx tsx shared/kpi-status.test.ts */

import { derivedAgreesWithDashboard, derivedKpiStatus, dashboardIdle, dashboardUnassigned } from "./kpi-status";
import { kpiBucketsForRow } from "./kpi-buckets";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(derivedKpiStatus({ off_rent: false }) === "Leased", "on rent → Leased");
ok(derivedKpiStatus({ is_sold: true, off_rent: true }) === "Sold", "sold wins");
ok(
  derivedKpiStatus({ off_rent: true, going_on_lease: true }) === "Idle",
  "Going On Lease is Idle",
);
ok(
  derivedKpiStatus({ off_rent: true, has_open_commitment: true }) === "Idle",
  "commitment is Idle",
);
ok(
  derivedKpiStatus({ off_rent: true, in_open_program: true }) === "Idle",
  "open program is Idle",
);
ok(
  derivedKpiStatus({ off_rent: true, awaiting_rent_start: true }) === "Idle",
  "awaiting rent start is Idle",
);
ok(derivedKpiStatus({ off_rent: true }) === "Unassigned", "off rent no plan → Unassigned");

const gol = { is_op: true, off_rent: true, going_on_lease: true };
ok(dashboardIdle(gol) && derivedKpiStatus(gol) === "Idle", "GOL dashboard Idle = derived Idle");
ok(derivedAgreesWithDashboard(gol), "GOL agrees");

const avail = { is_op: true, off_rent: true };
ok(dashboardUnassigned(avail) && derivedKpiStatus(avail) === "Unassigned", "Available = Unassigned");
ok(derivedAgreesWithDashboard(avail), "Available agrees");

const onRent = { is_op: true, off_rent: false };
ok(derivedKpiStatus(onRent) === "Leased" && derivedAgreesWithDashboard(onRent), "on rent agrees");

const abate = {
  active: true,
  is_op: true,
  is_sold: false,
  off_rent: false,
  on_ol: true,
  on_rent: false,
  open_abatement: true,
  in_open_program: true,
};
ok(derivedKpiStatus(abate) === "Leased", "open abatement is not Idle");
ok(!dashboardIdle(abate), "open abatement is not dashboard Idle");
ok(!kpiBucketsForRow(abate).includes("on_rent"), "open abatement excluded from on_rent");
ok(!kpiBucketsForRow(abate).includes("idle"), "open abatement not Idle bucket");
ok(!kpiBucketsForRow(abate).includes("unassigned"), "open abatement not Unassigned");
ok(kpiBucketsForRow(abate).includes("rental_abatement"), "open abatement bucket");

const sixGol = Array.from({ length: 6 }, () => gol);
const idleRest = Array.from({ length: 243 }, () => ({ is_op: true, off_rent: true, has_open_commitment: true as const }));
const unassigned = Array.from({ length: 45 }, () => avail);
const fleet = [...idleRest, ...sixGol, ...unassigned];
const idleN = fleet.filter((r) => derivedKpiStatus(r) === "Idle").length;
const unN = fleet.filter((r) => derivedKpiStatus(r) === "Unassigned").length;
const dashIdle = fleet.filter(dashboardIdle).length;
const dashUn = fleet.filter(dashboardUnassigned).length;
ok(idleN === 249 && dashIdle === 249, "Idle 249 matches dashboard");
ok(unN === 45 && dashUn === 45, "Unassigned 45 matches Available");
ok(fleet.every(derivedAgreesWithDashboard), "every row agrees");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
