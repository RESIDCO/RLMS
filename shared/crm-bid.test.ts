/* eslint-disable no-console */
/** Run: npx tsx shared/crm-bid.test.ts */

import { BFLX_C612_CARS, BFLX_LINES, BFLX_OFFERING, BFLX_PUBLISHED_PRICES } from "./crm-bid-bflx";
import { OPPORTUNITY_TYPES } from "./crm";
import {
  BID_FLAVOR,
  BID_STAGE_OPTIONS,
  PURCHASE_TYPE,
  bidStageLabel,
  bidStageOption,
  bidWinRate,
  buildOpportunityPayload,
  isBidOpportunity,
  lineBidTotal,
  nextBidDeadline,
  portfolioBidRequiresPurchase,
  rollupBidLines,
  type OpportunityPayloadInput,
} from "./crm-bid";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(PURCHASE_TYPE === "purchase", "purchase type is lowercase");
ok(PURCHASE_TYPE !== "Purchase", "purchase type is not title case");
ok(portfolioBidRequiresPurchase("portfolio_bid", "purchase"), "portfolio bid accepts lowercase purchase");
ok(!portfolioBidRequiresPurchase("portfolio_bid", "Purchase"), "title-case Purchase is not the stored type");
ok(!portfolioBidRequiresPurchase("portfolio_bid", "renewal"), "portfolio bid rejects renewal");
ok(portfolioBidRequiresPurchase(null, "renewal"), "a blank flavor is not a portfolio bid");

ok(bidStageLabel("identified", null, null) === "Bid request received", "received label");
ok(bidStageLabel("qualified", null, null) === "Evaluating", "evaluating label");
ok(bidStageLabel("proposal", null, null) === "Bid submitted", "submitted label");
ok(bidStageLabel("negotiating", null, null) === "Shortlisted", "shortlisted label");
ok(bidStageLabel("negotiating", null, "inspection") === "Inspection / diligence", "inspection label");
ok(bidStageLabel("negotiating", null, "final") === "Final negotiation", "final label");
ok(bidStageLabel("won", "won", null) === "Won", "won label");
ok(bidStageLabel("lost", "lost", null) === "Lost", "lost label");
ok(bidStageLabel("lost", "passed", null) === "Passed", "passed label");
ok(bidStageOption("passed").stage === "lost" && bidStageOption("passed").outcome === "passed", "passed stores lost");
ok(BID_STAGE_OPTIONS.every((option) => option.stage !== "priced"), "bid stages do not invent a priced step");

ok(bidWinRate(0, 0) === null, "no decided lines is a blank win rate");
ok(bidWinRate(1, 1) === 0.5, "win rate ignores nothing but won and lost");
ok(bidWinRate(3, 1) === 0.75, "three won one lost");
ok(bidWinRate(-1, 1) === null, "negative counts are blank");

ok(lineBidTotal({ car_count: 98, prelim_price_per_car: 64000, final_price_per_car: null }) === 6_272_000, "prelim times cars");
ok(lineBidTotal({ car_count: 10, prelim_price_per_car: 5, final_price_per_car: 8 }) === 80, "final price wins over prelim");
ok(lineBidTotal({ car_count: 10, prelim_price_per_car: null, final_price_per_car: null }) === null, "no price is blank");

const deadline = nextBidDeadline(["2026-11-09", "2026-10-30"], "2026-10-20");
ok(deadline?.date === "2026-10-30" && deadline.tone === "neutral" && deadline.days === 10, "next deadline is the earlier future date");
ok(nextBidDeadline(["2026-10-18"], "2026-10-20")?.tone === "past", "a past deadline is grey");
ok(nextBidDeadline(["2026-10-23"], "2026-10-20")?.tone === "red", "three days is red");
ok(nextBidDeadline(["2026-10-27"], "2026-10-20")?.tone === "amber", "seven days is amber");

const roll = rollupBidLines([
  { car_count: 10, include_in_bid: true, prelim_price_per_car: 100, outcome: "won" },
  { car_count: 4, include_in_bid: false, prelim_price_per_car: 50, outcome: null },
  { car_count: 2, include_in_bid: true, prelim_price_per_car: 10, outcome: "lost", deleted_at: "2026-10-20" },
]);
ok(roll.cars_total === 14 && roll.cars_bid === 10 && roll.dollars === 1000 && roll.won_lines === 1 && roll.line_count === 2, "rollup skips deleted and excluded dollars");

