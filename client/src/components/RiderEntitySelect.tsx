import { RIDER_ENTITY_VALUES, type RiderEntity } from "@shared/rider-entity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const UNSET = "__unset__";

export function RiderEntitySelect({
  value,
  onChange,
  allowEmpty = false,
  testId,
}: {
  value: string | null | undefined;
  onChange: (value: RiderEntity | null) => void;
  /** Existing riders may stay blank. New riders leave this off. */
  allowEmpty?: boolean;
  testId?: string;
}) {
  const selected = value && (RIDER_ENTITY_VALUES as readonly string[]).includes(value)
    ? value
    : allowEmpty
      ? UNSET
      : undefined;
  return (
    <Select
      value={selected}
      onValueChange={(next) => onChange(next === UNSET ? null : (next as RiderEntity))}
    >
      <SelectTrigger data-testid={testId}>
        <SelectValue placeholder="Select entity…" />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty ? <SelectItem value={UNSET}>Not set</SelectItem> : null}
        {RIDER_ENTITY_VALUES.map((entity) => (
          <SelectItem key={entity} value={entity}>{entity}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
