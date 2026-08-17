import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  testId?: string;
};

/** Magnifying-glass search field with an in-input × that clears and re-runs the filter. */
export default function ClearableSearchInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  testId,
}: Props) {
  return (
    <div className={cn("relative flex-1 min-w-[180px] max-w-md", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("pl-9 pr-8", inputClassName)}
        data-testid={testId}
      />
      {value ? (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onChange("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Clear search"
          data-testid={testId ? `${testId}-clear` : "button-search-clear"}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
