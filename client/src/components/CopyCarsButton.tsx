import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  copiedCarCount,
  copyCarsToastTitle,
  formatCopyRows,
  resolveCarsToCopy,
  writeClipboardText,
  type CopyCarIdentity,
} from "@/lib/copy-cars";

export type CopyCarsAppearance = "toolbar" | "header";

export type CopyCarsButtonProps<T> = {
  /** Rows already on screen, in display order. Read only. */
  rows: readonly T[];
  /** Existing checkbox selection. Read only; not updated by this button. */
  selectedIds?: Iterable<number | string> | null;
  idOf?: (row: T) => number | string | null | undefined;
  /** How to read mark + number when the row shape is nested or preformatted. */
  lineOf?: (row: T) => CopyCarIdentity | string | null | undefined;
  /** Full filtered size. When larger than `rows`, `loadAll` is used for an unselected copy. */
  totalCount?: number | null;
  /**
   * Read-only fetch of the full current filtered result.
   * Must not write, invalidate queries, or change cache keys.
   */
  loadAll?: () => Promise<readonly T[]>;
  appearance?: CopyCarsAppearance;
  disabled?: boolean;
  className?: string;
  testId?: string;
};

/**
 * Copies "MARK NUMBER" lines for the checked cars, or the full filtered
 * result when nothing is checked. Additive only: it does not change
 * selection, filters, sorting, or any server write.
 */
export function CopyCarsButton<T>({
  rows,
  selectedIds,
  idOf,
  lineOf,
  totalCount,
  loadAll,
  appearance = "toolbar",
  disabled = false,
  className,
  testId,
}: CopyCarsButtonProps<T>) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const selectedCount = selectedIds instanceof Set
    ? selectedIds.size
    : Array.isArray(selectedIds)
      ? selectedIds.length
      : null;
  const nothingToCopy = (totalCount != null ? totalCount <= 0 : rows.length === 0)
    && (selectedCount == null || selectedCount === 0);

  async function onCopy(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const resolved = await resolveCarsToCopy({ rows, selectedIds, idOf, totalCount, loadAll });
      const text = formatCopyRows(resolved.rows, lineOf);
      await writeClipboardText(text);
      toast({ title: copyCarsToastTitle(copiedCarCount(text)) });
    } catch (err) {
      const description = err instanceof Error ? err.message : "Could not copy cars";
      toast({ title: "Copy failed", description, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const shared = {
    "data-testid": testId ?? (appearance === "header" ? "button-copy-cars-column" : "button-copy-cars"),
    disabled: disabled || busy || nothingToCopy,
    onClick: (event: React.MouseEvent) => {
      void onCopy(event);
    },
    onMouseDown: (event: React.MouseEvent) => {
      event.stopPropagation();
    },
  };

  switch (appearance) {
    case "header":
      return (
        <button
          type="button"
          {...shared}
          draggable={false}
          aria-label="Copy cars"
          title="Copy cars"
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-40",
            className,
          )}
        >
          <Copy className="h-3 w-3" />
        </button>
      );
    case "toolbar":
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          {...shared}
          className={className}
        >
          <Copy className="h-4 w-4" />
          {busy ? "Copying…" : "Copy cars"}
        </Button>
      );
    default: {
      const unreachable: never = appearance;
      return unreachable;
    }
  }
}
