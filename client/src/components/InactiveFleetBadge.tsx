import { cn } from "@/lib/utils";
import { deriveFleetStatus, type FleetStatusInput } from "@shared/fleet-status";

/**
 * Fleet-membership inactive indicator (§5).
 * Distinct from lease/service StatusBadge and Off Rent — gray pill only.
 */
export function InactiveFleetBadge({
  active,
  className,
}: {
  active: boolean | null | undefined;
  className?: string;
}) {
  if (active !== false) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400",
        className
      )}
      data-testid="badge-inactive-fleet"
      title="Inactive in fleet (not lease occupancy)"
    >
      Inactive
    </span>
  );
}

/**
 * Sold-but-still-tracked (active=true, fleet_status=Sold).
 * Distinct from Inactive gray pill — these remain active for repair billing.
 */
export function SoldFleetBadge({
  car,
  className,
}: {
  car: FleetStatusInput;
  className?: string;
}) {
  if (deriveFleetStatus(car) !== "Sold") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-umler-amber/35 bg-umler-amber/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-umler-amber",
        className
      )}
      data-testid="badge-sold-fleet"
      title="Sold — kept active for repair billing until remarked"
    >
      Sold
    </span>
  );
}

/** Idle via managed_category (VCF §4.2) — stays in operating fleet / util denominator. */
export function IdleFleetBadge({
  car,
  className,
}: {
  car: FleetStatusInput;
  className?: string;
}) {
  if (deriveFleetStatus(car) !== "Idle") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-umler-steel/35 bg-umler-steel/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-umler-steel",
        className
      )}
      data-testid="badge-idle-fleet"
      title="Idle (managed_category) — counted in Total Fleet / utilization denominator"
    >
      Idle
    </span>
  );
}

export function fleetActiveLabel(active: boolean | null | undefined): "Active" | "Inactive" | "" {
  if (active === false) return "Inactive";
  if (active === true) return "Active";
  return "";
}
