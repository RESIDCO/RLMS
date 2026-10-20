/* eslint-disable no-console */
/** Run: npx tsx shared/dealCalcScratch.test.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { companyDefaultInputs, dealCalc } from "./dealCalc";
import { applyPriceWhichLabel, calcMethodLabel, LEGACY_BID_MODEL_LABEL } from "./dealCalcApi";
import { applyWhatIf, dealCalcExportSheets, saveScenarioPayload, scratchInputs } from "./dealCalcScratch";
import { DEAL_CALC_TOOLTIPS } from "./dealCalcTooltips";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const inputs = companyDefaultInputs();
inputs.monthlyRent = { value: 100, source: "user" };
inputs.sell.endValuePerCar = { value: 1000, source: "user" };
inputs.closeDate = { value: "2026-07-31", source: "user" };
inputs.firstRentDate = { value: "2026-08-01", source: "user" };
inputs.leaseExpiry = { value: "2028-06-30", source: "user" };

const copy = scratchInputs(inputs);
ok(copy.monthlyRent.value === 100 && copy !== inputs, "scratch inputs are a copy of the company default");
const same = applyWhatIf(inputs, { rentPct: 0, endValuePct: 0 });
ok(same.monthlyRent.value === 100 && inputs.monthlyRent.value === 100, "a zero what-if leaves the original rent");
const shocked = applyWhatIf(inputs, { rentPct: 0.25, endValuePct: -0.25 });
ok(shocked.monthlyRent.value === 125, "rent what-if scales the rent");
ok(shocked.sell.endValuePerCar.value === 750, "end-value what-if scales the sell value");
ok(inputs.sell.endValuePerCar.value === 1000, "what-if does not mutate the scenario");
const relet = applyWhatIf({
  ...inputs,
  postLeasePlan: { value: "relet", source: "user" },
  relet: { ...inputs.relet, endValuePerCar: { value: 500, source: "user" } },
}, { rentPct: 0, endValuePct: 0.1 });
ok(relet.relet.endValuePerCar.value === 550, "re-let what-if scales the re-let end value");

const body = saveScenarioPayload({ name: "  ", notes: "scratch", inputs, opportunityLineId: null });
ok(body.name === "Scratch scenario", "a blank name becomes Scratch scenario");
ok(body.opportunity_line_id === null, "save can omit the bid line");
ok(!("results" in body), "the save body does not send client results");
const lined = saveScenarioPayload({ name: "Deal 1", notes: "", inputs, opportunityLineId: 9 });
ok(lined.opportunity_line_id === 9 && lined.name === "Deal 1", "save keeps the chosen line");

const result = dealCalc(inputs);
const sheets = dealCalcExportSheets("Scratch", result);
ok(sheets.summary.some((row) => row[0] === "Verdict" && row[1] === result.verdict), "export includes the verdict");
ok(sheets.summary.some((row) => row[0] === `${LEGACY_BID_MODEL_LABEL} bid / car`), "export names the legacy bid");
ok(sheets.cashFlow.length === result.monthlyCashFlows.length + 1, "export includes every cash-flow month");
ok(!JSON.stringify(sheets).includes("Wayne"), "export has no Wayne label");

ok(calcMethodLabel("wayne_leveraged") === LEGACY_BID_MODEL_LABEL, "method toggle label is Legacy Bid Model");
ok(calcMethodLabel("cash_flow") === "Cash flow" && calcMethodLabel("both") === "Both", "other method labels stay");
ok(applyPriceWhichLabel("wayne") === LEGACY_BID_MODEL_LABEL, "price button label is Legacy Bid Model");
ok(applyPriceWhichLabel("max") === "max", "max price label stays");
for (const text of Object.values(DEAL_CALC_TOOLTIPS)) {
  ok(!text.includes("Wayne"), `tooltip has no Wayne: ${text.slice(0, 48)}`);
}
ok(Object.values(DEAL_CALC_TOOLTIPS).some((text) => text.includes(LEGACY_BID_MODEL_LABEL)), "a tooltip names the Legacy Bid Model");

const root = resolve(import.meta.dirname, "..");
const tab = readFileSync(resolve(root, "client/src/pages/opportunity/CalculatorTab.tsx"), "utf8");
const page = readFileSync(resolve(root, "client/src/pages/DealCalculator.tsx"), "utf8");
const app = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");
const layout = readFileSync(resolve(root, "client/src/components/AppLayout.tsx"), "utf8");
const opps = readFileSync(resolve(root, "client/src/pages/Opportunities.tsx"), "utf8");
ok(!/["'`]Wayne/.test(tab) && tab.includes("LEGACY_BID_MODEL_LABEL"), "calculator screen has no Wayne label");
ok(tab.includes("Save to opportunity") && tab.includes("saveScenarioPayload"), "scratch saves through the scenario payload");
ok(tab.includes('data-testid="calc-viewer"'), "viewers still get the numbers-hidden screen");
ok(page.includes("scratch") && page.includes("useCanEdit"), "standalone page is scratch and follows edit permission");
ok(app.indexOf('path="/opportunities/calculator"') >= 0 && app.indexOf('path="/opportunities/calculator"') < app.indexOf('path="/opportunities/:id"'), "calculator route is registered before the opportunity id route");
ok(layout.includes('href: "/opportunities/calculator"') && layout.includes('label: "Deal Calculator"'), "nav has Deal Calculator under Opportunities");
ok(opps.includes('href="/opportunities/calculator"'), "Opportunities page links to the calculator");
ok(!page.includes("CREATE TABLE") && !tab.includes("apply_migration"), "scratch mode adds no schema change");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
