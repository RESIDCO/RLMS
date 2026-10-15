/**
 * Searchable multi-select with checkboxes, All toggle, and chips.
 * Used by Bad Orders search (Shops / Statuses).
 */
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiSelectOption = {
  value: string;
  label: string;
};

type Props = {
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Empty selection means "All" when true (default). */
  emptyMeansAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  dark?: boolean;
};

export default function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  emptyMeansAll = true,
  allLabel = "All",
  placeholder = "Select…",
  className,
  triggerClassName,
  dark,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        o.value.toLowerCase().includes(needle),
    );
  }, [options, q]);

  const allSelected =
    options.length > 0 && options.every((o) => value.includes(o.value));
  const isAll = emptyMeansAll ? value.length === 0 || allSelected : allSelected;

  const chips = useMemo(() => {
    if (isAll && emptyMeansAll) return [];
    return options.filter((o) => value.includes(o.value));
  }, [options, value, isAll, emptyMeansAll]);

  const triggerText = (() => {
    if (isAll && emptyMeansAll) return allLabel;
    if (!value.length) return placeholder;
    if (value.length <= 2) {
      return chips.map((c) => c.label).join("; ") || placeholder;
    }
    return `${value.length} selected`;
  })();

  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  const selectAll = () => {
    if (emptyMeansAll) onChange([]);
    else onChange(options.map((o) => o.value));
  };

  const clearAll = () => onChange([]);

  return (
    <div className={cn("min-w-[160px] max-w-[280px]", className)}>
      <div className="text-xs font-medium mb-0.5">{label}</div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-8 w-full justify-between font-normal px-2",
              triggerClassName,
              dark && "bg-slate-950 border-slate-600 text-slate-100",
            )}
          >
            <span className="truncate text-left text-xs">{triggerText}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0 ml-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            "w-72 p-2",
            dark && "bg-slate-900 border-slate-600 text-slate-100",
          )}
          align="start"
        >
          <Input
            className="h-8 mb-2 text-xs"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <label className="flex items-center gap-2 text-xs px-1 py-1.5 cursor-pointer hover:bg-muted/60 rounded">
            <Checkbox
              checked={isAll}
              onCheckedChange={() => {
                if (isAll) clearAll();
                else selectAll();
              }}
            />
            <span className="font-medium">{allLabel}</span>
          </label>
          <div className="max-h-52 overflow-auto border-t mt-1 pt-1">
            {filtered.map((o) => {
              const checked = emptyMeansAll
                ? isAll || value.includes(o.value)
                : value.includes(o.value);
              return (
                <label
                  key={o.value}
                  className="flex items-center gap-2 text-xs px-1 py-1.5 cursor-pointer hover:bg-muted/60 rounded"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => {
                      if (emptyMeansAll && isAll) {
                        onChange(
                          options
                            .map((x) => x.value)
                            .filter((x) => x !== o.value),
                        );
                      } else {
                        toggle(o.value);
                      }
                    }}
                  />
                  <span className="truncate flex-1">{o.label}</span>
                  {checked && !isAll ? (
                    <Check className="h-3 w-3 text-sky-600 shrink-0" />
                  ) : null}
                </label>
              );
            })}
            {!filtered.length && (
              <p className="text-xs text-muted-foreground px-1 py-2">No matches</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {chips.slice(0, 6).map((c) => (
            <span
              key={c.value}
              className={cn(
                "inline-flex items-center gap-0.5 max-w-[140px] text-[10px] px-1.5 py-0.5 rounded border",
                dark
                  ? "bg-slate-800 border-slate-600"
                  : "bg-white border-slate-300",
              )}
            >
              <span className="truncate">{c.label}</span>
              <button
                type="button"
                className="opacity-60 hover:opacity-100"
                onClick={() => toggle(c.value)}
                aria-label={`Remove ${c.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {chips.length > 6 && (
            <span className="text-[10px] text-slate-500">+{chips.length - 6}</span>
          )}
        </div>
      )}
    </div>
  );
}