const unpriced = rollupBidLines([
  { car_count: 9, include_in_bid: true, prelim_price_per_car: null, final_price_per_car: null, deleted_at: "2026-10-01" },
  { car_count: 4, include_in_bid: false, prelim_price_per_car: null, final_price_per_car: null },
]);
ok(unpriced.line_count === 1, "deleted line is skipped");
ok(unpriced.cars_total === 4, "excluded line still counts in cars_total");
ok(unpriced.cars_bid === 0, "excluded line is not in cars_bid");
ok(unpriced.dollars === null, "no prices leaves dollars null");

const flavors = [null, undefined, "", BID_FLAVOR, "other"] as const;
for (const type of OPPORTUNITY_TYPES) {
  for (const flavor of flavors) {
    const flags = isBidOpportunity(type, flavor);
    ok(flags.isPurchase === (type === "purchase"), `${type} / ${String(flavor)} purchase flag`);
    ok(flags.isPortfolioBid === (flavor === BID_FLAVOR), `${type} / ${String(flavor)} portfolio flag`);
  }
}

function payloadForm(overrides: Partial<OpportunityPayloadInput> = {}): OpportunityPayloadInput {
  return {
    type: "renewal",
    stage: "identified",
    source: "manual",
    owner: "Ada",
    rider_id: "15",
    car_type: " box ",
    car_count: "10",
    current_rate: "1.5",
    target_rate: "2",
    term_months: "60",
    est_value: "1000",
    expiry_date: "2027-01-01",
    new_expiry_date: "2028-01-01",
    expected_close: "2026-12-01",
    won_rider_id: "9",
    sublessee_note: " west ",
    competitor: " GATX ",
    loss_reason: "",
    notes: " hello ",
    lessee_role: "sublessee",
    tags: ["a"],
    referral_note: " pat ",
    ...overrides,
  };
}

const renewalKeys = [
  "type",
  "stage",
  "source",
  "owner",
  "rider_id",
  "car_type",
  "car_count",
  "current_rate",
  "target_rate",
  "term_months",
  "est_value",
  "expiry_date",
  "new_expiry_date",
  "expected_close",
  "won_rider_id",
  "lessee_role",
  "sublessee_note",
  "competitor",
  "loss_reason",
  "notes",
  "tags",
  "referral_note",
];
const renewal = buildOpportunityPayload(payloadForm(), { isPurchase: false, isPortfolioBid: false });
ok(renewalKeys.every((key) => key in renewal) && Object.keys(renewal).length === renewalKeys.length, "renewal payload keeps every key");
ok(renewal.owner === "Ada" && renewal.rider_id === 15 && renewal.car_type === "box", "renewal trims text and parses numbers");
ok(renewal.car_count === 10 && renewal.current_rate === 1.5 && renewal.est_value === 1000, "renewal keeps car count, rate, and est value");
ok(renewal.lessee_role === "sublessee" && renewal.sublessee_note === "west", "renewal keeps a sublessee note");
ok(renewal.competitor === "GATX" && renewal.notes === "hello" && renewal.referral_note === "pat", "renewal trims notes and competitor");
ok(renewal.loss_reason === null && renewal.won_rider_id === 9 && renewal.expiry_date === "2027-01-01", "renewal dates and blank loss reason match today");
const lesseeRenewal = buildOpportunityPayload(payloadForm({ lessee_role: "lessee", sublessee_note: "hidden" }), { isPurchase: false, isPortfolioBid: false });
ok(lesseeRenewal.lessee_role === "lessee" && lesseeRenewal.sublessee_note === null, "a lessee renewal still sends a null sublessee note");

const purchaseHidden = ["rider_id", "current_rate", "target_rate", "term_months", "expiry_date", "lessee_role", "sublessee_note"];
const plainPurchase = buildOpportunityPayload(payloadForm({ type: "purchase", owner: "  " }), { isPurchase: true, isPortfolioBid: false });
ok(purchaseHidden.every((key) => !(key in plainPurchase)), "plain purchase omits lease keys");
ok(plainPurchase.car_count === 10 && plainPurchase.est_value === 1000 && plainPurchase.car_type === "box", "plain purchase keeps car count, est value, and car type");
ok(plainPurchase.owner === null, "blank bid lead saves as null");

