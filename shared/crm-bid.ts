/**
 * Portfolio bid rules (CRM Bid P1).
 * Stored stages stay on opportunities.stage. Bid labels are a view of
 * stage + outcome + bid_substage. "Passed" is stage lost with outcome passed
 * so it stays out of the win rate.
 */

export const BID_FLAVOR = "portfolio_bid" as const;
export type BidFlavor = typeof BID_FLAVOR;

export const BID_OUTCOMES = ["won", "lost", "passed"] as const;
export type BidOutcome = (typeof BID_OUTCOMES)[number];

export const BID_LINE_OUTCOMES = ["won", "lost", "passed", "withdrawn"] as const;
export type BidLineOutcome = (typeof BID_LINE_OUTCOMES)[number];

export const BID_SUBSTAGES = ["inspection", "final"] as const;
export type BidSubstage = (typeof BID_SUBSTAGES)[number];

/** Price columns viewers never receive. Totals are computed, not stored. */
export const BID_PRICE_FIELDS = [
  "prelim_price_per_car",
  "final_price_per_car",
  "market_price_per_car",
  "winner_company_id",
] as const;

export type BidStageId =
  | "received"
  | "evaluating"
  | "submitted"
  | "shortlisted"
  | "inspection"
  | "final"
  | "won"
  | "lost"
  | "passed";

export type BidStageOption = {
  id: BidStageId;
  label: string;
  stage: "identified" | "qualified" | "proposal" | "negotiating" | "won" | "lost";
  outcome: BidOutcome | null;
  bid_substage: BidSubstage | null;
};

export const BID_STAGE_OPTIONS: readonly BidStageOption[] = [
  { id: "received", label: "Bid request received", stage: "identified", outcome: null, bid_substage: null },
  { id: "evaluating", label: "Evaluating", stage: "qualified", outcome: null, bid_substage: null },
  { id: "submitted", label: "Bid submitted", stage: "proposal", outcome: null, bid_substage: null },
  { id: "shortlisted", label: "Shortlisted", stage: "negotiating", outcome: null, bid_substage: null },
  { id: "inspection", label: "Inspection / diligence", stage: "negotiating", outcome: null, bid_substage: "inspection" },
  { id: "final", label: "Final negotiation", stage: "negotiating", outcome: null, bid_substage: "final" },
  { id: "won", label: "Won", stage: "won", outcome: "won", bid_substage: null },
  { id: "lost", label: "Lost", stage: "lost", outcome: "lost", bid_substage: null },
  { id: "passed", label: "Passed", stage: "lost", outcome: "passed", bid_substage: null },
] as const;

const STAGE_LABEL_FALLBACK: Record<string, string> = {
  identified: "Identified",
  qualified: "Qualified",
  priced: "Priced",
  in_review: "In review",
  proposal: "Proposal",
  docs: "Docs",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
};

export function isBidFlavor(value: unknown): value is BidFlavor {
  return value === BID_FLAVOR;
}

export function isBidOutcome(value: unknown): value is BidOutcome {
  return typeof value === "string" && (BID_OUTCOMES as readonly string[]).includes(value);
}

export function isBidLineOutcome(value: unknown): value is BidLineOutcome {
  return typeof value === "string" && (BID_LINE_OUTCOMES as readonly string[]).includes(value);
}

export function isBidSubstage(value: unknown): value is BidSubstage {
  return typeof value === "string" && (BID_SUBSTAGES as readonly string[]).includes(value);
}

export function bidStageId(
  stage: string | null | undefined,
  outcome: string | null | undefined,
  bidSubstage: string | null | undefined,
): BidStageId | null {
  if (outcome === "passed" && stage === "lost") return "passed";
  if (stage === "negotiating" && bidSubstage === "inspection") return "inspection";
  if (stage === "negotiating" && bidSubstage === "final") return "final";
  if (stage === "negotiating") return "shortlisted";
  const match = BID_STAGE_OPTIONS.find((option) => option.stage === stage && option.bid_substage == null && option.outcome == null);
  if (match) return match.id;
  if (stage === "won") return "won";
  if (stage === "lost") return "lost";
  return null;
}

/** Label used only when the opportunity flavor is portfolio_bid. */
export function bidStageLabel(
  stage: string | null | undefined,
  outcome: string | null | undefined,
  bidSubstage: string | null | undefined,
): string {
  const id = bidStageId(stage, outcome, bidSubstage);
  if (id) return BID_STAGE_OPTIONS.find((option) => option.id === id)?.label ?? id;
  if (stage && STAGE_LABEL_FALLBACK[stage]) return STAGE_LABEL_FALLBACK[stage];
  return stage ? stage : "—";
}

