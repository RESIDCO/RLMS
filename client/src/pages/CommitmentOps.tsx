import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Redirect, useLocation } from "wouter";
import { useHashSearch } from "@/lib/hash-location";
import { offerUndoToast } from "@/lib/undo";
import {
  OFF_RENT_PASTE_STORAGE_KEY,
  RENT_STOP_REASON_CHOICES,
  parseOffRentPaste,
  rentStopReasonFields,
} from "@shared/rent-stops";
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
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import { useCanEdit } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AddNoteField, appendNoteBody, noteSkipDescription } from "@/components/AddNoteField";
import { COMMITMENT_TYPES, type CommitmentType } from "@shared/commitment";
import {
  commitmentVisibility,
  flagsFromCommitmentPayload,
  rentStartVisibility,
} from "@shared/car-detail-panel";
import { Link } from "wouter";
import { carPath, openAppTab } from "@/lib/browse-nav";
import { LineageCarLink } from "@/components/LineageCarLink";
import { CopyCarsButton } from "@/components/CopyCarsButton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

function csvFromFile(file: File): Promise<string> {
  return file.text();
}

export function CommitmentPanel({
  carId,
  heading = "Commitment",
  rentStartCollapsed = false,
}: {
  carId: number;
  /** "Car commitment" when the sheet was opened from a program. */
  heading?: string;
  /** Program context keeps the rent-start editor behind an expander. */
  rentStartCollapsed?: boolean;
}) {
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
  const implicit = data?.implicit;
  const [rentDate, setRentDate] = useState("");
  const [rentNote, setRentNote] = useState("");
  const [correctRentOpen, setCorrectRentOpen] = useState(false);
  const flags = flagsFromCommitmentPayload(data);
  const rentVis = flags ? rentStartVisibility(flags) : null;
  const commitVis = flags ? commitmentVisibility(flags, Boolean(open)) : "loading";
  const showRentBox = rentVis === "open" || correctRentOpen;
  const saveRent = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/rent-start/car/${carId}`, { date: rentDate || null, ...appendNoteBody(rentNote) });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commitments/car", carId] });
      qc.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      void invalidateFleetQueries(qc);
      toast({ title: "Rent start saved" });
    },
    onError: (e: Error) => toast({ title: "Could not set rent start", description: e.message, variant: "destructive" }),
  });
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
      void invalidateFleetQueries(qc);
      toast({ title: "Commitment saved" });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });
  const clear = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/commitments/car/${carId}`)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commitments/car", carId] });
      qc.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      void invalidateFleetQueries(qc);
      toast({ title: "Commitment cleared" });
    },
    onError: (e: Error) => toast({ title: "Could not clear", description: e.message, variant: "destructive" }),
  });
  const rentEditor = (
    <div className="text-sm space-y-2" data-testid="rent-start-box">
      <div className="font-semibold">Rent start</div>
      <div>
        <span className="text-muted-foreground">Rent start date</span>{" "}
        {data?.rent_start_date ?? "—"}
        {data?.on_ol ? "" : " (only editable on an OL)"}
      </div>
      {canEdit && data?.on_ol ? (
        <div className="space-y-2">
          <div className="flex gap-2 items-end">
            <div>
              <Label>Set date</Label>
              <Input type="date" value={rentDate} onChange={(e) => setRentDate(e.target.value)} />
            </div>
            <Button size="sm" disabled={saveRent.isPending} onClick={() => saveRent.mutate()}>Save date</Button>
          </div>
          <AddNoteField id={`rent-start-note-${carId}`} value={rentNote} onChange={setRentNote} />
        </div>
      ) : null}
    </div>
  );

  const rentBody = commitVis === "loading" || rentVis == null ? (
    <p className="text-sm text-muted-foreground">Loading rent start…</p>
  ) : showRentBox ? (
    rentEditor
  ) : (
    <button
      type="button"
      className="text-sm text-primary underline-offset-2 hover:underline"
      data-testid="link-correct-rent-start"
      onClick={() => setCorrectRentOpen(true)}
    >
      Correct rent start
    </button>
  );

  return (
    <div className="space-y-3">
      {rentStartCollapsed ? (
        <Collapsible className="rounded-lg border border-border">
          <CollapsibleTrigger
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            data-testid="rent-start-expander"
          >
            <span className="text-sm font-semibold">Rent start</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 pb-4">{rentBody}</CollapsibleContent>
        </Collapsible>
      ) : (
        <div className="rounded-lg border border-border p-4">{rentBody}</div>
      )}

      {commitVis === "readonly" && open ? (
        <div className="rounded-lg border border-border p-4 text-sm space-y-1" data-testid="commitment-readonly">
          <div className="font-semibold">{heading}</div>
          <div><span className="text-muted-foreground">Type</span> {open.type}</div>
          <div><span className="text-muted-foreground">Name</span> {open.name}</div>
          <div><span className="text-muted-foreground">Target</span> {open.target_date ?? "—"}</div>
          {open.note ? <div className="text-muted-foreground">{open.note}</div> : null}
          {canEdit ? (
            <Button size="sm" variant="outline" disabled={clear.isPending} onClick={() => clear.mutate()}>Clear</Button>
          ) : null}
        </div>
      ) : null}

      {commitVis === "form" ? (
        <div className="rounded-lg border border-border p-4 space-y-3" data-testid="commitment-form">
          <div className="text-sm font-semibold">{heading}</div>
          {implicit ? (
            <div className="text-sm rounded-md border border-border bg-muted/30 px-3 py-2">
              {implicit.name}
              <div className="text-xs text-muted-foreground">Read-only. No Commitment row is written.</div>
            </div>
          ) : null}
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
      ) : null}
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
  const qc = useQueryClient();
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
    onSuccess: (d) => {
      void invalidateFleetQueries(qc);
      toast({ title: "Applied", description: JSON.stringify({ set: d.set, skipped: d.skipped, cleared: d.cleared }) });
    },
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
          {preview?.matched ? (
            <CopyCarsButton
              rows={preview.matched}
              lineOf={(row: { marks?: string | null; car_number?: string | null }) => ({
                reporting_marks: row.marks,
                car_number: row.car_number,
              })}
              testId="button-copy-cars-bulk-commitment"
            />
          ) : null}
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
  const qc = useQueryClient();
  const search = useHashSearch();
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
    onSuccess: (d) => {
      void invalidateFleetQueries(qc);
      toast({ title: "Return applied", description: `Moved ${d.moved}` });
    },
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
          {preview?.rows ? (
            <CopyCarsButton
              rows={preview.rows}
              lineOf={(row: { marks?: string | null; car_number?: string | null }) => ({
                reporting_marks: row.marks,
                car_number: row.car_number,
              })}
              testId="button-copy-cars-bulk-return"
            />
          ) : null}
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
        <Link href="/fleet/data-issues" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
          Back to Fleet data issues
        </Link>
        <div className="flex justify-end">
          <CopyCarsButton
            rows={data?.items ?? []}
            lineOf={(row: { railcar?: { reporting_marks?: string | null; car_number?: string | null } | null }) => ({
              reporting_marks: row.railcar?.reporting_marks,
              car_number: row.railcar?.car_number,
            })}
            testId="button-copy-cars-stale-commitments"
          />
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground text-xs"><th>Car</th><th>Commitment</th><th>Reason</th><th>Target</th><th></th></tr></thead>
          <tbody>
            {(data?.items ?? []).map((c: any) => (
              <tr key={c.id} className="border-t border-border/40">
                <td className="py-1.5 font-mono">
                  <span className="inline-flex items-center gap-2">
                    <button type="button" className="underline" onClick={() => openAppTab(carPath(c.railcar_id ?? c.railcar?.id))}>
                      {c.railcar?.reporting_marks} {c.railcar?.car_number}
                    </button>
                    <LineageCarLink
                      id={c.railcar_id ?? c.railcar?.id}
                      reportingMarks={c.railcar?.reporting_marks}
                      carNumber={c.railcar?.car_number}
                    />
                  </span>
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
                        void invalidateFleetQueries(qc);
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
              void invalidateFleetQueries(qc);
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
                const preview = await apiRequest("POST", `/api/programs/${p.id}/close/preview`).then((r) => r.json());
                if (!window.confirm(`Close ${p.name}? Releases ${preview.commitments_released?.length ?? 0} Commitment(s). Links stay.`)) return;
                await apiRequest("POST", `/api/programs/${p.id}/close/apply`, { preview_token: preview.preview_token });
                qc.invalidateQueries({ queryKey: ["/api/commitments/stale"] });
                void invalidateFleetQueries(qc);
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
      <PageHeader title="Lease-ended watch" subtitle="Still on an OL whose end date is past, not Month to Month and not a scrap program (SCRAPPING stays on rent)." />
      <div className="p-6 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => nav(`/returns/bulk?cars=${encodeURIComponent(cars)}`)}>Move to EA x-lessee?</Button>
          <CopyCarsButton
            rows={data?.rows ?? []}
            lineOf={(row: { marks?: string | null; car_number?: string | null }) => ({
              reporting_marks: row.marks,
              car_number: row.car_number,
            })}
            testId="button-copy-cars-lease-ended"
          />
        </div>
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

export { KpiCarListPage } from "@/pages/KpiCarList";

export function BulkRentStopsPage() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const qc = useQueryClient();
  const hashSearch = useHashSearch();
  const openedOffRent = new URLSearchParams(hashSearch).get("action") === "off_rent";
  const [text, setText] = useState("");
  const [action, setAction] = useState(openedOffRent ? "off_rent" : "abatement");
  const [stopDate, setStopDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("quality repair");
  const [batchNote, setBatchNote] = useState("");
  const [copyCarNote, setCopyCarNote] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  useEffect(() => {
    if (!openedOffRent) return;
    try {
      const seeded = sessionStorage.getItem(OFF_RENT_PASTE_STORAGE_KEY);
      if (!seeded) return;
      setText(seeded);
      setAction("off_rent");
      sessionStorage.removeItem(OFF_RENT_PASTE_STORAGE_KEY);
    } catch {
      /* private mode */
    }
  }, [openedOffRent]);
  const runPreview = useMutation({
    mutationFn: async () => {
      const dated = action === "off_rent" ? parseOffRentPaste(text) : [];
      const fields = rentStopReasonFields({ reason, note: batchNote });
      const useRows = dated.some((row) => row.stop_date || row.note);
      return (await apiRequest("POST", "/api/rent-stops/bulk/preview", {
        ...(useRows ? { rows: dated } : { text }),
        action,
        stop_date: stopDate,
        reason: fields.reason,
        reason_other: fields.reason_other,
        note: fields.note,
      })).json();
    },
    onSuccess: setPreview,
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });
  const apply = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/rent-stops/bulk/apply", {
        preview_token: preview?.preview_token,
        ...(copyCarNote ? { copy_car_note: true } : {}),
      })).json(),
    onSuccess: (d) => {
      void invalidateFleetQueries(qc);
      offerUndoToast(d);
    },
    onError: (e: Error) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });
  const datedMode = action === "off_rent";
  const kpiMoves = (preview?.kpi_delta ?? []).filter(
    (row: { before_title?: string; after_title?: string }) => row.before_title !== row.after_title,
  );
  return (
    <div>
      <PageHeader title="Bulk rent stops" subtitle="Active cars only. Preview first. Off rent and abatement stay on the current assignment. One apply is one undo." />
      <div className="p-6 space-y-4 max-w-4xl">
        <div className="space-y-2">
          <Label htmlFor="off-rent-paste">{datedMode ? "Cars with their own dates" : "Cars"}</Label>
          <Textarea
            id="off-rent-paste"
            rows={8}
            value={text}
            data-testid="off-rent-paste"
            placeholder={datedMode
              ? "MARK NUMBER, YYYY-MM-DD, note\nTFOX 001000, 2026-09-09\nTFOX 001036, 2026-10-16, uneconomical to repair"
              : "Paste marks + numbers (TFOX 000644)…"}
            onChange={(e) => setText(e.target.value)}
          />
          <Input type="file" accept=".csv,.txt,.xlsx" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setText(await csvFromFile(file));
          }} />
          {datedMode ? (
            <p className="text-xs text-muted-foreground">One car per line. Date is optional when the stop date below is set. A third column is that car’s note.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label>Action</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off_rent">Set off rent</SelectItem>
                <SelectItem value="abatement">Set abatement</SelectItem>
                <SelectItem value="resume">Resume</SelectItem>
                <SelectItem value="convert">Convert to off rent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{datedMode ? "Date for rows that omit one" : "Stop date"}</Label>
            <Input type="date" value={stopDate} onChange={(e) => setStopDate(e.target.value)} />
          </div>
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RENT_STOP_REASON_CHOICES.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[240px] flex-1">
            <Label htmlFor="bulk-rent-stop-note">Stop note</Label>
            <Textarea
              id="bulk-rent-stop-note"
              rows={2}
              value={batchNote}
              onChange={(e) => setBatchNote(e.target.value)}
              placeholder="Saved on the rent stop. A date line’s note overrides this for that car."
            />
          </div>
          <label className="text-sm flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              checked={copyCarNote}
              data-testid="bulk-copy-car-note"
              onChange={(e) => setCopyCarNote(e.target.checked)}
            />
            Also add the stop note on each car
          </label>
          {canEdit && <Button disabled={runPreview.isPending} onClick={() => runPreview.mutate()}>Preview</Button>}
          {canEdit && preview?.preview_token && (
            <Button disabled={apply.isPending} onClick={() => apply.mutate()}>Apply preview</Button>
          )}
          {preview?.to_write ? (
            <CopyCarsButton
              rows={preview.to_write}
              lineOf={(row: { car?: string | null }) => row.car ?? ""}
              testId="button-copy-cars-bulk-rent-stops"
            />
          ) : null}
        </div>
        {preview && (
          <div className="text-sm space-y-2">
            <div>To write {preview.to_write?.length ?? 0} · rejected {preview.rejected?.length ?? 0} · warnings {preview.warnings?.length ?? 0}</div>
            {(preview.kpi_note || (preview.kpi_counts ?? []).length > 0 || kpiMoves.length > 0) && (
              <div className="text-xs space-y-0.5">
                <div className="font-medium">Dashboard counts</div>
                {preview.kpi_note ? <div className="text-muted-foreground">{preview.kpi_note}</div> : null}
                {(preview.kpi_counts ?? []).map((row: { bucket: string; title: string; delta: number }) => (
                  <div key={row.bucket}>
                    {row.title}: {row.delta > 0 ? `+${row.delta}` : row.delta}
                  </div>
                ))}
                {kpiMoves.slice(0, 8).map((row: { railcar_id: number; car?: string; before_title?: string; after_title?: string }) => (
                  <div key={row.railcar_id} className="text-muted-foreground">
                    {row.car}: {row.before_title} → {row.after_title}
                  </div>
                ))}
                {kpiMoves.length > 8 ? (
                  <div className="text-muted-foreground">+{kpiMoves.length - 8} more</div>
                ) : null}
              </div>
            )}
            {(preview.rejected ?? []).length > 0 && (
              <ul className="text-xs text-destructive space-y-0.5">
                {preview.rejected.map((row: { car?: string; id?: number; reason?: string }, index: number) => (
                  <li key={`${row.car ?? row.id}-${index}`}>{row.car ?? row.id}: {row.reason}</li>
                ))}
              </ul>
            )}
            {(preview.warnings ?? []).length > 0 && (
              <ul className="text-xs text-amber-700 space-y-0.5">
                {preview.warnings.map((row: { car?: string; reason?: string; stop_date?: string }, index: number) => (
                  <li key={`${row.car}-${index}`}>{row.car}: {row.reason}{row.stop_date ? ` (${row.stop_date})` : ""}</li>
                ))}
              </ul>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th>Car</th><th>OL</th><th>Lessee</th><th>Action</th><th>Date</th><th>Reason</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {(preview.to_write ?? []).map((r: any) => (
                  <tr key={r.id} className="border-t border-border/40">
                    <td className="font-mono">{r.car}</td>
                    <td>{r.ol}</td>
                    <td>{r.lessee}</td>
                    <td>{r.action}</td>
                    <td>{r.stop_date ?? "—"}</td>
                    <td>{r.reason_other || r.reason || ""}</td>
                    <td>{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function BulkRentStartPage() {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [addNote, setAddNote] = useState("");
  const runPreview = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/rent-start/bulk/preview", { text, date: date || null, overwrite })).json(),
    onSuccess: setPreview,
    onError: (e: Error) => toast({ title: "Preview failed", description: e.message, variant: "destructive" }),
  });
  const apply = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/rent-start/bulk/apply", { preview_token: preview?.preview_token, ...appendNoteBody(addNote) })).json(),
    onSuccess: (d) => {
      void invalidateFleetQueries(qc);
      toast({ title: "Applied", description: [`${d.written} dates written`, noteSkipDescription(d)].filter(Boolean).join(" ") });
    },
    onError: (e: Error) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div>
      <PageHeader title="Bulk Rent Start Date" subtitle="Preview first. Apply writes only the reviewed rows. EA / not-on-OL cars are rejected." />
      <div className="p-6 space-y-4 max-w-4xl">
        <PasteBox onText={setText} />
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label>Date for all rows (or put dates in the CSV)</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="min-w-[240px] flex-1">
            <AddNoteField id="bulk-rent-start-note" value={addNote} onChange={setAddNote} />
          </div>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            Overwrite existing dates
          </label>
          {canEdit && (
            <Button disabled={runPreview.isPending} onClick={() => runPreview.mutate()}>Preview</Button>
          )}
          {canEdit && preview?.preview_token && (
            <Button disabled={apply.isPending} onClick={() => apply.mutate()}>Apply preview</Button>
          )}
          {preview?.to_write ? (
            <CopyCarsButton
              rows={preview.to_write}
              lineOf={(row: { marks?: string | null; car_number?: string | null }) => ({
                reporting_marks: row.marks,
                car_number: row.car_number,
              })}
              testId="button-copy-cars-bulk-rent-start"
            />
          ) : null}
        </div>
        {preview && (
          <div className="text-sm space-y-2">
            <div>Matched {preview.matched?.length ?? 0} · not found {preview.not_found?.length ?? 0} · not on OL {preview.not_on_ol?.length ?? 0} · already dated {preview.already_has_date?.length ?? 0} · to write {preview.to_write?.length ?? 0}</div>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th>Car</th><th>OL</th><th>Old</th><th>New</th><th>Status</th></tr></thead>
              <tbody>
                {(preview.to_write ?? []).map((r: any) => (
                  <tr key={r.id} className="border-t border-border/40">
                    <td className="font-mono">{r.marks} {r.car_number}</td>
                    <td>{r.link}</td>
                    <td>{r.old_date ?? "—"}</td>
                    <td>{r.new_date}</td>
                    <td>{r.resulting_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function RentStartWatchPage({ kind }: { kind: "awaiting" | "shop" | "future" }) {
  if (kind === "awaiting") {
    return <Redirect to="/kpi/cars?bucket=awaiting_rent_start" />;
  }
  const titles = {
    awaiting: "Awaiting rent start",
    shop: "Shop conflict",
    future: "Future rent starts (30 days)",
  };
  const { data } = useQuery({
    queryKey: ["/api/rent-start/watch", kind],
    queryFn: () => apiGet<any>(`/api/rent-start/watch?kind=${kind}`),
  });
  return (
    <div>
      <PageHeader title={titles[kind]} subtitle={kind === "awaiting" ? `On OL, no rent start, assigned more than ${data?.days ?? 60} days ago` : `${data?.rows?.length ?? 0} cars`} />
      <div className="p-6 space-y-3">
        <div className="flex justify-end">
          <CopyCarsButton
            rows={data?.rows ?? []}
            idOf={(row: { railcar_id?: number }) => row.railcar_id}
            testId="button-copy-cars-rent-start-watch"
          />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground text-xs">
              <th>Car</th><th>OL</th><th>Lessee</th>
              {kind === "awaiting" && <th>Assigned</th>}
              {kind === "awaiting" && <th>Days waiting</th>}
              {kind !== "awaiting" && <th>Rent start</th>}
              <th>Shop</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r: any) => (
              <tr key={r.railcar_id} className="border-t border-border/40">
                <td className="py-1.5 font-mono">
                  <span className="inline-flex items-center gap-2">
                    <Link href={carPath(r.railcar_id)} className="underline">
                      {r.reporting_marks} {r.car_number}
                    </Link>
                    <LineageCarLink id={r.railcar_id} reportingMarks={r.reporting_marks} carNumber={r.car_number} />
                  </span>
                </td>
                <td>{r.link_rider}</td>
                <td>{r.lessee_name}</td>
                {kind === "awaiting" && <td>{String(r.assigned_at ?? "").slice(0, 10)}</td>}
                {kind === "awaiting" && <td>{r.days_waiting ?? "—"}</td>}
                {kind !== "awaiting" && <td>{r.rent_start_date ?? "—"}</td>}
                <td>{r.shop ?? r.open_program_shop_id ?? r.ops_flag ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
