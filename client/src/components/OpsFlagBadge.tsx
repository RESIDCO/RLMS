import { cn } from "@/lib/utils";
import { formatOpsFlag, opsFlagFamily } from "@shared/ops-flag";

const FAMILY_CLS: Record<string, string> = {
  Scrap: "bg-red-500/15 text-red-400 border-red-500/30",
  Shop: "bg-umler-steel/15 text-umler-steel border-umler-steel/30",
  Wreck: "bg-red-500/20 text-red-300 border-red-500/40",
  "Bad Order": "bg-umler-amber/15 text-umler-amber border-umler-amber/30",
  Lost: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  Program: "bg-umler-teal/15 text-umler-teal border-umler-teal/30",
  Interchange: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Other: "bg-muted text-muted-foreground border-border",
};

export function OpsFlagBadge({
  flag,
  className,
}: {
  flag: string | null | undefined;
  className?: string;
}) {
  const label = formatOpsFlag(flag);
  if (!label) return null;
  const family = opsFlagFamily(label) ?? "Other";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        FAMILY_CLS[family] ?? FAMILY_CLS.Other,
        className,
      )}
      title="Exception flag — does not change rental status"
    >
      {label}
    </span>
  );
}
