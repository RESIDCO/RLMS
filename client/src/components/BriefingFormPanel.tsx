import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatCalendarDate } from "@shared/lease-authority";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { displayTransitionAm } from "@shared/account-transitions";

type Contact = {
  name: string;
  title: string;
  role_function: string;
  authority: string;
  phone: string;
  email: string;
  comm_pref: string;
};

type OlRow = {
  ol_number: string;
  car_type: string | null;
  qty: number;
  rent: number | null;
  lease_exp: string | null;
  notes: string | null;
};

type FormFields = {
  tier_track: string;
  effective_date: string;
  mailing_address: string;
  target_completion: string;
  relationship_tenure_history: string;
  political_dynamics: string;
  background_commercial_history: string;
  credit_payment_history: string;
  notable_past_negotiations: string;
  overall_account_health: string;
  growth_potential_pipeline: string;
  renewal_risk_retention: string;
  whats_worked_hasnt: string;
  landmines: string;
  outgoing_signature_name: string;
  outgoing_signature_date: string;
  incoming_signature_name: string;
  incoming_signature_date: string;
  status: "draft" | "completed";
};

type Payload = {
  form: Record<string, string | null>;
  contacts: Contact[];
  ols: OlRow[];
  header: { account_name: string; outgoing_rep: string | null; incoming_rep: string | null };
};

const emptyContact = (): Contact => ({
  name: "",
  title: "",
  role_function: "",
  authority: "",
  phone: "",
  email: "",
  comm_pref: "",
});

function iso(v: string | null | undefined) {
  return v ? String(v).slice(0, 10) : "";
}

function formFromPayload(p: Payload): FormFields {
  const f = p.form ?? {};
  return {
    tier_track: f.tier_track ?? "",
    effective_date: iso(f.effective_date),
    mailing_address: f.mailing_address ?? "",
    target_completion: iso(f.target_completion),
    relationship_tenure_history: f.relationship_tenure_history ?? "",
    political_dynamics: f.political_dynamics ?? "",
    background_commercial_history: f.background_commercial_history ?? "",
    credit_payment_history: f.credit_payment_history ?? "",
    notable_past_negotiations: f.notable_past_negotiations ?? "",
    overall_account_health: f.overall_account_health ?? "",
    growth_potential_pipeline: f.growth_potential_pipeline ?? "",
    renewal_risk_retention: f.renewal_risk_retention ?? "",
    whats_worked_hasnt: f.whats_worked_hasnt ?? "",
    landmines: f.landmines ?? "",
    outgoing_signature_name: f.outgoing_signature_name ?? "",
    outgoing_signature_date: iso(f.outgoing_signature_date),
    incoming_signature_name: f.incoming_signature_name ?? "",
    incoming_signature_date: iso(f.incoming_signature_date),
    status: f.status === "completed" ? "completed" : "draft",
  };
}

