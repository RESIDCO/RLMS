import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountTransitionDocuments } from "@/components/AccountTransitionDocuments";
import ActivityDialog from "@/components/crm/ActivityDialog";
import FinanceLeaseTag from "@/components/crm/FinanceLeaseTag";
import ContactOpportunities from "@/components/crm/ContactOpportunities";
import OpportunityDialog from "@/components/crm/OpportunityDialog";
import SetupLesseeNote from "@/components/crm/SetupLesseeNote";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { contactsDirectoryPath } from "@/lib/directory-nav";
import { accountListPath, readAccountMgmtListState } from "@/lib/account-mgmt-nav";
import { useAuth, useCanEdit, usePermissions } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { offerUndoToast } from "@/lib/undo";
import {
  rentRollLabel,
  tierLabel,
  touchStatusClass,
  TIER_LABEL,
  TIER_VALUES,
  type TouchStatus,
} from "@shared/account-mgmt";
import {
  ownerLabel,
  OPPORTUNITY_STAGE_LABEL,
  OPPORTUNITY_TYPE_LABEL,
  viewerActivityPatch,
  type Account360Payload,
  type CrmActivityKind,
  type CrmActivityRow,
  type OpportunityRow,
} from "@shared/crm";

type OwnerOption = { initials: string; full_name: string; sort_order: number };

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function when(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 10);
}

function kindLabel(kind: Account360Payload["account"]["kind"], awaiting: boolean) {
  if (awaiting) return "Won – awaiting setup";
  if (kind === "client") return "Client";
  if (kind === "former") return "Former client";
  return "Prospect";
}

