import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import ActivityDialog from "@/components/crm/ActivityDialog";
import BidLinesGrid, { type BidLine } from "@/components/crm/BidLinesGrid";
import OpportunityDialog from "@/components/crm/OpportunityDialog";
import { opportunityFilesQueryKey, type OpportunityAttachment, type OpportunityFileLine } from "@/components/OpportunityFiles";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import { parseHashSearch, useHashSearch } from "@/lib/hash-location";
import CalculatorTab, { scenarioQueryKey } from "@/pages/opportunity/CalculatorTab";
import { pinnedBidFigure } from "@shared/dealCalcApi";
import { useToast } from "@/hooks/use-toast";
import { acquiredLeaseTable, bidStageLabel, leaseWizardHref, type OpportunityRow } from "@shared/crm";

type Offering = {
  opportunity: OpportunityRow & { seller_name?: string | null; broker_name?: string | null };
  lines: BidLine[];
  file_lines?: OpportunityFileLine[];
};

type TimelineItem = { id: string; occurred_at: string; kind: string; body: string; actor: string | null };

export default function BidOfferingPage() {
  const [, params] = useRoute("/opportunities/:id");
  const id = Number(params?.id);
  const canWrite = useCanEdit();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [filesLineId, setFilesLineId] = useState<number | null>(null);
  const hash = useHashSearch();
  const [tab, setTab] = useState(parseHashSearch(hash).get("tab") === "calculator" ? "calculator" : "lines");
  const [priceLineId, setPriceLineId] = useState<number | null>(null);
  const scenarios = useQuery({
    queryKey: scenarioQueryKey(id),
    queryFn: () => apiGet<{ numbersHidden: boolean; scenarios: Array<{ opportunity_line_id: number | null; is_pinned: boolean; verdict?: string | null; method: string; max_bid_per_car?: number | null; wayne_bid_per_car?: number | null }> }>(`/api/opportunities/${id}/scenarios`),
    enabled: canWrite && Number.isFinite(id) && id > 0,
  });
  const calcByLine = useMemo(() => {
    const map: Record<number, { verdict: string | null; bid: number | null }> = {};
    for (const row of scenarios.data?.scenarios ?? []) {
      if (!row.is_pinned || row.opportunity_line_id == null) continue;
      map[row.opportunity_line_id] = {
        verdict: row.verdict ?? null,
        bid: pinnedBidFigure({
          method: row.method,
          max_bid_per_car: row.max_bid_per_car ?? null,
          wayne_bid_per_car: row.wayne_bid_per_car ?? null,
        }),
      };
    }
    return map;
  }, [scenarios.data]);
  const offering = useQuery({
    queryKey: ["/api/opportunities", id, "bid"],
    queryFn: () => apiGet<Offering>(`/api/opportunities/${id}/bid`),
    enabled: Number.isFinite(id) && id > 0,
  });
  const timeline = useQuery({
    queryKey: ["/api/opportunities", id, "timeline"],
    queryFn: () => apiGet<TimelineItem[]>(`/api/opportunities/${id}/timeline`),
    enabled: Number.isFinite(id) && id > 0,
  });
  const files = useQuery({
    queryKey: opportunityFilesQueryKey(id),
    queryFn: () => apiGet<OpportunityAttachment[]>(`/api/attachments/opportunity/${id}`),
    enabled: canWrite && Number.isFinite(id) && id > 0,
  });
  const opp = offering.data?.opportunity;
  const lines = offering.data?.lines ?? [];
  const fileLines: OpportunityFileLine[] = offering.data?.file_lines ?? lines.filter((line) => line.id).map((line) => ({
    id: line.id!,
    label: [line.seller_deal_ref, line.lessee_desc].filter(Boolean).join(" – "),
    deleted: false,
  }));
  const fileCounts: Record<number, number> = {};
  for (const file of files.data ?? []) {
    if (file.opportunity_line_id != null) {
      fileCounts[file.opportunity_line_id] = (fileCounts[file.opportunity_line_id] ?? 0) + 1;
    }
  }
  const wonLines = lines.filter((line) => line.outcome === "won");
  const title = opp?.offering_name || opp?.seller_name || (opp ? `Opportunity ${opp.id}` : "Offering");

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={title}
        subtitle={opp ? `${opp.seller_name || opp.account_name || "Seller"} · ${bidStageLabel(opp.stage, opp.outcome, opp.bid_substage)}` : "Portfolio bid"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/opportunities" className="text-sm text-primary hover:underline self-center">Back to bids</Link>
            {canWrite && opp ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit offering</Button> : null}
          </div>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4">
        {offering.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {offering.isError ? <p className="text-sm text-destructive">Could not load this offering.</p> : null}
        {opp && opp.flavor !== "portfolio_bid" ? (
          <div className="space-y-4">
            <p className="text-sm">This opportunity is not a portfolio bid. Open it from the pipeline to edit the usual fields.</p>
            <CalculatorTab opportunityId={opp.id} opportunity={opp} lines={lines} canWrite={canWrite} />
          </div>
        ) : null}
        {opp && opp.flavor === "portfolio_bid" ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="lines">Lines</TabsTrigger>
              <TabsTrigger value="calculator">Calculator</TabsTrigger>
              {canWrite ? <TabsTrigger value="files">Files</TabsTrigger> : null}
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>
            <TabsContent value="lines" className="mt-4 space-y-4">
              <BidLinesGrid
                opportunityId={opp.id}
                lines={lines}
                canWrite={canWrite}
                canSeePrices={canWrite}
                parentIsWon={opp.stage === "won"}
                onWonLine={() => toast({ title: "Mark offering Won?" })}
                fileCounts={fileCounts}
                onOpenFiles={canWrite ? setFilesLineId : undefined}
                calcByLine={calcByLine}
                onPriceLine={canWrite ? (lineId) => { setPriceLineId(lineId); setTab("calculator"); } : undefined}
              />
              {opp.stage === "won" ? <WonPanel opportunity={opp} lines={wonLines} canSeePrices={canWrite} /> : null}
            </TabsContent>
            <TabsContent value="calculator" className="mt-4">
              <CalculatorTab
                opportunityId={opp.id}
                opportunity={opp}
                lines={lines}
                canWrite={canWrite}
                focusLineId={priceLineId}
              />
            </TabsContent>
            {canWrite ? (
              <TabsContent value="files" className="mt-4">
                <AttachmentsPanel entityType="opportunity" entityId={opp.id} lines={fileLines} />
              </TabsContent>
            ) : null}
            <TabsContent value="timeline" className="mt-4 space-y-3">
              {canWrite ? <Button size="sm" variant="outline" onClick={() => setActivityOpen(true)}>Add note</Button> : null}
              {(timeline.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No timeline yet.</p> : null}
              <ul className="space-y-2 text-sm">
                {(timeline.data ?? []).map((item) => (
                  <li key={item.id} className="border rounded-md px-3 py-2">
                    <div className="text-xs text-muted-foreground">{item.occurred_at.slice(0, 16).replace("T", " ")} · {item.actor || "—"} · {item.kind}</div>
                    <div>{item.body}</div>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        ) : null}
      </div>
      {opp ? (
        <OpportunityDialog open={editing} onOpenChange={setEditing} canWrite={canWrite} editing={opp} accountId={opp.account_id} accountName={opp.account_name ?? undefined} />
      ) : null}
      {opp && filesLineId != null ? (
        <Dialog open onOpenChange={(open) => { if (!open) setFilesLineId(null); }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Deal files</DialogTitle>
              <DialogDescription>
                {fileLines.find((line) => line.id === filesLineId)?.label ?? "This deal"}
              </DialogDescription>
            </DialogHeader>
            <AttachmentsPanel entityType="opportunity" entityId={opp.id} lines={fileLines} lineId={filesLineId} />
          </DialogContent>
        </Dialog>
      ) : null}
      {opp ? (
        <ActivityDialog
          open={activityOpen}
          onOpenChange={setActivityOpen}
          canWrite={canWrite}
          accountId={opp.account_id}
          opportunityId={opp.id}
        />
      ) : null}
    </div>
  );
}

function WonPanel({
  opportunity,
  lines,
  canSeePrices,
}: {
  opportunity: OpportunityRow;
  lines: BidLine[];
  canSeePrices: boolean;
}) {
  const { toast } = useToast();
  const href = leaseWizardHref(opportunity.account_id);
  const table = acquiredLeaseTable(lines.map((line) => ({
    seller_deal_ref: line.seller_deal_ref,
    lessee_desc: line.lessee_desc,
    lessee_country: line.lessee_country,
    aar_code: line.aar_code,
    car_type: line.car_type,
    car_count: line.car_count,
    lease_rate: canSeePrices ? line.lease_rate : null,
    lease_expiry: line.lease_expiry,
    purchase_option: line.purchase_option,
    final_price_per_car: canSeePrices ? line.final_price_per_car : null,
    close_date: opportunity.expected_close,
  })));
  return (
    <section className="border rounded-md p-3 space-y-2">
      <h2 className="text-sm font-semibold">Next: set up in Lease Management</h2>
      <p className="text-xs text-muted-foreground">Read only. Lease Management creates the account, lease, and cars. Nothing here writes to a lease.</p>
      {lines.length === 0 ? <p className="text-sm text-muted-foreground">No won lines yet.</p> : (
        <pre className="text-xs overflow-auto whitespace-pre font-mono">{table}</pre>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(table).then(() => toast({ title: "Copied as a table" }));
          }}
        >
          Copy as table
        </Button>
        {href ? <a className="text-sm text-primary hover:underline self-center" href={href}>Open lease wizard</a> : null}
      </div>
    </section>
  );
}