function money(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function BriefingFormPanel({
  recordId,
  accountId,
  canWrite,
}: {
  recordId: number;
  accountId: number;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Payload>({
    queryKey: ["/api/account-transitions", recordId, "briefing"],
    queryFn: () => apiRequest("GET", `/api/account-transitions/${recordId}/briefing`).then((r) => r.json()),
  });
  const [form, setForm] = useState<FormFields | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [olNotes, setOlNotes] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    const f = formFromPayload(data);
    const c = (data.contacts ?? []).map((row) => ({
      name: row.name ?? "",
      title: row.title ?? "",
      role_function: row.role_function ?? "",
      authority: row.authority ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      comm_pref: row.comm_pref ?? "",
    }));
    const notes: Record<string, string> = {};
    for (const ol of data.ols ?? []) notes[ol.ol_number] = ol.notes ?? "";
    setForm(f);
    setContacts(c.length ? c : [emptyContact()]);
    setOlNotes(notes);
    setBaseline(JSON.stringify({ f, c: c.length ? c : [emptyContact()], notes }));
  }, [data]);

  const dirty = form != null && JSON.stringify({ f: form, c: contacts, notes: olNotes }) !== baseline;

  const save = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/account-transitions/${recordId}/briefing`, {
        form,
        contacts,
        ol_notes: Object.entries(olNotes).map(([ol_number, notes]) => ({ ol_number, notes })),
      }).then((r) => r.json()),
    onSuccess: () => {
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
      if (form) setBaseline(JSON.stringify({ f: form, c: contacts, notes: olNotes }));
      qc.invalidateQueries({ queryKey: ["/api/account-transitions", recordId, "briefing"] });
      qc.invalidateQueries({ queryKey: ["/api/account-transitions"] });
      qc.invalidateQueries({ queryKey: ["/api/account-transitions/summary"] });
      qc.invalidateQueries({ queryKey: ["/api/account-management/accounts", accountId, "attachments"] });
      toast({ title: "Briefing form saved" });
    },
    onError: (e: Error) => toast({ title: "Could not save briefing form", description: e.message, variant: "destructive" }),
  });

  const pdf = useMutation({
    mutationFn: () => apiRequest("POST", `/api/account-transitions/${recordId}/briefing/pdf`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/account-management/accounts", accountId, "attachments"] });
      toast({ title: "PDF generated", description: "It will appear in Account Transitions documents." });
    },
    onError: (e: Error) => toast({ title: "PDF failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !form || !data) {
    return <p className="text-sm text-muted-foreground">Loading briefing form…</p>;
  }

  const set = (k: keyof FormFields, v: string) => setForm((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Handoff Briefing Form</div>
          <p className="text-xs text-muted-foreground">
            {data.header.account_name} · Outgoing {displayTransitionAm(data.header.outgoing_rep)} · Incoming{" "}
            {displayTransitionAm(data.header.incoming_rep)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {justSaved && !dirty ? <span className="text-xs text-emerald-500">Saved</span> : null}
          {canWrite && (
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save briefing form"
              )}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={pdf.isPending} onClick={() => pdf.mutate()}>
            {pdf.isPending ? "Generating…" : "Generate PDF"}
          </Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Tier / Track</Label>
          <Input value={form.tier_track} disabled={!canWrite} onChange={(e) => set("tier_track", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Effective Date</Label>
          <Input type="date" value={form.effective_date} disabled={!canWrite} onChange={(e) => set("effective_date", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs">Mailing Address</Label>
          <Textarea rows={2} className="text-xs" value={form.mailing_address} disabled={!canWrite} onChange={(e) => set("mailing_address", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Target Completion</Label>
          <Input type="date" value={form.target_completion} disabled={!canWrite} onChange={(e) => set("target_completion", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Form status</Label>
          <Select
            value={form.status}
            disabled={!canWrite}
            onValueChange={(v) => setForm((d) => (d ? { ...d, status: v as "draft" | "completed" } : d))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">1. Key Contacts</div>
      <Textarea rows={3} className="text-xs" placeholder="Relationship tenure & history" value={form.relationship_tenure_history} disabled={!canWrite} onChange={(e) => set("relationship_tenure_history", e.target.value)} />
      <Textarea rows={3} className="text-xs" placeholder="Political dynamics / sensitivities" value={form.political_dynamics} disabled={!canWrite} onChange={(e) => set("political_dynamics", e.target.value)} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              {["Name", "Title", "Role/Function", "Authority", "Phone", "Email", "Comm. Pref.", ""].map((h) => (
                <th key={h} className="text-left font-medium pr-1 pb-1">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={i}>
                {(["name", "title", "role_function", "authority", "phone", "email", "comm_pref"] as const).map((k) => (
                  <td key={k} className="pr-1 pb-1">
                    <Input className="h-8 text-xs" value={c[k]} disabled={!canWrite} onChange={(e) => setContacts((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)))} />
                  </td>
                ))}
                <td className="pb-1">
                  {canWrite && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setContacts((rows) => rows.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canWrite && (
        <Button size="sm" variant="outline" onClick={() => setContacts((rows) => [...rows, emptyContact()])}>
          <Plus className="h-4 w-4" /> Add contact
        </Button>
      )}

      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">2. Account History</div>
      <Textarea rows={3} className="text-xs" placeholder="Background & Commercial History" value={form.background_commercial_history} disabled={!canWrite} onChange={(e) => set("background_commercial_history", e.target.value)} />
      <Textarea rows={3} className="text-xs" placeholder="Credit & Payment History" value={form.credit_payment_history} disabled={!canWrite} onChange={(e) => set("credit_payment_history", e.target.value)} />
      <Textarea rows={3} className="text-xs" placeholder="Notable Past Negotiations" value={form.notable_past_negotiations} disabled={!canWrite} onChange={(e) => set("notable_past_negotiations", e.target.value)} />

      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">3. Active OL#&apos;s (live from RLMS — Notes only are editable)</div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-2 py-1">OL #</th>
              <th className="text-left font-medium px-2 py-1">Car Type</th>
              <th className="text-right font-medium px-2 py-1">Qty</th>
              <th className="text-right font-medium px-2 py-1">Rent</th>
              <th className="text-left font-medium px-2 py-1">Lease Exp</th>
              <th className="text-left font-medium px-2 py-1">Mthly Maint.</th>
              <th className="text-left font-medium px-2 py-1">Notes</th>
            </tr>
          </thead>
          <tbody>
            {(data.ols ?? []).map((ol) => (
              <tr key={ol.ol_number} className="border-t border-border">
                <td className="px-2 py-1 font-mono-num">{ol.ol_number}</td>
                <td className="px-2 py-1">{ol.car_type || "—"}</td>
                <td className="px-2 py-1 text-right font-mono-num">{ol.qty}</td>
                <td className="px-2 py-1 text-right font-mono-num">{money(ol.rent)}</td>
                <td className="px-2 py-1">{formatCalendarDate(ol.lease_exp)}</td>
                <td className="px-2 py-1 text-muted-foreground">n/a</td>
                <td className="px-2 py-1 min-w-[10rem]">
                  <Input
                    className="h-8 text-xs"
                    value={olNotes[ol.ol_number] ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => setOlNotes((m) => ({ ...m, [ol.ol_number]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
            {(data.ols ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">No OLs on this account.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">4. Account Performance</div>
      <Textarea rows={3} className="text-xs" placeholder="Overall Account Health" value={form.overall_account_health} disabled={!canWrite} onChange={(e) => set("overall_account_health", e.target.value)} />
      <Textarea rows={3} className="text-xs" placeholder="Growth Potential & Active Pipeline" value={form.growth_potential_pipeline} disabled={!canWrite} onChange={(e) => set("growth_potential_pipeline", e.target.value)} />
      <Textarea rows={3} className="text-xs" placeholder="Renewal Risk & Retention" value={form.renewal_risk_retention} disabled={!canWrite} onChange={(e) => set("renewal_risk_retention", e.target.value)} />
      <Textarea rows={3} className="text-xs" placeholder="What's Worked & What Hasn't" value={form.whats_worked_hasnt} disabled={!canWrite} onChange={(e) => set("whats_worked_hasnt", e.target.value)} />
      <Textarea rows={3} className="text-xs" placeholder="Landmines" value={form.landmines} disabled={!canWrite} onChange={(e) => set("landmines", e.target.value)} />

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Outgoing Rep Signature</Label>
          <Input value={form.outgoing_signature_name} disabled={!canWrite} onChange={(e) => set("outgoing_signature_name", e.target.value)} />
          <Input className="mt-1" type="date" value={form.outgoing_signature_date} disabled={!canWrite} onChange={(e) => set("outgoing_signature_date", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Incoming Rep Signature</Label>
          <Input value={form.incoming_signature_name} disabled={!canWrite} onChange={(e) => set("incoming_signature_name", e.target.value)} />
          <Input className="mt-1" type="date" value={form.incoming_signature_date} disabled={!canWrite} onChange={(e) => set("incoming_signature_date", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