export function bidStageOption(id: BidStageId): BidStageOption {
  switch (id) {
    case "received":
    case "evaluating":
    case "submitted":
    case "shortlisted":
    case "inspection":
    case "final":
    case "won":
    case "lost":
    case "passed": {
      const option = BID_STAGE_OPTIONS.find((row) => row.id === id);
      if (!option) throw new Error(`Unknown bid stage ${id}`);
      return option;
    }
    default: {
      const unknown: never = id;
      throw new Error(`Unknown bid stage ${String(unknown)}`);
    }
  }
}

/**
 * Win rate is won / (won + lost). Passed is not an input.
 * Zero decided lines returns null, not zero.
 */
export function bidWinRate(won: number, lost: number): number | null {
  if (!Number.isFinite(won) || !Number.isFinite(lost) || won < 0 || lost < 0) return null;
  const decided = won + lost;
  if (decided === 0) return null;
  return won / decided;
}

export function lineBidPricePerCar(line: {
  final_price_per_car?: number | string | null;
  prelim_price_per_car?: number | string | null;
}): number | null {
  const finalPrice = money(line.final_price_per_car);
  if (finalPrice != null) return finalPrice;
  return money(line.prelim_price_per_car);
}

/** Final price when present, otherwise preliminary, times car count. */
export function lineBidTotal(line: {
  car_count?: number | string | null;
  final_price_per_car?: number | string | null;
  prelim_price_per_car?: number | string | null;
}): number | null {
  const price = lineBidPricePerCar(line);
  const cars = money(line.car_count);
  if (price == null || cars == null) return null;
  return roundMoney(price * cars);
}

