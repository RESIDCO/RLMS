import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PartyPicker, { type PartySelection } from "@/components/crm/PartyPicker";
import SetupLesseeNote from "@/components/crm/SetupLesseeNote";
import { useToast } from "@/hooks/use-toast";
import {
  CAR_TYPE_SUGGESTIONS,
  LESSEE_ROLES,
  LOSS_REASONS,
  MANUAL_OPPORTUNITY_SOURCES,
  OPPORTUNITY_CONTACT_ROLE_LABEL,
  OPPORTUNITY_CONTACT_ROLES,
  OPPORTUNITY_SOURCE_LABEL,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABEL,
  OPPORTUNITY_STAGE_LABEL,
  bidStageId,
  bidStageOption,
  lostNeedsReason,
  remarketRiderUrl,
  wonReletNeedsRemarket,
  BID_STAGE_OPTIONS,
  type BidStageId,
  type LesseeRole,
  type OpportunityContactRole,
  type OpportunityContactRow,
  type OpportunityRow,
  type OpportunitySource,
  type OpportunityStage,
  type OpportunityType,
} from "@shared/crm";

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
  lessee_role: LesseeRole;
  tags: string[];
  referral_note: string;
  tagDraft: string;
  portfolio_bid: boolean;
  offering_name: string;
  received_date: string;
  bid_due_prelim: string;
  bid_due_final: string;
  award_date: string;
  bid_stage: BidStageId;
  seller_company_id: string;
  broker_company_id: string;
};

