import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { OlCombobox } from "@/components/OlCombobox";
import { createRiderLease, type RiderSuggestion } from "@/components/RiderFreeTextInput";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import { useToast } from "@/hooks/use-toast";
import { AddNoteField, appendNoteBody } from "@/components/AddNoteField";
import { confirmRiderEntityMismatch } from "@/lib/rider-entity-confirm";
import { formatUsDate } from "@shared/display-date";
import type { OlIdentity } from "@shared/ol-identity";
import {
  keepRentStartLabel,
  moveFormBlock,
  moveRentStartPayload,
  type OlListRider,
} from "@shared/car-detail-panel";
import type { RentStartMoveAction } from "@shared/commitment";

function dash(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  return s || "—";
}

function fmtDate(d: string | null | undefined): string {
  const s = String(d ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
  const [y, m, day] = s.split("-");
  return `${m}/${day}/${y}`;
}

type PickedOl = { id: number; rider_name: string };

type PlanSide = {
  rider_name?: string | null;
  fleet_name?: string | null;
  rent_start_date?: string | null;
  status?: string | null;
};

type PlanRow = {
  label?: string;
  disposition?: "move" | "left_alone";
  left_alone_reason?: string | null;
  before?: PlanSide | null;
  after?: PlanSide | null;
  rent_start_impact?: string;
  status_impact?: string;
};

function sideText(side: PlanSide | null | undefined): string {
  if (!side) return "—";
  const rider = side.rider_name || "Unassigned";
  const fleet = side.fleet_name || "—";
  const rent = side.rent_start_date ? formatUsDate(side.rent_start_date) : "no rent start";
  return `${rider} · ${fleet} · ${rent} · ${side.status || "—"}`;
}

export function MoveCarToOlForm({
  carId,
  currentRiderId,
  currentRiderName,
  currentRentStart,
  carEntity,
  riders,
  onCancel,
}: {
  carId: number;
  currentRiderId: number | null;
  currentRiderName: string;
  currentRentStart: string | null;
  carEntity?: string | null;
  riders: RiderSuggestion[];
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PickedOl | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLabel, setCreateLabel] = useState("");
  const [rentChoice, setRentChoice] = useState<RentStartMoveAction | "">("");
  const [rentDate, setRentDate] = useState("");
  const [lessee, setLessee] = useState("");
  const [reason, setReason] = useState("");
  const [addNote, setAddNote] = useState("");
  const [lesseeUnlocked, setLesseeUnlocked] = useState(false);
  const [preview, setPreview] = useState<{ cars?: PlanRow[] } | null>(null);
  const previewGen = useRef(0);

  function clearPreview() {
    previewGen.current += 1;
    setPreview(null);
  }

  const matchedId = selected?.id ?? null;
  const identityQuery = useQuery<OlIdentity>({
    queryKey: ["/api/riders", matchedId, "identity"],
    queryFn: () => apiRequest("GET", `/api/riders/${matchedId}/identity`).then((r) => r.json()),
    enabled: matchedId != null,
  });
  const identity = matchedId != null ? identityQuery.data : undefined;
  const lockLessee = Boolean(identity && !identity.is_sold && !identity.is_adhoc && identity.canonical_lessee && !lesseeUnlocked);

  useEffect(() => {
    setLesseeUnlocked(false);
    clearPreview();
  }, [matchedId]);

  useEffect(() => {
    if (!identity) return;
    if (identity.is_sold || identity.is_adhoc) return;
    if (identity.canonical_lessee && !lesseeUnlocked) setLessee(identity.canonical_lessee);
  }, [identity, lesseeUnlocked]);

  const overrideActive = Boolean(identity && !identity.is_sold && !identity.is_adhoc && lesseeUnlocked);
  const lesseeDiffers =
    overrideActive && identity?.canonical_lessee && lessee.trim() !== identity.canonical_lessee;
  const creating = createOpen && selected == null;
  const block = moveFormBlock({
    selectedId: selected?.id ?? null,
    currentRiderId,
    creating,
    rentChoice,
    rentDate,
    reasonRequired: overrideActive,
    reason,
  });

  function body() {
    const rent = moveRentStartPayload(rentChoice === "" ? "keep" : rentChoice, rentDate);
    return {
      car_ids: [carId],
      to_rider_id: selected?.id,
      new_fleet_name: lessee.trim() || null,
      reason: reason.trim() || null,
      moved_by: "user",
      lessee_override: overrideActive || undefined,
      ...rent,
      ...appendNoteBody(addNote),
    };
  }

  const createMut = useMutation({
    mutationFn: () => createRiderLease(createLabel),
    onSuccess: (row) => {
      setSelected({ id: row.id, rider_name: row.rider_name });
      setCreateOpen(false);
      setCreateLabel("");
      setQuery("");
      clearPreview();
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      toast({ title: "OL created", description: row.rider_name });
    },
    onError: (err: Error) => toast({ title: "Could not create OL", description: err.message, variant: "destructive" }),
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const gen = previewGen.current;
      const res = await apiRequest("POST", "/api/move/preview", body());
      const data = (await res.json()) as { cars?: PlanRow[] };
      return { gen, data };
    },
    onSuccess: ({ gen, data }) => {
      if (gen !== previewGen.current) return;
      setPreview(data);
    },
    onError: (err: Error) => toast({ title: "Preview failed", description: err.message, variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/move", body());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commitments/car", carId] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      void invalidateFleetQueries(queryClient);
      toast({ title: "Car moved", description: "Assignment saved successfully." });
      onCancel();
    },
    onError: (err: Error) => {
      toast({ title: "Move failed", description: err.message, variant: "destructive" });
    },
  });

  const plan = preview?.cars?.[0];
  const canConfirm = Boolean(preview) && plan?.disposition === "move" && !block && !save.isPending;

  function chooseRent(next: RentStartMoveAction) {
    setRentChoice(next);
    clearPreview();
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="move-to-ol-form">
      <div className="text-[10px] uppercase tracking-[0.2em] text-primary">Move to another OL</div>
      <p className="text-sm" data-testid="move-from-ol">
        From: {currentRiderName.trim() || "Unassigned"}
      </p>

      <div>
        <Label className="text-xs">To OL</Label>
        <OlCombobox
          query={query}
          onQueryChange={(value) => {
            setQuery(value);
            clearPreview();
          }}
          riders={riders as OlListRider[]}
          onSelect={(rider) => {
            setSelected({ id: rider.id, rider_name: rider.rider_name });
            setCreateOpen(false);
            setQuery("");
            clearPreview();
          }}
          onCreateNew={() => {
            setCreateOpen(true);
            setSelected(null);
            setCreateLabel(query.trim());
            clearPreview();
          }}
        />
      </div>

      {selected && (
        <p className="text-sm" data-testid="move-selected-ol">
          To: <span className="font-mono font-medium">{selected.rider_name}</span>
        </p>
      )}

      {createOpen && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-background/70 p-3">
          <div className="min-w-[180px] flex-1">
            <Label className="text-xs">New OL code</Label>
            <Input
              value={createLabel}
              onChange={(event) => setCreateLabel(event.target.value)}
              placeholder="OL number"
              data-testid="input-create-ol"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!createLabel.trim() || createMut.isPending}
            onClick={() => createMut.mutate()}
            data-testid="btn-create-ol"
          >
            {createMut.isPending ? "Creating…" : "Create new OL"}
          </Button>
        </div>
      )}

      {identity && !identity.is_adhoc && (
        <div
          className="rounded-md border border-border bg-background/70 px-3 py-2 text-xs space-y-1"
          data-testid="ol-details-block"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">OL details</div>
          <OlRow label="Lessee" value={dash(identity.canonical_lessee)} />
          <OlRow label="Master lease" value={dash(identity.master_lease_number)} />
          <OlRow label="Lease type" value={dash(identity.lease_type)} />
          <OlRow label="Expiration" value={fmtDate(identity.expiration_date)} />
          <OlRow label="Lease status" value={dash(identity.lease_status)} />
          <OlRow label="Account manager" value={dash(identity.account_manager)} />
          <OlRow label="Owner entity" value={dash(identity.owner_entity)} />
          {identity.is_sold && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              SOLD is a catch-all. Lessee is not filled in automatically
              {identity.suggested_lessee ? ` (sold_to suggestion: ${identity.suggested_lessee})` : ""}.
            </p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Lessee</Label>
          {lockLessee && (
            <button
              type="button"
              className="text-[11px] text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setLesseeUnlocked(true);
                clearPreview();
              }}
              data-testid="btn-edit-lessee"
            >
              Edit lessee
            </button>
          )}
        </div>
        <div className="relative">
          <Input
            value={lessee}
            onChange={(event) => {
              setLessee(event.target.value);
              clearPreview();
            }}
            readOnly={lockLessee}
            placeholder={identity?.is_sold ? "Buyer / lessee (required per car)" : "e.g. COVIA, Preferred Sands"}
            data-testid="input-assign-fleet"
            className={lockLessee ? "pr-8 bg-muted/40" : undefined}
          />
          {lockLessee && (
            <Lock className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
        {lockLessee && identity && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Pulled from {identity.rider_name}
            {identity.lessee_source === "cars" ? " (most common car lessee; master lease lessee is blank)" : ""}
          </p>
        )}
        {lesseeDiffers && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400" data-testid="lessee-override-warning">
            This differs from the OL&apos;s lessee, {identity?.canonical_lessee}.
          </p>
        )}
      </div>

      <fieldset className="space-y-2" data-testid="move-rent-start-choice">
        <legend className="text-xs font-medium">Rent start</legend>
        <RadioGroup
          value={rentChoice}
          onValueChange={(value) => chooseRent(value as RentStartMoveAction)}
        >
          <RentChoice id={`rent-keep-${carId}`} value="keep" testId="move-rent-keep" label={keepRentStartLabel(currentRentStart)} />
          <RentChoice id={`rent-clear-${carId}`} value="clear" testId="move-rent-clear" label="Clear rent start" />
          <RentChoice id={`rent-set-${carId}`} value="set" testId="move-rent-set" label="Set new rent start" />
        </RadioGroup>
        {rentChoice === "set" && (
          <Input
            type="date"
            value={rentDate}
            onChange={(event) => {
              setRentDate(event.target.value);
              clearPreview();
            }}
            data-testid="move-rent-start-date"
          />
        )}
      </fieldset>

      <div>
        <Label className="text-xs">
          Reason{" "}
          {overrideActive ? (
            <span className="text-destructive font-normal">(required)</span>
          ) : (
            <span className="text-muted-foreground font-normal">(optional)</span>
          )}
        </Label>
        <Input
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            clearPreview();
          }}
          placeholder="New Assignment"
          data-testid="input-assign-reason"
        />
      </div>
      <AddNoteField id="reassign-add-note" value={addNote} onChange={(value) => { setAddNote(value); clearPreview(); }} />

      {block && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="move-block-reason">
          {block}
        </p>
      )}

      {plan && (
        <div className="rounded-md border border-border bg-background/80 p-3 text-xs space-y-1" data-testid="move-impact">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Impact</div>
          <div>Before: {sideText(plan.before)}</div>
          <div>
            After: {plan.disposition === "left_alone" ? `Left alone${plan.left_alone_reason ? ` — ${plan.left_alone_reason}` : ""}` : sideText(plan.after)}
          </div>
          <div>Rent start: {plan.rent_start_impact || "—"}</div>
          <div>Status: {plan.status_impact || "—"}</div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={Boolean(block) || previewMut.isPending || identityQuery.isLoading}
          onClick={() => previewMut.mutate()}
          data-testid="move-preview"
        >
          {previewMut.isPending ? "Previewing…" : "Preview move"}
        </Button>
        <Button
          size="sm"
          disabled={!canConfirm}
          onClick={async () => {
            if (matchedId != null && identityQuery.isLoading) {
              toast({ title: "OL details are still loading" });
              return;
            }
            const ok = await confirmRiderEntityMismatch(identity?.entity, [{
              id: carId,
              entity: carEntity ?? null,
              label: "this car",
            }]);
            if (!ok) return;
            save.mutate();
          }}
          data-testid="move-confirm"
        >
          {save.isPending ? "Moving…" : "Confirm move"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function RentChoice({ id, value, testId, label }: { id: string; value: RentStartMoveAction; testId: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem value={value} id={id} data-testid={testId} />
      <Label htmlFor={id} className="text-sm font-normal">{label}</Label>
    </div>
  );
}

function OlRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
