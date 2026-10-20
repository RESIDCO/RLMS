import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import SearchableSelect, { riderToOption } from "@/components/SearchableSelect";
import { createRiderLease } from "@/components/RiderFreeTextInput";
import { apiGet, apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import { useToast } from "@/hooks/use-toast";
import { CopyCarsButton } from "@/components/CopyCarsButton";
import { AddNoteField, appendNoteBody } from "@/components/AddNoteField";
import { previewAndUndo } from "@/lib/undo";
import { formatUsDate } from "@shared/display-date";
import { todayIsoDateOnly } from "@shared/lease-authority";
import type { OlIdentity } from "@shared/ol-identity";

type PlanSide = {
  rider_name?: string | null;
  fleet_name?: string | null;
  rent_start_date?: string | null;
  status?: string | null;
};

type PlanRow = {
  railcar_id: number;
  label: string;
  disposition: "move" | "left_alone";
  left_alone_reason?: "inactive" | "blocked" | null;
  before?: PlanSide;
  after?: PlanSide | null;
  rent_start_impact?: string;
  status_impact?: string;
};

type MoveResponse = {
  change_group?: string | null;
  moved?: number;
  total?: number;
  movable?: number;
  actor?: string | null;
  cars?: PlanRow[];
  left_alone?: PlanRow[] | number;
};

type SourceCar = {
  id: number;
  car_number?: string | null;
  reporting_marks?: string | null;
  active?: boolean | null;
};

function sideText(side: PlanSide | null | undefined): string {
  if (!side) return "—";
  const rider = side.rider_name || "Unassigned";
  const fleet = side.fleet_name || "—";
  const rent = side.rent_start_date ? formatUsDate(side.rent_start_date) : "no rent start";
  return `${rider} · ${fleet} · ${rent} · ${side.status || "—"}`;
}

function leftAloneLabel(row: PlanRow): string {
  if (row.left_alone_reason === "inactive") return "Left alone — inactive";
  if (row.left_alone_reason === "blocked") return "Left alone — blocked";
  return "Left alone";
}

export function MoveCarsDialog({
  open,
  onOpenChange,
  carIds,
  sourceRiderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  carIds?: number[];
  sourceRiderId?: number | null;
}) {
  const { toast } = useToast();
  const fixedIds = (carIds ?? []).filter((id) => id > 0);
  const picking = fixedIds.length === 0 && sourceRiderId != null && sourceRiderId > 0;
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [toRiderId, setToRiderId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIsoDateOnly);
  const [rentStartDate, setRentStartDate] = useState("");
  const [reason, setReason] = useState("");
  const [addNote, setAddNote] = useState("");
  const [lessee, setLessee] = useState("");
  const [lesseeOverride, setLesseeOverride] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [preview, setPreview] = useState<MoveResponse | null>(null);
  const [result, setResult] = useState<MoveResponse | null>(null);
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null);

  const { data: riders } = useQuery<any[]>({ queryKey: ["/api/riders"], enabled: open });
  const sourceCars = useQuery<SourceCar[]>({
    queryKey: ["/api/riders", sourceRiderId, "cars", "active", "move"],
    queryFn: () => apiGet<SourceCar[]>(`/api/riders/${sourceRiderId}/cars?active=active`),
    enabled: open && picking,
  });

  const identityQuery = useQuery<OlIdentity>({
    queryKey: ["/api/riders", toRiderId, "identity"],
    queryFn: () => apiRequest("GET", `/api/riders/${toRiderId}/identity`).then((r) => r.json()),
    enabled: open && Number(toRiderId) > 0,
  });

  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setPreview(null);
    setResult(null);
    setProgress(null);
    setEffectiveDate(todayIsoDateOnly());
    setRentStartDate("");
    setReason("");
    setAddNote("");
    setLessee("");
    setLesseeOverride(false);
    setCreateOpen(false);
    setCreateLabel("");
  }, [open]);

  useEffect(() => {
    const identity = identityQuery.data;
    if (!identity || lesseeOverride) return;
    if (identity.canonical_lessee) setLessee(identity.canonical_lessee);
  }, [identityQuery.data, lesseeOverride]);

  const selectedIds = picking ? Array.from(picked) : fixedIds;
  const riderOptions = useMemo(() => (riders ?? []).map(riderToOption), [riders]);
  const destinationId = Number(toRiderId);
  const canPreview = destinationId > 0 && selectedIds.length > 0 && (!lesseeOverride || reason.trim().length > 0);

  function payload() {
    return {
      car_ids: selectedIds,
      to_rider_id: destinationId,
      new_fleet_name: lessee.trim() || null,
      reason: reason.trim() || null,
      effective_date: effectiveDate || null,
      rent_start_date: rentStartDate || null,
      lessee_override: lesseeOverride || undefined,
      ...appendNoteBody(addNote),
    };
  }

  const previewMut = useMutation({
    mutationFn: async () => {
      setProgress({ label: "Loading the before and after for each car…", value: 20 });
      const res = await apiRequest("POST", "/api/move/preview", payload());
      return (await res.json()) as MoveResponse;
    },
    onSuccess: (body) => {
      setPreview(body);
      setResult(null);
      setProgress(null);
    },
    onError: (err: Error) => {
      setProgress(null);
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const moveMut = useMutation({
    mutationFn: async () => {
      const total = selectedIds.length;
      setProgress({ label: `Moving ${total} car${total === 1 ? "" : "s"} in one request…`, value: 45 });
      const res = await apiRequest("POST", "/api/move", payload());
      setProgress({ label: "Saving the batch…", value: 85 });
      return (await res.json()) as MoveResponse;
    },
    onSuccess: (body) => {
      setResult(body);
      setPreview(body);
      const moved = body.moved ?? 0;
      setProgress({ label: `Moved ${moved} of ${body.total ?? selectedIds.length}.`, value: 100 });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/history"] });
      void invalidateFleetQueries(queryClient);
      toast({ title: "Move complete", description: `${moved} car${moved === 1 ? "" : "s"} reassigned.` });
    },
    onError: (err: Error) => {
      setProgress(null);
      toast({ title: "Move failed", description: err.message, variant: "destructive" });
    },
  });

  const createMut = useMutation({
    mutationFn: () => createRiderLease(createLabel),
    onSuccess: (row) => {
      setToRiderId(String(row.id));
      setCreateOpen(false);
      setCreateLabel("");
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      void invalidateFleetQueries(queryClient);
      toast({ title: "Lease created", description: row.rider_name });
    },
    onError: (err: Error) => toast({ title: "Could not create lease", description: err.message, variant: "destructive" }),
  });

  const rows = preview?.cars ?? [];
  const movable = rows.filter((row) => row.disposition === "move").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Move cars</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "calc(80vh - 140px)" }}>
          {picking ? (
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                <span>Active cars on this rider</span>
                <CopyCarsButton
                  rows={sourceCars.data ?? []}
                  selectedIds={picked}
                  testId="button-copy-cars-move-source"
                />
              </div>
              <div className="max-h-40 overflow-auto">
                {(sourceCars.data ?? []).map((car) => {
                  const label = [car.reporting_marks, car.car_number].filter(Boolean).join(" ") || `#${car.id}`;
                  return (
                    <label key={car.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <Checkbox
                        checked={picked.has(car.id)}
                        onCheckedChange={() => {
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(car.id)) next.delete(car.id);
                            else next.add(car.id);
                            return next;
                          });
                          setPreview(null);
                        }}
                      />
                      <span className="font-mono">{label}</span>
                    </label>
                  );
                })}
                {sourceCars.isFetched && (sourceCars.data ?? []).length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">No active cars on this rider.</div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{fixedIds.length} car{fixedIds.length === 1 ? "" : "s"} selected.</p>
          )}

          <div>
            <Label className="text-xs">Destination rider</Label>
            <SearchableSelect
              value={toRiderId}
              onChange={(value) => {
                setToRiderId(value);
                setLesseeOverride(false);
                setPreview(null);
              }}
              options={riderOptions}
              placeholder="Choose an existing rider…"
              searchPlaceholder="Type OL number or lessee…"
              emptyText="No riders match."
              testId="move-destination-rider"
            />
          </div>

          {createOpen ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
              <div className="min-w-[200px] flex-1">
                <Label className="text-xs">New lease name</Label>
                <Input value={createLabel} onChange={(e) => setCreateLabel(e.target.value)} placeholder="OL number or rider name" data-testid="move-create-lease-name" />
              </div>
              <Button type="button" size="sm" disabled={!createLabel.trim() || createMut.isPending} onClick={() => createMut.mutate()} data-testid="move-create-lease">
                {createMut.isPending ? "Creating…" : "Create lease"}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setCreateOpen(true)}>
              Create lease
            </Button>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Effective date</Label>
              <Input type="date" value={effectiveDate} onChange={(e) => { setEffectiveDate(e.target.value); setPreview(null); }} data-testid="move-effective-date" />
              <p className="mt-1 text-[11px] text-muted-foreground">{formatUsDate(effectiveDate) || "MM/DD/YYYY"}</p>
            </div>
            <div>
              <Label className="text-xs">Rent start date</Label>
              <Input type="date" value={rentStartDate} onChange={(e) => { setRentStartDate(e.target.value); setPreview(null); }} data-testid="move-rent-start-date" />
              <p className="mt-1 text-[11px] text-muted-foreground">{rentStartDate ? formatUsDate(rentStartDate) : "Blank clears rent start when the rider changes"}</p>
            </div>
          </div>

          <div>
            <Label className="text-xs">Lessee</Label>
            <Input
              value={lessee}
              onChange={(e) => { setLessee(e.target.value); setPreview(null); }}
              readOnly={!lesseeOverride && Boolean(identityQuery.data?.canonical_lessee)}
              data-testid="move-lessee"
            />
            {identityQuery.data?.canonical_lessee && !lesseeOverride ? (
              <button type="button" className="mt-1 text-[11px] text-primary underline" onClick={() => setLesseeOverride(true)}>
                Edit lessee
              </button>
            ) : null}
          </div>
          <div>
            <Label className="text-xs">Reason {lesseeOverride ? "(required for a lessee override)" : "(optional)"}</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="move-reason" />
          </div>
          <AddNoteField id="move-add-note" value={addNote} onChange={setAddNote} />

          {progress ? (
            <div className="space-y-1" data-testid="move-progress">
              <div className="text-xs text-muted-foreground">{progress.label}</div>
              <Progress value={progress.value} />
            </div>
          ) : null}

          {rows.length > 0 ? (
            <div className="overflow-auto rounded-md border border-border">
              <div className="flex justify-end border-b border-border px-2 py-1.5">
                <CopyCarsButton
                  rows={rows}
                  lineOf={(row) => row.label}
                  testId="button-copy-cars-move-preview"
                />
              </div>
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Car</th>
                    <th className="px-2 py-1.5 font-medium">Before</th>
                    <th className="px-2 py-1.5 font-medium">After</th>
                    <th className="px-2 py-1.5 font-medium">Rent start</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.railcar_id} className="border-t border-border align-top">
                      <td className="px-2 py-1.5 font-mono">{row.label}</td>
                      <td className="px-2 py-1.5">{sideText(row.before)}</td>
                      <td className="px-2 py-1.5">{row.disposition === "left_alone" ? leftAloneLabel(row) : sideText(row.after)}</td>
                      <td className="px-2 py-1.5">{row.rent_start_impact}</td>
                      <td className="px-2 py-1.5">{row.status_impact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {result?.change_group ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="move-undo"
              onClick={() => { void previewAndUndo(result.change_group || ""); }}
            >
              Undo
            </Button>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" variant="outline" disabled={!canPreview || previewMut.isPending || moveMut.isPending} onClick={() => previewMut.mutate()} data-testid="move-preview">
            {previewMut.isPending ? "Previewing…" : "Preview"}
          </Button>
          <Button type="button" disabled={!preview || movable === 0 || moveMut.isPending || Boolean(result?.change_group)} onClick={() => moveMut.mutate()} data-testid="move-confirm">
            {moveMut.isPending ? "Moving…" : `Move ${movable || selectedIds.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
