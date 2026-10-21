/* eslint-disable no-console */
/** Run: npx tsx server/crm-deal-calc.test.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { companyDefaultInputs, normalizeInputs } from "@shared/dealCalc";
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
ok(computed.columns.calc_version === "v2", "server stores calc version v2");
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
ok(!serverSrc.includes("applyDealCalcUndo"), "deal-calc undo is not applied in JavaScript");
ok(!serverSrc.includes("CREATE OR REPLACE FUNCTION") && !serverSrc.includes(".rpc(\"rlms_undo_change_group\""), "server does not replace or call the frozen undo RPC");
ok(undoSrc.includes("isDealCalcOnlyGroup") && undoSrc.includes("rlms_undo_deal_calc_group"), "applyUndo sends a deal-calc group to rlms_undo_deal_calc_group");
ok(isUndoAllowedTable("deal_calc_scenarios") && isUndoAllowedTable("deal_calc_assumption_sets"), "deal calc tables are undoable at the app layer");

ok(routeSrc.includes('app.get("/api/opportunities/:id/scenarios/:sid"') && /scenarios\/:sid", async[\s\S]*?requireWrite/.test(routeSrc), "viewer detail is requireWrite");
ok(/apply-price", async[\s\S]*?requireWrite/.test(routeSrc), "apply-price is requireWrite");
ok(/assumption-sets\/:id", async[\s\S]*?requireAdmin/.test(routeSrc), "assumption sets are admin only");
ok(routeSrc.includes('app.get("/api/opportunities/:id/scenarios"') && routeSrc.includes("requireUser"), "list allows any signed-in role");
ok(routesSrc.includes("registerCrmDealCalcRoutes(app)"), "routes.ts registers the calculator");

ok(migration.includes("66be7d422ec47e8c711f83c8ca001c79"), "migration guards apply md5");
ok(migration.includes("fda2979bbd2d37e82c936b0abcdf8927"), "migration guards undo md5");
ok(!migration.includes("CREATE OR REPLACE FUNCTION public.rlms_"), "migration does not replace undo functions");
ok(migration.includes("create function public.rlms_undo_deal_calc_group"), "migration defines rlms_undo_deal_calc_group");
ok(/security definer[\s\S]*set search_path = public, pg_temp/.test(migration.slice(migration.indexOf("rlms_undo_deal_calc_group"))), "deal-calc undo is security definer with search_path public, pg_temp");
ok(migration.includes("revoke all on function public.rlms_undo_deal_calc_group(uuid, text) from public, anon, authenticated"), "deal-calc undo execute is revoked from public, anon, and authenticated");
ok(migration.includes("grant execute on function public.rlms_undo_deal_calc_group(uuid, text) to service_role"), "deal-calc undo execute is granted to service_role");
ok(migration.includes("audit_op := 'delete'"), "undo of an insert audits the row as delete");
ok(migration.includes("order by id desc"), "deal-calc undo applies the newest change first");
const undoFn = migration.slice(migration.indexOf("create function public.rlms_undo_deal_calc_group"));
const logLock = undoFn.indexOf("order by a.id\n    for update");
ok(logLock >= 0 && logLock < undoFn.indexOf("'already_undone'"), "activity_log rows are locked before the already_undone re-check");
ok(migration.includes("public.set_updated_at()"), "migration requires set_updated_at");
const seedStart = migration.indexOf(`'{"dealType"`);
const seedEnd = migration.indexOf(`'::jsonb`, seedStart);
ok(seedStart > 0 && seedEnd > seedStart, "p1 seed JSON is present");
const seeded = normalizeInputs(JSON.parse(migration.slice(seedStart + 1, seedEnd)));
ok(seeded.usefulLifeYears.value === 50 && seeded.targetIrr.value === companyDefaultInputs().targetIrr.value, "p1 seed normalizes onto the company defaults");
ok(!migration.includes("newCarCostByClass"), "p1 seed is not rewritten with v2 costs");
const v2 = readFileSync(resolve(root, "migrations/20261123_crm_deal_calc_v2.sql"), "utf8");
const v2down = readFileSync(resolve(root, "migrations/20261123_crm_deal_calc_v2_down.sql"), "utf8");
ok(v2.includes("6d0fa2812a066a2242a893267fd72347"), "v2 records the p1 deal-calc undo md5");
ok(v2.includes("79ff0afc077af1b807f4d4399698e514"), "v2 records the new deal-calc undo md5");
ok(v2.includes("66be7d422ec47e8c711f83c8ca001c79") && v2.includes("fda2979bbd2d37e82c936b0abcdf8927"), "v2 guards the frozen md5s");
ok(v2.includes("deal_calc_scenarios_line_needs_opp") && v2.includes("deal_calc_scenarios_pin_needs_opp"), "v2 adds the null-opportunity checks");
ok(v2.includes("rlms_undo_calc_create_opp") && v2.includes("revoke all on function public.rlms_undo_calc_create_opp(uuid, uuid, text) from public, anon, authenticated"), "wrapper execute is revoked from public roles");
ok(!v2.includes("rlms_apply_jsonb_patch(") || v2.includes("md5(pg_get_functiondef('public.rlms_apply_jsonb_patch'"), "v2 does not replace rlms_apply_jsonb_patch");
ok(!v2.includes("create or replace function public.rlms_undo_change_group"), "v2 does not replace the frozen undo");
ok(v2down.includes("have no opportunity; link or delete them first"), "down refuses null opportunities with a count");
ok(v2down.includes("create or replace function public.rlms_undo_deal_calc_group"), "down recreates the p1 deal-calc undo");
ok(routeSrc.includes('"/api/deal-calc/scenarios"') && /\/api\/deal-calc\/scenarios", async[\s\S]*?requireWrite/.test(routeSrc), "standalone list is requireWrite");
ok(routeSrc.includes('"/api/deal-calc/scenarios/:sid/link"') && routeSrc.includes('"/api/deal-calc/scenarios/:sid/unlink"'), "link and unlink routes exist");
ok(routeSrc.includes("create-opportunity") && routeSrc.includes("requireWrite"), "create opportunity from calc is requireWrite");
ok(undoSrc.includes("rlms_undo_calc_create_opp") && undoSrc.includes("previewUndo(otherGroup"), "undo previews both groups and calls the wrapper");
ok(!undoSrc.includes("linkedGroupDirectUndoStatus"), "the unused direct-half helper is gone");
ok(serverSrc.includes('.rpc("rlms_create_opp_from_calc"'), "create opportunity from calc is one database call");
ok(!serverSrc.includes("callUndoChangeGroup") && !serverSrc.includes("callUndoCalcCreateOpp"), "create opportunity does not roll back in JavaScript");
ok(v2.includes("create or replace function public.rlms_create_opp_from_calc"), "v2 defines the create-opportunity function");
ok(v2.includes("revoke all on function public.rlms_create_opp_from_calc(text, uuid, uuid, jsonb, jsonb, bigint, jsonb) from public, anon, authenticated"), "create-opportunity execute is revoked from public roles");
ok(v2.includes("has_function_privilege('public', 'public.rlms_create_opp_from_calc(text,uuid,uuid,jsonb,jsonb,bigint,jsonb)', 'execute')"), "v2 post-checks public cannot execute the create function");
ok(v2down.includes("drop function if exists public.rlms_create_opp_from_calc(text, uuid, uuid, jsonb, jsonb, bigint, jsonb)"), "down drops the create-opportunity function");
ok(serverSrc.includes("scenarioWriteRefusal") && serverSrc.includes("An unlinked scenario cannot be pinned"), "link uses the closed-line guard and unlinked pin is 400");
ok(!serverSrc.includes("master_leases") && !v2.includes("master_leases"), "deal calc v2 does not touch lease tables");
ok(down.includes("down refused"), "down refuses when data exists");
ok(down.includes("drop function if exists public.rlms_undo_deal_calc_group(uuid, text)"), "down drops the deal-calc undo function");
ok(down.includes("66be7d422ec47e8c711f83c8ca001c79"), "down re-checks the md5 guard");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
