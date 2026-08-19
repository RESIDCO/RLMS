import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OPS_FLAG_PRESETS,
  composeOpsFlag,
  interchangeRoad,
  opsFlagFamily,
} from "@shared/ops-flag";

export function OpsFlagPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const family = opsFlagFamily(value);
  const selectValue = !family ? "none" : family === "Other" ? "Other" : family;
  const extra =
    family === "Interchange" ? interchangeRoad(value) : family === "Other" ? value : "";

  function setPreset(preset: string) {
    if (preset === "none") {
      onChange("");
      return;
    }
    if (preset === "Interchange") {
      onChange(composeOpsFlag("Interchange", extra) ?? "Interchange");
      return;
    }
    if (preset === "Other") {
      onChange(extra || "");
      return;
    }
    onChange(preset);
  }

  return (
    <div className="space-y-2">
      <Label>Flag</Label>
      <p className="text-[11px] text-muted-foreground">
        Scrap, shop, wreck, and similar — does not change rental status or take the car inactive.
      </p>
      <Select value={selectValue} onValueChange={setPreset} disabled={disabled}>
        <SelectTrigger data-testid="select-ops-flag">
          <SelectValue placeholder="No flag" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No flag</SelectItem>
          {OPS_FLAG_PRESETS.map((p) => (
            <SelectItem key={p} value={p}>
              {p === "Interchange" ? "Interchange…" : p}
            </SelectItem>
          ))}
          <SelectItem value="Other">Custom…</SelectItem>
        </SelectContent>
      </Select>
      {selectValue === "Interchange" && (
        <Input
          value={extra}
          disabled={disabled}
          placeholder="Road — e.g. BNSF, UP (Interchange XX)"
          onChange={(e) => onChange(composeOpsFlag("Interchange", e.target.value) ?? "Interchange")}
          data-testid="input-ops-flag-interchange"
        />
      )}
      {selectValue === "Other" && (
        <Input
          value={extra}
          disabled={disabled}
          placeholder="Type a flag name to add"
          onChange={(e) => onChange(e.target.value)}
          data-testid="input-ops-flag-custom"
        />
      )}
    </div>
  );
}
