import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { COMMITMENT_TYPES, type CommitmentType } from "@shared/commitment";
import { kpiBucketTitle } from "@shared/kpi-buckets";
import { carPath } from "@/lib/browse-nav";

function KpiDeltaBlock({ delta }: { delta: any[] | undefined }) {
  if (!delta?.length) return null;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">KPI before → after</div>
      {delta.map((d) => (
        <div key={d.railcar_id}>
          <span className="font-medium">{d.before_title}</span>
          {" → "}
          <span className="font-medium">{d.after_title}</span>
          {d.leaves_current ? (
            <span className="text-muted-foreground"> (leaves this list)</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function KpiCarSheet({
  carId,
  bucket,
  fromQs,
  onClose,
}: {
  carId: number | null;
  bucket: string;
  fromQs: string;
  onClose: () => void;
}) {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const qc = useQueryClient();
  const enabled = Number.isFinite(carId) && (carId ?? 0) > 0;
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/kpi/car", carId],
    queryFn: () => apiGet<any>(`/api/kpi/car/${carId}`),
    enabled,
  });
  const { data: commit } = useQuery({
    queryKey: ["/api/commitments/car", carId],
    queryFn: () => apiGet<any>(`/api/commitments/car/${carId}`),
    enabled,
  });

  const [type, setType] = useState<CommitmentType>("deal");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [rentDate, setRentDate] = useState("");
  const [buyer, setBuyer] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [kind, setKind] = useState<"commitment" | "clear" | "rent_start" | "sold" | "unsold" | null>(null);

  const row = data?.row;
  const ids = carId ? [carId] : [];
  const from = encodeURIComponent(`/kpi/cars${fromQs.startsWith("?") ? fromQs : `?${fromQs}`}`);

  const runPreview = useMutation({
    mutationFn: async (nextKind: NonNullable<typeof kind>) => {
      setKind(nextKind);
      if (nextKind === "sold") {
        return (await apiRequest("POST", "/api/railcars/sold/preview", {
          ids,
          sold_to: buyer || null,
          bucket,
        })).json();
      }
      if (nextKind === "unsold") {
        return (await apiRequest("POST", "/api/railcars/unsold/preview", { ids, bucket })).json();
      }
      if (nextKind === "rent_start") {
        return (await apiRequest("POST", "/api/rent-start/bulk/preview", {
          ids,
          date: rentDate || null,
          overwrite: true,
          bucket,
        })).json();
      }
      return (await apiRequest("POST", "/api/commitments/bulk/preview", {
        ids,
        action: nextKind === "clear" ? "clear" : "set",
        type,
        name,
        target_date: target || null,
        overwrite: true,
        bucket,
      })).json();
    },
    onSuccess: setPreview,
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });

  const apply = useMutation({
    mutationFn: async () => {
      const token = preview?.preview_token;
      if (!token) throw new Error("Preview first");
      if (kind === "sold") return (await apiRequest("POST", "/api/railcars/sold/apply", { preview_token: token })).json();
      if (kind === "unsold") return (await apiRequest("POST", "/api/railcars/unsold/apply", { preview_token: token })).json();
      if (kind === "rent_start") return (await apiRequest("POST", "/api/rent-start/bulk/apply", { preview_token: token })).json();
      return (await apiRequest("POST", "/api/commitments/bulk/apply", { preview_token: token })).json();
    },
    onSuccess: () => {
      toast({ title: "Applied" });
      setPreview(null);
      setKind(null);
      qc.invalidateQueries({ queryKey: ["/api/kpi/cars"] });
      qc.invalidateQueries({ queryKey: ["/api/kpi/car"] });
      qc.invalidateQueries({ queryKey: ["/api/commitments/car", carId] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: (e: Error) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Sheet open={carId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{row?.car ?? "Car"}</SheetTitle>
        </SheetHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground mt-4">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive mt-4">{(error as Error).message}</p>
        ) : row ? (
          <div className="mt-4 space-y-4 text-sm">
            <div className="rounded-md border border-border p-3 space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Why in this KPI</div>
              <div className="font-medium">{row.reason ?? kpiBucketTitle(bucket)}</div>
              <div className="text-muted-foreground">
                {kpiBucketTitle(data.primary)} · tag {row.status_tag ?? "—"} · derived {row.derived_status ?? "—"}
              </div>
              <div className="text-muted-foreground">
                Lease {row.current_lease ?? "—"} · {row.lessee ?? "—"}
              </div>
            </div>

            <Link
              href={`${carPath(row.railcar_id)}?from=${from}&focus=assignment`}
              className="text-sm underline"
            >
              Edit assignment on car page
            </Link>

            {canEdit && (
              <>
                <div className="space-y-2 border border-border rounded-md p-3">
                  <div className="font-medium">Commitment</div>
                  <div className="text-muted-foreground">
                    {row.commitment ?? commit?.commitment?.name ?? "None"}
                    {commit?.implicit ? ` · ${commit.implicit.name}` : ""}
                  </div>
                  <div className="grid gap-2">
                    <Select value={type} onValueChange={(v) => setType(v as CommitmentType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMMITMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                    <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={!name.trim()} onClick={() => runPreview.mutate("commitment")}>
                        Preview set
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => runPreview.mutate("clear")}>
                        Preview clear
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 border border-border rounded-md p-3">
                  <div className="font-medium">Rent start date</div>
                  <div className="text-muted-foreground">{row.rent_start_date ?? "—"}{row.on_ol ? "" : " (on OL only)"}</div>
                  <Input type="date" value={rentDate} onChange={(e) => setRentDate(e.target.value)} />
                  <Button size="sm" disabled={!rentDate || !row.on_ol} onClick={() => runPreview.mutate("rent_start")}>
                    Preview rent start
                  </Button>
                </div>

                <div className="space-y-2 border border-border rounded-md p-3">
                  <div className="font-medium">Sold tag / buyer</div>
                  <div className="text-muted-foreground">
                    Tag {row.status_tag ?? "—"} · buyer {row.buyer ?? "—"}
                  </div>
                  <Label>Buyer (optional)</Label>
                  <Input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder={row.buyer ?? "Buyer"} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => runPreview.mutate("sold")}>Preview Mark Sold</Button>
                    <Button size="sm" variant="outline" onClick={() => runPreview.mutate("unsold")}>
                      Preview remove Sold
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">No direct status edit. Sold stays billing-active.</p>
                </div>
              </>
            )}

            {preview && (
              <div className="space-y-2">
                <KpiDeltaBlock delta={preview.kpi_delta} />
                {(preview.rejected_inactive ?? []).length > 0 && (
                  <div className="text-destructive">Rejected inactive — nothing will be written.</div>
                )}
                {canEdit && (
                  <Button disabled={!preview.preview_token || apply.isPending} onClick={() => apply.mutate()}>
                    Apply preview
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
