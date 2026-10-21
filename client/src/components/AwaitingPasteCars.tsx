import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { writeClipboardText } from "@/lib/copy-cars";
import { parseCarPasteList } from "@shared/programs";
import { awaitingPasteSummary, formatUnmatchedPasteList } from "@shared/kpi-paste-cars";

/**
 * Paste filter for the Awaiting rent start drill-down only.
 * Callers opt in by rendering this; it does not change other KPI lists.
 */
export function AwaitingPasteCars({
  text,
  onTextChange,
  busy,
  applied,
  matchedCount,
  selectedCount,
  unmatched,
  onApply,
  onClear,
}: {
  text: string;
  onTextChange: (value: string) => void;
  busy: boolean;
  applied: boolean;
  matchedCount: number;
  selectedCount: number;
  unmatched: string[];
  onApply: () => void;
  onClear: () => void;
}) {
  const { toast } = useToast();
  const tokenCount = parseCarPasteList(text).length;
  const showClear = applied || text.trim().length > 0;

  async function copyUnmatched() {
    try {
      await writeClipboardText(formatUnmatchedPasteList(unmatched));
      toast({ title: unmatched.length === 1 ? "Copied 1 unmatched car" : `Copied ${unmatched.length} unmatched cars` });
    } catch (err) {
      const description = err instanceof Error ? err.message : "Could not copy";
      toast({ title: "Copy failed", description, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-2" data-testid="awaiting-paste-cars">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <Label htmlFor="awaiting-paste-cars-input">Paste cars</Label>
          <Textarea
            id="awaiting-paste-cars-input"
            data-testid="input-paste-cars"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onApply();
              }
            }}
            placeholder={"One per line, or paste from Excel\nELTX 003105, ELTX3105, ELTX 3105"}
            className="mt-1 min-h-[72px] font-mono text-xs"
            spellCheck={false}
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            data-testid="button-paste-cars"
            disabled={busy || tokenCount === 0}
            onClick={onApply}
          >
            {busy ? "Matching…" : "Paste cars"}
          </Button>
          {showClear ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="button-paste-cars-clear"
              onClick={onClear}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      {applied ? (
        <div className="text-sm space-y-1" data-testid="text-paste-cars-summary">
          <div>{awaitingPasteSummary(matchedCount, selectedCount)}</div>
          {unmatched.length > 0 ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span data-testid="text-paste-cars-unmatched-count">
                  {unmatched.length} not on the awaiting list
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="button-paste-cars-copy-unmatched"
                  onClick={() => void copyUnmatched()}
                >
                  Copy unmatched
                </Button>
              </div>
              <pre
                className="max-h-28 overflow-auto rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-xs text-foreground"
                data-testid="text-paste-cars-unmatched"
              >
                {formatUnmatchedPasteList(unmatched)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
