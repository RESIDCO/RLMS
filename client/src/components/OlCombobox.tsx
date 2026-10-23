import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { filterOlRiders, type OlListRider } from "@shared/car-detail-panel";

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  riders: OlListRider[];
  onSelect: (rider: OlListRider) => void;
  onCreateNew: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  testId?: string;
};

/**
 * Existing-OL combobox. The field starts empty and the chevron lists OLs.
 * Typing filters that list. A code that is not in the list is not a new OL;
 * "+ Create new OL" is the only create path.
 */
export function OlCombobox({
  query,
  onQueryChange,
  riders,
  onSelect,
  onCreateNew,
  open,
  onOpenChange,
  disabled,
  testId = "ol-combobox",
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const wrapRef = useRef<HTMLDivElement>(null);
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (open === undefined) setUncontrolledOpen(next);
  };
  const { rows, total } = filterOlRiders(riders, query);

  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isOpen, open]);

  return (
    <div className="space-y-1" ref={wrapRef}>
      <div className="relative">
        <Input
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search OL code or lessee…"
          disabled={disabled}
          data-testid={`${testId}-input`}
          autoComplete="off"
          className="pr-8"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Show OLs"
          data-testid={`${testId}-chevron`}
          onClick={() => setOpen(!isOpen)}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
        </button>
        {isOpen && (
          <ul
            className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
            role="listbox"
            data-testid={`${testId}-list`}
          >
            {rows.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No matching OLs.</li>
            ) : (
              rows.map((row) => (
                <li key={row.id} role="option">
                  <button
                    type="button"
                    className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    data-testid={`ol-option-${row.id}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      const rider = riders.find((item) => item.id === row.id);
                      if (rider) onSelect(rider);
                      onQueryChange("");
                      setOpen(false);
                    }}
                  >
                    <span className="font-mono font-medium">{row.code}</span>
                    {row.lessee ? <span className="truncate text-xs text-muted-foreground">{row.lessee}</span> : null}
                    {row.carCount != null && (
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {row.carCount} cars
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
            {!query.trim() && total > rows.length && (
              <li className="px-3 py-1.5 text-[11px] text-muted-foreground">
                Type an OL code or lessee to filter {total} OLs.
              </li>
            )}
            <li role="option">
              <button
                type="button"
                className="flex w-full px-3 py-1.5 text-left text-sm font-medium text-primary hover:bg-accent"
                data-testid={`${testId}-create`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onCreateNew();
                  setOpen(false);
                }}
              >
                + Create new OL
              </button>
            </li>
          </ul>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Choose an existing OL. A new OL is created only from Create new OL.
      </p>
    </div>
  );
}
