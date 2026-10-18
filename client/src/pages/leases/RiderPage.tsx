import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiRequest, queryClient } from "@/lib/queryClient";
import FleetRegistry from "@/pages/FleetRegistry";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import { displayRiderCode, lifecycleLabel } from "@shared/lease-mgmt";
import { todayIsoDateOnly } from "@shared/lease-authority";
import { ArrowLeft } from "lucide-react";
import { useCanEdit } from "@/lib/AuthContext";

export default function RiderPage() {
  const [, params] = useRoute("/leases/rider/:id");
  const id = Number(params?.id);
  const canEdit = useCanEdit();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/lease-mgmt/riders", id],
    queryFn: () => apiGet<any>(`/api/lease-mgmt/riders/${id}`),
    enabled: Number.isFinite(id),
  });
  const h = data?.header ?? {};
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [offOpen, setOffOpen] = useState(false);
  const [offDate, setOffDate] = useState(todayIsoDateOnly);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [newOl, setNewOl] = useState("");
  const [remarkDate, setRemarkDate] = useState(todayIsoDateOnly);
  const [carIdsText, setCarIdsText] = useState("");

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/lease-mgmt/riders/${id}`, {
      effective_date: form.effective_date ?? h.effective_date,
      expiration_date: form.expiration_date ?? h.expiration_date,
      monthly_rent_per_car: form.monthly_rent_per_car === "" ? null : Number(form.monthly_rent_per_car ?? h.monthly_rent_per_car),
      sublessee: form.sublessee ?? h.sublessee,
      contract_doc_url: form.contract_doc_url ?? h.contract_doc_url,
      owner_entity: form.owner_entity ?? h.owner_entity,
    }).then((r) => r.json()),
    onSuccess: () => {
      setEdit(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/lease-mgmt/riders", id] });
    },
  });
  const offLease = useMutation({
    mutationFn: () => {
      const ids = carIdsText.split(/[,\s]+/).map(Number).filter((n) => n > 0);
      return apiRequest("POST", `/api/lease-mgmt/riders/${id}/off-lease`, {
        date: offDate,
        car_ids: ids.length ? ids : undefined,
      }).then((r) => r.json());
    },
    onSuccess: () => {
      setOffOpen(false);
      void queryClient.invalidateQueries();
    },
  });
  const remarket = useMutation({
    mutationFn: () => {
      const ids = carIdsText.split(/[,\s]+/).map(Number).filter((n) => n > 0);
      return apiRequest("POST", `/api/lease-mgmt/riders/${id}/remarket`, {
        date: remarkDate,
        new_ol_number: newOl,
        lessee_id: h.master_lease_id,
        car_ids: ids,
      }).then((r) => r.json());
    },
    onSuccess: (body) => {
      setRemarkOpen(false);
      void queryClient.invalidateQueries();
      if (body?.new_rider_id) window.location.hash = `#/leases/rider/${body.new_rider_id}`;
    },
  });

  if (isLoading || !data) return <div className="p-8 text-sm text-muted-foreground">Loading OL…</div>;
  const code = displayRiderCode(h);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={code}
        subtitle={`${h.lessee ?? ""} · ${lifecycleLabel(h.lifecycle_status)} · ${h.cars ?? 0} cars`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={h.master_lease_id ? `/leases/lessee/${h.master_lease_id}` : "/leases"}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Link>
            </Button>
            {canEdit && <Button size="sm" variant="outline" onClick={() => { setForm({}); setEdit(true); }}>Edit terms</Button>}
            {canEdit && <Button size="sm" variant="outline" onClick={() => setOffOpen(true)}>Off lease</Button>}
            {canEdit && <Button size="sm" onClick={() => setRemarkOpen(true)}>Remarket → new OL</Button>}
          </div>
        }
      />
      <div className="px-4 sm:px-8 py-3 text-sm flex flex-wrap gap-3">
        <span>Effective {h.effective_date ?? "—"}</span>
        <span>Expiry {h.expiration_date ?? "—"}</span>
        <span>Rent/car {h.monthly_rent_per_car ?? h.rider_rent_per_car ?? "—"}</span>
        {h.sublessee ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Operated by {h.sublessee}</span> : null}
        {h.contract_doc_url ? (
          <button type="button" className="font-mono text-xs underline" onClick={() => void navigator.clipboard.writeText(h.contract_doc_url)}>{h.contract_doc_url}</button>
        ) : <span className="text-xs text-muted-foreground">No contract on file</span>}
        {h.successor_rider_id ? <Link href={`/leases/rider/${h.successor_rider_id}`} className="underline">Successor OL</Link> : null}
      </div>
      <div className="flex-1 min-h-0">
        <FleetRegistry scopedRiderId={id} />
      </div>
      <div className="px-4 sm:px-8 py-3 border-t">
        <AttachmentsPanel entityType="rider" entityId={id} />
      </div>

      <Dialog open={edit} onOpenChange={setEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit terms</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Effective</Label><Input type="date" defaultValue={h.effective_date ?? ""} onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} /></div>
            <div><Label>Expiration</Label><Input type="date" defaultValue={h.expiration_date ?? ""} onChange={(e) => setForm((f) => ({ ...f, expiration_date: e.target.value }))} /></div>
            <div><Label>Rent / car</Label><Input type="number" defaultValue={h.monthly_rent_per_car ?? h.rider_rent_per_car ?? ""} onChange={(e) => setForm((f) => ({ ...f, monthly_rent_per_car: e.target.value }))} /></div>
            <div><Label>Sublessee / Operated by</Label><Input defaultValue={h.sublessee ?? ""} onChange={(e) => setForm((f) => ({ ...f, sublessee: e.target.value }))} /></div>
            <div><Label>Contract path</Label><Input defaultValue={h.contract_doc_url ?? ""} onChange={(e) => setForm((f) => ({ ...f, contract_doc_url: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdit(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={offOpen} onOpenChange={setOffOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Off lease (all / selected cars)</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Sets assignment_status only. Does not change fleet_status or reporting KPIs. Leave car ids blank to return all active cars on this OL.</p>
          <Label>Date</Label>
          <Input type="date" value={offDate} onChange={(e) => setOffDate(e.target.value)} />
          <Label>Car ids (optional, comma-separated)</Label>
          <Input value={carIdsText} onChange={(e) => setCarIdsText(e.target.value)} placeholder="Partial return: selected railcar ids" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOffOpen(false)}>Cancel</Button>
            <Button onClick={() => offLease.mutate()} disabled={offLease.isPending}>Off lease</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={remarkOpen} onOpenChange={setRemarkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remarket → new OL</DialogTitle></DialogHeader>
          <Label>New OL number</Label>
          <Input value={newOl} onChange={(e) => setNewOl(e.target.value.toUpperCase())} placeholder="OL2544" />
          <Label>Date</Label>
          <Input type="date" value={remarkDate} onChange={(e) => setRemarkDate(e.target.value)} />
          <Label>Car ids to move</Label>
          <Input value={carIdsText} onChange={(e) => setCarIdsText(e.target.value)} placeholder="Required" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemarkOpen(false)}>Cancel</Button>
            <Button onClick={() => remarket.mutate()} disabled={remarket.isPending || !newOl}>Remarket</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
