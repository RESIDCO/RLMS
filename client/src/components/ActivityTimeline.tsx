import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { displayLeaseNumber } from "@shared/residco-import";

export type ActivityEvent = {
  id: number;
  action: string;
  actor?: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
  detail?: Record<string, any> | null;
  railcar?: { id: number; car_number?: string | null; reporting_marks?: string | null } | null;
  rider?: {
    id: number;
    rider_name?: string | null;
    schedule_number?: string | null;
    master_lease?: { lease_number?: string | null } | null;
  } | null;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "mark_change", label: "Marks" },
  { id: "status_change", label: "Status" },
  { id: "rent_event", label: "Rent" },
  { id: "reassignment", label: "Assignment" },
  { id: "note", label: "Notes" },
  { id: "attachment", label: "Files" },
] as const;

function carLabel(c?: ActivityEvent["railcar"] | null) {
  if (!c) return "";
  return [c.reporting_marks, c.car_number].filter(Boolean).join(" ");
}

function eventHeadline(ev: ActivityEvent): string {
  const d = ev.detail ?? {};
  switch (ev.action) {
    case "mark_change":
      return `Mark changed ${d.from ?? "—"} → ${d.to ?? "—"}`;
    case "status_change": {
      const kind = d.event_type === "marked_inactive" ? "Marked Inactive" : d.event_type === "reactivated" ? "Reactivated" : "Status changed";
      return `${kind}${d.from || d.to ? ` ${d.from ?? "—"} → ${d.to ?? "—"}` : ""}`;
    }
    case "rent_event":
      return d.event_type === "off_rent" ? "Off Rent" : d.event_type === "on_rent" ? "On Rent" : "Rent event";
    case "reassignment": {
      const from = d.from_fleet ?? "—";
      const to = d.to_fleet ?? "—";
      return `Assigned ${from} → ${to}`;
    }
    case "note":
      return String(d.body ?? "").trim() || "Note";
    case "attachment":
      return `Attachment: ${d.file_name ?? "file"}`;
    default:
      return String(ev.action ?? "event").replace(/_/g, " ");
  }
}

function accentClass(action: string) {
  if (action === "mark_change") return "border-amber-500/50";
  if (action === "status_change") return "border-zinc-500/60";
  if (action === "rent_event") return "border-[hsl(var(--success))]/60";
  if (action === "note") return "border-umler-teal/50";
  if (action === "attachment") return "border-umler-steel/50";
  return "border-primary/50";
}

export default function ActivityTimeline({
  railcarId,
  riderId,
  q,
  canEdit,
  title = "Activity",
  showSearchHint = false,
  compact = false,
}: {
  railcarId?: number;
  riderId?: number;
  q?: string;
  canEdit?: boolean;
  title?: string;
  showSearchHint?: boolean;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [note, setNote] = useState("");
  const params = new URLSearchParams();
  if (railcarId) params.set("railcar_id", String(railcarId));
  if (riderId) params.set("rider_id", String(riderId));
  if (q?.trim()) params.set("q", q.trim());
  const path = `/api/activity?${params.toString()}`;

  const { data, isLoading } = useQuery<{ events: ActivityEvent[] }>({
    queryKey: ["/api/activity", { railcarId, riderId, q: q ?? "" }],
    queryFn: () => apiRequest("GET", path).then((r) => r.json()),
  });

  const events = useMemo(() => {
    const rows = data?.events ?? [];
    if (filter === "all") return rows;
    return rows.filter((e) => e.action === filter);
  }, [data, filter]);

  const entityType = riderId && !railcarId ? "rider" : "railcar";
  const entityId = entityType === "rider" ? riderId : railcarId;

  const add = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/activity/notes", {
        entity_type: entityType,
        entity_id: entityId,
        body: note.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      if (railcarId) queryClient.invalidateQueries({ queryKey: ["/api/railcars", railcarId] });
      toast({ title: "Note added" });
    },
    onError: (e: Error) => toast({ title: "Could not add note", description: e.message, variant: "destructive" }),
  });

  return (
    <div className={compact ? "pt-1" : "mt-6 border-t border-border pt-5"}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{title}</div>
        <div className="text-xs text-muted-foreground font-mono-num">{events.length} events</div>
      </div>
      {showSearchHint && (
        <p className="text-xs text-muted-foreground mb-3">
          Search by current or prior mark+number, or by OL / rider name.
        </p>
      )}
      <div className="flex flex-wrap gap-1 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={cn(
              "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border",
              filter === f.id
                ? "bg-primary/15 text-foreground border-primary/40"
                : "text-muted-foreground border-border hover-elevate",
            )}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {canEdit && entityId ? (
        <div className="rounded-md border border-border bg-muted/20 p-3 mb-3 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Add a note</div>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Append a timestamped comment — this does not overwrite prior notes."
          />
          <Button size="sm" disabled={!note.trim() || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? "Saving…" : "Add note"}
          </Button>
        </div>
      ) : null}
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : events.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">No activity recorded yet.</div>
      ) : (
        <ul className="space-y-3">
          {events.map((ev) => {
            const when = ev.occurred_at || ev.created_at;
            const reason = ev.detail?.reason;
            const riderName = ev.rider?.rider_name;
            const ol = displayLeaseNumber(ev.rider?.master_lease?.lease_number);
            return (
              <li key={ev.id} className={cn("text-xs border-l-2 pl-3 py-1", accentClass(ev.action))}>
                <div className="font-mono-num text-muted-foreground">
                  {when ? new Date(when).toLocaleString() : "—"}
                  {ev.actor ? <span> — {ev.actor}</span> : null}
                </div>
                <div className="mt-0.5 font-medium">
                  {eventHeadline(ev)}
                  {carLabel(ev.railcar) && (riderId || q) ? (
                    <span className="ml-2 font-mono font-normal text-muted-foreground">{carLabel(ev.railcar)}</span>
                  ) : null}
                </div>
                {ev.action === "reassignment" && (riderName || ol) && (
                  <div className="text-muted-foreground mt-0.5">
                    {riderName ?? "—"}
                    {ol ? <span className="font-mono-num"> · {ol}</span> : null}
                  </div>
                )}
                {reason && ev.action !== "note" && (
                  <div className="text-muted-foreground italic mt-0.5">{reason}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
