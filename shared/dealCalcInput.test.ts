/* eslint-disable no-console */
/** Run: npx tsx shared/dealCalcInput.test.ts */

import { blurDecimalText, commitDecimalText, isCompleteNumber } from "./dealCalcInput";
import { clearAllDealCalcDrafts, draftIsNewer, draftStorageKey, readDraft, writeDraft } from "./dealCalcDraft";
import { directHalfUndoRefusal, linkedUndoBlockedByFiles, routeUndoGroup } from "./dealCalcUndo";
import { presentCreateFromCalc, presentStandaloneScenarioList, scenarioWriteRefusal, stripScenarioPrices } from "./dealCalcApi";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const seven = commitDecimalText("7.8", 100);
ok(seven.commit && seven.value === 0.078 && seven.text === "7.8", "7.8 stores 0.078 and keeps the text");
const half = commitDecimalText(".5", 100);
ok(half.commit && half.value === 0.005 && half.text === ".5", ".5 stores 0.005");
const neg = commitDecimalText("-1.25", 100);
ok(neg.commit && neg.value === -0.0125 && neg.text === "-1.25", "-1.25 stores -0.0125");
const dotted = commitDecimalText("12.", 1);
ok(dotted.commit && dotted.value === 12 && dotted.text === "12.", "12. stores 12 and keeps the dot");
for (const text of ["", "-", ".", "-."]) {
  const next = commitDecimalText(text, 100);
  ok(!next.commit && next.value == null, `${JSON.stringify(text)} does not commit`);
  ok(!isCompleteNumber(text), `${JSON.stringify(text)} is not a complete number`);
}
const blurBlank = blurDecimalText({ text: "", committed: 0.078, scale: 100, allowNull: false });
ok(!blurBlank.commit && blurBlank.text === "7.8", "blank blur returns the last committed percent");
const blurNull = blurDecimalText({ text: "", committed: 12, scale: 1, allowNull: true });
ok(blurNull.commit && blurNull.value == null && blurNull.text === "", "blank blur of a nullable number commits null");

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
  get length() { return memory.size; },
  key: (index: number) => Array.from(memory.keys())[index] ?? null,
};
const key = draftStorageKey("user-1", "scratch");
ok(key === "rlms.dealcalc.draft.user-1.scratch", "draft key includes the user and scratch");
writeDraft(storage, key, { inputs: { rent: 1 }, name: "Hopper", notes: "", savedAt: "2026-10-21T15:00:00Z" });
ok(readDraft(storage, key)?.name === "Hopper", "draft round-trips");
ok(draftIsNewer("2026-10-21T15:00:00Z", "2026-10-21T14:00:00Z"), "a newer draft is offered");
ok(!draftIsNewer("2026-10-21T13:00:00Z", "2026-10-21T14:00:00Z"), "an older draft is not newer");
clearAllDealCalcDrafts(storage);
ok(readDraft(storage, key) == null, "logout clears calculator drafts");

const linkedRows = [
  { change_group: "calc", table_name: "deal_calc_scenarios", detail: { link_kind: "calc_create_opp", linked_group: "core", op: "insert" } },
];
const routed = routeUndoGroup(linkedRows);
ok(routed.kind === "wrapper" && routed.calcGroup === "calc" && routed.coreGroup === "core", "a linked scenario group routes to the wrapper");
const coreRoute = routeUndoGroup([
  { change_group: "core", table_name: "opportunities", detail: { link_kind: "calc_create_opp", linked_group: "calc", op: "insert" } },
]);
ok(coreRoute.kind === "wrapper" && coreRoute.calcGroup === "calc" && coreRoute.coreGroup === "core", "a linked opportunity group names both halves");
ok(routeUndoGroup([{ table_name: "deal_calc_scenarios", detail: { op: "update" } }]).kind === "deal_calc", "a plain scenario group stays on the deal-calc undo");
ok(directHalfUndoRefusal().status === 409 && directHalfUndoRefusal().error === "linked_group", "a direct half undo is 409 linked_group");
ok(linkedUndoBlockedByFiles([9], []), "a file outside the group blocks undo");
ok(!linkedUndoBlockedByFiles([9], [9]), "a file logged in the group does not block");

