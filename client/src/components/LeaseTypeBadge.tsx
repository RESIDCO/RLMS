import { cn } from "@/lib/utils";
import { resolveLeaseType } from "@shared/lease-type";

function tone(label: string): string {
  const n = label.toLowerCase();
  if (n.includes("net")) return "border-umler-teal/35 bg-umler-teal/15 text-umler-teal";
  if (n.includes("full")) return "border-umler-steel/35 bg-umler-steel/15 text-umler-steel";
  if (n.includes("modified")) return "border-umler-amber/35 bg-umler-amber/15 text-umler-amber";
  return "border-border bg-muted/40 text-foreground";
}

export function LeaseTypeBadge({
  carType,
  mlaType,
  className,
  empty = "—",
}: {
  carType?: unknown;
  mlaType?: unknown;
  className?: string;
  empty?: string;
}) {
  const label = resolveLeaseType(carType, mlaType);
  if (!label) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
          className,
        )}
        title="Lease type not set"
      >
        {empty}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        tone(label),
        className,
      )}
      title={`Lease type: ${label}`}
    >
      {label}
    </span>
  );
}
