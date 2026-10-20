import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadDealCalcExcel } from "@/lib/dealCalcExcel";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { offerUndoToast } from "@/lib/undo";
import { useToast } from "@/hooks/use-toast";
import {
  CALC_METHODS,
  DEAL_TYPES,
  addMonths,
  buildInputsFromLine,
  companyDefaultInputs,
  dealCalc,
  formatYmd,
  parseYmd,
  resetInput,
  type CalcMethod,
  type DealCalcInputs,
  type DealCalcResult,
  type DealType,
  type PostLeasePlan,
  type Sourced,
} from "@shared/dealCalc";
import { applyPriceWhichLabel, calcMethodLabel, LEGACY_BID_MODEL_LABEL, pinnedBidFigure, usePriceDisabledReason } from "@shared/dealCalcApi";
import { applyWhatIf, saveScenarioPayload, scratchInputs } from "@shared/dealCalcScratch";
import { DEAL_CALC_TOOLTIPS, type DealCalcTooltipKey } from "@shared/dealCalcTooltips";
import type { OpportunityRow } from "@shared/crm";
import type { BidLine } from "@/components/crm/BidLinesGrid";

type ScenarioRow = {
  id: number;
  name: string;
  opportunity_line_id: number | null;
  deal_type: string;
  method: string;
  post_lease_plan: string;
  is_pinned: boolean;
  created_at: string;
  verdict?: string | null;
  max_bid_per_car?: number | null;
  wayne_bid_per_car?: number | null;
  irr?: number | null;
  npv?: number | null;
  inputs?: DealCalcInputs;
  notes?: string | null;
};

type ScenarioList = { numbersHidden: boolean; scenarios: ScenarioRow[] };

type PickerLine = { id?: number; seller_deal_ref?: string | null; lessee_desc?: string | null; car_count?: number | null };

type Props = {
  opportunityId: number;
  opportunity?: OpportunityRow;
  lines?: BidLine[];
  canWrite: boolean;
  focusLineId?: number | null;
  /** No opportunity. The run stays in the browser until Save to opportunity. */
  scratch?: boolean;
  /** Offline render for the screenshot fixture. Skips the API. */
  preview?: { inputs: DealCalcInputs; viewer?: boolean; scenarios?: ScenarioRow[] };
};

export function scenarioQueryKey(opportunityId: number) {
  return ["/api/opportunities", opportunityId, "scenarios"] as const;
}

