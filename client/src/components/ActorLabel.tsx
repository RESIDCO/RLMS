import { isActorUuid } from "@shared/actor-label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Email (or the raw value) on screen. A resolved UUID stays available on hover. */
export function ActorLabel({
  label,
  raw,
  empty = null,
}: {
  label?: string | null;
  raw?: string | null;
  empty?: string | null;
}) {
  const id = String(raw ?? "").trim();
  const shown = String(label ?? "").trim() || id;
  if (!shown) {
    if (!empty) return null;
    return <>{empty}</>;
  }
  if (!isActorUuid(id) || id.toLowerCase() === shown.toLowerCase()) return <>{shown}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">{shown}</span>
      </TooltipTrigger>
      <TooltipContent className="font-mono text-xs">{id}</TooltipContent>
    </Tooltip>
  );
}
