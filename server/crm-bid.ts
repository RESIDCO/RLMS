import {
  isBidFlavor,
  isBidOutcome,
  isBidSubstage,
  PURCHASE_TYPE,
  type BidFlavor,
  type BidOutcome,
  type BidSubstage,
} from "@shared/crm-bid";
import { CrmHttpError } from "./crm-error";

const BID_TOUCH_KEYS = [
  "flavor",
  "outcome",
  "bid_substage",
  "seller_company_id",
  "broker_company_id",
  "offering_name",
  "received_date",
  "bid_due_prelim",
  "bid_due_final",
  "award_date",
  "stage",
  "type",
  "loss_reason",
] as const;

export function bidTouch(body: Record<string, unknown>): boolean {
  return BID_TOUCH_KEYS.some((key) => key in body);
}

function httpError(status: number, message: string): CrmHttpError {
  return new CrmHttpError(status, message);
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function dateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function positiveInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function mapBidColumns(row: Record<string, unknown>): {
  flavor: BidFlavor | null;
  outcome: BidOutcome | null;
  bid_substage: BidSubstage | null;
  seller_company_id: number | null;
  broker_company_id: number | null;
  offering_name: string | null;
  received_date: string | null;
  bid_due_prelim: string | null;
  bid_due_final: string | null;
  award_date: string | null;
} {
  const flavor = row.flavor == null || row.flavor === "" ? null : String(row.flavor);
  const outcome = row.outcome == null || row.outcome === "" ? null : String(row.outcome);
  const sub = row.bid_substage == null || row.bid_substage === "" ? null : String(row.bid_substage);
  return {
    flavor: isBidFlavor(flavor) ? flavor : null,
    outcome: isBidOutcome(outcome) ? outcome : null,
    bid_substage: isBidSubstage(sub) ? sub : null,
    seller_company_id: positiveInt(row.seller_company_id),
    broker_company_id: positiveInt(row.broker_company_id),
    offering_name: textOrNull(row.offering_name),
    received_date: dateOnly(row.received_date),
    bid_due_prelim: dateOnly(row.bid_due_prelim),
    bid_due_final: dateOnly(row.bid_due_final),
    award_date: dateOnly(row.award_date),
  };
}

/** Columns accepted on opportunity create/update. Unknown flavors are rejected. */
export function readBidWrite(body: Record<string, unknown>, partial: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const take = (key: string, value: unknown) => {
    if (partial && !(key in body)) return;
    out[key] = value;
  };
  if (!partial || "flavor" in body) {
    const flavor = textOrNull(body.flavor);
    if (flavor != null && !isBidFlavor(flavor)) throw httpError(400, "Invalid bid flavor");
    take("flavor", flavor);
  }
  if (!partial || "outcome" in body) {
    const outcome = textOrNull(body.outcome);
    if (outcome != null && !isBidOutcome(outcome)) throw httpError(400, "Invalid outcome");
    take("outcome", outcome);
  }
  if (!partial || "bid_substage" in body) {
    const sub = textOrNull(body.bid_substage);
    if (sub != null && !isBidSubstage(sub)) throw httpError(400, "Invalid bid substage");
    take("bid_substage", sub);
  }
  if (!partial || "seller_company_id" in body) take("seller_company_id", positiveInt(body.seller_company_id));
  if (!partial || "broker_company_id" in body) take("broker_company_id", positiveInt(body.broker_company_id));
  if (!partial || "offering_name" in body) take("offering_name", textOrNull(body.offering_name));
  if (!partial || "received_date" in body) take("received_date", dateOnly(body.received_date));
  if (!partial || "bid_due_prelim" in body) take("bid_due_prelim", dateOnly(body.bid_due_prelim));
  if (!partial || "bid_due_final" in body) take("bid_due_final", dateOnly(body.bid_due_final));
  if (!partial || "award_date" in body) take("award_date", dateOnly(body.award_date));
  return out;
}

/**
 * Portfolio bids are type 'purchase' (lowercase). Passed requires stage lost
 * and a loss reason. Won/lost without an outcome fills the matching outcome.
 * Inspection and final substages only stick while stage is negotiating.
 */
export function applyBidRules(patch: Record<string, unknown>, merged: Record<string, unknown>): void {
  const flavorRaw = merged.flavor == null || merged.flavor === "" ? null : String(merged.flavor);
  if (flavorRaw != null && !isBidFlavor(flavorRaw)) throw httpError(400, "Invalid bid flavor");
  const flavor = flavorRaw;
  const type = String(merged.type ?? "");
  if (flavor === "portfolio_bid" && type !== PURCHASE_TYPE) {
    throw httpError(400, "Portfolio bids use type purchase");
  }
  const stage = String(merged.stage ?? "");
  const bidding = flavor === "portfolio_bid" || "flavor" in patch || "outcome" in patch || "bid_substage" in patch
    || "seller_company_id" in patch || "broker_company_id" in patch || "offering_name" in patch
    || "received_date" in patch || "bid_due_prelim" in patch || "bid_due_final" in patch || "award_date" in patch;
  if (!bidding) return;

  let outcome = merged.outcome == null || merged.outcome === "" ? null : String(merged.outcome);
  if (outcome != null && !isBidOutcome(outcome)) throw httpError(400, "Invalid outcome");
  let sub = merged.bid_substage == null || merged.bid_substage === "" ? null : String(merged.bid_substage);
  if (sub != null && !isBidSubstage(sub)) throw httpError(400, "Invalid bid substage");
  if (stage !== "negotiating") sub = null;

  if (outcome == null && stage === "won") outcome = "won";
  else if (outcome == null && stage === "lost") outcome = "lost";

  if (outcome === "passed") {
    if (stage !== "lost") throw httpError(400, "Passed bids are stored as lost");
    if (!textOrNull(merged.loss_reason)) throw httpError(400, "Passed bids require a loss reason");
  }
  if (outcome === "won" && stage !== "won") throw httpError(400, "Won outcome requires stage won");
  if (outcome === "lost" && stage !== "lost") throw httpError(400, "Lost outcome requires stage lost");

  const prelim = dateOnly(merged.bid_due_prelim);
  const finalDue = dateOnly(merged.bid_due_final);
  if (prelim && finalDue && finalDue < prelim) throw httpError(400, "Final bid due is before the preliminary due date");

  patch.flavor = flavor;
  patch.outcome = outcome;
  patch.bid_substage = sub;
}

export function isPortfolioBid(row: { flavor?: string | null }): boolean {
  return row.flavor === "portfolio_bid";
}
