import { Checkbox } from "@/components/ui/checkbox";

export function OnlyColumnsWithDataToggle({
  id,
  checked,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="inline-flex items-center gap-2 text-xs text-muted-foreground"
      title="Hide optional and custom columns that are blank on every exported car. Car mark, number, program, status, and key dates stay."
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        data-testid={id}
      />
      Only columns with data
    </label>
  );
}