const portfolioHidden = [...purchaseHidden, "car_type", "car_count", "est_value"];
const portfolio = buildOpportunityPayload(payloadForm({ type: "purchase" }), { isPurchase: true, isPortfolioBid: true });
ok(portfolioHidden.every((key) => !(key in portfolio)), "portfolio bid omits lease keys, car count, and est value");
ok(portfolio.notes === "hello" && portfolio.competitor === "GATX" && Array.isArray(portfolio.tags) && portfolio.tags[0] === "a", "portfolio bid keeps notes, competitor, and tags");
ok(!("lessee_role" in portfolio) && !("rider_id" in portfolio) && !("sublessee_note" in portfolio), "portfolio bid does not pass lessee role, rider id, or sublessee note through");

ok(BFLX_OFFERING.type === "purchase", "BFLX offering type is lowercase purchase");
ok(BFLX_LINES.length === 21, "BFLX fixture has 21 lines");
ok(BFLX_LINES.filter((line) => line.include_in_bid).length === 19, "deals through the tanks are the ones left out");
const tanks = BFLX_LINES.filter((line) => line.seller_deal_ref === "20" || line.seller_deal_ref === "21");
ok(tanks.length === 2 && tanks.every((line) => !line.include_in_bid && line.exclude_reason === "per Greg"), "tanks 20 and 21 excluded per Greg");
ok(tanks.reduce((sum, line) => sum + line.car_count, 0) === BFLX_OFFERING.tank_cars, "tank cars are 182 + 94");
const deal1 = BFLX_LINES.find((line) => line.seller_deal_ref === "1");
const deal5 = BFLX_LINES.find((line) => line.seller_deal_ref === "5");
ok(deal1?.prelim_price_per_car === 64_000 && deal1.include_in_bid && deal1.car_count === 98, "deal 1 is the Mexican boxcars at $64,000");
ok(deal5?.prelim_price_per_car === 78_900 && deal5.car_count === 333, "deal 5 is the 2023 group at $78,900");
ok(BFLX_PUBLISHED_PRICES.some((row) => row.seller_deal_ref === "3a" && row.prelim_price_per_car === 8_100), "3a publish price is $8,100");
ok(
  BFLX_LINES.filter((line) => line.prelim_price_per_car != null).length === 2,
  "only the two whole-deal exhibit prices are stored on lines",
);
const rowCars = BFLX_LINES.reduce((sum, line) => sum + line.car_count, 0);
ok(rowCars + BFLX_C612_CARS === BFLX_OFFERING.package_cars, "row cars plus the unsplit C612 pool equal 3,450");
ok(rowCars === 3_282, "BFLX fixture lines sum to 3,282 cars");
const bflxRoll = rollupBidLines(BFLX_LINES);
const bflxIncluded = BFLX_LINES.filter((line) => line.include_in_bid);
const bflxExcluded = BFLX_LINES.filter((line) => !line.include_in_bid);
const bflxPriced = bflxIncluded.filter((line) => lineBidTotal(line) != null);
ok(bflxRoll.line_count === 21 && bflxRoll.line_count === BFLX_LINES.length, "BFLX rollup counts the 21 fixture lines");
ok(bflxExcluded.length === 2, "BFLX rollup fixture has 2 excluded lines");
ok(bflxPriced.length === 2, "BFLX rollup fixture has 2 priced included lines");
ok(bflxRoll.cars_total === rowCars, "BFLX rollup cars_total is the fixture sum");
const bflxCarsBid = bflxIncluded.reduce((sum, line) => sum + line.car_count, 0);
ok(bflxRoll.cars_bid === bflxCarsBid, "BFLX rollup cars_bid is the included fixture lines");
const bflxDollars = bflxPriced.reduce((sum, line) => sum + (lineBidTotal(line) ?? 0), 0);
const bothPricedIncluded = bflxPriced.some((line) => line.car_count === 98 && line.prelim_price_per_car === 64_000)
  && bflxPriced.some((line) => line.car_count === 333 && line.prelim_price_per_car === 78_900);
ok(bothPricedIncluded, "priced included lines are the 98-car and 333-car deals");
ok(bflxRoll.dollars === bflxDollars, "BFLX rollup dollars follows the fixture's included priced lines");
ok(bflxRoll.dollars === 98 * 64_000 + 333 * 78_900, "BFLX dollars is 98 × 64,000 plus 333 × 78,900");
ok(BFLX_OFFERING.package_cars - BFLX_OFFERING.tank_cars === BFLX_OFFERING.exhibit_cars, "exhibit car count drops the tanks");
ok(BFLX_LINES.every((line) => line.prelim_price_per_car == null || [64_000, 78_900].includes(line.prelim_price_per_car)), "no invented exhibit prices");

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
