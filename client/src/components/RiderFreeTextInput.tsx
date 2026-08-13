import { Input } from "@/components/ui/input";

export type RiderSuggestion = {
  id: number;
  rider_name: string;
  schedule_number?: string | null;
  master_lease?: { lease_number?: string | null } | null;
  car_count?: number;
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
 * Free-text Rider/OL input. Existing riders appear as autocomplete suggestions,
 * but any typed value is accepted (new OL codes are created on resolve/save).
 */
export function RiderFreeTextInput({
  value,
  onChange,
  riders,
  placeholder = "Type rider / OL code…",
  excludeId,
  listId = "rider-ol-suggestions",
  "data-testid": testId,
  disabled,
}: Props) {
  const options = riders.filter((r) => String(r.id) !== excludeId);

  return (
    <div className="space-y-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={listId}
        disabled={disabled}
        data-testid={testId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((r) => {
          const lease = r.master_lease?.lease_number ? ` · ${r.master_lease.lease_number}` : "";
          const label = `${r.rider_name}${lease}`;
          return <option key={r.id} value={r.rider_name} label={label} />;
        })}
      </datalist>
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
