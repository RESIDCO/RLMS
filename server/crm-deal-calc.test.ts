/* eslint-disable no-console */
/** Run: npx tsx server/crm-deal-calc.test.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { companyDefaultInputs } from "@shared/dealCalc";
import {
  applyPriceRefusal,
  calculatedScenario,
  inputsIgnoringClientResults,
  opportunityIsClosed,
  presentScenarioList,
  priceForWhich,
  usePriceDisabledReason,
  VIEWER_SCENARIO_KEYS,
} from "@shared/dealCalcApi";
import { isUndoAllowedTable } from "@shared/undo";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const root = resolve(import.meta.dirname, "..");
const serverSrc = readFileSync(resolve(root, "server/crm-deal-calc.ts"), "utf8");
const routeSrc = readFileSync(resolve(root, "server/crm-deal-calc-routes.ts"), "utf8");
const routesSrc = readFileSync(resolve(root, "server/routes.ts"), "utf8");
const undoSrc = readFileSync(resolve(root, "server/undo.ts"), "utf8");
const migration = readFileSync(resolve(root, "migrations/20261120_crm_deal_calc_p1.sql"), "utf8");
const down = readFileSync(resolve(root, "migrations/20261120_crm_deal_calc_p1_down.sql"), "utf8");

const row = {
  id: 4,
  name: "Deal 1",
  opportunity_line_id: 9,
  deal_type: "portfolio_bid",
  method: "both",
  post_lease_plan: "sell",
  is_pinned: true,
  created_at: "2026-10-20T00:00:00Z",
  inputs: { monthlyRent: { value: 500, source: "user" } },
  results: { irr: 0.11 },
  irr: 0.10697,
  npv: 1200,
  max_bid_per_car: 64006.14,
  wayne_bid_per_car: 64006.14,
  target_irr: 0.105,
  stretch_irr: 0.09,
  verdict: "bid",
};

const hidden = presentScenarioList([row], false);
ok(hidden.numbersHidden === true, "viewer list sets numbersHidden");
const hiddenJson = JSON.stringify(hidden.scenarios[0]);
for (const key of ["inputs", "results", "irr", "npv", "max_bid_per_car", "wayne_bid_per_car", "target_irr", "stretch_irr", "verdict"]) {
  ok(!Object.prototype.hasOwnProperty.call(hidden.scenarios[0], key), `viewer list omits ${key}`);
  ok(!hiddenJson.includes(`"${key}"`), `viewer JSON omits ${key}`);
}
for (const key of VIEWER_SCENARIO_KEYS) ok(key in hidden.scenarios[0], `viewer list keeps ${key}`);
ok(presentScenarioList([row], true).numbersHidden === false, "editors receive the full row");
ok(presentScenarioList([row], true).scenarios[0]?.inputs != null, "editors still see inputs");

ok(applyPriceRefusal({
  scenarioLineId: 1,
  line: { deleted_at: "2026-10-20", outcome: null },
  opportunityStage: "proposal",
  opportunityOutcome: null,
  price: 10,
})?.status === 409, "deleted line is 409");
ok(applyPriceRefusal({
  scenarioLineId: 1,
  line: { deleted_at: null, outcome: "won" },
  opportunityStage: "proposal",
  opportunityOutcome: null,
  price: 10,
})?.message === "Line already has an outcome", "line outcome is 409");
ok(applyPriceRefusal({
  scenarioLineId: 1,
  line: { deleted_at: null, outcome: null },
  opportunityStage: "won",
  opportunityOutcome: null,
  price: 10,
})?.status === 409, "won stage is 409");
ok(applyPriceRefusal({
  scenarioLineId: 1,
  line: { deleted_at: null, outcome: null },
  opportunityStage: "proposal",
  opportunityOutcome: "passed",
  price: 10,
})?.message === "Opportunity is closed", "passed outcome is closed");
ok(applyPriceRefusal({
  scenarioLineId: null,
  line: null,
  opportunityStage: "proposal",
  opportunityOutcome: null,
  price: 10,
})?.status === 400, "portfolio-level scenario cannot write a line price");
ok(applyPriceRefusal({
  scenarioLineId: 1,
  line: { deleted_at: null, outcome: null },
  opportunityStage: "proposal",
  opportunityOutcome: null,
  price: 12,
}) == null, "open line with a price is allowed");
ok(opportunityIsClosed("lost", null), "lost stage is closed");
ok(!opportunityIsClosed("docs", null), "docs stage stays open");
ok(usePriceDisabledReason({
  lineId: 1,
  linePresent: false,
  lineOutcome: null,
  opportunityStage: "proposal",
  opportunityOutcome: null,
}) === "Line is deleted", "use-this-price explains a deleted line");

const inputs = companyDefaultInputs();
inputs.monthlyRent = { value: 576.89, source: "user" };
inputs.leaseExpiry = { value: "2038-06-30", source: "user" };
inputs.closeDate = { value: "2026-07-31", source: "user" };
inputs.firstRentDate = { value: "2026-08-01", source: "user" };
inputs.sell.endValuePerCar = { value: 60000, source: "user" };
inputs.method = { value: "both", source: "user" };
const body = { inputs, results: { irr: 9, verdict: "pass" } };
const computed = calculatedScenario(inputsIgnoringClientResults(body));
ok(computed.columns.calc_version === "dc-1.0.0", "server stores calc version");
ok(computed.columns.irr !== 9, "server ignores client results");
ok(priceForWhich(computed.result, "wayne") != null, "wayne price comes from the recompute");
ok(!serverSrc.includes("body.results") && !serverSrc.includes("clientResults"), "server source does not read client results");
ok(serverSrc.includes("inputsIgnoringClientResults"), "create and update drop client results");

ok(serverSrc.includes("withChangeGroupResult"), "scenario writes use a change group");
ok(serverSrc.includes("recordChange"), "scenario writes call recordChange");
ok(serverSrc.includes("planSoftDelete"), "delete records unpin before deleted_at");
ok(serverSrc.includes("planPin"), "pin records the previous pin first");
ok(serverSrc.includes("saveOpportunityLines"), "apply-price uses the bid line save path");
for (const table of ["leases", "riders", "master_leases", "railcars", "rent_charges", "car_rent"]) {
  ok(!serverSrc.includes(`"${table}"`) && !serverSrc.includes(`'${table}'`), `deal calc source does not write ${table}`);
}
ok(!serverSrc.includes("CREATE OR REPLACE FUNCTION") && !serverSrc.includes(".rpc(\"rlms_undo_change_group\""), "server does not replace or call the frozen undo RPC");
ok(undoSrc.includes("isDealCalcOnlyGroup"), "undo of a deal-calc group skips the frozen RPC");
ok(isUndoAllowedTable("deal_calc_scenarios") && isUndoAllowedTable("deal_calc_assumption_sets"), "deal calc tables are undoable at the app layer");

ok(routeSrc.includes('app.get("/api/opportunities/:id/scenarios/:sid"') && /scenarios\/:sid", async[\s\S]*?requireWrite/.test(routeSrc), "viewer detail is requireWrite");
ok(/apply-price", async[\s\S]*?requireWrite/.test(routeSrc), "apply-price is requireWrite");
ok(/assumption-sets\/:id", async[\s\S]*?requireAdmin/.test(routeSrc), "assumption sets are admin only");
ok(routeSrc.includes('app.get("/api/opportunities/:id/scenarios"') && routeSrc.includes("requireUser"), "list allows any signed-in role");
ok(routesSrc.includes("registerCrmDealCalcRoutes(app)"), "routes.ts registers the calculator");

ok(migration.includes("66be7d422ec47e8c711f83c8ca001c79"), "migration guards apply md5");
ok(migration.includes("fda2979bbd2d37e82c936b0abcdf8927"), "migration guards undo md5");
ok(!migration.includes("CREATE OR REPLACE FUNCTION public.rlms_"), "migration does not replace undo functions");
ok(migration.includes("public.set_updated_at()"), "migration requires set_updated_at");
ok(migration.includes(JSON.stringify(companyDefaultInputs())), "seed JSON matches companyDefaultInputs()");
ok(down.includes("down refused"), "down refuses when data exists");
ok(down.includes("66be7d422ec47e8c711f83c8ca001c79"), "down re-checks the md5 guard");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