export default function CalculatorTab({ opportunityId, opportunity, lines = [], canWrite, focusLineId, scratch = false, preview }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const scenarios = useQuery({
    queryKey: scenarioQueryKey(opportunityId),
    queryFn: () => apiGet<ScenarioList>(`/api/opportunities/${opportunityId}/scenarios`),
    enabled: !preview && !scratch && opportunityId > 0,
  });
  const defaults = useQuery({
    queryKey: ["/api/calc/defaults"],
    queryFn: () => apiGet<{ assumption_set: { inputs: DealCalcInputs } }>("/api/calc/defaults"),
    enabled: canWrite && !preview,
  });
  const fallbackCompany = useMemo(() => companyDefaultInputs(), []);
  const company = defaults.data?.assumption_set.inputs ?? fallbackCompany;
  const rows = preview?.scenarios ?? scenarios.data?.scenarios ?? [];
  const numbersHidden = preview?.viewer ?? scenarios.data?.numbersHidden ?? !canWrite;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DealCalcInputs | null>(preview?.inputs ?? null);
  const [name, setName] = useState("Scenario");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [compare, setCompare] = useState<number[]>([]);
  const [seedLine, setSeedLine] = useState<number | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveOppId, setSaveOppId] = useState<number | null>(null);
  const [saveLineId, setSaveLineId] = useState<number | null>(null);
  const [savedHref, setSavedHref] = useState<string | null>(null);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const line = lines.find((item) => item.id === (selected?.opportunity_line_id ?? seedLine ?? focusLineId)) ?? null;
  const baseline = useMemo(() => {
    if (scratch || !opportunity) return scratchInputs(company);
    return buildInputsFromLine({
      opportunity,
      line: line ? {
        car_count: line.car_count,
        car_type: line.car_type,
        aar_code: line.aar_code,
        avg_build_year: line.avg_build_year,
        lease_rate: line.lease_rate,
        lease_expiry: line.lease_expiry,
        lessee_rating: line.lessee_rating,
        prelim_price_per_car: line.prelim_price_per_car,
        final_price_per_car: line.final_price_per_car,
      } : null,
      company,
    });
  }, [scratch, opportunity, line, company]);

  useEffect(() => {
    if (scratch || !opportunity) return;
    if (!focusLineId || focusLineId === seedLine) return;
    setSeedLine(focusLineId);
    setSelectedId(null);
    const seeded = buildInputsFromLine({
      opportunity,
      line: lines.find((item) => item.id === focusLineId) ?? null,
      company,
    });
    setDraft(seeded);
    setName(`Deal ${lines.find((item) => item.id === focusLineId)?.seller_deal_ref ?? focusLineId}`);
    setDirty(true);
  }, [focusLineId, seedLine, opportunity, lines, company]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  function loadRow(row: ScenarioRow | null) {
    if (dirty && !window.confirm("Discard unsaved calculator changes?")) return;
    setSelectedId(row?.id ?? null);
    setSeedLine(row?.opportunity_line_id ?? null);
    setDraft(row?.inputs ? structuredClone(row.inputs) : null);
    setName(row?.name ?? "Scenario");
    setNotes(row?.notes ?? "");
    setDirty(false);
  }

  const inputs = draft ?? selected?.inputs ?? baseline;
  const result = useMemo(() => dealCalc(inputs), [inputs]);

  function edit(next: DealCalcInputs) {
    setDraft(next);
    setDirty(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        notes,
        opportunity_line_id: line?.id ?? selected?.opportunity_line_id ?? null,
        inputs,
      };
      const res = selectedId
        ? await apiRequest("PATCH", `/api/opportunities/${opportunityId}/scenarios/${selectedId}`, payload)
        : await apiRequest("POST", `/api/opportunities/${opportunityId}/scenarios`, payload);
      return res.json() as Promise<{ scenario: ScenarioRow; change_group?: string }>;
    },
    onSuccess: (saved) => {
      offerUndoToast(saved);
      setSelectedId(saved.scenario.id);
      setDirty(false);
      void qc.invalidateQueries({ queryKey: scenarioQueryKey(opportunityId) });
    },
    onError: (err: Error) => toast({ title: "Could not save scenario", description: err.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Save the scenario before deleting it");
      const res = await apiRequest("POST", `/api/opportunities/${opportunityId}/scenarios/${selectedId}/delete`, {});
      return res.json();
    },
    onSuccess: (saved) => {
      offerUndoToast(saved);
      setSelectedId(null);
      setDraft(null);
      setDirty(false);
      void qc.invalidateQueries({ queryKey: scenarioQueryKey(opportunityId) });
    },
    onError: (err: Error) => toast({ title: "Could not delete scenario", description: err.message, variant: "destructive" }),
  });

  const pin = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Save the scenario before pinning it");
      const res = await apiRequest("POST", `/api/opportunities/${opportunityId}/scenarios/${selectedId}/pin`, {});
      return res.json();
    },
    onSuccess: (saved) => {
      offerUndoToast(saved);
      void qc.invalidateQueries({ queryKey: scenarioQueryKey(opportunityId) });
    },
    onError: (err: Error) => toast({ title: "Could not pin scenario", description: err.message, variant: "destructive" }),
  });

  const applyPrice = useMutation({
    mutationFn: async (choice: { field: "prelim" | "final"; which: "max" | "stretch" | "wayne" }) => {
      if (!selectedId) throw new Error("Save the scenario before using its price");
      const res = await apiRequest("POST", `/api/opportunities/${opportunityId}/scenarios/${selectedId}/apply-price`, choice);
      return res.json();
    },
    onSuccess: (saved) => {
      offerUndoToast(saved);
      toast({ title: "Price written to the bid line" });
      void qc.invalidateQueries({ queryKey: ["/api/opportunities", opportunityId, "bid"] });
    },
    onError: (err: Error) => toast({ title: "Could not use this price", description: err.message, variant: "destructive" }),
  });

  const openOpps = useQuery({
    queryKey: ["/api/opportunities", "scratch-open"],
    queryFn: () => apiGet<OpportunityRow[]>("/api/opportunities?open=1"),
    enabled: scratch && saveOpen && !preview,
  });
  const oppLines = useQuery({
    queryKey: ["/api/opportunities", saveOppId, "lines"],
    queryFn: () => apiGet<PickerLine[]>(`/api/opportunities/${saveOppId}/lines`),
    enabled: scratch && saveOpen && !preview && saveOppId != null,
  });
  const attach = useMutation({
    mutationFn: async () => {
      if (!saveOppId) throw new Error("Pick an opportunity");
      const payload = saveScenarioPayload({ name, notes, inputs, opportunityLineId: saveLineId });
      const res = await apiRequest("POST", `/api/opportunities/${saveOppId}/scenarios`, payload);
      return res.json() as Promise<{ scenario: ScenarioRow; change_group?: string }>;
    },
    onSuccess: (saved) => {
      offerUndoToast(saved);
      setDirty(false);
      setSavedHref(saveOppId ? `/opportunities/${saveOppId}?tab=calculator` : null);
      toast({ title: "Saved to the opportunity" });
      if (saveOppId) void qc.invalidateQueries({ queryKey: scenarioQueryKey(saveOppId) });
    },
    onError: (err: Error) => toast({ title: "Could not save scenario", description: err.message, variant: "destructive" }),
  });

  if (!preview && !scratch && scenarios.isLoading) return <p className="text-sm text-muted-foreground">Loading scenarios…</p>;
  if (!preview && !scratch && scenarios.isError) return <p className="text-sm text-destructive">Could not load scenarios.</p>;
  if (numbersHidden || !canWrite) {
    return (
      <div className="space-y-3" data-testid="calc-viewer">
        <p className="text-sm">Pricing visible to editors/admins.</p>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No scenarios yet.</p> : null}
        <ul className="text-sm space-y-1">
          {rows.map((row) => (
            <li key={row.id}>{row.is_pinned ? "★ " : ""}{row.name}</li>
          ))}
        </ul>
      </div>
    );
  }

  const priceReason = !scratch && opportunity ? usePriceDisabledReason({
    lineId: line?.id ?? selected?.opportunity_line_id ?? null,
    linePresent: Boolean(line),
    lineOutcome: line?.outcome ?? null,
    opportunityStage: opportunity.stage,
    opportunityOutcome: opportunity.outcome,
  }) : null;

  return (
    <div className="space-y-4" data-testid="calc-editor">
      <div className="flex flex-wrap items-end gap-2">
        {scratch ? null : (
          <label className="text-xs space-y-1">
            <span className="text-muted-foreground">Scenario</span>
            <select
              className="block h-9 rounded-md border bg-background px-2 text-sm"
              value={selectedId ?? ""}
              onChange={(event) => loadRow(rows.find((row) => row.id === Number(event.target.value)) ?? null)}
            >
              <option value="">Unsaved draft</option>
              {rows.map((row) => (
                <option key={row.id} value={row.id}>{row.is_pinned ? "★ " : ""}{row.name}</option>
              ))}
            </select>
          </label>
        )}
        <Input className="h-9 w-48" value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} aria-label="Scenario name" />
        <Button type="button" size="sm" variant="outline" onClick={() => { setSelectedId(null); setDraft(structuredClone(baseline)); setName("Scenario"); setDirty(true); }}>New</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => { setSelectedId(null); setDraft(structuredClone(inputs)); setName(`Copy of ${name}`); setDirty(true); }}>Duplicate</Button>
        {scratch ? (
          <Button type="button" size="sm" data-testid="save-to-opportunity" onClick={() => setSaveOpen(true)}>Save to opportunity</Button>
        ) : (
          <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
        )}
        {scratch ? (
          <Button type="button" size="sm" variant="outline" data-testid="download-excel" onClick={() => downloadDealCalcExcel(name, result)}>Download Excel</Button>
        ) : (
          <>
            <Button type="button" size="sm" variant="outline" disabled={!selectedId || remove.isPending} onClick={() => remove.mutate()}>Delete</Button>
            <Button type="button" size="sm" variant="outline" disabled={!selectedId || pin.isPending} onClick={() => pin.mutate()}>{selected?.is_pinned ? "Pinned" : "Pin"}</Button>
          </>
        )}
        <MethodSwitch value={inputs.method.value} onChange={(method) => edit({ ...inputs, method: { value: method, source: "user" } })} />
        {scratch ? <span className="text-xs text-muted-foreground" data-testid="scratch-note">Scratch. Nothing is stored until you save to an opportunity.</span> : null}
        {!scratch && dirty ? <span className="text-xs text-amber-600">Unsaved changes</span> : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <div className="space-y-4">
          <Group title="Deal & timing">
            <SelectField label="Deal type" tip="dealType" value={inputs.dealType} options={DEAL_TYPES} onChange={(value) => edit({ ...inputs, dealType: { value: value as DealType, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "dealType"))} />
            <DateField label="Close" tip="closeDate" sourced={inputs.closeDate} onChange={(value) => edit({ ...inputs, closeDate: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "closeDate"))} />
            <DateField label="First rent" tip="firstRentDate" sourced={inputs.firstRentDate} onChange={(value) => edit({ ...inputs, firstRentDate: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "firstRentDate"))} />
          </Group>
          <Group title="Cars">
            <NumField label="Cars" tip="carCount" sourced={inputs.carCount} onChange={(value) => edit({ ...inputs, carCount: { value: value ?? 0, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "carCount"))} />
            <TextField label="Car type" tip="carType" sourced={inputs.carType} onChange={(value) => edit({ ...inputs, carType: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "carType"))} />
            <TextField label="AAR" tip="aarCode" sourced={inputs.aarCode} onChange={(value) => edit({ ...inputs, aarCode: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "aarCode"))} />
            <NumField label="Avg build year" tip="avgBuildYear" sourced={inputs.avgBuildYear} onChange={(value) => edit({ ...inputs, avgBuildYear: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "avgBuildYear"))} />
            <NumField label="Useful life (years)" tip="usefulLifeYears" sourced={inputs.usefulLifeYears} onChange={(value) => edit({ ...inputs, usefulLifeYears: { value: value ?? 50, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "usefulLifeYears"))} />
          </Group>
          <Group title="Lease">
            <NumField label="Rent / car / month" tip="monthlyRent" sourced={inputs.monthlyRent} onChange={(value) => edit({ ...inputs, monthlyRent: { value: value ?? 0, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "monthlyRent"))} />
            <DateField label="Lease expiry" tip="leaseExpiry" sourced={inputs.leaseExpiry} onChange={(value) => edit({ ...inputs, leaseExpiry: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "leaseExpiry"))} />
            <TextField label="Lessee rating" tip="lesseeRating" sourced={inputs.lesseeRating} onChange={(value) => edit({ ...inputs, lesseeRating: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "lesseeRating"))} />
            <PctField label="Credit loss" tip="creditLossPct" sourced={inputs.creditLossPct} onChange={(value) => edit({ ...inputs, creditLossPct: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "creditLossPct"))} />
            <PctField label="Rent escalator" tip="rentEscalatorPct" sourced={inputs.rentEscalatorPct} onChange={(value) => edit({ ...inputs, rentEscalatorPct: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "rentEscalatorPct"))} />
            <PctField label="Utilization" tip="utilizationPct" sourced={inputs.utilizationPct} onChange={(value) => edit({ ...inputs, utilizationPct: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "utilizationPct"))} />
          </Group>
          <Group title="After the lease">
            <RadioGroup value={inputs.postLeasePlan.value} onValueChange={(value) => edit({ ...inputs, postLeasePlan: { value: value as PostLeasePlan, source: "user" } })} className="flex gap-4">
              <Label className="flex items-center gap-2 text-sm"><RadioGroupItem value="sell" /> Sell</Label>
              <Label className="flex items-center gap-2 text-sm"><RadioGroupItem value="relet" /> Re-let</Label>
            </RadioGroup>
            {inputs.postLeasePlan.value === "sell" ? (
              <>
                <NumField label="End value / car" tip="endValuePerCar" sourced={inputs.sell.endValuePerCar} onChange={(value) => edit({ ...inputs, sell: { ...inputs.sell, endValuePerCar: { value, source: "user" } } })} onReset={() => edit({ ...inputs, sell: { ...inputs.sell, endValuePerCar: baseline.sell.endValuePerCar } })} />
                <NumField label="Scrap / car" tip="scrapPerCar" sourced={inputs.sell.scrapPerCar} onChange={(value) => edit({ ...inputs, sell: { ...inputs.sell, scrapPerCar: { value: value ?? 0, source: "user" } } })} onReset={() => edit({ ...inputs, sell: { ...inputs.sell, scrapPerCar: baseline.sell.scrapPerCar } })} />
              </>
            ) : (
              <>
                <NumField label="Idle months" tip="idleMonths" sourced={inputs.relet.idleMonths} onChange={(value) => edit({ ...inputs, relet: { ...inputs.relet, idleMonths: { value: value ?? 0, source: "user" } } })} onReset={() => edit({ ...inputs, relet: { ...inputs.relet, idleMonths: baseline.relet.idleMonths } })} />
                <PctField label="Re-let rent" tip="reletRentPct" sourced={inputs.relet.rentPct} onChange={(value) => edit({ ...inputs, relet: { ...inputs.relet, rentPct: { value, source: "user" } } })} onReset={() => edit({ ...inputs, relet: { ...inputs.relet, rentPct: baseline.relet.rentPct } })} />
                <NumField label="Re-let term (months)" tip="reletTermMonths" sourced={inputs.relet.termMonths} onChange={(value) => edit({ ...inputs, relet: { ...inputs.relet, termMonths: { value: value ?? 0, source: "user" } } })} onReset={() => edit({ ...inputs, relet: { ...inputs.relet, termMonths: baseline.relet.termMonths } })} />
                <NumField label="Remarketing / car" tip="remarketingPerCar" sourced={inputs.relet.remarketingPerCar} onChange={(value) => edit({ ...inputs, relet: { ...inputs.relet, remarketingPerCar: { value: value ?? 0, source: "user" } } })} onReset={() => edit({ ...inputs, relet: { ...inputs.relet, remarketingPerCar: baseline.relet.remarketingPerCar } })} />
                <NumField label="Storage / car / month" tip="storagePerCarMonth" sourced={inputs.relet.storagePerCarMonth} onChange={(value) => edit({ ...inputs, relet: { ...inputs.relet, storagePerCarMonth: { value: value ?? 0, source: "user" } } })} onReset={() => edit({ ...inputs, relet: { ...inputs.relet, storagePerCarMonth: baseline.relet.storagePerCarMonth } })} />
                <NumField label="End value after re-let" tip="reletEndValuePerCar" sourced={inputs.relet.endValuePerCar} onChange={(value) => edit({ ...inputs, relet: { ...inputs.relet, endValuePerCar: { value, source: "user" } } })} onReset={() => edit({ ...inputs, relet: { ...inputs.relet, endValuePerCar: baseline.relet.endValuePerCar } })} />
              </>
            )}
          </Group>
          <Group title="Costs (optional)">
            <NumField label="Make-ready / car" tip="makeReadyPerCar" sourced={inputs.makeReadyPerCar} onChange={(value) => edit({ ...inputs, makeReadyPerCar: { value: value ?? 0, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "makeReadyPerCar"))} />
            <NumField label="Maintenance / car / month" tip="maintPcpm" sourced={inputs.maintPcpm} onChange={(value) => edit({ ...inputs, maintPcpm: { value: value ?? 0, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "maintPcpm"))} />
            <PctField label="Maintenance growth" tip="maintGrowthPct" sourced={inputs.maintGrowthPct} onChange={(value) => edit({ ...inputs, maintGrowthPct: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "maintGrowthPct"))} />
            <PctField label="Management fee" tip="mgmtFeePct" sourced={inputs.mgmtFeePct} onChange={(value) => edit({ ...inputs, mgmtFeePct: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "mgmtFeePct"))} />
            <NumField label="Overhead / car / month" tip="overheadPcpm" sourced={inputs.overheadPcpm} onChange={(value) => edit({ ...inputs, overheadPcpm: { value: value ?? 0, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "overheadPcpm"))} />
            <NumField label="Insurance / car / month" tip="insurancePcpm" sourced={inputs.insurancePcpm} onChange={(value) => edit({ ...inputs, insurancePcpm: { value: value ?? 0, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "insurancePcpm"))} />
            <NumField label="Property tax / car / month" tip="propTaxPcpm" sourced={inputs.propTaxPcpm} onChange={(value) => edit({ ...inputs, propTaxPcpm: { value: value ?? 0, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "propTaxPcpm"))} />
          </Group>
          <Group title="Targets & financing">
            <PctField label="Target IRR" tip="targetIrr" sourced={inputs.targetIrr} onChange={(value) => edit({ ...inputs, targetIrr: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "targetIrr"))} />
            <PctField label="Stretch IRR" tip="stretchIrr" sourced={inputs.stretchIrr} onChange={(value) => edit({ ...inputs, stretchIrr: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "stretchIrr"))} />
            <PctField label="Discount rate" tip="discountRate" sourced={inputs.discountRate} onChange={(value) => edit({ ...inputs, discountRate: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "discountRate"))} />
            <PctField label="Debt base" tip="debtBase" sourced={inputs.wayne.debtBase} onChange={(value) => edit({ ...inputs, wayne: { ...inputs.wayne, debtBase: { value, source: "user" } } })} onReset={() => edit({ ...inputs, wayne: { ...inputs.wayne, debtBase: baseline.wayne.debtBase } })} />
            <NumField label="Spread (bps)" tip="spreadBps" sourced={inputs.wayne.spreadBps} onChange={(value) => edit({ ...inputs, wayne: { ...inputs.wayne, spreadBps: { value: value ?? 0, source: "user" } } })} onReset={() => edit({ ...inputs, wayne: { ...inputs.wayne, spreadBps: baseline.wayne.spreadBps } })} />
            <PctField label="Equity return" tip="equityReturn" sourced={inputs.wayne.equityReturn} onChange={(value) => edit({ ...inputs, wayne: { ...inputs.wayne, equityReturn: { value, source: "user" } } })} onReset={() => edit({ ...inputs, wayne: { ...inputs.wayne, equityReturn: baseline.wayne.equityReturn } })} />
            <PctField label="Debt closing cost" tip="debtClosePct" sourced={inputs.wayne.debtClosePct} onChange={(value) => edit({ ...inputs, wayne: { ...inputs.wayne, debtClosePct: { value, source: "user" } } })} onReset={() => edit({ ...inputs, wayne: { ...inputs.wayne, debtClosePct: baseline.wayne.debtClosePct } })} />
            <PctField label="Transaction cost" tip="txnCostPct" sourced={inputs.wayne.txnCostPct} onChange={(value) => edit({ ...inputs, wayne: { ...inputs.wayne, txnCostPct: { value, source: "user" } } })} onReset={() => edit({ ...inputs, wayne: { ...inputs.wayne, txnCostPct: baseline.wayne.txnCostPct } })} />
            <PctField label="Leverage target" tip="leverageTarget" sourced={inputs.wayne.leverageTarget} onChange={(value) => edit({ ...inputs, wayne: { ...inputs.wayne, leverageTarget: { value, source: "user" } } })} onReset={() => edit({ ...inputs, wayne: { ...inputs.wayne, leverageTarget: baseline.wayne.leverageTarget } })} />
            <NumField label="Price to test" tip="testPricePerCar" sourced={inputs.testPricePerCar} onChange={(value) => edit({ ...inputs, testPricePerCar: { value, source: "user" } })} onReset={() => edit(resetInput(inputs, baseline, "testPricePerCar"))} />
          </Group>
          <label className="block text-xs space-y-1">
            <span className="text-muted-foreground">Notes</span>
            <textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={2} value={notes} onChange={(event) => { setNotes(event.target.value); setDirty(true); }} />
          </label>
        </div>
        <Results result={result} showWayne={inputs.method.value !== "cash_flow"} showCash={inputs.method.value !== "wayne_leveraged"} />
      </div>
      {scratch ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Use this price</span>
          {(["prelim", "final"] as const).map((field) => (
            (["max", "stretch", "wayne"] as const).map((which) => (
              <Button
                key={`${field}-${which}`}
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(priceReason) || !selectedId || applyPrice.isPending}
                title={priceReason ?? `Write the ${applyPriceWhichLabel(which)} price into ${field}`}
                onClick={() => applyPrice.mutate({ field, which })}
              >
                {field} {applyPriceWhichLabel(which)}
              </Button>
            ))
          ))}
          {priceReason ? <span className="text-xs text-muted-foreground">{priceReason}</span> : null}
        </div>
      )}
      <Tabs defaultValue="cashflow">
        <TabsList>
          <TabsTrigger value="cashflow">Cash flow</TabsTrigger>
          <TabsTrigger value="sensitivity">Sensitivity</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
        </TabsList>
        <TabsContent value="cashflow" className="mt-3">
          <CashFlowTable result={result} />
        </TabsContent>
        <TabsContent value="sensitivity" className="mt-3 space-y-4">
          <WhatIfSliders inputs={inputs} />
          <SensitivityTable result={result} />
        </TabsContent>
        <TabsContent value="compare" className="mt-3">
          <CompareTable
            rows={rows.filter((row) => row.inputs)}
            selected={compare}
            onToggle={(id) => setCompare((current) => {
              if (current.includes(id)) return current.filter((item) => item !== id);
              if (current.length >= 4) return current;
              return [...current, id];
            })}
          />
        </TabsContent>
      </Tabs>
      {scratch ? (
        <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save to opportunity</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <label className="block space-y-1">
                <span className="text-muted-foreground">Opportunity</span>
                <select
                  className="block h-9 w-full rounded-md border bg-background px-2"
                  aria-label="Opportunity"
                  value={saveOppId ?? ""}
                  onChange={(event) => {
                    const next = event.target.value ? Number(event.target.value) : null;
                    setSaveOppId(next);
                    setSaveLineId(null);
                    setSavedHref(null);
                  }}
                >
                  <option value="">Select an opportunity</option>
                  {(openOpps.data ?? []).map((row) => (
                    <option key={row.id} value={row.id}>{row.offering_name || row.account_name || `Opportunity ${row.id}`}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground">Bid line (optional)</span>
                <select
                  className="block h-9 w-full rounded-md border bg-background px-2"
                  aria-label="Bid line"
                  value={saveLineId ?? ""}
                  onChange={(event) => setSaveLineId(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">No line</option>
                  {(oppLines.data ?? []).map((row) => (
                    <option key={row.id} value={row.id}>
                      {[row.seller_deal_ref, row.lessee_desc, row.car_count != null ? `${row.car_count} cars` : null].filter(Boolean).join(" · ") || `Line ${row.id}`}
                    </option>
                  ))}
                </select>
              </label>
              {savedHref ? <Link href={savedHref} className="text-primary hover:underline">Open the saved scenario</Link> : null}
            </div>
            <DialogFooter>
              <Button type="button" disabled={!saveOppId || attach.isPending || Boolean(preview)} onClick={() => attach.mutate()}>Save scenario</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function MethodSwitch({ value, onChange }: { value: CalcMethod; onChange: (method: CalcMethod) => void }) {
  return (
    <RadioGroup value={value} onValueChange={(next) => onChange(next as CalcMethod)} className="flex gap-3">
      {CALC_METHODS.map((method) => (
        <Label key={method} className="flex items-center gap-1 text-xs">
          <RadioGroupItem value={method} />
          {calcMethodLabel(method)}
        </Label>
      ))}
    </RadioGroup>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border rounded-md p-3 space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Tip({ tip }: { tip: DealCalcTooltipKey }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground" aria-label={DEAL_CALC_TOOLTIPS[tip]}>(?)</button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{DEAL_CALC_TOOLTIPS[tip]}</TooltipContent>
    </Tooltip>
  );
}

function FieldLabel({ label, tip, source, onReset }: { label: string; tip: DealCalcTooltipKey; source?: string; onReset: () => void }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      {source === "user" ? <button type="button" className="h-2 w-2 rounded-full bg-amber-500" title="Reset" onClick={onReset} /> : null}
      {label}
      <Tip tip={tip} />
    </span>
  );
}

function NumField({ label, tip, sourced, onChange, onReset }: { label: string; tip: DealCalcTooltipKey; sourced: Sourced<number | null>; onChange: (value: number | null) => void; onReset: () => void }) {
  return (
    <label className="text-xs space-y-1">
      <FieldLabel label={label} tip={tip} source={sourced.source} onReset={onReset} />
      <Input className="h-8" inputMode="decimal" value={sourced.value ?? ""} onChange={(event) => onChange(event.target.value.trim() === "" ? null : Number(event.target.value))} />
    </label>
  );
}

function PctField({ label, tip, sourced, onChange, onReset }: { label: string; tip: DealCalcTooltipKey; sourced: Sourced<number>; onChange: (value: number) => void; onReset: () => void }) {
  const shown = Number.isFinite(sourced.value) ? String(Math.round(sourced.value * 10000) / 100) : "";
  return (
    <label className="text-xs space-y-1">
      <FieldLabel label={`${label} %`} tip={tip} source={sourced.source} onReset={onReset} />
      <Input className="h-8" inputMode="decimal" value={shown} onChange={(event) => onChange((Number(event.target.value) || 0) / 100)} />
    </label>
  );
}

function TextField({ label, tip, sourced, onChange, onReset }: { label: string; tip: DealCalcTooltipKey; sourced: Sourced<string | null>; onChange: (value: string | null) => void; onReset: () => void }) {
  return (
    <label className="text-xs space-y-1">
      <FieldLabel label={label} tip={tip} source={sourced.source} onReset={onReset} />
      <Input className="h-8" value={sourced.value ?? ""} onChange={(event) => onChange(event.target.value.trim() ? event.target.value : null)} />
    </label>
  );
}

function DateField({ label, tip, sourced, onChange, onReset }: { label: string; tip: DealCalcTooltipKey; sourced: Sourced<string | null>; onChange: (value: string | null) => void; onReset: () => void }) {
  return (
    <label className="text-xs space-y-1">
      <FieldLabel label={label} tip={tip} source={sourced.source} onReset={onReset} />
      <Input className="h-8" type="date" value={sourced.value ?? ""} onChange={(event) => onChange(event.target.value || null)} />
    </label>
  );
}

function SelectField({ label, tip, value, options, onChange, onReset }: { label: string; tip: DealCalcTooltipKey; value: Sourced<string>; options: readonly string[]; onChange: (value: string) => void; onReset: () => void }) {
  return (
    <label className="text-xs space-y-1">
      <FieldLabel label={label} tip={tip} source={value.source} onReset={onReset} />
      <select className="h-8 w-full rounded-md border bg-background px-2" value={value.value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}
      </select>
    </label>
  );
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function Results({ result, showWayne, showCash }: { result: DealCalcResult; showWayne: boolean; showCash: boolean }) {
  const tone = result.verdict === "bid" ? "default" : result.verdict === "stretch" ? "secondary" : "outline";
  return (
    <aside className="border rounded-md p-3 space-y-3 h-fit" data-testid="calc-results">
      <div className="flex items-center gap-2">
        <Badge variant={tone}>{result.verdict}</Badge>
        <Tip tip="verdict" />
        <span className="text-xs text-muted-foreground">{result.nMonths} months</span>
      </div>
      <ul className="text-xs space-y-1 text-muted-foreground">
        {result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        {result.flags.map((flag) => <li key={flag}>{flag}</li>)}
      </ul>
      <div className={`grid gap-3 ${showWayne && showCash ? "grid-cols-2" : "grid-cols-1"}`}>
        {showCash ? <MetricColumn title="Cash flow" rows={[
          ["Max bid", money(result.cash.maxBidPerCar), "maxBid"],
          ["Stretch bid", money(result.cash.stretchBidPerCar), "stretchBid"],
          ["IRR", pct(result.cash.irr), "irr"],
          ["Effective IRR", pct(result.cash.effectiveAnnualIrr), "effectiveIrr"],
          ["NPV", money(result.cash.npv), "npv"],
          ["Payback", result.cash.paybackMonths == null ? "—" : `${result.cash.paybackMonths} mo`, "payback"],
          ["Cash on cash", pct(result.cash.cashOnCash), "cashOnCash"],
          ["LRF", result.cash.lrf == null ? "—" : result.cash.lrf.toFixed(4), "lrf"],
          ["Rent − maint", money(result.cash.margin), "margin"],
          ["Residual share", pct(result.cash.residualShare), "residualShare"],
        ]} /> : null}
        {showWayne && result.wayne ? <MetricColumn title={LEGACY_BID_MODEL_LABEL} rows={[
          [`${LEGACY_BID_MODEL_LABEL} bid`, money(result.wayne.bidPerCar), "wayneBid"],
          ["Acquisition", money(result.wayne.acqPerCar), "wayneBid"],
          ["IRR", pct(result.wayne.irr), "irr"],
          ["Effective IRR", pct(result.wayne.effectiveAnnualIrr), "effectiveIrr"],
          ["Debt", money(result.wayne.debt), "debtBase"],
          ["Equity", money(result.wayne.equity), "equityReturn"],
          ["Balloon", money(result.wayne.balloon), "leverageTarget"],
          ["LRF", result.wayne.lrf == null ? "—" : result.wayne.lrf.toFixed(4), "lrf"],
        ]} /> : null}
      </div>
      <p className="text-xs text-muted-foreground"><Tip tip="incomeTax" /> Before income tax.</p>
    </aside>
  );
}

function MetricColumn({ title, rows }: { title: string; rows: Array<[string, string, DealCalcTooltipKey]> }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="text-sm">
        {rows.map(([label, value, tip]) => (
          <div key={label} className="flex justify-between gap-2 border-b py-1">
            <dt className="text-muted-foreground flex items-center gap-1">{label} <Tip tip={tip} /></dt>
            <dd className="font-mono-num">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CashFlowTable({ result }: { result: DealCalcResult }) {
  const start = parseYmd(result.cashFlowStart);
  return (
    <div className="max-h-72 overflow-auto border rounded-md">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background"><tr><th className="px-2 py-1 text-left">Month</th><th className="px-2 py-1 text-right">Cash flow / car</th></tr></thead>
        <tbody>
          {result.monthlyCashFlows.map((flow, index) => {
            const date = start ? addMonths(start, index) : null;
            return (
              <tr key={index} className="border-t">
                <td className="px-2 py-1">{date ? formatYmd(date) : index}</td>
                <td className="px-2 py-1 text-right font-mono-num">{money(flow)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WhatIfSliders({ inputs }: { inputs: DealCalcInputs }) {
  const [rentPct, setRentPct] = useState(0);
  const [endPct, setEndPct] = useState(0);
  const shocked = useMemo(
    () => dealCalc(applyWhatIf(inputs, { rentPct: rentPct / 100, endValuePct: endPct / 100 })),
    [inputs, rentPct, endPct],
  );
  return (
    <div className="space-y-3 border rounded-md p-3" data-testid="calc-what-if">
      <p className="text-xs text-muted-foreground">What-if. The sliders do not change the scenario.</p>
      <label className="block text-xs space-y-1">
        <span>Rent {rentPct > 0 ? "+" : ""}{rentPct}%</span>
        <Slider aria-label="Rent what-if" value={[rentPct]} min={-20} max={20} step={1} onValueChange={(value) => setRentPct(value[0] ?? 0)} />
      </label>
      <label className="block text-xs space-y-1">
        <span>End value {endPct > 0 ? "+" : ""}{endPct}%</span>
        <Slider aria-label="End value what-if" value={[endPct]} min={-40} max={40} step={1} onValueChange={(value) => setEndPct(value[0] ?? 0)} />
      </label>
      <p className="text-sm" data-testid="what-if-verdict">
        {shocked.verdict} · max {money(shocked.cash.maxBidPerCar)}
        {shocked.wayne ? ` · ${LEGACY_BID_MODEL_LABEL} ${money(shocked.wayne.bidPerCar)}` : ""}
        {" · "}IRR {pct(shocked.cash.irr)}
      </p>
    </div>
  );
}

function SensitivityTable({ result }: { result: DealCalcResult }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-muted-foreground flex items-center gap-1">Rent shocks <Tip tip="sensitivity" /></p>
      <table className="w-full text-xs">
        <tbody>
          {result.sensitivity.rent.map((row) => (
            <tr key={row.label} className="border-t">
              <td className="py-1">{row.label}</td>
              <td className="py-1 text-right font-mono-num">{money(row.maxBidPerCar)}</td>
              <td className="py-1 text-right font-mono-num">{pct(row.irr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">Break-even end value {money(result.sensitivity.breakEvenEndValuePerCar)}</p>
    </div>
  );
}

function CompareTable({ rows, selected, onToggle }: { rows: ScenarioRow[]; selected: number[]; onToggle: (id: number) => void }) {
  const shown = rows.filter((row) => selected.includes(row.id)).slice(0, 4);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {rows.map((row) => (
          <label key={row.id} className="flex items-center gap-1">
            <input type="checkbox" checked={selected.includes(row.id)} onChange={() => onToggle(row.id)} />
            {row.name}
          </label>
        ))}
      </div>
      <table className="w-full text-xs">
        <thead><tr><th className="text-left">Scenario</th><th>Verdict</th><th>Bid</th><th>IRR</th></tr></thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="py-1">{row.name}</td>
              <td>{row.verdict ?? "—"}</td>
              <td className="font-mono-num">{money(pinnedBidFigure({ method: row.method, max_bid_per_car: row.max_bid_per_car ?? null, wayne_bid_per_car: row.wayne_bid_per_car ?? null }))}</td>
              <td className="font-mono-num">{pct(row.irr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
