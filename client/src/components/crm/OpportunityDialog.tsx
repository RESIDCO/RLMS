import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  LOSS_REASONS,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABEL,
  OPPORTUNITY_STAGE_LABEL,
  lostNeedsReason,
  remarketRiderUrl,
  wonReletNeedsRemarket,
  type OpportunityRow,
  type OpportunitySource,
  type OpportunityStage,
  type OpportunityType,
} from "@shared/crm";

type AccountOption = { id: number; name: string };

type FormState = {
  account_id: string;
  type: OpportunityType;
  stage: OpportunityStage;
  source: OpportunitySource;
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
};

function blankForm(seed?: Partial<FormState>): FormState {
  return {
    account_id: "",
    type: "renewal",
    stage: "identified",
    source: "manual",
    owner: "",
    rider_id: "",
    car_type: "",
    car_count: "",
    current_rate: "",
    target_rate: "",
    term_months: "",
    est_value: "",
    expiry_date: "",
    new_expiry_date: "",
    expected_close: "",
    won_rider_id: "",
    sublessee_note: "",
    competitor: "",
    loss_reason: "",
    notes: "",
    ...seed,
  };
}

function fromRow(row: OpportunityRow): FormState {
  return blankForm({
    account_id: String(row.account_id),
    type: row.type,
    stage: row.stage,
    source: row.source,
    owner: row.owner ?? "",
    rider_id: row.rider_id ? String(row.rider_id) : "",
    car_type: row.car_type ?? "",
    car_count: row.car_count == null ? "" : String(row.car_count),
    current_rate: row.current_rate == null ? "" : String(row.current_rate),
    target_rate: row.target_rate == null ? "" : String(row.target_rate),
    term_months: row.term_months == null ? "" : String(row.term_months),
    est_value: row.est_value == null ? "" : String(row.est_value),
    expiry_date: row.expiry_date ?? "",
    new_expiry_date: row.new_expiry_date ?? "",
    expected_close: row.expected_close ?? "",
    won_rider_id: row.won_rider_id ? String(row.won_rider_id) : "",
    sublessee_note: row.sublessee_note ?? "",
    competitor: row.competitor ?? "",
    loss_reason: row.loss_reason ?? "",
    notes: row.notes ?? "",
  });
}

