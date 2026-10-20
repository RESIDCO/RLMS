import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiGet } from "@/lib/queryClient";
import {
  collapseSourceWhitespace,
  isReservedAutoExpiryInput,
  MANUAL_OPPORTUNITY_SOURCES,
  OPPORTUNITY_SOURCE_LABEL,
  OPPORTUNITY_SOURCE_MAX,
  opportunitySourceLabel,
  type SourceSuggestion,
} from "@shared/crm";

const PRESETS: SourceSuggestion[] = MANUAL_OPPORTUNITY_SOURCES.map((value) => ({
  value,
  label: OPPORTUNITY_SOURCE_LABEL[value],
}));

export default function SourceCombo({
  open,
  value,
  disabled,
  onChange,
}: {
  open: boolean;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [comboOpen, setComboOpen] = useState(false);
  const [query, setQuery] = useState("");
  const suggestions = useQuery({
    queryKey: ["/api/opportunities/source-suggestions"],
    queryFn: () => apiGet<{ sources: SourceSuggestion[] }>("/api/opportunities/source-suggestions"),
    enabled: open && value !== "auto_expiry",
  });
  if (value === "auto_expiry") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="h-9 rounded-md border border-input bg-muted px-2 flex items-center text-sm" data-testid="source-auto-expiry">
            Auto expiry
          </div>
        </TooltipTrigger>
        <TooltipContent>Auto expiry is only for generated renewals</TooltipContent>
      </Tooltip>
    );
  }
  const options = suggestions.data?.sources?.length ? suggestions.data.sources : PRESETS;
  const known = options.some((option) => option.value === value)
    ? options
    : [{ value, label: opportunitySourceLabel(value) }, ...options];
  const collapsed = collapseSourceWhitespace(query);
  const matchesKnown = known.some((option) => {
    return option.value.toLowerCase() === collapsed.toLowerCase() || option.label.toLowerCase() === collapsed.toLowerCase();
  });
  const canUseTyped = collapsed.length >= 1
    && collapsed.length <= OPPORTUNITY_SOURCE_MAX
    && !matchesKnown
    && !isReservedAutoExpiryInput(collapsed);

  return (
    <Popover open={comboOpen} onOpenChange={setComboOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={comboOpen}
          className="w-full justify-between font-normal"
          disabled={disabled}
          title="Choose a source, or type a new one"
          data-testid="source-combo"
        >
          <span className="truncate">{opportunitySourceLabel(value) || "Source"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Source" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              {isReservedAutoExpiryInput(collapsed) ? "Auto expiry is reserved for generated renewals" : "No matching source"}
            </CommandEmpty>
            <CommandGroup>
              {known.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => {
                    onChange(option.value);
                    setComboOpen(false);
                    setQuery("");
                  }}
                >
                  {option.label}
                </CommandItem>
              ))}
              {canUseTyped ? (
                <CommandItem
                  value={`use ${collapsed}`}
                  onSelect={() => {
                    onChange(collapsed);
                    setComboOpen(false);
                    setQuery("");
                  }}
                >
                  {`Use “${collapsed}”`}
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
