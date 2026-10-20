import { ClipboardList, Wrench } from "lucide-react";
import { FleetAwareStatusBadge } from "@/components/InactiveFleetBadge";
import { OpsFlagBadge } from "@/components/OpsFlagBadge";
import { cn } from "@/lib/utils";
import { displayStatusInputFromRailcar } from "@shared/fleet-status";

export const TRANSIT_STATUSES = [
  { value: "repair", label: "At Repair Shop", color: "bg-umler-signal/15 text-umler-signal border-umler-signal/25" },
  { value: "transit", label: "In Transit", color: "bg-umler-steel/15 text-umler-steel border-umler-steel/25" },
  { value: "cleaning", label: "Cleaning / Prep", color: "bg-umler-teal/15 text-umler-teal border-umler-teal/25" },
  { value: "bad_order", label: "Bad Order", color: "bg-umler-signal/15 text-umler-signal border-umler-signal/25" },
] as const;

export function NeedsCompletionBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300"
      title="New acquisition — still needs lessee, rider, and financials filled in"
      data-testid="badge-needs-completion"
    >
      <ClipboardList className="h-2.5 w-2.5" />
      Needs data
    </span>
  );
}

export function TransitBadge({ status, label }: { status: string | null; label: string | null }) {
  if (!status) return null;
  const ts = TRANSIT_STATUSES.find((t) => t.value === status);
  const color = ts?.color ?? "bg-muted text-muted-foreground border-border";
  const text = ts?.label ?? status;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium", color)}>
      <Wrench className="h-2.5 w-2.5" />
      {text}{label ? ` · ${label}` : ""}
    </span>
  );
}

/** Fields the rental-status cluster reads. `needs_completion` is optional on the API row. */
export type RentalStatusRow = Parameters<typeof displayStatusInputFromRailcar>[0] & {
  transit_status?: string | null;
  transit_label?: string | null;
  needs_completion?: boolean | null;
  ops_flag?: string | null;
};

/**
 * Rental Status cluster used by the Railcars and Search grids:
 * fleet status badge, transit flag, needs-data flag, then ops flag.
 * A missing `needs_completion` is treated as not needing completion.
 */
export function RentalStatusCell({ row }: { row: RentalStatusRow }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <FleetAwareStatusBadge car={displayStatusInputFromRailcar(row)} />
      {row.transit_status && (
        <TransitBadge status={row.transit_status} label={row.transit_label ?? null} />
      )}
      {row.needs_completion && <NeedsCompletionBadge />}
      {row.ops_flag && <OpsFlagBadge flag={row.ops_flag} />}
    </div>
  );
}
