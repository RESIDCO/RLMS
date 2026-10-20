import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RiderFreeTextInput, resolveRiderLabel, type RiderSuggestion } from "@/components/RiderFreeTextInput";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import { useToast } from "@/hooks/use-toast";
import { findRiderByOlLabel, type OlIdentity } from "@shared/ol-identity";

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

export function ReassignCarForm({
  carId,
  isReassign,
  initialRiderName,
  initialLessee,
  riders,
  onCancel,
}: {
  carId: number;
  isReassign: boolean;
  initialRiderName: string;
  initialLessee: string;
  riders: RiderSuggestion[];
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [riderLabel, setRiderLabel] = useState(initialRiderName);
  const [lessee, setLessee] = useState(initialLessee);
  const [reason, setReason] = useState("");
  const [lesseeUnlocked, setLesseeUnlocked] = useState(false);

  const matched = useMemo(() => findRiderByOlLabel(riders, riderLabel), [riders, riderLabel]);
  const matchedId = matched?.id ?? null;

  const identityQuery = useQuery<OlIdentity>({
    queryKey: ["/api/riders", matchedId, "identity"],
    queryFn: () => apiRequest("GET", `/api/riders/${matchedId}/identity`).then((r) => r.json()),
    enabled: matchedId != null,
  });
  const identity = matchedId != null ? identityQuery.data : undefined;
  const lockLessee = Boolean(identity && !identity.is_sold && !identity.is_adhoc && identity.canonical_lessee && !lesseeUnlocked);

  useEffect(() => {
    setLesseeUnlocked(false);
  }, [matchedId, riderLabel]);

  useEffect(() => {
    if (!identity) return;
    if (identity.is_sold || identity.is_adhoc) return;
    if (identity.canonical_lessee && !lesseeUnlocked) {
      setLessee(identity.canonical_lessee);
    }
  }, [identity, lesseeUnlocked]);

  useEffect(() => {
    if (matched?.rider_name && compactDiffers(riderLabel, matched.rider_name)) {
      setRiderLabel(matched.rider_name);
    }
  }, [matched?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const overrideActive = Boolean(identity && !identity.is_sold && !identity.is_adhoc && lesseeUnlocked);
  const lesseeDiffers =
    overrideActive &&
    identity?.canonical_lessee &&
    lessee.trim() !== identity.canonical_lessee;

  const save = useMutation({
    mutationFn: async () => {
      const resolved = await resolveRiderLabel(riderLabel);
      await apiRequest("POST", "/api/move", {
        car_ids: [carId],
        to_rider_id: resolved.id,
        new_fleet_name: lessee.trim() || null,
        reason: reason.trim() || null,
        moved_by: "user",
        lessee_override: overrideActive || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      void invalidateFleetQueries(queryClient);
      toast({ title: "Car assigned", description: "Assignment saved successfully." });
      onCancel();
    },
    onError: (err: Error) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  const reasonRequired = overrideActive;
  const canSave = Boolean(riderLabel.trim()) && (!reasonRequired || Boolean(reason.trim())) && !save.isPending;

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-primary mb-1">
        {isReassign ? "Reassign Car" : "Assign Car to Rider"}
      </div>

      <div>
        <Label className="text-xs">Rider / OL</Label>
        <RiderFreeTextInput
          value={riderLabel}
          onChange={setRiderLabel}
          riders={riders}
          listId={`assign-rider-${carId}`}
          data-testid="select-assign-rider"
          placeholder="Type rider / OL code…"
        />
      </div>

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
              onClick={() => setLesseeUnlocked(true)}
              data-testid="btn-edit-lessee"
            >
              Edit lessee
            </button>
          )}
        </div>
        <div className="relative">
          <Input
            value={lessee}
            onChange={(e) => setLessee(e.target.value)}
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

      <div>
        <Label className="text-xs">
          Reason{" "}
          {reasonRequired ? (
            <span className="text-destructive font-normal">(required)</span>
          ) : (
            <span className="text-muted-foreground font-normal">(optional)</span>
          )}
        </Label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="New Assignment"
          data-testid="input-assign-reason"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() => save.mutate()}
          data-testid="btn-save-assign"
        >
          {save.isPending ? "Saving…" : "Save Assignment"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function compactDiffers(a: string, b: string) {
  return a.trim() !== b.trim();
}

function OlRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
