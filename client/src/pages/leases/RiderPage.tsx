import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import FleetRegistry from "@/pages/FleetRegistry";
import LeaseDocumentsPanel from "@/pages/leases/LeaseDocumentsPanel";
import LeaseCrmLinks from "@/components/crm/LeaseCrmLinks";
import { documentCountLabel, leaseDocumentsPath, type LeaseDoc } from "@/pages/leases/lease-documents";
import { cn } from "@/lib/utils";
import { displayRiderCode, lifecycleLabel } from "@shared/lease-mgmt";
import { todayIsoDateOnly } from "@shared/lease-authority";
import { ArrowLeft } from "lucide-react";
import { BackToSearch } from "@/components/BackToSearch";
import { useCanEdit } from "@/lib/AuthContext";
import { AddNoteField, appendNoteBody } from "@/components/AddNoteField";

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
  const [termsNote, setTermsNote] = useState("");
  const [offNote, setOffNote] = useState("");
  const [remarkNote, setRemarkNote] = useState("");
  const [section, setSection] = useState<"cars" | "documents">("cars");
  const docsPath = leaseDocumentsPath("rider", id);
  const docs = useQuery<{ rows: LeaseDoc[] }>({
    queryKey: [docsPath],
    queryFn: () => apiGet(docsPath),
    enabled: Number.isFinite(id) && id > 0,
  });

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/lease-mgmt/riders/${id}`, {
      effective_date: form.effective_date ?? h.effective_date,
      expiration_date: form.expiration_date ?? h.expiration_date,
      monthly_rent_per_car: form.monthly_rent_per_car === "" ? null : Number(form.monthly_rent_per_car ?? h.monthly_rent_per_car),
      sublessee: form.sublessee ?? h.sublessee,
      contract_doc_url: form.contract_doc_url ?? h.contract_doc_url,
      owner_entity: form.owner_entity ?? h.owner_entity,
      ...appendNoteBody(termsNote),
    }).then((r) => r.json()),
    onSuccess: () => {
      setEdit(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/lease-mgmt/riders", id] });
      void invalidateFleetQueries(queryClient);
    },
  });
  const offLease = useMutation({
    mutationFn: () => {
      const ids = carIdsText.split(/[,\s]+/).map(Number).filter((n) => n > 0);
      return apiRequest("POST", `/api/lease-mgmt/riders/${id}/off-lease`, {
        date: offDate,
        car_ids: ids.length ? ids : undefined,
        ...appendNoteBody(offNote),
      }).then((r) => r.json());
    },
    onSuccess: () => {
      setOffOpen(false);
      void queryClient.invalidateQueries();
      void invalidateFleetQueries(queryClient);
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
        ...appendNoteBody(remarkNote),
      }).then((r) => r.json());
    },
    onSuccess: (body) => {
      setRemarkOpen(false);
      void queryClient.invalidateQueries();
      void invalidateFleetQueries(queryClient);
      if (body?.new_rider_id) window.location.hash = `#/leases/rider/${body.new_rider_id}`;
    },
  });

  if (isLoading || !data) return <div className="p-8 text-sm text-muted-foreground">Loading OL…</div>;
  const code = displayRiderCode(h);
  const lesseeName = h.lessee || "Lessee";
  const docCount = docs.data?.rows.length;
  const hasDocs = (docCount ?? 0) > 0;
  const docStatus = docs.isLoading
    ? "Documents…"
    : docs.isError
      ? "Documents unavailable"
      : hasDocs
        ? documentCountLabel(docCount ?? 0)
        : null;
  const carCount = Number(h.cars ?? 0);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="px-4 pt-4 sm:px-8">
        <BackToSearch />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 sm:px-8">
        <Breadcrumb data-testid="ol-breadcrumb">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/leases">Leases</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {h.master_lease_id ? (
                <BreadcrumbLink asChild>
                  <Link href={`/leases/lessee/${h.master_lease_id}`}>{lesseeName}</Link>
                </BreadcrumbLink>
              ) : (
                <span>{lesseeName}</span>
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{code}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <LeaseCrmLinks mode="rider" id={id} part="account" />
      </div>
      <PageHeader
        title={code}
        subtitle={`${lesseeName} · ${lifecycleLabel(h.lifecycle_status)} · ${carCount} cars`}
        actions={
          <div className="flex max-w-full flex-wrap gap-2">
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
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-8">
        <span>Effective {h.effective_date ?? "—"}</span>
        <span>Expiry {h.expiration_date ?? "—"}</span>
        <span>Rent/car {h.monthly_rent_per_car ?? h.rider_rent_per_car ?? "—"}</span>
        {h.sublessee ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Operated by {h.sublessee}</span> : null}
        {docStatus ? (
          <button
            type="button"
            className={cn(
              "text-sm underline-offset-2 hover:underline",
              hasDocs ? "text-foreground" : "text-muted-foreground",
            )}
            data-testid="ol-document-count"
            onClick={() => setSection("documents")}
          >
            {docStatus}
          </button>
        ) : null}
        {!docs.isLoading && !docs.isError && !hasDocs && !h.contract_doc_url ? (
          <span className="text-xs text-muted-foreground" data-testid="ol-document-count">No contract on file</span>
        ) : null}
        {h.contract_doc_url ? (
          <button type="button" className="max-w-full break-all font-mono text-xs underline" onClick={() => void navigator.clipboard.writeText(h.contract_doc_url)}>{h.contract_doc_url}</button>
        ) : null}
        {h.successor_rider_id ? <Link href={`/leases/rider/${h.successor_rider_id}`} className="underline">Successor OL</Link> : null}
      </div>
      <div className="shrink-0 px-4 sm:px-8">
        <LeaseCrmLinks mode="rider" id={id} part="opportunities" />
      </div>
      <Tabs
        value={section}
        onValueChange={(value) => {
          if (value === "cars" || value === "documents") setSection(value);
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 pb-4 sm:px-8"
      >
        <TabsList className="flex h-auto w-fit max-w-full shrink-0 flex-wrap justify-start">
          <TabsTrigger value="cars">Cars ({carCount})</TabsTrigger>
          <TabsTrigger value="documents">
            Documents{docCount == null ? "" : ` (${docCount})`}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="cars" className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          <FleetRegistry scopedRiderId={id} />
        </TabsContent>
        <TabsContent value="documents" className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          <LeaseDocumentsPanel
            fill
            kind="rider"
            id={id}
            fallbackUrls={h.contract_doc_url ? [{ label: "Contract path", url: h.contract_doc_url }] : []}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={edit} onOpenChange={setEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit terms</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Effective</Label><Input type="date" defaultValue={h.effective_date ?? ""} onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))} /></div>
            <div><Label>Expiration</Label><Input type="date" defaultValue={h.expiration_date ?? ""} onChange={(e) => setForm((f) => ({ ...f, expiration_date: e.target.value }))} /></div>
            <div><Label>Rent / car</Label><Input type="number" defaultValue={h.monthly_rent_per_car ?? h.rider_rent_per_car ?? ""} onChange={(e) => setForm((f) => ({ ...f, monthly_rent_per_car: e.target.value }))} /></div>
            <div><Label>Sublessee / Operated by</Label><Input defaultValue={h.sublessee ?? ""} onChange={(e) => setForm((f) => ({ ...f, sublessee: e.target.value }))} /></div>
            <div><Label>Contract path</Label><Input defaultValue={h.contract_doc_url ?? ""} onChange={(e) => setForm((f) => ({ ...f, contract_doc_url: e.target.value }))} /></div>
            <AddNoteField id="rider-terms-note" value={termsNote} onChange={setTermsNote} />
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
          <AddNoteField id="off-lease-note" value={offNote} onChange={setOffNote} />
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
          <AddNoteField id="remarket-note" value={remarkNote} onChange={setRemarkNote} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemarkOpen(false)}>Cancel</Button>
            <Button onClick={() => remarket.mutate()} disabled={remarket.isPending || !newOl}>Remarket</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