export function money(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type DeadlineTone = "red" | "amber" | "neutral" | "past";

export function nextBidDeadline(
  dates: Array<string | null | undefined>,
  today: string,
): { date: string; tone: DeadlineTone; days: number } | null {
  const valid = dates.filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (!valid.length || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const upcoming = valid.filter((value) => value >= today).sort();
  if (upcoming.length) {
    const date = upcoming[0];
    const days = isoDayDiff(today, date);
    const tone: DeadlineTone = days <= 3 ? "red" : days <= 7 ? "amber" : "neutral";
    return { date, tone, days };
  }
  const past = valid.filter((value) => value < today).sort();
  const date = past[past.length - 1];
  return { date, tone: "past", days: isoDayDiff(today, date) };
}

function isoDayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export type BidLineLike = {
  car_count?: number | string | null;
  include_in_bid?: boolean | null;
  final_price_per_car?: number | string | null;
  prelim_price_per_car?: number | string | null;
  outcome?: string | null;
  deleted_at?: string | null;
};

export function rollupBidLines(lines: BidLineLike[]): {
  cars_bid: number;
  cars_total: number;
  dollars: number | null;
  won_lines: number;
  line_count: number;
} {
  let carsBid = 0;
  let carsTotal = 0;
  let dollars = 0;
  let priced = false;
  let wonLines = 0;
  let lineCount = 0;
  for (const line of lines) {
    if (line.deleted_at) continue;
    lineCount += 1;
    const cars = money(line.car_count) ?? 0;
    carsTotal += cars;
    if (line.include_in_bid !== false) {
      carsBid += cars;
      const total = lineBidTotal(line);
      if (total != null) {
        dollars += total;
        priced = true;
      }
    }
    if (line.outcome === "won") wonLines += 1;
  }
  return {
    cars_bid: carsBid,
    cars_total: carsTotal,
    dollars: priced ? roundMoney(dollars) : null,
    won_lines: wonLines,
    line_count: lineCount,
  };
}

export function formatWinRate(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

export type AcquiredLeaseLine = {
  seller_deal_ref: string;
  lessee_desc: string | null;
  lessee_country: string | null;
  aar_code: string | null;
  car_type: string | null;
  car_count: number;
  lease_rate: number | null;
  lease_expiry: string | null;
  purchase_option: boolean | null;
  final_price_per_car: number | null;
  close_date: string | null;
};

/** Copy-friendly table. This field list is the contract for a later Lease Mgmt acquired-lease mode. */
export function acquiredLeaseTable(lines: AcquiredLeaseLine[]): string {
  const header = [
    "Deal",
    "Lessee",
    "Country",
    "AAR",
    "Car type",
    "Cars",
    "Lease rate",
    "Expiry",
    "Purchase option",
    "Final $/car",
    "Close",
  ];
  const rows = lines.map((line) =>
    [
      line.seller_deal_ref,
      line.lessee_desc ?? "",
      line.lessee_country ?? "",
      line.aar_code ?? "",
      line.car_type ?? "",
      String(line.car_count),
      line.lease_rate == null ? "" : String(line.lease_rate),
      line.lease_expiry ?? "",
      line.purchase_option == null ? "" : line.purchase_option ? "yes" : "no",
      line.final_price_per_car == null ? "" : String(line.final_price_per_car),
      line.close_date ?? "",
    ].join("\t"),
  );
  return [header.join("\t"), ...rows].join("\n");
}

export function leaseWizardHref(accountId: number | null | undefined): string | null {
  if (accountId == null || !Number.isFinite(accountId) || accountId <= 0) return null;
  return `#/lease-wizard?account_id=${accountId}`;
}

/** Portfolio bids are purchase opportunities. The stored type value is lowercase. */
export const PURCHASE_TYPE = "purchase";

export function portfolioBidRequiresPurchase(flavor: string | null | undefined, type: string | null | undefined): boolean {
  if (flavor == null || flavor === "") return true;
  return flavor === BID_FLAVOR && type === PURCHASE_TYPE;
}

/**
 * isPurchase is any purchase, including a portfolio bid.
 * isPortfolioBid is the portfolio_bid flavor (or the dialog checkbox that stores it).
 * Deal lines exist only for the portfolio bid.
 */
export function isBidOpportunity(
  type: string | null | undefined,
  flavor: string | null | undefined,
): { isPurchase: boolean; isPortfolioBid: boolean } {
  return {
    isPurchase: type === PURCHASE_TYPE,
    isPortfolioBid: flavor === BID_FLAVOR,
  };
}

/** Form values the opportunity dialog turns into the base write. */
export type OpportunityPayloadInput = {
  type: string;
  stage: string;
  source: string;
  owner: string;
  rider_id: string;
  car_type: string;
  car_count: string;
  current_rate: string;
  target_rate: string;
  term_months: string;
  est_value: string;
  expiry_date: string;
  new_expiry_date: string;
  expected_close: string;
  won_rider_id: string;
  sublessee_note: string;
  competitor: string;
  loss_reason: string;
  notes: string;
  lessee_role: string;
  tags: string[];
  referral_note: string;
};

const PURCHASE_HIDDEN_KEYS = [
  "rider_id",
  "current_rate",
  "target_rate",
  "term_months",
  "expiry_date",
  "lessee_role",
  "sublessee_note",
] as const;

const PORTFOLIO_HIDDEN_KEYS = ["car_type", "car_count", "est_value"] as const;

function textOrNull(value: string): string | null {
  const text = value.trim();
  return text ? text : null;
}

function formNumber(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Base save body. Hidden fields are left out entirely: a purchase patch must
 * not send lease columns, and a portfolio bid must not send car count or
 * estimated value. Omitted keys take server defaults on create.
 */
export function buildOpportunityPayload(
  form: OpportunityPayloadInput,
  flags: { isPurchase: boolean; isPortfolioBid: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: form.type,
    stage: form.stage,
    source: form.source,
    owner: textOrNull(form.owner),
    rider_id: formNumber(form.rider_id),
    car_type: textOrNull(form.car_type),
    car_count: formNumber(form.car_count),
    current_rate: formNumber(form.current_rate),
    target_rate: formNumber(form.target_rate),
    term_months: formNumber(form.term_months),
    est_value: formNumber(form.est_value),
    expiry_date: form.expiry_date || null,
    new_expiry_date: form.new_expiry_date || null,
    expected_close: form.expected_close || null,
    won_rider_id: formNumber(form.won_rider_id),
    lessee_role: form.lessee_role,
    sublessee_note: form.lessee_role === "sublessee" ? textOrNull(form.sublessee_note) : null,
    competitor: textOrNull(form.competitor),
    loss_reason: form.loss_reason || null,
    notes: textOrNull(form.notes),
    tags: [...form.tags],
    referral_note: textOrNull(form.referral_note),
  };
  if (flags.isPurchase) {
    for (const key of PURCHASE_HIDDEN_KEYS) delete payload[key];
  }
  if (flags.isPortfolioBid) {
    for (const key of PORTFOLIO_HIDDEN_KEYS) delete payload[key];
  }
  return payload;
}
