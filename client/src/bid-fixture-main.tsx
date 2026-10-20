import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { ConfirmActionHost } from "@/components/ConfirmActionDialog";
import BidLinesGrid, { type BidLine } from "@/components/crm/BidLinesGrid";
import {
  OpportunityFilesView,
  saveAttachmentBlob,
  type OpportunityAttachment,
  type OpportunityFileLine,
} from "@/components/OpportunityFiles";
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

const fileLines: OpportunityFileLine[] = [
  { id: 7, label: "7 – ACME", deleted: false },
  { id: 8, label: "8 – Removed lessee", deleted: true },
];

const seedFiles: OpportunityAttachment[] = [
  {
    id: 1,
    entity_type: "opportunity",
    entity_id: 1,
    file_name: "cars.xlsx",
    file_size: 24000,
    mime_type: "application/vnd.ms-excel",
    storage_path: "opportunity/1/cars.xlsx",
    uploaded_by: "bruce",
    uploaded_at: "2026-10-19T15:00:00.000Z",
    notes: null,
    source_module: "crm",
    doc_category: "pricing",
    opportunity_line_id: 7,
  },
  {
    id: 2,
    entity_type: "opportunity",
    entity_id: 1,
    file_name: "note.msg",
    file_size: 12000,
    mime_type: "application/vnd.ms-outlook",
    storage_path: "opportunity/1/note.msg",
    uploaded_by: "bruce",
    uploaded_at: "2026-10-19T16:00:00.000Z",
    notes: null,
    source_module: "crm",
    doc_category: "correspondence",
    opportunity_line_id: null,
  },
  {
    id: 3,
    entity_type: "opportunity",
    entity_id: 1,
    file_name: "drawing.pdf",
    file_size: 80000,
    mime_type: "application/pdf",
    storage_path: "opportunity/1/drawing.pdf",
    uploaded_by: "bruce",
    uploaded_at: "2026-10-18T12:00:00.000Z",
    notes: null,
    source_module: "crm",
    doc_category: "drawings",
    opportunity_line_id: 8,
  },
];

function Fixture() {
  const prices = BFLX_PUBLISHED_PRICES.map((row) => `${row.seller_deal_ref} ${money(row.prelim_price_per_car)}`).join(", ");
  const [files, setFiles] = useState(seedFiles);
  const [lineId, setLineId] = useState<number | undefined>(undefined);
  const [lastOpen, setLastOpen] = useState("none");
  const counts: Record<number, number> = {};
  for (const file of files) {
    if (file.opportunity_line_id != null) counts[file.opportunity_line_id] = (counts[file.opportunity_line_id] ?? 0) + 1;
  }
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
          fileCounts={{ ...counts, 1: counts[7] ?? 0 }}
          onOpenFiles={(id) => setLineId(id === 1 ? 7 : id)}
        />
        <section className="max-w-3xl space-y-2 border rounded-md p-3">
          <h2 className="text-sm font-semibold">Files</h2>
          <p className="text-xs text-muted-foreground" data-testid="bid-file-last-open">Last open: {lastOpen}</p>
          <OpportunityFilesView
            attachments={files}
            lines={fileLines}
            lineId={lineId}
            canEdit
            onUpload={async (picked, category, pinned, notes) => {
              setFiles((current) => [
                ...picked.map((file, index) => ({
                  id: Date.now() + index,
                  entity_type: "opportunity",
                  entity_id: 1,
                  file_name: file.name,
                  file_size: file.size,
                  mime_type: file.type || "application/octet-stream",
                  storage_path: `opportunity/1/${file.name}`,
                  uploaded_by: "bruce",
                  uploaded_at: new Date().toISOString(),
                  notes: notes || null,
                  source_module: "crm",
                  doc_category: category,
                  opportunity_line_id: pinned,
                })),
                ...current,
              ]);
            }}
            onPatch={async (id, body) => {
              setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...body } : file)));
            }}
            onDelete={async (id) => {
              setFiles((current) => current.filter((file) => file.id !== id));
            }}
            onDownload={async (file) => {
              const blob = new Blob(["preview"], { type: file.mime_type });
              saveAttachmentBlob(file.file_name, blob);
              setLastOpen(file.file_name);
            }}
          />
        </section>
      </div>
    </div>
  );
}

document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <ConfirmActionHost />
    <Fixture />
  </QueryClientProvider>,
);
