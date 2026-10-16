import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiRequest, downloadXlsx } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";

export default function SaleClassAdmin() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["/api/sale-class"],
    queryFn: () => apiGet<any>("/api/sale-class"),
  });
  const { data: ox } = useQuery({
    queryKey: ["/api/previews/occidental-ol1818"],
    queryFn: () => apiGet<any>("/api/previews/occidental-ol1818"),
  });
  const { data: rtex } = useQuery({
    queryKey: ["/api/previews/ol2144-rtex"],
    queryFn: () => apiGet<any>("/api/previews/ol2144-rtex"),
  });
  const [rtexPreview, setRtexPreview] = useState<any>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("legal_owner");
  const [note, setNote] = useState("");
  const [ml, setMl] = useState("");
  const [rider, setRider] = useState("");
  const [klass, setKlass] = useState("external");
  const [buyer, setBuyer] = useState("");
  const [cnote, setCnote] = useState("");

  const addEntity = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/sale-class/entities", { name, kind, note: note || null })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/sale-class"] });
      toast({ title: "Entity saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const addRow = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/sale-class/rows", {
        master_lease_id: ml ? Number(ml) : null,
        rider_id: rider ? Number(rider) : null,
        class: klass,
        buyer: buyer || null,
        note: cnote || null,
      })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/sale-class"] });
      toast({ title: "Classification saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <PageHeader
        title="Sale classification"
        subtitle="Bruce owns these tables. Matching is case- and punctuation-insensitive. No auto-writes to cars."
      />
      <div className="p-6 space-y-8 max-w-5xl">
        <div>
          <h2 className="font-semibold mb-2">Internal entities</h2>
          <table className="w-full text-sm mb-3">
            <thead><tr className="text-left text-xs text-muted-foreground"><th>Name</th><th>Kind</th><th>Note</th></tr></thead>
            <tbody>
              {(data?.entities ?? []).map((e: any) => (
                <tr key={e.name} className="border-t border-border/40">
                  <td className="py-1">{e.name}</td>
                  <td>{e.kind}</td>
                  <td>{e.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <div className="flex flex-wrap gap-2 items-end">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Kind</Label><Input value={kind} onChange={(e) => setKind(e.target.value)} /></div>
              <div><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
              <Button size="sm" onClick={() => addEntity.mutate()}>Add / upsert</Button>
            </div>
          )}
        </div>
        <div>
          <h2 className="font-semibold mb-2">Lease / rider classifications</h2>
          <table className="w-full text-sm mb-3">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th>MLA</th><th>Rider</th><th>Class</th><th>Buyer</th><th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(data?.classifications ?? []).map((r: any) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="py-1">{r.master_lease_id ?? "—"}</td>
                  <td>{r.rider_id ?? "—"}</td>
                  <td>{r.class}</td>
                  <td>{r.buyer ?? "—"}</td>
                  <td>{r.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <div className="flex flex-wrap gap-2 items-end">
              <div><Label>MLA id</Label><Input value={ml} onChange={(e) => setMl(e.target.value)} className="w-24" /></div>
              <div><Label>Rider id</Label><Input value={rider} onChange={(e) => setRider(e.target.value)} className="w-24" /></div>
              <div>
                <Label>Class</Label>
                <Input value={klass} onChange={(e) => setKlass(e.target.value)} className="w-32" />
              </div>
              <div><Label>Buyer</Label><Input value={buyer} onChange={(e) => setBuyer(e.target.value)} /></div>
              <div><Label>Note</Label><Input value={cnote} onChange={(e) => setCnote(e.target.value)} /></div>
              <Button size="sm" onClick={() => addRow.mutate()}>Add row</Button>
            </div>
          )}
        </div>
        <div>
          <h2 className="font-semibold mb-2">Occidental OL1818 preview (read-only)</h2>
          <p className="text-sm text-muted-foreground mb-2">
            {ox?.mla_rows ?? 0} MLA row · {ox?.car_rows ?? 0} car rows · {ox?.inactive_rows ?? 0} inactive.
            Apply is gated in migrations/20261019_occidental_ol1818_apply_DO_NOT_RUN.sql until Bruce signs off.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadXlsx("/api/previews/occidental-ol1818?format=csv", "preview_occidental_ol1818_unsold.csv")}
          >
            Download preview CSV
          </Button>
        </div>
        <div>
          <h2 className="font-semibold mb-2">OL2144 RTEX buyer (30 Sold cars only)</h2>
          <p className="text-sm text-muted-foreground mb-2">
            {rtex?.car_rows ?? 0} active Sold cars on OL2144. The other 68 stay Leased and on rent.
            No rider-wide classification. Set buyer RTEX via preview → apply after merge. Does not change active.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadXlsx("/api/previews/ol2144-rtex?format=csv", "preview_ol2144_rtex_buyer.csv")}
            >
              Download preview CSV
            </Button>
            {canEdit && (
              <>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const p = await (await apiRequest("POST", "/api/previews/ol2144-rtex", {})).json();
                      setRtexPreview(p);
                      toast({ title: "Preview ready", description: `${p.ids?.length ?? 0} cars` });
                    } catch (e: any) {
                      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
                    }
                  }}
                >
                  Preview set buyer RTEX
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!rtexPreview?.preview_token}
                  onClick={async () => {
                    try {
                      const d = await (await apiRequest("POST", "/api/previews/ol2144-rtex/apply", {
                        preview_token: rtexPreview.preview_token,
                      })).json();
                      toast({ title: "Applied", description: `${d.updated} buyers set` });
                      setRtexPreview(null);
                      qc.invalidateQueries({ queryKey: ["/api/previews/ol2144-rtex"] });
                      qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
                    } catch (e: any) {
                      toast({ title: "Apply failed", description: e.message, variant: "destructive" });
                    }
                  }}
                >
                  Apply RTEX preview
                </Button>
              </>
            )}
          </div>
          {rtexPreview?.kpi_delta && (
            <div className="text-sm mt-2">
              {(rtexPreview.kpi_delta as any[]).slice(0, 5).map((d) => (
                <div key={d.railcar_id}>{d.car}: {d.before_title} → {d.after_title}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
