import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import CalculatorTab from "@/pages/opportunity/CalculatorTab";
import { companyDefaultInputs, type DealCalcInputs } from "@shared/dealCalc";
import type { OpportunityRow } from "@shared/crm";
import "./index.css";

function dealOne(): DealCalcInputs {
  const inputs = companyDefaultInputs();
  inputs.method = { value: "both", source: "user" };
  inputs.closeDate = { value: "2026-07-31", source: "line" };
  inputs.firstRentDate = { value: "2026-08-01", source: "line" };
  inputs.carCount = { value: 98, source: "line" };
  inputs.monthlyRent = { value: 576.89, source: "line" };
  inputs.leaseExpiry = { value: "2038-06-30", source: "line" };
  inputs.sell.endValuePerCar = { value: 60000, source: "user" };
  inputs.carType = { value: "Tank", source: "line" };
  return inputs;
}

const opportunity = {
  id: 1,
  stage: "proposal",
  outcome: null,
  flavor: "portfolio_bid",
  type: "purchase",
  expected_close: "2026-07-31",
} as OpportunityRow;

function Fixture() {
  const [viewer, setViewer] = useState(() => new URLSearchParams(window.location.search).get("view") === "viewer");
  return (
    <div className="min-h-screen bg-background text-foreground p-4 space-y-3">
      <div className="flex gap-2">
        <button type="button" className="border rounded px-2 py-1 text-sm" onClick={() => setViewer(false)}>Editor</button>
        <button type="button" className="border rounded px-2 py-1 text-sm" onClick={() => setViewer(true)}>Viewer</button>
      </div>
      <h1 className="text-lg font-semibold">BFLX deal 1 — both methods</h1>
      <CalculatorTab
        opportunityId={1}
        opportunity={opportunity}
        lines={[{
          id: 1,
          seller_deal_ref: "1",
          lessee_desc: null,
          lessee_rating: null,
          lessee_country: null,
          aar_code: null,
          car_type: "Tank",
          equipment_desc: null,
          car_count: 98,
          avg_build_year: null,
          commodity: null,
          lease_rate: 576.89,
          lease_expiry: "2038-06-30",
          purchase_option: null,
          include_in_bid: true,
          exclude_reason: null,
          prelim_price_per_car: null,
          final_price_per_car: null,
          outcome: null,
          market_price_per_car: null,
          winner_company_id: null,
          loss_reason: null,
          notes: null,
          sort_order: 0,
        }]}
        canWrite={!viewer}
        preview={{
          inputs: dealOne(),
          viewer,
          scenarios: [{ id: 1, name: "Deal 1", opportunity_line_id: 1, deal_type: "portfolio_bid", method: "both", post_lease_plan: "sell", is_pinned: true, created_at: "2026-10-20T00:00:00Z" }],
        }}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <Fixture />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}
