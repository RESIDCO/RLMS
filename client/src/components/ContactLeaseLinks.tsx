import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SearchableSelect from "@/components/SearchableSelect";
import { useToast } from "@/hooks/use-toast";
import { Link2, Trash2 } from "lucide-react";
import { displayLeaseNumber } from "@shared/residco-import";

type LeaseLink = {
  id: number;
  company_contact_id: number;
  master_lease_id: number | null;
  rider_id: number | null;
  relationship_note: string | null;
  contact_name?: string | null;
  company_id?: number | null;
  company_name?: string | null;
  master_lease?: { id: number; lease_number: string | null; lessee: string | null } | null;
  rider?: { id: number; rider_name: string | null; schedule_number: string | null } | null;
};

type Lease = {
  id: number;
  lease_number: string | null;
  lessee: string | null;
  riders?: Array<{ id: number; rider_name: string | null; schedule_number: string | null }>;
};

function linkLabel(row: LeaseLink) {
  const mla = row.master_lease ? displayLeaseNumber(row.master_lease.lease_number) || row.master_lease.lessee : null;
  const ol = row.rider?.rider_name || row.rider?.schedule_number;
  return [mla, ol].filter(Boolean).join(" · ") || "Lease link";
}

export default function ContactLeaseLinks({
  mode,
  contactId,
  companyId,
  contacts,
  masterLeaseId,
  riderId,
  canAdd,
  canRemove,
}: {
  mode: "contact" | "company" | "lease" | "rider";
  contactId?: number;
  companyId?: number;
  contacts?: Array<{ id: number; name: string }>;
  masterLeaseId?: number;
  riderId?: number;
  canAdd: boolean;
  canRemove: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [mlaId, setMlaId] = useState("");
  const [olId, setOlId] = useState("");
  const [note, setNote] = useState("");
  const [pickContact, setPickContact] = useState("");
  const [peopleQ, setPeopleQ] = useState("");

  const listUrl =
    mode === "contact" ? `/api/company-contacts/${contactId}/lease-links`
    : mode === "company" ? `/api/companies/${companyId}/lease-links`
    : mode === "lease" ? `/api/leases/${masterLeaseId}/contact-links`
    : `/api/riders/${riderId}/contact-links`;

  const { data: links = [] } = useQuery<LeaseLink[]>({
    queryKey: [listUrl],
    queryFn: () => apiGet<LeaseLink[]>(listUrl),
    enabled: Boolean(contactId || companyId || masterLeaseId || riderId),
  });

  const { data: leases = [] } = useQuery<Lease[]>({
    queryKey: ["/api/leases"],
    enabled: canAdd && (mode === "contact" || mode === "company"),
  });

  const { data: peoplePage } = useQuery<{ rows: Array<{ id: number; name: string; company_name: string | null }> }>({
    queryKey: ["/api/company-contacts", peopleQ],
    queryFn: () => apiGet(`/api/company-contacts?page=1&pageSize=40${peopleQ ? `&search=${encodeURIComponent(peopleQ)}` : ""}`),
    enabled: canAdd && (mode === "lease" || mode === "rider"),
  });

  const mlaOptions = useMemo(
    () => leases.map((l) => ({
      value: String(l.id),
      label: displayLeaseNumber(l.lease_number) || `MLA ${l.id}`,
      hint: l.lessee ?? undefined,
      keywords: [l.lease_number, l.lessee].filter(Boolean).join(" "),
    })),
    [leases],
  );
  const riders = useMemo(() => {
    const lease = leases.find((l) => String(l.id) === mlaId);
    return lease?.riders ?? [];
  }, [leases, mlaId]);

  const addMut = useMutation({
    mutationFn: async () => {
      if (mode === "contact" || mode === "company") {
        const cid = mode === "contact" ? contactId : Number(pickContact);
        if (!cid) throw new Error("Pick a contact");
        await apiRequest("POST", `/api/company-contacts/${cid}/lease-links`, {
          master_lease_id: mlaId ? Number(mlaId) : null,
          rider_id: olId ? Number(olId) : null,
          relationship_note: note || null,
        });
      } else if (mode === "lease") {
        await apiRequest("POST", `/api/leases/${masterLeaseId}/contact-links`, {
          company_contact_id: Number(pickContact),
          relationship_note: note || null,
        });
      } else {
        await apiRequest("POST", `/api/riders/${riderId}/contact-links`, {
          company_contact_id: Number(pickContact),
          relationship_note: note || null,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [listUrl] });
      setNote("");
      toast({ title: "Lease linked" });
    },
    onError: (e: Error) => toast({ title: "Could not link", description: e.message, variant: "destructive" }),
  });

  const delUrl = (id: number) => {
    if (mode === "lease") return `/api/leases/${masterLeaseId}/contact-links/${id}`;
    if (mode === "rider") return `/api/riders/${riderId}/contact-links/${id}`;
    return `/api/contact-lease-links/${id}`;
  };

  const delMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", delUrl(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: [listUrl] }),
  });

  const peopleOpts = (peoplePage?.rows ?? []).map((p) => ({
    value: String(p.id),
    label: p.name,
    hint: p.company_name ?? undefined,
  }));
  const companyPeopleOpts = (contacts ?? []).map((c) => ({ value: String(c.id), label: c.name }));

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {mode === "lease" || mode === "rider" ? "Linked contacts" : "Linked leases"}
      </div>
      {links.length === 0 && <p className="text-xs text-muted-foreground italic">No leases linked yet.</p>}
      <ul className="space-y-1.5">
        {links.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs">
            <div>
              <div className="font-medium">{linkLabel(row)}</div>
              {(row.contact_name || row.company_name) && (
                <div className="text-muted-foreground">{[row.contact_name, row.company_name].filter(Boolean).join(" · ")}</div>
              )}
              {row.relationship_note && <div className="text-muted-foreground mt-0.5">{row.relationship_note}</div>}
            </div>
            {canRemove && (
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => delMut.mutate(row.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canAdd && (
        <div className="space-y-2 pt-1">
          {(mode === "company" || mode === "lease" || mode === "rider") && (
            <SearchableSelect
              value={pickContact}
              onChange={setPickContact}
              options={mode === "company" ? companyPeopleOpts : peopleOpts}
              placeholder="Contact…"
              searchPlaceholder="Search people…"
            />
          )}
          {(mode === "lease" || mode === "rider") && (
            <Input value={peopleQ} onChange={(e) => setPeopleQ(e.target.value)} placeholder="Filter people by name…" className="h-8 text-xs" />
          )}
          {(mode === "contact" || mode === "company") && (
            <>
              <SearchableSelect value={mlaId} onChange={(v) => { setMlaId(v); setOlId(""); }} options={mlaOptions} placeholder="MLA…" searchPlaceholder="Lessee or lease…" />
              <SearchableSelect
                value={olId}
                onChange={setOlId}
                options={riders.map((r) => ({ value: String(r.id), label: r.rider_name || r.schedule_number || `OL ${r.id}` }))}
                placeholder="OL (optional)…"
                disabled={!mlaId}
              />
            </>
          )}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. primary for renewal" className="h-8 text-xs" />
          <Button size="sm" className="gap-1" disabled={addMut.isPending} onClick={() => addMut.mutate()}>
            <Link2 className="h-3.5 w-3.5" /> Link
          </Button>
        </div>
      )}
    </div>
  );
}
