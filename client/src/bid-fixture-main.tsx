import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import BidLinesGrid, { type BidLine } from "@/components/crm/BidLinesGrid";
import { bidStageLabel } from "@shared/crm";
import { BFLX_C612_CARS, BFLX_LINES, BFLX_OFFERING, BFLX_PUBLISHED_PRICES } from "@shared/crm-bid-bflx";
import "./index.css";

const lines: BidLine[] = BFLX_LINES.map((line, index) => ({
  id: index + 1,
  seller_deal_ref: line.seller_deal_ref,
  lessee_desc: line.lessee_desc,
  lessee_rating: line.lessee_rating,
  lessee_country: line.lessee_country,
  aar_code: line.aar_code,
  car_type: line.car_type,
  equipment_desc: null,
  car_count: line.car_count,
  avg_build_year: line.avg_build_year,
  commodity: null,
  lease_rate: null,
  lease_expiry: null,
  purchase_option: null,
  include_in_bid: line.include_in_bid,
  exclude_reason: line.exclude_reason,
  prelim_price_per_car: line.prelim_price_per_car,
  final_price_per_car: null,
  outcome: null,
  market_price_per_car: null,
  winner_company_id: null,
  loss_reason: null,
  notes: line.notes,
  sort_order: index,
}));

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function Fixture() {
  const prices = BFLX_PUBLISHED_PRICES.map((row) => `${row.seller_deal_ref} ${money(row.prelim_price_per_car)}`).join(", ");
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader
        title={BFLX_OFFERING.offering_name}
        subtitle={`${BFLX_OFFERING.seller} · ${bidStageLabel(BFLX_OFFERING.stage, BFLX_OFFERING.outcome, BFLX_OFFERING.bid_substage)}`}
        note={`Preliminary bids due ${BFLX_OFFERING.bid_due_prelim}. Package ${BFLX_OFFERING.package_cars.toLocaleString()} cars. Exhibit ${BFLX_OFFERING.exhibit_cars.toLocaleString()} cars, ${money(BFLX_OFFERING.exhibit_dollars)}, tanks excluded.`}
      />
      <div className="px-4 sm:px-8 py-4 space-y-3">
        <p className="text-sm text-muted-foreground max-w-4xl">
          Local preview only. Deals 1–19 are in the bid. Deals 20 and 21 (tank cars) are excluded per Greg.
          Published preliminary prices from the design notes: {prices}. Group 3a is part of deal 3, so its $8,100 price is not entered as the price for all {lines.find((line) => line.seller_deal_ref === "3")?.car_count} cars on that line.
          Deals 6–10 are {BFLX_C612_CARS} cars together; their per-car prices are not in the notes, so those cells are blank.
        </p>
        <BidLinesGrid
          opportunityId={1}
          lines={lines}
          canWrite
          canSeePrices
          parentIsWon={false}
          onWonLine={() => undefined}
        />
      </div>
    </div>
  );
}

document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <Fixture />
  </QueryClientProvider>,
);
