import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  columnHelpText,
  getColumn,
  getKpiReason,
  type ColumnDictEntry,
} from "@shared/column-dictionary";
import { cn } from "@/lib/utils";

function HelpBody({ entry }: { entry: ColumnDictEntry }) {
  return (
    <div className="space-y-1.5 text-xs leading-snug">
      <div className="font-semibold text-sm">{entry.label}</div>
      <p>{entry.meaning}</p>
      <p className="text-muted-foreground">Source: {entry.source}</p>
      <p>{entry.derivation}</p>
    </div>
  );
}

function InfoButton({
  entry,
  className,
}: {
  entry: ColumnDictEntry;
  className?: string;
}) {
  const text = columnHelpText(entry);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex shrink-0 text-muted-foreground hover:text-foreground align-middle",
                className,
              )}
              aria-label={`About ${entry.label}`}
              title={text}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Info className="h-3 w-3" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs whitespace-pre-wrap text-xs">{text}</TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-80 p-3"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <HelpBody entry={entry} />
      </PopoverContent>
    </Popover>
  );
}

export function ColumnHelp({
  listKey,
  colKey,
  className,
}: {
  listKey: string;
  colKey: string;
  className?: string;
}) {
  if (colKey === "_select" || colKey === "_actions") return null;
  const entry = getColumn(listKey, colKey);
  if (!entry) return null;
  return <InfoButton entry={entry} className={className} />;
}

export function ColumnHeaderLabel({
  listKey,
  colKey,
  fallback,
  className,
}: {
  listKey: string;
  colKey: string;
  fallback?: string;
  className?: string;
}) {
  const entry = getColumn(listKey, colKey);
  const label = entry?.label ?? fallback ?? colKey;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span>{label}</span>
      {entry ? <ColumnHelp listKey={listKey} colKey={colKey} /> : null}
    </span>
  );
}

export function KpiReasonHelp({ value }: { value: string | null | undefined }) {
  const entry = getKpiReason(value);
  if (!value || value === "—") return <>{value ?? "—"}</>;
  return (
    <span className="inline-flex items-center gap-1">
      <span>{value}</span>
      {entry ? <InfoButton entry={entry} /> : null}
    </span>
  );
}
