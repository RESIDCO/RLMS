import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { carPath, openAppTab } from "@/lib/browse-nav";

function csvFromFile(file: File): Promise<string> {
  return file.text();
}

export function CommitmentPanel({ carId }: { carId: number }) {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["/api/commitments/car", carId],
    queryFn: () => apiGet<any>(`/api/commitments/car/${carId}`),
    enabled: Number.isFinite(carId),
  });
  const [type, setType] = useState<CommitmentType>("deal");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const open = data?.commitment;
  const save = useMutation({
    mutationFn: async (overwrite: boolean) => {
      const res = await apiRequest("POST", `/api/commitments/car/${carId}`, {
        type, name, target_date: target || null, note: note || null, overwrite,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commitments/car", carId] });
      qc.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      toast({ title: "Commitment saved" });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });
  const clear = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/commitments/car/${carId}`)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commitments/car", carId] });
      qc.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      toast({ title: "Commitment cleared" });
    },
    onError: (e: Error) => toast({ title: "Could not clear", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="text-sm font-semibold">Commitment</div>
      {open ? (
        <div className="text-sm space-y-1">
          <div><span className="text-muted-foreground">Type</span> {open.type}</div>
          <div><span className="text-muted-foreground">Name</span> {open.name}</div>
          <div><span className="text-muted-foreground">Target</span> {open.target_date ?? "—"}</div>
          {open.note ? <div className="text-muted-foreground">{open.note}</div> : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">None — Available for Opportunities if off rent.</p>
      )}
      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as CommitmentType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMMITMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Metalico" />
          </div>
          <div>
            <Label>Target date</Label>
            <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div>
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <Button size="sm" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(Boolean(open))}>
              {open ? "Edit" : "Set"} Commitment
            </Button>
            {open ? (
              <Button size="sm" variant="outline" disabled={clear.isPending} onClick={() => clear.mutate()}>Clear</Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function PasteBox({ onText }: { onText: (t: string) => void }) {
  return (
    <div className="space-y-2">
      <Textarea rows={8} placeholder="Paste marks + numbers (TFOX 000644)…" onChange={(e) => onText(e.target.value)} />
      <Input type="file" accept=".csv,.txt,.xlsx" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) onText(await csvFromFile(f));
      }} />
    </div>
  );
}

export function BulkCommitmentPage() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [type, setType] = useState<CommitmentType>("deal");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [action, setAction] = useState<"set" | "clear">("set");
  const runPreview = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/commitments/bulk/preview", {
      text, action, type, name, target_date: target || null, note: note || null, overwrite,
    })).json(),
    onSuccess: setPreview,
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/commitments/bulk/apply", {
      preview_token: preview?.preview_token,
    })).json(),
    onSuccess: (d) => toast({ title: "Applied", description: JSON.stringify({ set: d.set, skipped: d.skipped, cleared: d.cleared }) }),
    onError: (e: Error) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div>
      <PageHeader title="Bulk Commitment" subtitle="Preview first. On-rent cars are rejected." />
      <div className="p-6 space-y-4 max-w-4xl">
        <PasteBox onText={setText} />
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label>Action</Label>
            <Select value={action} onValueChange={(v) => setAction(v as "set" | "clear")}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="set">Set</SelectItem>
                <SelectItem value="clear">Clear</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {action === "set" && (
            <>
              <div>
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as CommitmentType)}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMMITMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
              </div>
              <label className="text-xs flex items-center gap-2">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Overwrite existing
              </label>
            </>
          )}
          <Button onClick={() => runPreview.mutate()} disabled={!text.trim()}>Preview</Button>
          {canEdit && <Button variant="secondary" disabled={!preview?.preview_token} onClick={() => apply.mutate()}>Apply reviewed preview</Button>}
        </div>
        {preview && (
          <div className="text-sm space-y-3">
            <div>Matched {preview.matched?.length ?? 0} · Already committed {preview.already_committed?.length ?? 0} · On rent rejected {preview.on_rent?.length ?? 0} · Not found {preview.not_found?.length ?? 0}</div>
            {(preview.not_found ?? []).length > 0 && <div className="text-destructive">Not found: {preview.not_found.map((n: any) => n.raw).join(", ")}</div>}
            {(preview.on_rent ?? []).length > 0 && <div>Rejected on rent: {preview.on_rent.map((n: any) => `${n.marks} ${n.car_number}`).join(", ")}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export function BulkReturnPage() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const search = useSearch();
  const prefill = useMemo(() => new URLSearchParams(search.replace(/^\?/, "")).get("cars") ?? "", [search]);
  const [text, setText] = useState(prefill);
  const [preview, setPreview] = useState<any>(null);
  const [commitName, setCommitName] = useState("");
  const [commitType, setCommitType] = useState<CommitmentType>("deal");
  const runPreview = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/returns/bulk/preview", {
      text,
      commitment: commitName.trim() ? { type: commitType, name: commitName.trim() } : null,
    })).json(),
    onSuccess: setPreview,
  });
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/returns/bulk/apply", {
      preview_token: preview?.preview_token,
    })).json(),
    onSuccess: (d) => toast({ title: "Return applied", description: `Moved ${d.moved}` }),
  });
  return (
    <div>
      <PageHeader title="Bulk return" subtitle="Move OL → EA / x-lessee. Preview shows old link → new link and resulting status." />
      <div className="p-6 space-y-4 max-w-5xl">
        <PasteBox onText={setText} />
        <div className="flex gap-2 flex-wrap items-end">
          <div>
            <Label>Optional Commitment</Label>
            <Input value={commitName} onChange={(e) => setCommitName(e.target.value)} placeholder="Metalico" />
          </div>
          <Select value={commitType} onValueChange={(v) => setCommitType(v as CommitmentType)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMMITMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => runPreview.mutate()}>Preview</Button>
          {canEdit && <Button variant="secondary" disabled={!preview?.preview_token} onClick={() => apply.mutate()}>Apply reviewed preview</Button>}
        </div>
        {preview?.rows && (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th>Car</th><th>From</th><th>To</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {preview.rows.map((r: any) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="py-1 font-mono">{r.marks} {r.car_number}</td>
                  <td>{r.from_link}</td>
                  <td>{r.to_link} {r.to_label}</td>
                  <td>{r.resulting_status}</td>
                  <td>{r.eligible ? "" : r.reject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function StaleCommitmentsPage() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["/api/commitments/stale"], queryFn: () => apiGet<any>("/api/commitments/stale") });
  const [extendId, setExtendId] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  return (
    <div>
      <PageHeader title="Stale Commitments" subtitle="Open Commitments with no date, a past date, or older than 90 days — plus programs past target completion. Nothing clears silently." />
      <div className="p-6 space-y-6">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground text-xs"><th>Car</th><th>Commitment</th><th>Reason</th><th>Target</th><th></th></tr></thead>
          <tbody>
            {(data?.items ?? []).map((c: any) => (
              <tr key={c.id} className="border-t border-border/40">
                <td className="py-1.5 font-mono">
                  <button type="button" className="underline" onClick={() => openAppTab(carPath(c.railcar_id ?? c.railcar?.id))}>
                    {c.railcar?.reporting_marks} {c.railcar?.car_number}
                  </button>
                </td>
                <td>{c.type} · {c.name}</td>
                <td>{c.reason}</td>
                <td>{c.target_date ?? "—"}</td>
                <td className="space-x-2">
                  {canEdit && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { setExtendId(c.id); setDate(""); }}>Extend</Button>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        await apiRequest("POST", `/api/commitments/${c.id}/clear`);
                        qc.invalidateQueries({ queryKey: ["/api/commitments/stale"] });
                      }}>Clear</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {extendId != null && (
          <div className="flex gap-2 items-end">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button onClick={async () => {
              await apiRequest("POST", `/api/commitments/${extendId}/extend`, { target_date: date, note });
              setExtendId(null);
              qc.invalidateQueries({ queryKey: ["/api/commitments/stale"] });
              toast({ title: "Extended" });
            }}>Save date</Button>
          </div>
        )}
        <h2 className="text-sm font-semibold">Open programs past target</h2>
        {(data?.programs ?? []).map((p: any) => (
          <div key={p.id} className="flex items-center gap-3 text-sm">
            <span>{p.name} · {p.target_completion_date}</span>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={async () => {
                await apiRequest("POST", `/api/programs/${p.id}/close`);
                qc.invalidateQueries({ queryKey: ["/api/commitments/stale"] });
                toast({ title: "Program closed" });
              }}>Close program</Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeaseEndedWatchPage() {
  const [, nav] = useLocation();
  const { data } = useQuery({ queryKey: ["/api/returns/watch"], queryFn: () => apiGet<any>("/api/returns/watch") });
  const cars = (data?.rows ?? []).map((r: any) => `${r.marks} ${r.car_number}`).join("\n");
  return (
    <div>
      <PageHeader title="Lease-ended watch" subtitle="Still on an OL whose end date is past, not Month to Month, no EA/xOL move yet." />
      <div className="p-6 space-y-3">
        <Button onClick={() => nav(`/returns/bulk?cars=${encodeURIComponent(cars)}`)}>Move to EA x-lessee?</Button>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground text-xs"><th>Car</th><th>OL</th><th>Lessee</th><th>End</th><th>Days past</th></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((r: any) => (
              <tr key={r.id} className="border-t border-border/40">
                <td className="py-1.5 font-mono">{r.marks} {r.car_number}</td>
                <td>{r.ol}</td>
                <td>{r.lessee}</td>
                <td>{r.end_date}</td>
                <td>{r.days_past}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function KpiCarListPage() {
  const search = useSearch();
  const bucket = new URLSearchParams(search.replace(/^\?/, "")).get("bucket") ?? "off_rent";
  const titles: Record<string, string> = {
    off_rent: "Off Rent",
    idle: "Idle (seed / committed)",
    idle_on_ol: "Tagged Idle on OL — under review",
    unassigned: "Unassigned / Available for Opportunities",
    on_rent: "Active Cars (on rent)",
    no_link: "No lease link",
    mtm: "Month to Month",
  };
  const { data } = useQuery({
    queryKey: ["/api/kpi/cars", bucket],
    queryFn: () => apiGet<any>(`/api/kpi/cars?bucket=${encodeURIComponent(bucket)}`),
  });
  return (
    <div>
      <PageHeader title={titles[bucket] ?? bucket} subtitle={`${data?.rows?.length ?? 0} cars`} />
      <div className="p-6">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground text-xs"><th>Car</th><th>Entity</th><th>Link</th><th>Lessee</th></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((r: any) => (
              <tr key={r.railcar_id} className="border-t border-border/40">
                <td className="py-1.5 font-mono">
                  <button type="button" className="underline" onClick={() => openAppTab(carPath(r.railcar_id))}>
                    {r.reporting_marks} {r.car_number}
                  </button>
                </td>
                <td>{r.entity}</td>
                <td>{r.link_rider ?? "—"}</td>
                <td>{r.lessee_name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
