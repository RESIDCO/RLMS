/* eslint-disable no-console */
/** Run: npx tsx shared/dealCalc.test.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  companyDefaultInputs,
  days360Us,
  dealCalc,
  excelPv,
  maxBidAtRate,
  parseYmd,
  portfolioRollup,
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
  ok(result.calcVersion === "dc-1.0.0", `deal ${deal.deal} stores calc version`);
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

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
