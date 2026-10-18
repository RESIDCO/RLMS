import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiRequest, queryClient } from "@/lib/queryClient";
import LeaseDocumentsPanel from "@/pages/leases/LeaseDocumentsPanel";
import LeaseCrmLinks from "@/components/crm/LeaseCrmLinks";
import { displayRiderCode, lifecycleLabel } from "@shared/lease-mgmt";
import { ArrowLeft, FileText } from "lucide-react";
import { useCanEdit } from "@/lib/AuthContext";

function usd(n: number) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function CodeChip({ code, lifecycle }: { code: string; lifecycle?: string | null }) {
  const ea = lifecycle === "off_lease_pending_remarketing" || code.startsWith("EA");
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-mono ${ea ? "bg-amber-500/15 text-amber-800" : "bg-sky-500/15 text-sky-800"}`}>
      {code}
    </span>
  );
}

export default function LesseePage() {
  const [, params] = useRoute("/leases/lessee/:id");
  const id = Number(params?.id);
  const canEdit = useCanEdit();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/lease-mgmt/lessees", id],
    queryFn: () => apiGet<any>(`/api/lease-mgmt/lessees/${id}`),
    enabled: Number.isFinite(id),
  });
  const header = data?.header ?? {};
  const [mla, setMla] = useState("");
  const [mlaDoc, setMlaDoc] = useState("");
  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/lease-mgmt/lessees/${id}`, {
      mla_number: mla || header.mla_number,
      mla_doc_url: mlaDoc || header.mla_doc_url,
    }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/lease-mgmt/lessees", id] }),
  });

  if (isLoading || !data) {
    return <div className="p-8 text-sm text-muted-foreground">Loading lessee…</div>;
  }

  const docs = [
    header.mla_doc_url ? { label: "MLA", url: header.mla_doc_url } : null,
    ...((data.riders ?? []) as any[]).map((r) => r.contract_doc_url ? { label: displayRiderCode(r), url: r.contract_doc_url } : null),
  ].filter(Boolean) as { label: string; url: string }[];

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={header.lessee || header.lease_number || "Lessee"}
        subtitle={[header.account_manager ? `AM ${header.account_manager}` : null, header.mla_number ? `MLA ${header.mla_number}` : null].filter(Boolean).join(" · ") || "Lessee of record"}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href="/leases"><ArrowLeft className="h-4 w-4" /> Back</Link>
          </Button>
        }
      />
      <div className="px-4 sm:px-8 py-4 flex-1 min-h-0 overflow-auto space-y-6">
        <LeaseCrmLinks mode="lessee" id={id} />
        <div className="flex flex-wrap gap-4 text-sm">
          {(data.contacts ?? []).slice(0, 8).map((c: any) => (
            <div key={c.id} className="text-muted-foreground">{c.name || c.email || "Contact"}</div>
          ))}
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">MLA number</div>
              <Input className="h-8 w-48" defaultValue={header.mla_number ?? ""} onChange={(e) => setMla(e.target.value)} />
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">MLA doc path</div>
              <Input className="h-8 w-80" defaultValue={header.mla_doc_url ?? ""} onChange={(e) => setMlaDoc(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          </div>
        )}

        <div>
          <h2 className="text-sm font-semibold mb-2">OL / EA</h2>
          <div className="border rounded-md">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground border-b">
                <tr>
                  {["Code","Effective","Expiry","Cars","On rent","Off lease","Rent/car","Monthly rent","Owner entity","Sublessee","Doc"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.riders ?? []).map((r: any) => {
                  const code = displayRiderCode(r);
                  return (
                    <tr key={r.rider_id} className="border-t">
                      <td className="px-3 py-2">
                        <Link href={`/leases/rider/${r.rider_id}`} className="hover:underline inline-flex items-center gap-2">
                          <CodeChip code={code} lifecycle={r.lifecycle_status} />
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono-num">{r.effective_date ?? "—"}</td>
                      <td className="px-3 py-2 font-mono-num">{r.expiration_date ?? "—"}</td>
                      <td className="px-3 py-2 font-mono-num">{r.cars}</td>
                      <td className="px-3 py-2 font-mono-num">{r.on_rent}</td>
                      <td className="px-3 py-2 font-mono-num">{r.off_rent}</td>
                      <td className="px-3 py-2 font-mono-num">{r.rider_rent_per_car != null ? usd(r.rider_rent_per_car) : "—"}</td>
                      <td className="px-3 py-2 font-mono-num">{usd(r.monthly_rent)}</td>
                      <td className="px-3 py-2">{r.owner_entity ?? "—"}</td>
                      <td className="px-3 py-2">{r.sublessee ? <span className="text-[11px] rounded bg-muted px-1.5 py-0.5">Operated by {r.sublessee}</span> : "—"}</td>
                      <td className="px-3 py-2">{r.contract_doc_url ? <FileText className="h-4 w-4" /> : <span className="text-[11px] text-muted-foreground">No contract on file</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <h2 className="text-sm font-semibold mb-2">Timeline</h2>
            <ul className="text-sm space-y-1.5">
              {(data.timeline ?? []).slice(0, 40).map((e: any) => (
                <li key={e.id} className="text-muted-foreground">
                  <span className="font-mono-num text-xs">{String(e.occurred_at ?? "").slice(0, 10)}</span>
                  {" · "}
                  <span className="text-foreground">{e.action}</span>
                  {e.detail?.successor || e.detail?.new_ol_number ? ` → ${e.detail.successor || e.detail.new_ol_number}` : ""}
                  {lifecycleLabel(e.detail?.lifecycle_status) !== "—" ? ` (${lifecycleLabel(e.detail?.lifecycle_status)})` : ""}
                </li>
              ))}
              {!(data.timeline ?? []).length ? <li className="text-muted-foreground">No events yet.</li> : null}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold mb-2">Documents</h2>
            <LeaseDocumentsPanel kind="lessee" id={id} fallbackUrls={docs} />
          </div>
        </div>
      </div>
    </div>
  );
}