function touchLabel(status: TouchStatus) {
  switch (status) {
    case "overdue":
      return "Overdue";
    case "due_soon":
      return "Due soon";
    case "ok":
      return "On track";
    case "never":
      return "Never touched";
    case "untiered":
      return "No tier";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

export default function Account360Page() {
  const [, params] = useRoute("/accounts/:id");
  const id = Number(params?.id);
  const canWrite = useCanEdit();
  const { role, user } = useAuth();
  const signedIn = Boolean(role);
  const { canEditAccountMgmtComments } = usePermissions();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [oppOpen, setOppOpen] = useState(false);
  const [editing, setEditing] = useState<OpportunityRow | null>(null);
  const [activityKind, setActivityKind] = useState<CrmActivityKind | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["/api/accounts", id, "360"],
    queryFn: () => apiGet<Account360Payload>(`/api/accounts/${id}/360`),
    enabled: Number.isFinite(id) && id > 0,
  });

  if (!Number.isFinite(id) || id <= 0) return <div className="p-8 text-sm">Unknown account.</div>;
  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading account…</div>;
  if (isError || !data) {
    return <div className="p-8 text-sm text-destructive">{error instanceof Error ? error.message : "Account unavailable"}</div>;
  }

  const awaitingSetup = data.account.kind === "prospect" && data.opportunities.some((row) => row.stage === "won" && (row.type === "new_business" || row.type === "expansion"));
  const maxBar = Math.max(1, ...data.expiry_bars.map((bar) => bar.cars));
  const back = accountListPath(readAccountMgmtListState());
  const owner = data.owner;
  const handoffOpen = Boolean(owner.incoming);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={data.account.name}
        subtitle={kindLabel(data.account.kind, awaitingSetup)}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={back}>Back</Link>
            </Button>
            {canWrite ? <Button size="sm" variant="outline" onClick={() => setDetailsOpen(true)}>Edit details</Button> : null}
            {canWrite ? <Button size="sm" onClick={() => { setEditing(null); setOppOpen(true); }}>+ Opportunity</Button> : null}
            {signedIn ? <Button size="sm" variant="outline" onClick={() => setActivityKind("note")}>Log activity</Button> : null}
            {signedIn ? <Button size="sm" variant="outline" onClick={() => setActivityKind("task")}>+ Task</Button> : null}
          </div>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 space-y-4">
        {awaitingSetup ? <SetupLesseeNote accountId={id} accountName={data.account.name} /> : null}
        {handoffOpen ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            Owner: <strong>{owner.effective}</strong>
            {" "}(taking over from {owner.of_record || "—"}
            {owner.handoff_pct == null ? "" : ` · handoff ${owner.handoff_pct}%`})
            {owner.handoff_id ? (
              <>
                {" · "}
                <Link href={`/account-transitions/${owner.handoff_id}`} className="underline">Open handoff →</Link>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <span className={`rounded px-2 py-0.5 text-xs ${data.account.kind === "client" ? "bg-sky-500/15 text-sky-800" : "bg-amber-500/15 text-amber-800"}`}>
            {kindLabel(data.account.kind, awaitingSetup)}
          </span>
          <div className="text-xs text-muted-foreground">
            Owner
            <div className="text-sm text-foreground">{owner.effective || "Unassigned"}</div>
          </div>
          <Stat label="Tier" value={tierLabel(data.tier)} />
          <Stat label="Lessees" value={data.counts.lessees} />
          <Stat label="OLs" value={data.counts.ols} />
          <Stat label="On rent" value={data.counts.on_rent_cars} />
          <Stat label="Off lease" value={data.counts.off_lease} />
          <Stat label="Next expiry" value={when(data.next_expiry)} />
          <Stat label="Open opps" value={data.counts.open_opps} />
          <Stat label="Est. value" value={money(data.counts.est_value)} />
          {canWrite ? (
            <Stat
              label="Rent/mo"
              value={data.rent_roll ? money(data.rent_roll.total) : "—"}
              hint={data.rent_roll ? rentRollLabel(data.rent_roll.snapshot_month) : rentRollLabel(null)}
              extra={data.rent_roll && data.rent_roll.riders_without_summary > 0 ? `(${data.rent_roll.riders_without_summary} OLs not in import)` : undefined}
            />
          ) : null}
          <Stat
            label="Next touch due"
            value={data.next_touch_due ?? touchLabel(data.touch_status)}
            className={touchStatusClass(data.touch_status)}
          />
          <Stat label="Last contact" value={when(data.last_activity_at)} />
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="fleet">Fleet & OLs</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-4 mt-4">
            <BriefCard brief={data.brief} handoffId={owner.handoff_id} />
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Expiring on-rent cars, 24 months</div>
              <div className="flex items-end gap-1 h-28">
                {data.expiry_bars.map((bar) => (
                  <div key={bar.month} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${bar.month}: ${bar.cars}`}>
                    <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${Math.max(bar.cars ? 4 : 0, (bar.cars / maxBar) * 100)}%` }} />
                    <div className="text-[9px] text-muted-foreground mt-1 truncate w-full text-center">{bar.month.slice(2)}</div>
                  </div>
                ))}
              </div>
            </div>
            <OppTable rows={data.opportunities.filter((row) => row.stage !== "won" && row.stage !== "lost")} onOpen={(row) => { setEditing(row); setOppOpen(true); }} />
            <Timeline items={data.timeline.slice(0, 5)} />
          </TabsContent>
          <TabsContent value="fleet" className="mt-4">
            <div className="border rounded-md overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    {["OL", "Lessee", "Lifecycle", "Expiry", "Source", "On rent", "Rent/car", "Opportunity"].map((label) => (
                      <th key={label} className="px-3 py-2 text-left font-medium">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.ols.map((ol) => (
                    <tr key={ol.rider_id} className="border-t">
                      <td className="px-3 py-2">
                        <Link href={`/leases/rider/${ol.rider_id}`} className="hover:underline font-mono">{ol.rider_name || ol.rider_id}</Link>
                        <FinanceLeaseTag code={ol.rider_name} />
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/leases/lessee/${ol.master_lease_id}`} className="hover:underline">{ol.lessee || "Lessee"}</Link>
                      </td>
                      <td className="px-3 py-2">{ol.lifecycle_status || "—"}</td>
                      <td className="px-3 py-2 font-mono-num">{ol.expiration_date || "—"}</td>
                      <td className="px-3 py-2">{ol.expiration_source || "—"}</td>
                      <td className="px-3 py-2 font-mono-num">{ol.on_rent_cars}</td>
                      <td className="px-3 py-2 font-mono-num">{ol.monthly_rent_per_car == null ? "—" : money(ol.monthly_rent_per_car)}</td>
                      <td className="px-3 py-2">
                        {ol.open_opportunity_id ? (
                          <button type="button" className="underline" onClick={() => {
                            const row = data.opportunities.find((opp) => opp.id === ol.open_opportunity_id);
                            if (row) { setEditing(row); setOppOpen(true); }
                          }}>
                            {ol.open_opportunity_id}
                          </button>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                  {data.ols.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-muted-foreground">No OLs on this account.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TabsContent>
          <TabsContent value="opportunities" className="mt-4">
            <OppTable rows={data.opportunities} onOpen={(row) => { setEditing(row); setOppOpen(true); }} />
          </TabsContent>
          <TabsContent value="contacts" className="mt-4 space-y-4">
            {data.contacts.length === 0 ? <p className="text-sm text-muted-foreground">No directory contacts linked through this account's leases.</p> : null}
            {data.contacts.map((group) => (
              <div key={group.role}>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{group.role}</div>
                <ul className="space-y-1 text-sm">
                  {group.people.map((person) => (
                    <li key={person.id}>
                      <Link
                        href={contactsDirectoryPath({ q: "", companyId: person.company_id, contactId: person.id, people: true, leaseTied: false })}
                        className="hover:underline"
                      >
                        {person.name}
                      </Link>
                      <span className="text-muted-foreground"> {[person.title, person.email, person.phone].filter(Boolean).join(" · ")}</span>
                      <div className="mt-1"><ContactOpportunities contactId={person.id} /></div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <ActivityList
              rows={data.activities}
              userId={user?.id ?? ""}
              canEditAny={canWrite}
              onError={(message) => toast({ title: "Could not update task", description: message, variant: "destructive" })}
            />
          </TabsContent>
        </Tabs>

        <div className="space-y-3 pt-2">
          {data.transition ? (
            <Link href={`/account-transitions/${data.transition.id}`} className="text-sm text-primary hover:underline">
              Open handoff → {data.transition.status || "in progress"}
            </Link>
          ) : null}
          <AccountTransitionDocuments
            accountId={id}
            ols={data.ols.map((ol) => ({ id: ol.rider_id, label: ol.rider_name || `OL ${ol.rider_id}` }))}
            canUpload={canEditAccountMgmtComments}
          />
        </div>
      </div>

      <EditDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        accountId={id}
        data={data}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ["/api/accounts", id, "360"] });
          void qc.invalidateQueries({ queryKey: ["/api/accounts/book"] });
        }}
      />
      <OpportunityDialog
        open={oppOpen}
        onOpenChange={setOppOpen}
        canWrite={canWrite}
        accountId={id}
        accountName={data.account.name}
        editing={editing}
      />
      <ActivityDialog
        open={activityKind != null}
        onOpenChange={(next) => { if (!next) setActivityKind(null); }}
        canWrite={signedIn}
        accountId={id}
        defaultKind={activityKind ?? "note"}
      />
    </div>
  );
}

function Stat({ label, value, hint, extra, className }: { label: string; value: string | number; hint?: string; extra?: string; className?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono-num ${className ?? ""}`}>{value}</div>
      {hint ? <div className="text-[10px] text-muted-foreground">{hint}</div> : null}
      {extra ? <div className="text-[10px] text-muted-foreground">{extra}</div> : null}
    </div>
  );
}

function BriefCard({ brief, handoffId }: { brief: Account360Payload["brief"]; handoffId: number | null }) {
  const fields = [
    ["Overall health", brief?.overall_account_health],
    ["Renewal risk", brief?.renewal_risk_retention],
    ["Growth", brief?.growth_potential_pipeline],
    ["Landmines", brief?.landmines],
    ["Credit / payment", brief?.credit_payment_history],
  ] as const;
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Account brief</div>
      {!brief ? <p className="text-sm text-muted-foreground">No briefing on file</p> : (
        <>
          {fields.map(([label, text]) => (
            <div key={label}>
              <div className="text-xs text-muted-foreground">{label}</div>
              <Clamp text={text} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            From briefing completed {when(brief.completed_at)} by {brief.outgoing_signature_name || "—"}
            {handoffId ? <> · <Link href={`/account-transitions/${handoffId}`} className="underline">Open handoff</Link></> : null}
          </p>
        </>
      )}
    </div>
  );
}

function Clamp({ text }: { text: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!text) return <div className="text-sm">—</div>;
  const long = text.length > 180;
  return (
    <div className="text-sm">
      <p className={open ? "whitespace-pre-wrap" : "line-clamp-3 whitespace-pre-wrap"}>{text}</p>
      {long ? (
        <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setOpen((value) => !value)}>
          {open ? "less" : "more"}
        </button>
      ) : null}
    </div>
  );
}

function EditDetailsDialog({
  open,
  onOpenChange,
  accountId,
  data,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: number;
  data: Account360Payload;
  onSaved: () => void;
}) {
  const owners = useQuery({
    queryKey: ["/api/account-owners"],
    queryFn: () => apiGet<OwnerOption[]>("/api/account-owners"),
    enabled: open,
  });
  const [name, setName] = useState(data.account.name);
  const [notes, setNotes] = useState(data.account.notes ?? "");
  const [manager, setManager] = useState(data.owner.of_record ?? "");
  const [tier, setTier] = useState(data.tier ?? "");
  const [cadence, setCadence] = useState(data.account.touch_cadence_days == null ? "" : String(data.account.touch_cadence_days));
  useEffect(() => {
    if (!open) return;
    setName(data.account.name);
    setNotes(data.account.notes ?? "");
    setManager(data.owner.of_record ?? "");
    setTier(data.tier ?? "");
    setCadence(data.account.touch_cadence_days == null ? "" : String(data.account.touch_cadence_days));
  }, [open, data]);
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/accounts/${accountId}`, {
      name,
      notes,
      account_manager: manager || null,
      tier: tier || null,
      touch_cadence_days: cadence.trim() ? Number(cadence) : null,
    }).then((r) => r.json()),
    onSuccess: (row) => {
      offerUndoToast(row);
      onSaved();
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Notes</Label>
            <textarea className="mt-1 w-full min-h-20 rounded-md border border-input bg-background px-2 py-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <Label>Official owner</Label>
            <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" value={manager} onChange={(e) => setManager(e.target.value)}>
              <option value="">Unassigned</option>
              {(owners.data ?? []).map((row) => (
                <option key={row.initials} value={row.initials}>{row.initials} · {row.full_name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Lease Management shows this owner. The incoming owner on an open handoff takes over CRM work right away.</p>
          </div>
          <div>
            <Label>Tier</Label>
            <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">No tier</option>
              {TIER_VALUES.map((value) => (
                <option key={value} value={value}>{TIER_LABEL[value]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Cadence override (days)</Label>
            <Input value={cadence} placeholder="Blank = tier default" onChange={(e) => setCadence(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActivityList({
  rows,
  userId,
  canEditAny,
  onError,
}: {
  rows: CrmActivityRow[];
  userId: string;
  canEditAny: boolean;
  onError: (message: string) => void;
}) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (row: CrmActivityRow) => {
      const done_at = row.done_at ? null : new Date().toISOString();
      const payload = canEditAny ? { done_at } : viewerActivityPatch({ ...row, done_at });
      return apiRequest("PATCH", `/api/crm-activities/${row.id}`, payload).then((r) => r.json());
    },
    onSuccess: (saved) => {
      offerUndoToast(saved);
      void qc.invalidateQueries({ queryKey: ["/api/accounts"] });
    },
    onError: (err: Error) => onError(err.message),
  });
  const openTasks = rows.filter((row) => row.kind === "task" && !row.done_at);
  const rest = rows.filter((row) => !(row.kind === "task" && !row.done_at));
  const ordered = [...openTasks, ...rest];
  if (!ordered.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {ordered.map((row) => {
        const mine = row.actor === userId;
        const canToggle = row.kind === "task" && (canEditAny || mine);
        return (
          <li key={row.id} className="border-b border-border/60 pb-2">
            <div className="text-xs text-muted-foreground">
              {when(row.occurred_at)} · {row.kind}
              {row.actor ? ` · ${row.actor}` : ""}
              {row.due_date ? ` · due ${row.due_date}` : ""}
            </div>
            <div className="flex items-start gap-2">
              {row.kind === "task" ? (
                <input
                  type="checkbox"
                  checked={Boolean(row.done_at)}
                  disabled={!canToggle || save.isPending}
                  onChange={() => save.mutate(row)}
                  aria-label="Done"
                />
              ) : null}
              <div>{row.body}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OppTable({ rows, onOpen }: { rows: OpportunityRow[]; onOpen: (row: OpportunityRow) => void }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No opportunities.</p>;
  return (
    <div className="border rounded-md overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b">
          <tr>
            {["Type", "Stage", "Owner", "Cars", "Expiry", "Value"].map((label) => (
              <th key={label} className="px-3 py-2 text-left font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="px-3 py-2">
                <button type="button" className="hover:underline" onClick={() => onOpen(row)}>{OPPORTUNITY_TYPE_LABEL[row.type]}</button>
                <FinanceLeaseTag code={row.rider_name} />
              </td>
              <td className="px-3 py-2">{OPPORTUNITY_STAGE_LABEL[row.stage]}</td>
              <td className="px-3 py-2">{ownerLabel(row.owner)}</td>
              <td className="px-3 py-2 font-mono-num">{row.car_count ?? "—"}</td>
              <td className="px-3 py-2 font-mono-num">{row.expiry_date ?? "—"}</td>
              <td className="px-3 py-2 font-mono-num">{money(row.est_value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ items }: { items: Account360Payload["timeline"] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {items.map((item) => (
        <li key={item.id} className="border-b border-border/60 pb-2">
          <div className="text-xs text-muted-foreground">
            {when(item.occurred_at)} · {item.source === "system" ? "System" : item.label}
            {item.actor ? ` · ${item.actor}` : ""}
          </div>
          <div>{item.body}</div>
        </li>
      ))}
    </ul>
  );
}