const stripped = stripScenarioPrices({
  max_bid_per_car: 10,
  irr: 0.1,
  results: { cash: 1 },
  inputs: {
    testPricePerCar: { value: 5, source: "user" },
    newCarCostPerCar: { value: 100, source: "user" },
    oecPerCar: { value: 80, source: "user" },
    newCarCostByClass: { boxcar: 90 },
    sell: { endValuePerCar: { value: 40, source: "user" } },
  },
});
ok(stripped.max_bid_per_car == null && stripped.irr == null && stripped.results == null, "prices and results are stripped");
const inputs = stripped.inputs as { testPricePerCar: { value: unknown }; newCarCostByClass: object; sell: { endValuePerCar: { value: unknown } } };
ok(inputs.testPricePerCar.value == null && inputs.sell.endValuePerCar.value == null, "test price and end value are stripped");
ok(Object.keys(inputs.newCarCostByClass).length === 0, "new-car costs by class are stripped");
ok(presentStandaloneScenarioList([{ max_bid_per_car: 1 }], false).numbersHidden, "the standalone list hides numbers");
const created = {
  opportunity_id: 7,
  line_id: 3,
  change_group: "calc",
  core_group: "core",
  calc_group: "calc",
  scenario: {
    id: 11,
    opportunity_id: 7,
    name: "Kept",
    max_bid_per_car: 10,
    wayne_bid_per_car: 9,
    irr: 0.12,
    npv: 4,
    target_irr: 0.1,
    stretch_irr: 0.14,
    results: { cash: 1 },
    inputs: {
      testPricePerCar: { value: 5, source: "user" },
      newCarCostPerCar: { value: 100, source: "user" },
      oecPerCar: { value: 80, source: "user" },
      newCarCostByClass: { boxcar: 90 },
      sell: { endValuePerCar: { value: 40, source: "user" } },
    },
  },
};
const hidden = presentCreateFromCalc(created, false);
const hiddenScenario = hidden.scenario as typeof created.scenario;
ok(hidden.opportunity_id === 7 && hidden.line_id === 3 && hidden.change_group === "calc", "a hidden create keeps the opportunity and group ids");
ok(hiddenScenario.id === 11 && hiddenScenario.opportunity_id === 7 && hiddenScenario.name === "Kept", "a hidden create keeps the scenario identity");
ok(hiddenScenario.max_bid_per_car == null && hiddenScenario.wayne_bid_per_car == null && hiddenScenario.irr == null && hiddenScenario.npv == null, "a hidden create strips bids, IRR, and NPV");
ok(hiddenScenario.results == null && hiddenScenario.target_irr == null && hiddenScenario.stretch_irr == null, "a hidden create strips results and target rates");
ok(hiddenScenario.inputs.testPricePerCar.value == null && hiddenScenario.inputs.newCarCostPerCar.value == null && hiddenScenario.inputs.oecPerCar.value == null, "a hidden create strips test price, new-car cost, and OEC");
ok(Object.keys(hiddenScenario.inputs.newCarCostByClass).length === 0 && hiddenScenario.inputs.sell.endValuePerCar.value == null, "a hidden create strips class costs and end value");
ok(created.scenario.max_bid_per_car === 10, "stripping a create response leaves the saved row unchanged");
const shown = presentCreateFromCalc(created, true);
ok(shown.scenario.max_bid_per_car === 10 && shown.scenario.results != null && shown === created, "a visible create returns the scenario prices");
ok(scenarioWriteRefusal({ opportunityStage: "won", opportunityOutcome: null, lineOutcome: null })?.status === 409, "a closed opportunity is refused");
ok(scenarioWriteRefusal({ opportunityStage: "proposal", opportunityOutcome: null, lineOutcome: "won" })?.message === "Line already has an outcome", "a decided line is refused");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
