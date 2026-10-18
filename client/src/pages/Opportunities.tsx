import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FinanceLeaseTag from "@/components/crm/FinanceLeaseTag";
import OpportunityDialog from "@/components/crm/OpportunityDialog";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_LABEL,
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABEL,
  ownerLabel,
  type OpportunityRow,
  type OpportunityType,
  type RenewalRunResult,
  type WatchRow,
} from "@shared/crm";

type WatchPayload = {
  holdover: WatchRow[];
  check_date: WatchRow[];
  off_lease: WatchRow[];
  unclassified: WatchRow[];
  returns_watch_url: string;
};

export default function OpportunitiesPage() {
  const canWrite = useCanEdit();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [owner, setOwner] = useState("");
  const [type, setType] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OpportunityRow | null>(null);
  const [preview, setPreview] = useState<RenewalRunResult | null>(null);
  const [relet, setRelet] = useState<WatchRow | null>(null);

  const params = new URLSearchParams();
  if (owner) params.set("owner", owner);
  if (type) params.set("type", type);
  if (openOnly) params.set("open", "1");
  const qs = params.toString();

  const opps = useQuery({
    queryKey: ["/api/opportunities", qs],
    queryFn: () => apiGet<OpportunityRow[]>(`/api/opportunities${qs ? `?${qs}` : ""}`),
  });
  const watch = useQuery({
    queryKey: ["/api/opportunities/watch"],
    queryFn: () => apiGet<WatchPayload>("/api/opportunities/watch"),
  });

  const dryRun = useMutation({
    mutationFn: () => apiRequest("POST", "/api/opportunities/generate-renewals?months=12&dry_run=1").then((r) => r.json() as Promise<RenewalRunResult>),
    onSuccess: (result) => setPreview(result),
    onError: (err: Error) => toast({ title: "Renewal preview failed", description: err.message, variant: "destructive" }),
  });
  const commit = useMutation({
    mutationFn: () => apiRequest("POST", "/api/opportunities/generate-renewals?months=12").then((r) => r.json() as Promise<RenewalRunResult>),
    onSuccess: (result) => {
      setPreview(null);
      toast({ title: result.created ? `Created ${result.created} renewals` : "No new renewals" });
      void qc.invalidateQueries({ queryKey: ["/api/opportunities"] });
      void qc.invalidateQueries({ queryKey: ["/api/accounts"] });
    },
    onError: (err: Error) => toast({ title: "Renewal run failed", description: err.message, variant: "destructive" }),
  });

  const owners = useMemo(() => {
    const names = new Set<string>();
    for (const row of opps.data ?? []) names.add(row.owner || "__unassigned__");
    return Array.from(names).sort();
  }, [opps.data]);

  const grouped = useMemo(() => {
    const rows = opps.data ?? [];
    return OPPORTUNITY_STAGES.map((stage) => ({ stage, rows: rows.filter((row) => row.stage === stage) })).filter((group) => group.rows.length);
  }, [opps.data]);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Opportunities"
        subtitle="Renewals, re-leases, and new business"
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => dryRun.mutate()} disabled={dryRun.isPending}>
                Generate renewals (12 mo)
              </Button>
              <Button size="sm" onClick={() => { setEditing(null); setCreateOpen(true); }}>+ Opportunity</Button>
            </div>
          ) : undefined
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 space-y-6">
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <select className="h-8 rounded-md border border-input bg-background px-2" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">All owners</option>
            {owners.map((name) => (
              <option key={name} value={name}>{name === "__unassigned__" ? "Unassigned" : name}</option>
            ))}
          </select>
          <select className="h-8 rounded-md border border-input bg-background px-2" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {OPPORTUNITY_TYPES.map((value) => (
              <option key={value} value={value}>{OPPORTUNITY_TYPE_LABEL[value]}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Open only
          </label>
        </div>

        {opps.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {opps.isError ? <p className="text-sm text-destructive">{opps.error instanceof Error ? opps.error.message : "Could not load opportunities"}</p> : null}
        {grouped.map((group) => (
          <div key={group.stage}>
            <h2 className="text-sm font-semibold mb-2">{OPPORTUNITY_STAGE_LABEL[group.stage]} · {group.rows.length}</h2>
            <div className="border rounded-md overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    {["Account", "Type", "Owner", "OL", "Cars", "Expiry", "Value"].map((label) => (
                      <th key={label} className="px-3 py-2 text-left font-medium">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2">
                        <Link href={`/accounts/${row.account_id}`} className="hover:underline">Account {row.account_id}</Link>
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" className="hover:underline" onClick={() => { setEditing(row); setCreateOpen(true); }}>
                          {OPPORTUNITY_TYPE_LABEL[row.type]}
                        </button>
                        <FinanceLeaseTag code={row.rider_name} />
                      </td>
                      <td className="px-3 py-2">{ownerLabel(row.owner)}</td>
                      <td className="px-3 py-2">
                        {row.rider_id ? <Link href={`/leases/rider/${row.rider_id}`} className="hover:underline">{row.rider_id}</Link> : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono-num">{row.car_count ?? "—"}</td>
                      <td className="px-3 py-2 font-mono-num">{row.expiry_date ?? "—"}</td>
                      <td className="px-3 py-2 font-mono-num">{row.est_value ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {!opps.isLoading && grouped.length === 0 ? <p className="text-sm text-muted-foreground">No opportunities match.</p> : null}

        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Watch</h2>
          <WatchBlock
            title="Holdover"
            hint={<Link href="/returns/watch" className="text-primary hover:underline">#/returns/watch</Link>}
            rows={watch.data?.holdover ?? []}
          />
          <WatchBlock title="Check date" rows={watch.data?.check_date ?? []} />
          <WatchBlock title="Unclassified (null lifecycle, on rent)" rows={watch.data?.unclassified ?? []} />
          <WatchBlock
            title="Off lease"
            rows={watch.data?.off_lease ?? []}
            action={canWrite ? (row) => (
              <Button
                size="sm"
                variant="outline"
                disabled={row.account_id == null}
                onClick={() => setRelet(row)}
              >
                Create re-lease opp
              </Button>
            ) : undefined}
          />
        </section>
      </div>

      <Dialog open={preview != null} onOpenChange={(next) => { if (!next) setPreview(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate renewals (12 mo)</DialogTitle></DialogHeader>
          {preview ? (
            <div className="text-sm space-y-2">
              <p>{preview.riders} riders · {preview.cars.toLocaleString()} on-rent cars · {preview.accounts} accounts</p>
              <p className="text-muted-foreground">Dry run writes nothing. Confirming creates one renewal per rider in a single undo group. A second run creates none.</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            <Button disabled={!canWrite || commit.isPending || !preview?.riders} onClick={() => commit.mutate()}>Create renewals</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OpportunityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        canWrite={canWrite}
        editing={editing}
      />
      {relet ? (
        <OpportunityDialog
          open
          onOpenChange={(next) => { if (!next) setRelet(null); }}
          canWrite={canWrite}
          accountId={relet.account_id ?? undefined}
          accountName={relet.account_name ?? undefined}
          preset={{
            type: "relet" as OpportunityType,
            owner: relet.owner ?? "",
            rider_id: String(relet.rider_id),
            account_id: relet.account_id ? String(relet.account_id) : "",
          }}
        />
      ) : null}
    </div>
  );
}

function WatchBlock({
  title,
  hint,
  rows,
  action,
}: {
  title: string;
  hint?: ReactNode;
  rows: WatchRow[];
  action?: (row: WatchRow) => ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">{title} · {rows.length}</h3>
        {hint}
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
        <ul className="text-sm space-y-1">
          {rows.map((row) => (
            <li key={`${title}-${row.rider_id}`} className="flex flex-wrap items-center gap-2">
              <Link href={`/leases/rider/${row.rider_id}`} className="hover:underline font-mono">{row.rider_name || row.rider_id}</Link>
              <FinanceLeaseTag code={row.rider_name} />
              <span className="text-muted-foreground">{row.lessee} · {row.reason} · {row.on_rent_cars || row.unsold_cars} cars · {ownerLabel(row.owner)}</span>
              {action ? action(row) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
