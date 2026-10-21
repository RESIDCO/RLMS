import {
  addMonths,
  companyDefaultInputs,
  formatYmd,
  parseYmd,
  type DealCalcInputs,
  type DealCalcResult,
} from "./dealCalc";
import { LEGACY_BID_MODEL_LABEL } from "./dealCalcApi";

/** Scratch mode starts from the company default. Nothing is stored. */
export function scratchInputs(company?: DealCalcInputs | null): DealCalcInputs {
  return structuredClone(company ?? companyDefaultInputs());
}

/** Percent shocks for the what-if sliders. Does not change the original inputs. */
export function applyWhatIf(
  inputs: DealCalcInputs,
  shock: { rentPct: number; endValuePct: number },
): DealCalcInputs {
  const next = structuredClone(inputs);
  const rent = next.monthlyRent.value ?? 0;
  next.monthlyRent = { value: rent * (1 + shock.rentPct), source: "user" };
  if (next.postLeasePlan.value === "relet") {
    const end = next.relet.endValuePerCar.value ?? 0;
    next.relet = {
      ...next.relet,
      endValuePerCar: { value: end * (1 + shock.endValuePct), source: "user" },
    };
  } else {
    const end = next.sell.endValuePerCar.value ?? 0;
    next.sell = {
      ...next.sell,
      endValuePerCar: { value: end * (1 + shock.endValuePct), source: "user" },
    };
  }
  return next;
}

/** Body for the existing opportunity scenario create route. The server recomputes results. */
export function saveScenarioPayload(args: {
  name: string;
  notes: string;
  inputs: DealCalcInputs;
  opportunityLineId: number | null;
}): {
  name: string;
  notes: string;
  inputs: DealCalcInputs;
  opportunity_line_id: number | null;
} {
  return {
    name: args.name.trim() || "Scratch scenario",
    notes: args.notes,
    inputs: args.inputs,
    opportunity_line_id: args.opportunityLineId,
  };
}

export type SheetRows = Array<Array<string | number | null>>;

export function dealCalcExportSheets(name: string, result: DealCalcResult): { summary: SheetRows; cashFlow: SheetRows } {
  const summary: SheetRows = [
    ["Scenario", name],
    ["Verdict", result.verdict],
    ["Calc version", result.calcVersion],
    ["Cars", result.carCount],
    ["Months", result.nMonths],
    ["Cash max bid / car", result.cash.maxBidPerCar],
    ["Cash stretch bid / car", result.cash.stretchBidPerCar],
    ["Cash IRR", result.cash.irr],
    ["Cash NPV", result.cash.npv],
    [`${LEGACY_BID_MODEL_LABEL} bid / car`, result.wayne?.bidPerCar ?? null],
    [`${LEGACY_BID_MODEL_LABEL} IRR`, result.wayne?.irr ?? null],
  ];
  for (const reason of result.reasons) summary.push(["Reason", reason]);
  summary.push(["Value at purchase vs at lease expiry", ""]);
  summary.push(["Value basis", result.valuation.basisBadge]);
  summary.push(["Value at purchase / car", result.valuation.valueAtClose]);
  summary.push(["Value at lease expiry / car", result.valuation.valueAtExpiry]);
  summary.push(["Value change / car", result.valuation.valueChange]);
  summary.push(["Scrap floor / car", result.valuation.scrapFloor]);
  summary.push(["AAR limit year", result.valuation.aarLimitYear]);
  summary.push(["Years of life left at expiry", result.valuation.yearsLeftAtExpiry]);
  summary.push(["Portfolio value at purchase", result.valuation.portfolio.valueAtPurchase]);
  summary.push(["Portfolio value at expiry", result.valuation.portfolio.valueAtExpiry]);
  summary.push(["Portfolio value decline", result.valuation.portfolio.totalDecline]);
  summary.push(["Price / value at purchase", result.valuation.portfolio.priceToValue]);
  const cashFlow: SheetRows = [["Month", "Date", "Cash flow / car"]];
  const start = parseYmd(result.cashFlowStart);
  result.monthlyCashFlows.forEach((flow, index) => {
    const date = start ? formatYmd(addMonths(start, index)) : result.cashFlowStart;
    cashFlow.push([index, date, flow]);
  });
  return { summary, cashFlow };
}
