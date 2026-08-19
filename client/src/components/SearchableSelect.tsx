import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { compactSearch, matchesSearchQuery } from "@/lib/search-match";
import { displayLeaseNumber } from "@shared/residco-import";

export type SearchableOption = {
  value: string;
  label: string;
  hint?: string;
  keywords?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  noneOption?: SearchableOption;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  testId?: string;
  /** Action pickers (e.g. bulk assign) keep the placeholder after a choice. */
  actionMode?: boolean;
};

function optionMatches(opt: SearchableOption, q: string) {
  return matchesSearchQuery([opt.label, opt.hint, opt.keywords], q);
}

export function riderToOption(r: {
  id: number;
  rider_name?: string | null;
  schedule_number?: string | null;
  car_count?: number | null;
  lessee?: string | null;
  fleet_name?: string | null;
  master_lease?: { lease_number?: string | null; lessee?: string | null } | null;
}): SearchableOption {
  const name = String(r.rider_name ?? "").trim();
  const sched = String(r.schedule_number ?? "").trim();
  const lease = displayLeaseNumber(r.master_lease?.lease_number);
  const lessee = String(r.master_lease?.lessee ?? r.lessee ?? r.fleet_name ?? "").trim();
  const cars = typeof r.car_count === "number" ? `${r.car_count} cars` : "";
  const hintParts = [lessee || lease, cars].filter(Boolean);
  return {
    value: String(r.id),
    label: name || sched || `Rider ${r.id}`,
    hint: hintParts.join(" · "),
    keywords: [name, sched, lease, lessee].filter(Boolean).join(" "),
  };
}

export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Type to filter…",
  emptyText = "No matches.",
  noneOption,
  disabled,
  className,
  triggerClassName,
  testId,
  actionMode,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const all = useMemo(
    () => (noneOption ? [noneOption, ...options] : options),
    [noneOption, options],
  );

  const selected = all.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const list = all.filter((o) => optionMatches(o, q));
    const qc = compactSearch(q);
    if (!qc) return list;
    return [...list].sort((a, b) => {
      const ac = compactSearch([a.label, a.keywords].join(" "));
      const bc = compactSearch([b.label, b.keywords].join(" "));
      const ap = ac.startsWith(qc) ? 0 : 1;
      const bp = bc.startsWith(qc) ? 0 : 1;
      return ap - bp;
    });
  }, [all, q]);

  const shown = actionMode ? placeholder : (selected?.label || placeholder);

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "h-9 w-full justify-between font-normal",
            !selected && !actionMode && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span className="truncate">{shown}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-0 w-[var(--radix-popover-trigger-width)] min-w-[280px]", className)} align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.value} ${o.label} ${o.keywords ?? ""}`}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", o.value === value && !actionMode ? "opacity-100" : "opacity-0")} />
                  <span className="truncate font-medium">{o.label}</span>
                  {o.hint && (
                    <span className="ml-auto shrink-0 pl-3 text-[11px] tabular-nums text-muted-foreground">
                      {o.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
