/* eslint-disable no-console */
/** Run: npx tsx shared/dealCalc.test.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AAR_CAP_YEARS,
  applyAssumptionSetCosts,
  clampUsefulLife,
  companyDefaultInputs,
  days360Us,
  dealCalc,
  excelPv,
  inferCarTypeClass,
  lifeDefaultForClass,
  maxBidAtRate,
  normalizeInputs,
  parseYmd,
  portfolioRollup,
  scrapFloorPerCar,
  STORAGE_DAYS_PER_MONTH,
  type DealCalcInputs,
} from "./dealCalc";
import { applyScenarioUndo, planPin, planSoftDelete, type ScenarioSlot } from "./dealCalcUndo";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function near(actual: number | null | undefined, expected: number, tol: number, label: string) {
  const delta = actual == null ? Number.POSITIVE_INFINITY : Math.abs(actual - expected);
  ok(delta <= tol, `${label}: ${actual} vs ${expected} (Δ ${Number.isFinite(delta) ? delta : "∞"})`);
}

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "../tests/fixtures/bflx_wayne.json"), "utf8")) as {
  settings: {
    closeDate: string;
    firstRentDate: string;
    debtBase: number;
    spreadBps: number;
    equityReturn: number;
    debtClosePct: number;
    txnCostPct: number;
    leverageTarget: number;
    usefulLifeYears: number;
    scrapPerCar: number;
    discountRate: number;
  };
  deals: Array<{
    deal: string;
    cars: number;
    rent: number;
    rv: number;
    expiry: string;
    buildYear: number;
    n: number;
    bidPerCar: number;
    acqPerCar: number;
    irr: number;
  }>;
};

function wayneInputs(deal: (typeof fixture.deals)[number], patch?: Partial<DealCalcInputs>): DealCalcInputs {
  const base = companyDefaultInputs();
  const settings = fixture.settings;
  const inputs: DealCalcInputs = {
    ...base,
    dealType: { value: "portfolio_bid", source: "line" },
    method: { value: "both", source: "default" },
    closeDate: { value: settings.closeDate, source: "line" },
    firstRentDate: { value: settings.firstRentDate, source: "default" },
    carCount: { value: deal.cars, source: "line" },
    avgBuildYear: { value: deal.buildYear, source: "line" },
    monthlyRent: { value: deal.rent, source: "line" },
    leaseExpiry: { value: deal.expiry, source: "line" },
    usefulLifeYears: { value: settings.usefulLifeYears, source: "default" },
    postLeasePlan: { value: "sell", source: "default" },
    sell: {
      endValuePerCar: { value: deal.rv, source: "user" },
      scrapPerCar: { value: settings.scrapPerCar, source: "default" },
    },
    targetIrr: { value: 0.105, source: "default" },
    stretchIrr: { value: 0.09, source: "default" },
    discountRate: { value: settings.discountRate, source: "default" },
    wayne: {
      debtBase: { value: settings.debtBase, source: "default" },
      spreadBps: { value: settings.spreadBps, source: "default" },
      equityReturn: { value: settings.equityReturn, source: "default" },
      debtClosePct: { value: settings.debtClosePct, source: "default" },
      txnCostPct: { value: settings.txnCostPct, source: "default" },
      leverageTarget: { value: settings.leverageTarget, source: "default" },
    },
    testPricePerCar: { value: null, source: "default" },
    ...patch,
  };
  return inputs;
}

const start = parseYmd("2026-01-31");
const end = parseYmd("2026-02-28");
ok(start != null && end != null && days360Us(start, end) === 30, "DAYS360 US last-day January to February is 30");
ok(days360Us(parseYmd("2026-01-30")!, parseYmd("2026-03-31")!) === 60, "DAYS360 US 30th to month-end is 60");
ok(days360Us(parseYmd("2026-08-01")!, parseYmd("2038-07-01")!) === 4290, "DAYS360 of BFLX deal 1 term is 4290");

const pv = excelPv(0.0762 / 12, 143, -576.89, 0, 1);
near(pv, 54446.80335813236, 0.02, "Excel PV of deal 1 net rent");

const rollupItems = [];
for (const deal of fixture.deals) {
  const result = dealCalc(wayneInputs(deal), { today: "2026-10-20" });
  ok(result.calcVersion === "v2", `deal ${deal.deal} stores calc version`);
  near(result.nMonths, deal.n, 1e-9, `deal ${deal.deal} payment count`);
  ok(result.wayne != null, `deal ${deal.deal} has a Wayne result`);
  near(result.wayne?.bidPerCar, deal.bidPerCar, 1, `deal ${deal.deal} Wayne bid per car`);
  near(result.wayne?.irr, deal.irr, 0.0001, `deal ${deal.deal} unlevered IRR`);
  if (deal.deal === "1") near(result.wayne?.balloon ?? 0, 0, 1e-6, "deal 1 balloon is zero");
  const operating = result.wayne?.unleveredCashFlows.slice() ?? [];
  if (operating.length) operating[0] += result.wayne?.acqPerCar ?? 0;
  near(maxBidAtRate(operating, deal.irr, 0, 0), deal.acqPerCar, 5, `deal ${deal.deal} cash-flow round trip to acquisition cost`);
  rollupItems.push({
    label: deal.deal,
    cars: deal.cars,
    wayneBidPerCar: result.wayne?.bidPerCar ?? null,
    cashMaxBidPerCar: result.cash.maxBidPerCar,
    netRent: result.wayne?.netRent ?? null,
    endValue: deal.rv,
    debtPerCar: result.wayne?.debt ?? null,
    acqPerCar: result.wayne?.acqPerCar ?? null,
    irr: result.wayne?.irr ?? null,
    cashFlowStart: result.firstRentDate,
    monthlyCashFlows: result.wayne?.unleveredCashFlows ?? [],
  });
}

const portfolio = portfolioRollup(rollupItems);
ok(portfolio.cars === 3174, `portfolio cars ${portfolio.cars}`);
near(portfolio.wayneBid, 173_457_389, 100, "portfolio Wayne bid");
near(portfolio.irr, 0.1047, 0.0001, "portfolio unlevered IRR");
near(portfolio.avgNetRent, 503.59, 0.01, "portfolio average net rent");
near(portfolio.avgEndValue, 51377.13, 0.01, "portfolio average RV");
near(portfolio.leverage, 0.809, 0.001, "portfolio leverage");

const sample = dealCalc(wayneInputs(fixture.deals[0]), { today: "2026-10-20" });
const higherRent = dealCalc(wayneInputs(fixture.deals[0], {
  monthlyRent: { value: fixture.deals[0].rent * 1.1, source: "user" },
}), { today: "2026-10-20" });
ok(
  (higherRent.cash.maxBidPerCar ?? 0) > (sample.cash.maxBidPerCar ?? 0),
  "higher rent raises the max bid",
);

const sell = sample;
const relet = dealCalc(wayneInputs(fixture.deals[0], {
  postLeasePlan: { value: "relet", source: "user" },
  relet: {
    ...companyDefaultInputs().relet,
    endValuePerCar: { value: fixture.deals[0].rv, source: "user" },
  },
}), { today: "2026-10-20" });
ok((relet.cash.maxBidPerCar ?? 0) < (sell.cash.maxBidPerCar ?? 0), "re-let with idle time bids less than selling at the same RV");

const scrap = dealCalc(wayneInputs({ ...fixture.deals[0], buildYear: 1970, rv: 60000 }), { today: "2026-10-20" });
ok(scrap.flags.some((flag) => flag.includes("useful life")), "useful life reached is flagged");
ok((scrap.cash.maxBidPerCar ?? 0) < (sell.cash.maxBidPerCar ?? 0), "scrap replaces a higher end value when life is reached");

const withCosts = dealCalc(wayneInputs(fixture.deals[0], {
  overheadPcpm: { value: 10, source: "user" },
}), { today: "2026-10-20" });
const zeroCosts = dealCalc(wayneInputs(fixture.deals[0], {
  overheadPcpm: { value: 0, source: "user" },
  insurancePcpm: { value: 0, source: "user" },
  propTaxPcpm: { value: 0, source: "user" },
  mgmtFeePct: { value: 0, source: "user" },
  maintPcpm: { value: 0, source: "user" },
}), { today: "2026-10-20" });
near(zeroCosts.cash.maxBidPerCar, sample.cash.maxBidPerCar, 0.01, "optional costs at zero do not move the max bid");
ok((withCosts.cash.maxBidPerCar ?? 0) < (sample.cash.maxBidPerCar ?? 0), "overhead lowers the max bid");

const rich = dealCalc(wayneInputs(fixture.deals[0], {
  testPricePerCar: { value: 50000, source: "user" },
}), { today: "2026-10-20" });
ok(rich.verdict === "bid", "a low test price at a high IRR is a bid");
const stretchy = dealCalc(wayneInputs(fixture.deals[1], {
  testPricePerCar: { value: null, source: "default" },
  method: { value: "wayne_leveraged", source: "user" },
}), { today: "2026-10-20" });
ok(stretchy.verdict === "stretch", "deal 2 Wayne IRR is a stretch against 10.5%");
const passedDeal = dealCalc(wayneInputs(fixture.deals[0], {
  testPricePerCar: { value: 120000, source: "user" },
}), { today: "2026-10-20" });
ok(passedDeal.verdict === "pass", "a price far above the max bid is a pass");
const negativeNpv = dealCalc(wayneInputs(fixture.deals[0], {
  testPricePerCar: { value: fixture.deals[0].bidPerCar, source: "user" },
  discountRate: { value: 0.5, source: "user" },
}), { today: "2026-10-20" });
ok(negativeNpv.verdict === "pass" && negativeNpv.reasons.some((reason) => reason.includes("NPV")), "negative NPV forces a pass");

const closed = dealCalc(wayneInputs(fixture.deals[0]), { today: "2026-10-20" });
near(
  dealCalc(wayneInputs(fixture.deals[0], { targetIrr: { value: closed.cash.irr ?? 0.105, source: "user" } }), { today: "2026-10-20" }).cash.maxBidPerCar,
  closed.cash.maxBidPerCar,
  5,
  "max bid at the solved IRR round-trips",
);

function slot(id: number, isPinned: boolean, deletedAt: string | null): ScenarioSlot {
  return { id, opportunityId: 7, lineId: null, isPinned, deletedAt };
}

const deletedAt = "2026-10-20T12:00:00.000Z";
const beforeDelete = [slot(1, true, null), slot(2, false, null)];
const deletePatches = planSoftDelete(beforeDelete[0], deletedAt, 10);
ok(deletePatches[0]?.before.isPinned === true && deletePatches[1]?.after.deletedAt === deletedAt, "delete records unpin before deleted_at");
const afterDeleteAndPin = [slot(1, false, deletedAt), slot(2, true, null)];
const restored = applyScenarioUndo(afterDeleteAndPin, deletePatches);
const restoredA = restored.find((row) => row.id === 1);
const restoredB = restored.find((row) => row.id === 2);
ok(restoredA?.deletedAt == null && restoredA.isPinned === false, "undo of a pinned delete brings A back unpinned");
ok(restoredB?.isPinned === true && restoredB.deletedAt == null, "B stays pinned after A's delete is undone");

const pinPatches = planPin([slot(1, true, null), slot(2, false, null)], 2, 30);
ok(pinPatches[0]?.rowId === 1 && pinPatches[0].after.isPinned === false, "pin unpins the current row first");
ok(pinPatches[1]?.rowId === 2 && pinPatches[1].after.isPinned === true, "pin then pins the target");
const afterPin = [slot(1, false, null), slot(2, true, null)];
const unpinned = applyScenarioUndo(afterPin, pinPatches);
ok(unpinned.find((row) => row.id === 1)?.isPinned === true, "undo of a pin swap restores A");
ok(unpinned.find((row) => row.id === 2)?.isPinned === false, "undo of a pin swap clears B");
const pinnedCount = unpinned.filter((row) => row.isPinned && !row.deletedAt).length;
ok(pinnedCount === 1, "undo of a pin swap never leaves two pins");

ok(lifeDefaultForClass("covered_hopper") === 45, "covered hopper life default is 45");
ok(lifeDefaultForClass("gondola") === 45, "gondola life default is 45");
ok(lifeDefaultForClass("boxcar") === 40, "boxcar life default is 40");
ok(lifeDefaultForClass("gs_tank") === 40, "general-service tank life default is 40");
ok(lifeDefaultForClass("pressure_tank") === 45, "pressure tank life default is 45");
ok(lifeDefaultForClass("other") === 40, "other car life default is 40");
ok(inferCarTypeClass("40' Plate C boxcar", "A203") === "boxcar", "boxcar class from type and AAR");
ok(inferCarTypeClass("Covered hopper", "C112") === "covered_hopper", "covered hopper class");
ok(inferCarTypeClass("General service tank", "T108") === "gs_tank", "general-service tank class");
ok(inferCarTypeClass("Pressure tank", "T789") === "pressure_tank", "pressure tank class");
ok(clampUsefulLife(55).life === AAR_CAP_YEARS && clampUsefulLife(55).clamped, "life 55 clamps to the 50-year cap");
ok(clampUsefulLife(40).life === 40 && !clampUsefulLife(40).clamped, "life 40 stays 40");

const capped = dealCalc(wayneInputs(fixture.deals[0], {
  usefulLifeYears: { value: 55, source: "user" },
}), { today: "2026-10-20" });
ok(capped.valuation.lifeYears === 50 && capped.valuation.lifeClamped, "a 55-year life is clamped on the result");
ok(capped.flags.some((flag) => flag.includes("clamped to 50")), "clamping warns the user");

function valued(patch: Partial<DealCalcInputs>): DealCalcInputs {
  return wayneInputs(fixture.deals[0], {
    carType: { value: "Covered hopper", source: "user" },
    carTypeClass: { value: "covered_hopper", source: "user" },
    buildDate: { value: "1982-06", source: "user" },
    avgBuildYear: { value: 1982, source: "user" },
    tareLb: { value: 63000, source: "user" },
    newCarCostPerCar: { value: 150000, source: "user" },
    depreciationBasis: { value: "replacement", source: "user" },
    usefulLifeYears: { value: 45, source: "user" },
    ...patch,
  });
}

const hopper = dealCalc(valued({}), { today: "2026-10-20" });
ok(hopper.valuation.basisBadge === "Replacement (manual)", "a typed new-car cost is Replacement (manual)");
ok(hopper.valuation.ageAtClose != null && hopper.valuation.valueAtClose != null, "covered hopper shows value at close");
ok(hopper.valuation.valueAtExpiry != null, "covered hopper shows value at expiry");
ok(hopper.valuation.scrapFloor != null && (hopper.valuation.valueAtClose ?? 0) >= hopper.valuation.scrapFloor - 1e-6, "value does not drop below the scrap floor");
const historical = dealCalc(valued({
  depreciationBasis: { value: "historical", source: "user" },
  oecPerCar: { value: 80000, source: "user" },
  newCarCostPerCar: { value: null, source: "user" },
}), { today: "2026-10-20" });
ok(historical.valuation.basisBadge === "Historical OEC", "an OEC basis badge says Historical OEC");
const fromSet = dealCalc(valued({
  depreciationBasis: { value: null, source: "default" },
  newCarCostPerCar: { value: 150000, source: "company" },
  oecPerCar: { value: null, source: "default" },
}), { today: "2026-10-20" });
ok(fromSet.valuation.basisBadge === "Replacement (assumption-set default)", "a cost from the assumption set is labeled that way");
const noBasis = dealCalc(wayneInputs(fixture.deals[0]), { today: "2026-10-20" });
ok(noBasis.valuation.basisBadge == null && noBasis.valuation.valueAtClose == null, "no basis and no cost leaves depreciation blank");
ok(noBasis.cash.maxBidPerCar === sample.cash.maxBidPerCar && noBasis.wayne?.bidPerCar === sample.wayne?.bidPerCar, "a blank-cost run matches the fixture");

const costedInputs = applyAssumptionSetCosts(wayneInputs(fixture.deals[0], {
  carType: { value: "Boxcar", source: "line" },
  carTypeClass: { value: "boxcar", source: "default" },
}), { boxcar: 140000, covered_hopper: 120000 });
const withCostResult = dealCalc(costedInputs, { today: "2026-10-20" });
near(withCostResult.wayne?.bidPerCar, sample.wayne?.bidPerCar, 1, "assumption-set costs do not move a typed residual");
near(withCostResult.cash.maxBidPerCar, sample.cash.maxBidPerCar, 1, "assumption-set costs do not move the cash bid when the end value is typed");
const blankEnd = dealCalc(applyAssumptionSetCosts(wayneInputs(fixture.deals[0], {
  sell: { endValuePerCar: { value: null, source: "default" }, scrapPerCar: { value: 7000, source: "default" } },
  carType: { value: "Boxcar", source: "line" },
  carTypeClass: { value: "boxcar", source: "default" },
}), { boxcar: 140000 }), { today: "2026-10-20" });
ok(blankEnd.valuation.endValueSource === "sl" && blankEnd.valuation.valueAtExpiry != null, "a blank end value uses straight-line once a cost is on the scenario");
ok((blankEnd.cash.maxBidPerCar ?? 0) !== (sample.cash.maxBidPerCar ?? 0), "straight-line end value is what the cash bid uses");

const nullTare = dealCalc(valued({ tareLb: { value: null, source: "user" } }), { today: "2026-10-20" });
ok(nullTare.valuation.scrapFloor == null, "null tare leaves the scrap floor blank");
const tankClean = scrapFloorPerCar({ tareLb: 67200, scrapPerGrossTon: 348, dismantleHaulPerCar: 1500, tankCleaningPerCar: 4000, isTank: true });
const hopperClean = scrapFloorPerCar({ tareLb: 67200, scrapPerGrossTon: 348, dismantleHaulPerCar: 1500, tankCleaningPerCar: 4000, isTank: false });
ok(tankClean != null && hopperClean != null && tankClean < hopperClean, "tank cleaning is in the floor only for a tank");
const tankResult = dealCalc(valued({
  carTypeClass: { value: "gs_tank", source: "user" },
  carType: { value: "Tank", source: "user" },
  tankPreScrapCleaningPerCar: { value: 4000, source: "user" },
  tareLb: { value: 67200, source: "user" },
}), { today: "2026-10-20" });
const keptCleaning = dealCalc(valued({
  carTypeClass: { value: "covered_hopper", source: "user" },
  tankPreScrapCleaningPerCar: { value: 4000, source: "user" },
  tareLb: { value: 67200, source: "user" },
}), { today: "2026-10-20" });
ok(tankResult.valuation.isTank && keptCleaning.valuation.scrapFloor != null && tankResult.valuation.scrapFloor != null && tankResult.valuation.scrapFloor < keptCleaning.valuation.scrapFloor, "changing away from tank keeps the cleaning number out of the floor");

const floorBinds = dealCalc(valued({
  newCarCostPerCar: { value: 20000, source: "user" },
  usefulLifeYears: { value: 40, source: "user" },
  buildDate: { value: "2000-01", source: "user" },
  avgBuildYear: { value: 2000, source: "user" },
}), { today: "2026-10-20" });
ok(floorBinds.valuation.scrapFloor != null && floorBinds.valuation.valueAtExpiry === floorBinds.valuation.scrapFloor, "the scrap floor binds when straight-line falls through it");

function boundary(build: string, expiry: string, plan: "sell" | "relet"): DealCalcInputs {
  return valued({
    buildDate: { value: build, source: "user" },
    avgBuildYear: { value: Number(build.slice(0, 4)), source: "user" },
    closeDate: { value: "2025-12-01", source: "user" },
    firstRentDate: { value: "2026-01-01", source: "user" },
    leaseExpiry: { value: expiry, source: "user" },
    usefulLifeYears: { value: 50, source: "user" },
    newCarCostPerCar: { value: 100000, source: "user" },
    sell: { endValuePerCar: { value: null, source: "default" }, scrapPerCar: { value: 7000, source: "default" } },
    postLeasePlan: { value: plan, source: "user" },
    relet: {
      ...companyDefaultInputs().relet,
      endValuePerCar: { value: null, source: "default" },
      termMonths: { value: 60, source: "user" },
      idleMonths: { value: 0, source: "user" },
    },
  });
}
const under = dealCalc(boundary("1976-01-01", "2025-11-30", "sell"), { today: "2026-10-20" });
const atCap = dealCalc(boundary("1976-01-01", "2026-01-01", "sell"), { today: "2026-10-20" });
ok((under.valuation.ageAtExpiry ?? 0) < 50 && (under.valuation.valueAtExpiry ?? 0) >= (under.valuation.scrapFloor ?? 0), "age just under 50 uses max of straight-line and the floor");
ok((atCap.valuation.ageAtExpiry ?? 0) >= 50 && atCap.valuation.valueAtExpiry === atCap.valuation.scrapFloor, "age at 50 uses the scrap floor");
const forced = dealCalc(boundary("1976-01-01", "2026-02-01", "relet"), { today: "2026-10-20" });
ok(forced.valuation.forcedSell && forced.flags.some((flag) => flag.includes("past AAR limit at expiry")), "a re-let already past the cap is forced to sell");
const cut = dealCalc(boundary("1976-01-01", "2025-06-01", "relet"), { today: "2026-10-20" });
ok(cut.valuation.reletRunsPastLimit && cut.flags.some((flag) => flag.includes("re-let runs past limit")), "a re-let that would pass the cap is cut");

const legacyStorage = normalizeInputs({
  monthlyRent: { value: 500, source: "user" },
  closeDate: { value: "2026-07-31", source: "user" },
  firstRentDate: { value: "2026-08-01", source: "user" },
  leaseExpiry: { value: "2030-06-30", source: "user" },
  sell: { endValuePerCar: { value: 20000, source: "user" } },
  relet: { storagePerCarMonth: { value: 12.5, source: "user" }, idleMonths: { value: 3, source: "user" } },
  postLeasePlan: { value: "relet", source: "user" },
});
ok(legacyStorage.relet.storagePerCarMonth.value === 12.5, "the original monthly storage is kept");
ok(Math.abs(legacyStorage.relet.storagePerCarDay.value - 12.5 / STORAGE_DAYS_PER_MONTH) < 1e-12, "day storage is the unrounded month divided by 30.4");
const legacyRun = dealCalc(legacyStorage, { today: "2026-10-20" });
const replay = dealCalc({
  ...legacyStorage,
  relet: { ...legacyStorage.relet, storagePerCarMonth: { value: 12.5, source: "user" } },
}, { today: "2026-10-20" });
near(replay.cash.irr, legacyRun.cash.irr, 1e-12, "keeping the monthly storage round-trips IRR");
near(replay.cash.maxBidPerCar, legacyRun.cash.maxBidPerCar, 1e-6, "keeping the monthly storage round-trips the max bid");
const dayOnly = dealCalc(normalizeInputs({
  ...legacyStorage,
  relet: { idleMonths: { value: 3, source: "user" }, storagePerCarDay: { value: 1, source: "user" } },
}), { today: "2026-10-20" });
ok(Math.abs((dayOnly.inputs.relet.storagePerCarMonth.value) - STORAGE_DAYS_PER_MONTH) < 1e-9, "a new day rate becomes day times 30.4");

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