function numOrNull(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export default function OpportunityDialog({
  open,
  onOpenChange,
  canWrite,
  accountId,
  accountName,
  editing,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
  accountId?: number;
  accountName?: string;
  editing?: OpportunityRow | null;
  preset?: Partial<FormState>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(() => blankForm(preset));
  const lockedAccount = accountId ?? editing?.account_id ?? null;

  useEffect(() => {
    if (!open) return;
    if (editing) setForm(fromRow(editing));
    else {
      setForm(
        blankForm({
          ...preset,
          account_id: lockedAccount ? String(lockedAccount) : preset?.account_id ?? "",
        }),
      );
    }
    // Reset only when the dialog opens or the edited row changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const accounts = useQuery({
    queryKey: ["/api/accounts"],
    queryFn: () => apiGet<AccountOption[]>("/api/accounts"),
    enabled: open && lockedAccount == null,
  });

  const riderId = numOrNull(form.rider_id);
  const wonRiderId = numOrNull(form.won_rider_id);
  const needsReason = lostNeedsReason(form.stage, form.loss_reason);
  const needsRemarket = wonReletNeedsRemarket({ type: form.type, stage: form.stage, won_rider_id: wonRiderId });
  const remarket = remarketRiderUrl(riderId);
  const needsEndDate = form.type === "renewal" && form.stage === "won" && !form.new_expiry_date;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        account_id: lockedAccount ?? numOrNull(form.account_id),
        type: form.type,
        stage: form.stage,
        source: form.source,
        owner: form.owner.trim() || null,
        rider_id: riderId,
        car_type: form.car_type.trim() || null,
        car_count: numOrNull(form.car_count),
        current_rate: numOrNull(form.current_rate),
        target_rate: numOrNull(form.target_rate),
        term_months: numOrNull(form.term_months),
        est_value: numOrNull(form.est_value),
        expiry_date: form.expiry_date || null,
        new_expiry_date: form.new_expiry_date || null,
        expected_close: form.expected_close || null,
        won_rider_id: wonRiderId,
        sublessee_note: form.sublessee_note.trim() || null,
        competitor: form.competitor.trim() || null,
        loss_reason: form.loss_reason || null,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const res = await apiRequest("PATCH", `/api/opportunities/${editing.id}`, payload);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/opportunities", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: editing ? "Opportunity updated" : "Opportunity created" });
      void qc.invalidateQueries({ queryKey: ["/api/opportunities"] });
      void qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const accountLabel = useMemo(() => {
    if (accountName) return accountName;
    return (accounts.data ?? []).find((row) => row.id === lockedAccount)?.name ?? (lockedAccount ? `Account ${lockedAccount}` : "");
  }, [accountName, accounts.data, lockedAccount]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Opportunity ${editing.id}` : "Opportunity"}</DialogTitle>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="sm:col-span-2">
            <Label>Account</Label>
            {lockedAccount ? (
              <div className="mt-1">{accountLabel}</div>
            ) : (
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2"
                value={form.account_id}
                onChange={(e) => set("account_id", e.target.value)}
                disabled={!canWrite}
              >
                <option value="">Select account</option>
                {(accounts.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Field label="Type">
            <SelectValue value={form.type} disabled={!canWrite} onChange={(value) => set("type", value as OpportunityType)} options={OPPORTUNITY_TYPES.map((value) => ({ value, label: OPPORTUNITY_TYPE_LABEL[value] }))} />
          </Field>
          <Field label="Stage">
            <SelectValue value={form.stage} disabled={!canWrite} onChange={(value) => set("stage", value as OpportunityStage)} options={OPPORTUNITY_STAGES.map((value) => ({ value, label: OPPORTUNITY_STAGE_LABEL[value] }))} />
          </Field>
          <Field label="Source">
            <SelectValue value={form.source} disabled={!canWrite} onChange={(value) => set("source", value as OpportunitySource)} options={OPPORTUNITY_SOURCES.map((value) => ({ value, label: value }))} />
          </Field>
          <Field label="Owner">
            <Input value={form.owner} disabled={!canWrite} onChange={(e) => set("owner", e.target.value)} placeholder="Account manager" />
          </Field>
          <Field label="OL rider id">
            <Input value={form.rider_id} disabled={!canWrite} onChange={(e) => set("rider_id", e.target.value)} />
          </Field>
          <Field label="Car type">
            <Input value={form.car_type} disabled={!canWrite} onChange={(e) => set("car_type", e.target.value)} />
          </Field>
          <Field label="Car count">
            <Input value={form.car_count} disabled={!canWrite} onChange={(e) => set("car_count", e.target.value)} />
          </Field>
          <Field label="Current rate">
            <Input value={form.current_rate} disabled={!canWrite} onChange={(e) => set("current_rate", e.target.value)} />
          </Field>
          <Field label="Target rate">
            <Input value={form.target_rate} disabled={!canWrite} onChange={(e) => set("target_rate", e.target.value)} />
          </Field>
          <Field label="Term months">
            <Input value={form.term_months} disabled={!canWrite} onChange={(e) => set("term_months", e.target.value)} />
          </Field>
          <Field label="Est. value">
            <Input value={form.est_value} disabled={!canWrite} onChange={(e) => set("est_value", e.target.value)} />
          </Field>
          <Field label="Expiry snapshot">
            <Input type="date" value={form.expiry_date} disabled={!canWrite} onChange={(e) => set("expiry_date", e.target.value)} />
          </Field>
          <Field label="Expected close">
            <Input type="date" value={form.expected_close} disabled={!canWrite} onChange={(e) => set("expected_close", e.target.value)} />
          </Field>
          <Field label="Sublessee note">
            <Input value={form.sublessee_note} disabled={!canWrite} onChange={(e) => set("sublessee_note", e.target.value)} />
          </Field>
          <Field label="Competitor">
            <Input value={form.competitor} disabled={!canWrite} onChange={(e) => set("competitor", e.target.value)} />
          </Field>
          {form.stage === "lost" ? (
            <Field label="Loss reason">
              <SelectValue
                value={form.loss_reason}
                disabled={!canWrite}
                onChange={(value) => set("loss_reason", value)}
                options={[{ value: "", label: "Required" }, ...LOSS_REASONS.map((value) => ({ value, label: value }))]}
              />
            </Field>
          ) : null}
          {form.type === "renewal" && form.stage === "won" ? (
            <Field label="New end date">
              <Input type="date" value={form.new_expiry_date} disabled={!canWrite} onChange={(e) => set("new_expiry_date", e.target.value)} />
            </Field>
          ) : null}
          {form.type === "relet" && form.stage === "won" ? (
            <div className="sm:col-span-2 space-y-2">
              <p className="text-sm">
                {remarket ? (
                  <Link href={remarket.replace(/^#/, "")} className="text-primary hover:underline">
                    Run remarket in Lease Management →
                  </Link>
                ) : (
                  "Run remarket in Lease Management, then record the new OL id."
                )}
              </p>
              <Field label="Won rider id">
                <Input value={form.won_rider_id} disabled={!canWrite} onChange={(e) => set("won_rider_id", e.target.value)} placeholder="successor rider id" />
              </Field>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <Label>Notes</Label>
            <textarea
              className="mt-1 w-full min-h-20 rounded-md border border-input bg-background px-2 py-1"
              value={form.notes}
              disabled={!canWrite}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>
        {needsReason ? <p className="text-sm text-destructive">Lost opportunities require a reason.</p> : null}
        {needsEndDate ? <p className="text-sm text-destructive">A won renewal needs the new end date. Nothing is written to the rider.</p> : null}
        {needsRemarket ? <p className="text-sm text-destructive">Mark won after remarket, once the new OL id is known.</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canWrite || save.isPending || needsReason || needsEndDate || needsRemarket || !(lockedAccount ?? numOrNull(form.account_id))}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SelectValue({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      className="h-9 w-full rounded-md border border-input bg-background px-2"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((option) => (
        <option key={option.value || "blank"} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