type ExtraContact = {
  name: string;
  email: string;
  phone: string;
  title: string;
  role: OpportunityContactRole;
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
    lessee_role: "lessee",
    tags: [],
    referral_note: "",
    tagDraft: "",
    portfolio_bid: false,
    offering_name: "",
    received_date: "",
    bid_due_prelim: "",
    bid_due_final: "",
    award_date: "",
    bid_stage: "received",
    seller_company_id: "",
    broker_company_id: "",
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
    lessee_role: row.lessee_role ?? "lessee",
    tags: row.tags ?? [],
    referral_note: row.referral_note ?? "",
    portfolio_bid: row.flavor === "portfolio_bid",
    offering_name: row.offering_name ?? "",
    received_date: row.received_date ?? "",
    bid_due_prelim: row.bid_due_prelim ?? "",
    bid_due_final: row.bid_due_final ?? "",
    award_date: row.award_date ?? "",
    bid_stage: bidStageId(row.stage, row.outcome, row.bid_substage) ?? "received",
    seller_company_id: row.seller_company_id ? String(row.seller_company_id) : "",
    broker_company_id: row.broker_company_id ? String(row.broker_company_id) : "",
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
  partyPreset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
  accountId?: number;
  accountName?: string;
  editing?: OpportunityRow | null;
  preset?: Partial<FormState>;
  partyPreset?: PartySelection | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(() => blankForm(preset));
  const [party, setParty] = useState<PartySelection | null>(partyPreset ?? null);
  const [broker, setBroker] = useState<PartySelection | null>(null);
  const [extraContacts, setExtraContacts] = useState<ExtraContact[]>([]);
  const [setup, setSetup] = useState<{ accountId: number; accountName: string } | null>(null);
  const lockedAccount = accountId ?? editing?.account_id ?? null;

  useEffect(() => {
    if (!open) return;
    setSetup(null);
    setExtraContacts([]);
    setParty(partyPreset ?? null);
    if (editing?.broker_company_id) {
      setBroker({
        entity: "company",
        entity_id: editing.broker_company_id,
        account_id: null,
        company_id: editing.broker_company_id,
        contact_id: null,
        label: editing.broker_name || `Company ${editing.broker_company_id}`,
        kind: "company",
      });
    } else {
      setBroker(null);
    }
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

  const savedContacts = useQuery({
    queryKey: ["/api/opportunities", editing?.id, "contacts"],
    queryFn: () => apiGet<OpportunityContactRow[]>(`/api/opportunities/${editing!.id}/contacts`),
    enabled: open && editing != null,
  });

  const riderId = numOrNull(form.rider_id);
  const wonRiderId = numOrNull(form.won_rider_id);
  const needsReason = lostNeedsReason(form.stage, form.loss_reason);
  const needsRemarket = wonReletNeedsRemarket({ type: form.type, stage: form.stage, won_rider_id: wonRiderId });
  const remarket = remarketRiderUrl(riderId);
  const needsEndDate = form.type === "renewal" && form.stage === "won" && !form.new_expiry_date;

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
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
        lessee_role: form.lessee_role,
        sublessee_note: form.lessee_role === "sublessee" ? form.sublessee_note.trim() || null : null,
        competitor: form.competitor.trim() || null,
        loss_reason: form.loss_reason || null,
        notes: form.notes.trim() || null,
        tags: form.tags,
        referral_note: form.referral_note.trim() || null,
      };
      if (form.type === "purchase" && form.portfolio_bid) {
        const bid = bidStageOption(form.bid_stage);
        payload.type = "purchase";
        payload.flavor = "portfolio_bid";
        payload.stage = bid.stage;
        payload.outcome = bid.outcome;
        payload.bid_substage = bid.bid_substage;
        payload.offering_name = form.offering_name.trim() || null;
        payload.received_date = form.received_date || null;
        payload.bid_due_prelim = form.bid_due_prelim || null;
        payload.bid_due_final = form.bid_due_final || null;
        payload.award_date = form.award_date || null;
        payload.seller_company_id = party?.company_id ?? (form.seller_company_id ? Number(form.seller_company_id) : null);
        payload.broker_company_id = broker?.company_id ?? (form.broker_company_id ? Number(form.broker_company_id) : null);
      } else if (editing?.flavor === "portfolio_bid") {
        payload.flavor = null;
        payload.outcome = null;
        payload.bid_substage = null;
      }
      const contactPayload = [
        ...(party?.contact_id ? [{ contact_id: party.contact_id, role: "primary" }] : []),
        ...(savedContacts.data ?? []).filter((row) => row.contact_id !== party?.contact_id).map((row) => ({ contact_id: row.contact_id, role: row.role })),
        ...extraContacts
          .filter((row) => row.name.trim())
          .map((row) => ({ name: row.name.trim(), email: row.email.trim() || null, phone: row.phone.trim() || null, title: row.title.trim() || null, role: row.role })),
      ];
      if (!editing || savedContacts.isSuccess) payload.contacts = contactPayload;
      if (lockedAccount) payload.account_id = lockedAccount;
      else if (party?.entity === "account" && party.account_id) payload.account_id = party.account_id;
      else if (party) payload.party = { entity: party.entity, entity_id: party.entity_id };
      else payload.account_id = numOrNull(form.account_id);
      if (editing) {
        const res = await apiRequest("PATCH", `/api/opportunities/${editing.id}`, payload);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/opportunities", payload);
      return res.json();
    },
    onSuccess: (row: OpportunityRow) => {
      toast({ title: editing ? "Opportunity updated" : "Opportunity created" });
      void qc.invalidateQueries({ queryKey: ["/api/opportunities"] });
      void qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      if (row.next_step === "setup_lessee") {
        setSetup({ accountId: row.account_id, accountName: row.account_name || accountLabel || "this account" });
        return;
      }
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const accountLabel = useMemo(() => {
    if (accountName) return accountName;
    if (party?.label) return party.label;
    return lockedAccount ? `Account ${lockedAccount}` : "";
  }, [accountName, party?.label, lockedAccount]);

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
            <Label>{form.portfolio_bid ? "Seller" : "Who is this deal with?"}</Label>
            {lockedAccount ? (
              <div className="mt-1">{accountLabel}</div>
            ) : (
              <div className="mt-1">
                <PartyPicker
                  selected={party}
                  disabled={!canWrite}
                  onSelect={(next) => {
                    setParty(next);
                    if (next.company_id) set("seller_company_id", String(next.company_id));
                  }}
                />
              </div>
            )}
          </div>
          <Field label="Type">
            <SelectValue
              value={form.type}
              disabled={!canWrite}
              onChange={(value) => {
                const next = value as OpportunityType;
                set("type", next);
                if (next !== "purchase") set("portfolio_bid", false);
              }}
              options={OPPORTUNITY_TYPES.map((value) => ({ value, label: OPPORTUNITY_TYPE_LABEL[value] }))}
            />
          </Field>
          {form.type === "purchase" ? (
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={form.portfolio_bid}
                disabled={!canWrite}
                onChange={(e) => set("portfolio_bid", e.target.checked)}
              />
              Portfolio bid
            </label>
          ) : null}
          <Field label="Stage">
            {form.portfolio_bid ? (
              <SelectValue
                value={form.bid_stage}
                disabled={!canWrite}
                onChange={(value) => {
                  const bid = bidStageOption(value as BidStageId);
                  set("bid_stage", bid.id);
                  set("stage", bid.stage);
                }}
                options={BID_STAGE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
              />
            ) : (
              <SelectValue value={form.stage} disabled={!canWrite} onChange={(value) => set("stage", value as OpportunityStage)} options={OPPORTUNITY_STAGES.map((value) => ({ value, label: OPPORTUNITY_STAGE_LABEL[value] }))} />
            )}
          </Field>
          {form.portfolio_bid ? (
            <>
              <Field label="Offering name">
                <Input value={form.offering_name} disabled={!canWrite} onChange={(e) => set("offering_name", e.target.value)} placeholder="BFLX Oct 2026" />
              </Field>
              <Field label="Received">
                <Input type="date" value={form.received_date} disabled={!canWrite} onChange={(e) => set("received_date", e.target.value)} />
              </Field>
              <Field label="Preliminary due">
                <Input type="date" value={form.bid_due_prelim} disabled={!canWrite} onChange={(e) => set("bid_due_prelim", e.target.value)} />
              </Field>
              <Field label="Final due">
                <Input type="date" value={form.bid_due_final} disabled={!canWrite} onChange={(e) => set("bid_due_final", e.target.value)} />
              </Field>
              <Field label="Award date">
                <Input type="date" value={form.award_date} disabled={!canWrite} onChange={(e) => set("award_date", e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Label>Broker / manager (optional)</Label>
                <div className="mt-1">
                  <PartyPicker
                    selected={broker}
                    disabled={!canWrite}
                    onSelect={(next) => {
                      setBroker(next);
                      if (next.company_id) set("broker_company_id", String(next.company_id));
                    }}
                  />
                </div>
              </div>
            </>
          ) : null}
          <Field label="Expected close">
            <Input type="date" value={form.expected_close} disabled={!canWrite} onChange={(e) => set("expected_close", e.target.value)} />
          </Field>
          <Field label="Owner">
            <Input value={form.owner} disabled={!canWrite} onChange={(e) => set("owner", e.target.value)} placeholder="Account manager" />
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
          <details className="sm:col-span-2 rounded-md border border-border p-3">
            <summary className="cursor-pointer text-sm">More details</summary>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <Field label="Source">
                <SelectValue
                  value={form.source}
                  disabled={!canWrite}
                  onChange={(value) => set("source", value as OpportunitySource)}
                  options={(
                    (MANUAL_OPPORTUNITY_SOURCES as readonly string[]).includes(form.source)
                      ? [...MANUAL_OPPORTUNITY_SOURCES]
                      : [form.source, ...MANUAL_OPPORTUNITY_SOURCES]
                  ).map((value) => ({ value, label: OPPORTUNITY_SOURCE_LABEL[value] }))}
                />
              </Field>
              <Field label="Lessee or sublessee">
                <SelectValue value={form.lessee_role} disabled={!canWrite} onChange={(value) => set("lessee_role", value as LesseeRole)} options={LESSEE_ROLES.map((value) => ({ value, label: value === "lessee" ? "Lessee" : "Sublessee" }))} />
              </Field>
              {form.lessee_role === "sublessee" ? (
                <Field label="Sublessee note">
                  <Input value={form.sublessee_note} disabled={!canWrite} onChange={(e) => set("sublessee_note", e.target.value)} />
                </Field>
              ) : null}
              <Field label="Car type">
                <Input list="crm-car-types" value={form.car_type} disabled={!canWrite} onChange={(e) => set("car_type", e.target.value)} />
                <datalist id="crm-car-types">
                  {CAR_TYPE_SUGGESTIONS.map((value) => <option key={value} value={value} />)}
                </datalist>
              </Field>
              <Field label="Car count">
                <Input value={form.car_count} disabled={!canWrite} onChange={(e) => set("car_count", e.target.value)} />
              </Field>
              <Field label="OL rider id">
                <Input value={form.rider_id} disabled={!canWrite} onChange={(e) => set("rider_id", e.target.value)} />
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
              <Field label="Competitor">
                <Input value={form.competitor} disabled={!canWrite} onChange={(e) => set("competitor", e.target.value)} />
              </Field>
              {form.source === "referral" ? (
                <Field label="Referral note">
                  <Input value={form.referral_note} disabled={!canWrite} onChange={(e) => set("referral_note", e.target.value)} />
                </Field>
              ) : null}
              <div className="sm:col-span-2">
                <Label>Tags</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {form.tags.map((tag) => (
                    <button key={tag} type="button" className="rounded bg-muted px-2 py-0.5 text-xs" disabled={!canWrite} onClick={() => set("tags", form.tags.filter((item) => item !== tag))}>
                      {tag} ×
                    </button>
                  ))}
                </div>
                <Input
                  className="mt-1"
                  value={form.tagDraft}
                  disabled={!canWrite}
                  placeholder="Type a tag and press Enter"
                  onChange={(e) => set("tagDraft", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const tag = form.tagDraft.trim().toLowerCase();
                    if (!tag || form.tags.includes(tag)) {
                      set("tagDraft", "");
                      return;
                    }
                    set("tags", [...form.tags, tag]);
                    set("tagDraft", "");
                  }}
                />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <div className="text-xs text-muted-foreground">People</div>
                {(savedContacts.data ?? []).map((row) => (
                  <div key={row.id} className="text-xs">{row.name || `Contact ${row.contact_id}`} · {OPPORTUNITY_CONTACT_ROLE_LABEL[row.role]}</div>
                ))}
                {extraContacts.map((row, index) => (
                  <div key={index} className="grid grid-cols-2 gap-2">
                    <Input value={row.name} placeholder="Name" disabled={!canWrite} onChange={(e) => setExtraContacts((list) => list.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
                    <SelectValue value={row.role} disabled={!canWrite} onChange={(value) => setExtraContacts((list) => list.map((item, i) => i === index ? { ...item, role: value as OpportunityContactRole } : item))} options={OPPORTUNITY_CONTACT_ROLES.map((value) => ({ value, label: OPPORTUNITY_CONTACT_ROLE_LABEL[value] }))} />
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" disabled={!canWrite} onClick={() => setExtraContacts((list) => [...list, { name: "", email: "", phone: "", title: "", role: "contact" }])}>
                  + add person
                </Button>
              </div>
            </div>
          </details>
        </div>
        {setup ? <SetupLesseeNote accountId={setup.accountId} accountName={setup.accountName} /> : null}
        {needsReason ? <p className="text-sm text-destructive">Lost opportunities require a reason.</p> : null}
        {needsEndDate ? <p className="text-sm text-destructive">A won renewal needs the new end date. Nothing is written to the rider.</p> : null}
        {needsRemarket ? <p className="text-sm text-destructive">Mark won after remarket, once the new OL id is known.</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canWrite || save.isPending || needsReason || needsEndDate || needsRemarket || !(lockedAccount ?? party ?? numOrNull(form.account_id))}
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
