import { cn } from "@/lib/utils";
import {
  deriveFleetStatus,
  displayRailcarStatus,
  type DisplayStatusInput,
  type FleetStatusInput,
} from "@shared/fleet-status";

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

/** Always-visible Active/Inactive pill — used on search results so status is never inferred from a missing badge. */
export function FleetMembershipBadge({
  active,
  className,
}: {
  active: boolean | null | undefined;
  className?: string;
}) {
  if (active === false) return <InactiveFleetBadge active={false} className={className} />;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-umler-teal/30 bg-umler-teal/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-umler-teal",
        className
      )}
      data-testid="badge-active-fleet"
      title="Active in fleet"
    >
      Active
    </span>
  );
}

/**
 * Sold-but-still-tracked (fleet_status=Sold).
 * Prefer FleetAwareStatusBadge in the STATUS column; this pill is for compact layouts.
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
      title="Sold — kept in the fleet until the new owner remarks the car"
    >
      Sold
    </span>
  );
}

/** Idle (fleet_status=Idle). Prefer FleetAwareStatusBadge in the STATUS column. */
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
      title="Idle — still owned by RESIDCO, not currently on rent"
    >
      Idle
    </span>
  );
}

const STATUS_BADGE_MAP: Record<string, string> = {
  "Active/In-Service": "bg-umler-teal/15 text-umler-teal border-umler-teal/25",
  Leased: "bg-umler-teal/15 text-umler-teal border-umler-teal/25",
  Sold: "bg-umler-amber/15 text-umler-amber border-umler-amber/25",
  Idle: "bg-umler-steel/15 text-umler-steel border-umler-steel/25",
  Abatement: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  Storage: "bg-umler-amber/15 text-umler-amber border-umler-amber/25",
  "Bad Order": "bg-umler-signal/15 text-umler-signal border-umler-signal/25",
  "Off-Lease": "bg-umler-steel/15 text-umler-steel border-umler-steel/25",
  Retired: "bg-umler-faint/15 text-umler-faint border-umler-faint/25",
  Scrapped: "bg-umler-faint/15 text-umler-faint border-umler-faint/25",
};

/** STATUS column badge: Leased / Idle / Sold / Abatement from stored fleet_status. */
export function FleetAwareStatusBadge({
  car,
  className,
}: {
  car: DisplayStatusInput;
  className?: string;
}) {
  const label = displayRailcarStatus(car);
  if (!label || label === "—") {
    return <span className="text-muted-foreground">—</span>;
  }
  const cls = STATUS_BADGE_MAP[label] ?? "bg-muted text-muted-foreground border-border";
  const title =
    label === "Sold"
      ? "Sold — no longer owned by RESIDCO, still tracked until remarked"
      : label === "Idle"
        ? "Idle — still owned by RESIDCO, not currently on rent"
        : label === "Abatement"
          ? "Abatement — still leased; rent is temporarily paused"
        : label === "Leased" || label === "Active/In-Service"
          ? "Leased / in revenue service"
          : undefined;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap",
        cls,
        className,
      )}
      data-testid="badge-fleet-aware-status"
      title={title}
    >
      {label}
    </span>
  );
}

export function fleetActiveLabel(active: boolean | null | undefined): "Active" | "Inactive" | "" {
  if (active === false) return "Inactive";
  if (active === true) return "Active";
  return "";
}

export { displayRailcarStatus };
