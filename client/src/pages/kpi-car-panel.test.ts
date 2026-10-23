/* eslint-disable no-console */
/** Run: npx tsx client/src/pages/kpi-car-panel.test.ts */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const list = readFileSync(join(root, "client/src/pages/KpiCarList.tsx"), "utf8");
const fleet = readFileSync(join(root, "client/src/pages/FleetRegistry.tsx"), "utf8");
const why = readFileSync(join(root, "client/src/components/KpiWhySection.tsx"), "utf8");
const issues = readFileSync(join(root, "client/src/pages/FleetDataIssues.tsx"), "utf8");
const watch = readFileSync(join(root, "client/src/pages/CommitmentOps.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(!existsSync(join(root, "client/src/pages/KpiCarSheet.tsx")), "the old KPI car sheet is gone");
ok(!list.includes("KpiCarSheet"), "the KPI list no longer opens the old sheet");
ok(list.includes("<RailcarDetailSheet"), "dashboard and data-issue car lists open the shared sheet");
ok(list.includes("kpiContext={carId ? { carId, bucket } : null}"), "the list passes Why in this KPI only while a car is open");
ok(list.includes("carPageHref=") && list.includes("?from="), "Car page keeps the list in from= so Back still works");
ok(list.includes(">Bulk action<") && list.includes("Set Commitment") && list.includes("Set Rent Start"), "bulk actions on the list stay");
ok(!list.includes("Preview set") && !list.includes("Edit assignment on car page") && !list.includes("<RentStopsCard"), "the list no longer mounts the always-open car forms");

ok(why.includes("Why in this KPI") && why.includes("kpiWhyLines"), "the context section is the why block");
ok(why.includes('data-testid="kpi-why"'), "the why block can be found in the panel");
ok(fleet.includes("kpiContext ?") && fleet.includes("<KpiWhySection"), "the shared panel renders the why block only when context is set");

ok(app.includes('path="/kpi/cars"') && app.includes("KpiCarListPage"), "KPI drill-down is the shared list page");
ok(issues.includes("kpiDrillPath(") && issues.includes("Lease end date conflict"), "fleet data issues open the same list, including lease end date conflict");
ok(list.includes("isIssueListBucket"), "data-issue buckets stay on this list");

ok(watch.includes('Redirect to="/kpi/cars?bucket=awaiting_rent_start"'), "awaiting rent-start watch opens the shared KPI list");
ok(!watch.includes("KpiCarSheet"), "rent-start watch does not keep the old sheet");
const watchPage = watch.slice(watch.indexOf("export function RentStartWatchPage"));
ok(watchPage.includes("carPath(r.railcar_id)") && !watchPage.includes("<Sheet"), "shop and future rent-start rows open the car page, not a second panel");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log(`${passed} passed, ${failed} failed`);
