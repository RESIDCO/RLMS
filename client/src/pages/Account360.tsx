import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountTransitionDocuments } from "@/components/AccountTransitionDocuments";
import ActivityDialog from "@/components/crm/ActivityDialog";
import OpportunityDialog from "@/components/crm/OpportunityDialog";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { contactsDirectoryPath } from "@/lib/directory-nav";
import { accountListPath, readAccountMgmtListState } from "@/lib/account-mgmt-nav";
import { useCanEdit, usePermissions } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  ownerLabel,
  OPPORTUNITY_STAGE_LABEL,
  OPPORTUNITY_TYPE_LABEL,
  type Account360Payload,
  type CrmActivityKind,
  type OpportunityRow,
} from "@shared/crm";

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function when(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 10);
}

export default function Account360Page() {
  const [, params] = useRoute("/accounts/:id");
  const id = Number(params?.id);
  const canWrite = useCanEdit();
  const { canEditAccountMgmtComments } = usePermissions();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [oppOpen, setOppOpen] = useState(false);
  const [editing, setEditing] = useState<OpportunityRow | null>(null);
  const [activityKind, setActivityKind] = useState<CrmActivityKind | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["/api/accounts", id, "360"],
    queryFn: () => apiGet<Account360Payload>(`/api/accounts/${id}/360`),
    enabled: Number.isFinite(id) && id > 0,
  });
  const amOptions = useQuery({
    queryKey: ["/api/lease-mgmt/am-options"],
    queryFn: () => apiGet<string[]>("/api/lease-mgmt/am-options"),
  });
  const saveAm = useMutation({
    mutationFn: (account_manager: string) => apiRequest("PATCH", `/api/accounts/${id}`, { account_manager: account_manager || null }).then((r) => r.json()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/accounts", id, "360"] });
      void qc.invalidateQueries({ queryKey: ["/api/account-management/overview"] });
    },
    onError: (err: Error) => toast({ title: "Could not save account manager", description: err.message, variant: "destructive" }),
  });

  if (!Number.isFinite(id) || id <= 0) return <div className="p-8 text-sm">Unknown account.</div>;
  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading account…</div>;
  if (isError || !data) {
    return <div className="p-8 text-sm text-destructive">{error instanceof Error ? error.message : "Account unavailable"}</div>;
  }

  const maxBar = Math.max(1, ...data.expiry_bars.map((bar) => bar.cars));
  const managers = Array.from(new Set([...(amOptions.data ?? []), data.account.account_manager ?? ""].filter(Boolean))).sort();
  const back = accountListPath(readAccountMgmtListState());

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={data.account.name}
        subtitle={data.account.kind === "client" ? "Client" : "Prospect"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={back}>Back</Link>
            </Button>
            {canWrite ? <Button size="sm" onClick={() => { setEditing(null); setOppOpen(true); }}>+ Opportunity</Button> : null}
            {canWrite ? <Button size="sm" variant="outline" onClick={() => setActivityKind("note")}>Log activity</Button> : null}
            {canWrite ? <Button size="sm" variant="outline" onClick={() => setActivityKind("task")}>+ Task</Button> : null}
          </div>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <span className={`rounded px-2 py-0.5 text-xs ${data.account.kind === "client" ? "bg-sky-500/15 text-sky-800" : "bg-amber-500/15 text-amber-800"}`}>
            {data.account.kind === "client" ? "Client" : "Prospect"}
          </span>
          <label className="text-xs text-muted-foreground">
            Account manager
            <select
              className="ml-2 h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={data.account.account_manager ?? ""}
              disabled={!canWrite || saveAm.isPending}
              onChange={(e) => saveAm.mutate(e.target.value)}
            >
              <option value="">Unassigned</option>
              {managers.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <Stat label="Lessees" value={data.counts.lessees} />
          <Stat label="OLs" value={data.counts.ols} />
          <Stat label="On rent" value={data.counts.on_rent_cars} />
          <Stat label="Off lease" value={data.counts.off_lease} />
          <Stat label="Next expiry" value={when(data.next_expiry)} />
          <Stat label="Open opps" value={data.counts.open_opps} />
          <Stat label="Est. value" value={money(data.counts.est_value)} />
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
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <Timeline items={data.timeline} />
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
        canWrite={canWrite}
        accountId={id}
        defaultKind={activityKind ?? "note"}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono-num">{value}</div>
    </div>
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
