import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { displayLeaseNumber } from "@shared/residco-import";
import { compactSearch, matchesSearchQuery } from "@/lib/search-match";

export type RiderSuggestion = {
  id: number;
  rider_name: string;
  schedule_number?: string | null;
  master_lease?: { lease_number?: string | null; lessee?: string | null } | null;
  car_count?: number;
  lessee?: string | null;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  riders: RiderSuggestion[];
  placeholder?: string;
  /** Exclude a rider id (e.g. Move Cars source) from suggestions */
  excludeId?: string;
  listId?: string;
  "data-testid"?: string;
  disabled?: boolean;
};

/**
 * Free-text Rider/OL input with a visible filtered suggestion list.
 * Native <datalist> does not render reliably (especially in Chromium with
 * hundreds of options / a trailing chevron), so this is a custom combobox.
 * Any typed value is still accepted — new OL codes are created on resolve.
 */
export function RiderFreeTextInput({
  value,
  onChange,
  riders,
  placeholder = "Type rider / OL code…",
  excludeId,
  "data-testid": testId,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => riders.filter((r) => String(r.id) !== excludeId),
    [riders, excludeId]
  );

  const q = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = !q
      ? options
      : options.filter((r) =>
          matchesSearchQuery(
            [
              r.rider_name,
              r.schedule_number,
              displayLeaseNumber(r.master_lease?.lease_number),
              r.master_lease?.lessee,
              r.lessee,
            ],
            q,
          ),
        );
    const qc = compactSearch(q);
    const ranked = !qc
      ? list
      : [...list].sort((a, b) => {
          const ac = compactSearch(`${a.rider_name ?? ""} ${a.schedule_number ?? ""}`);
          const bc = compactSearch(`${b.rider_name ?? ""} ${b.schedule_number ?? ""}`);
          const ap = ac.startsWith(qc) ? 0 : 1;
          const bp = bc.startsWith(qc) ? 0 : 1;
          return ap - bp;
        });
    // Unfiltered list can be huge — keep the first page; typing searches the full set.
    return q ? ranked : ranked.slice(0, 80);
  }, [options, q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="space-y-1" ref={wrapRef}>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          data-testid={testId}
          autoComplete="off"
          className="pr-8"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Show rider suggestions"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <ul
            className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
            role="listbox"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                {q ? "No matching riders — a new OL will be created." : "No riders loaded."}
              </li>
            ) : (
              filtered.map((r) => {
                const lease = displayLeaseNumber(r.master_lease?.lease_number);
                const lessee = r.master_lease?.lessee || r.lessee || lease;
                return (
                  <li key={r.id} role="option">
                    <button
                      type="button"
                      className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onChange(r.rider_name);
                        setOpen(false);
                      }}
                    >
                      <span className="font-mono font-medium">{r.rider_name}</span>
                      {lessee && (
                        <span className="truncate text-xs text-muted-foreground">{lessee}</span>
                      )}
                      {typeof r.car_count === "number" && (
                        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {r.car_count} cars
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
            {!q && options.length > filtered.length && (
              <li className="px-3 py-1.5 text-[11px] text-muted-foreground">
                Type an OL number or lessee to filter {options.length} riders.
              </li>
            )}
          </ul>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Type any OL/rider code. Suggestions are existing riders — new codes are accepted.
      </p>
    </div>
  );
}

/** Resolve free-text label via API (match existing or create). */
export async function resolveRiderLabel(
  label: string
): Promise<{ id: number; rider_name: string; created: boolean }> {
  const { apiRequest } = await import("@/lib/queryClient");
  const res = await apiRequest("POST", "/api/riders/resolve", { label: label.trim() });
  return res.json();
}
