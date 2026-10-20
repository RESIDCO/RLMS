/**
 * Pure request/response helpers for the deal calculator API.
 * The server recomputes from inputs and never reads a client results payload.
 */

import {
  CALC_VERSION,
  dealCalc,
  npvAt,
  normalizeInputs,
  type CalcMethod,
  type DealCalcInputs,
  type DealCalcResult,
  type DealType,
  type PostLeasePlan,
  type Verdict,
} from "./dealCalc";

export const VIEWER_SCENARIO_KEYS = [
  "id",
  "name",
  "opportunity_line_id",
  "deal_type",
  "method",
  "post_lease_plan",
  "is_pinned",
  "created_at",
] as const;

export type ViewerScenarioKey = (typeof VIEWER_SCENARIO_KEYS)[number];

export type ApplyPriceField = "prelim" | "final";
export type ApplyPriceWhich = "max" | "stretch" | "wayne";

export type ScenarioColumns = {
  deal_type: DealType;
  method: CalcMethod;
  post_lease_plan: PostLeasePlan;
  calc_version: typeof CALC_VERSION;
  verdict: Verdict;
  target_irr: number;
  stretch_irr: number;
  max_bid_per_car: number | null;
  wayne_bid_per_car: number | null;
  irr: number | null;
  npv: number | null;
};

export function inputsIgnoringClientResults(body: Record<string, unknown>): unknown {
  const rest = { ...body };
  delete rest.results;
  return rest.inputs;
}

function money(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function rate(value: number | null | undefined, places: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function headlineColumns(result: DealCalcResult): ScenarioColumns {
  return {
    deal_type: result.inputs.dealType.value,
    method: result.inputs.method.value,
    post_lease_plan: result.inputs.postLeasePlan.value,
    calc_version: result.calcVersion,
    verdict: result.verdict,
    target_irr: rate(result.inputs.targetIrr.value, 4) ?? 0.105,
    stretch_irr: rate(result.inputs.stretchIrr.value, 4) ?? 0.09,
    max_bid_per_car: money(result.cash.maxBidPerCar),
    wayne_bid_per_car: money(result.wayne?.bidPerCar ?? null),
    irr: rate(result.priceBasis === "wayne_bid" ? result.wayne?.irr ?? null : result.cash.irr, 5),
    npv: money(result.priceBasis === "wayne_bid" ? null : result.cash.npv),
  };
}

/** Legacy Bid Model headline NPV is the discount of the unlevered flows, which are monthlyCashFlows. */
export function storedNpv(result: DealCalcResult): number | null {
  if (result.priceBasis === "wayne_bid") {
    if (!result.monthlyCashFlows.length) return null;
    return money(npvAt(result.inputs.discountRate.value / 12, result.monthlyCashFlows));
  }
  return money(result.cash.npv);
}

export function calculatedScenario(inputs: unknown): {
  inputs: DealCalcInputs;
  result: DealCalcResult;
  columns: ScenarioColumns;
} {
  const normalized = normalizeInputs(inputs);
  const result = dealCalc(normalized);
  const columns = headlineColumns(result);
  columns.npv = storedNpv(result);
  return { inputs: normalized, result, columns };
}

export function presentScenarioList<T extends Record<string, unknown>>(
  rows: T[],
  canSeeNumbers: boolean,
): { numbersHidden: boolean; scenarios: Array<Partial<T> & Record<string, unknown>> } {
  if (canSeeNumbers) return { numbersHidden: false, scenarios: rows };
  return {
    numbersHidden: true,
    scenarios: rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const key of VIEWER_SCENARIO_KEYS) out[key] = row[key] ?? null;
      return out as Partial<T> & Record<string, unknown>;
    }),
  };
}

export function opportunityIsClosed(stage: string | null | undefined, outcome: string | null | undefined): boolean {
  if (outcome === "won" || outcome === "lost" || outcome === "passed") return true;
  return stage === "won" || stage === "lost";
}

export function priceForWhich(result: DealCalcResult, which: ApplyPriceWhich): number | null {
  switch (which) {
    case "max":
      return money(result.cash.maxBidPerCar);
    case "stretch":
      return money(result.cash.stretchBidPerCar);
    case "wayne":
      return money(result.wayne?.bidPerCar ?? null);
    default: {
      const neverWhich: never = which;
      return neverWhich;
    }
  }
}

export function applyPriceFieldName(field: ApplyPriceField): "prelim_price_per_car" | "final_price_per_car" {
  switch (field) {
    case "prelim":
      return "prelim_price_per_car";
    case "final":
      return "final_price_per_car";
    default: {
      const neverField: never = field;
      return neverField;
    }
  }
}

export function parseApplyPriceChoice(body: { field?: unknown; which?: unknown }): {
  field: ApplyPriceField;
  which: ApplyPriceWhich;
} | null {
  const field = body.field === "prelim" || body.field === "final" ? body.field : null;
  const which = body.which === "max" || body.which === "stretch" || body.which === "wayne" ? body.which : null;
  if (!field || !which) return null;
  return { field, which };
}

export type ApplyPriceRefusal = { status: number; message: string };

export function applyPriceRefusal(input: {
  scenarioLineId: number | null;
  line: { deleted_at: string | null; outcome: string | null } | null;
  opportunityStage: string | null;
  opportunityOutcome: string | null;
  price: number | null;
}): ApplyPriceRefusal | null {
  if (input.scenarioLineId == null) return { status: 400, message: "Scenario is not tied to a line" };
  if (!input.line || input.line.deleted_at) return { status: 409, message: "Line is deleted" };
  if (input.line.outcome != null) return { status: 409, message: "Line already has an outcome" };
  if (opportunityIsClosed(input.opportunityStage, input.opportunityOutcome)) {
    return { status: 409, message: "Opportunity is closed" };
  }
  if (input.price == null) return { status: 400, message: "No price for that choice" };
  return null;
}

export function usePriceDisabledReason(input: {
  lineId: number | null;
  linePresent: boolean;
  lineOutcome: string | null;
  opportunityStage: string | null;
  opportunityOutcome: string | null;
}): string | null {
  if (input.lineId == null) return "Pick a line-level scenario before writing a price";
  if (!input.linePresent) return "Line is deleted";
  if (input.lineOutcome != null) return "Line already has an outcome";
  if (opportunityIsClosed(input.opportunityStage, input.opportunityOutcome)) return "Opportunity is closed";
  return null;
}

export function pinnedBidFigure(row: {
  method: string;
  max_bid_per_car: number | null;
  wayne_bid_per_car: number | null;
}): number | null {
  if (row.method === "cash_flow") return row.max_bid_per_car;
  return row.wayne_bid_per_car ?? row.max_bid_per_car;
}

/** User-facing name for the leveraged method. The stored value stays wayne_leveraged. */
export const LEGACY_BID_MODEL_LABEL = "Legacy Bid Model";

export function calcMethodLabel(method: string): string {
  switch (method) {
    case "wayne_leveraged":
      return LEGACY_BID_MODEL_LABEL;
    case "cash_flow":
      return "Cash flow";
    case "both":
      return "Both";
    default:
      return method;
  }
}

export function applyPriceWhichLabel(which: string): string {
  if (which === "wayne") return LEGACY_BID_MODEL_LABEL;
  return which;
}
