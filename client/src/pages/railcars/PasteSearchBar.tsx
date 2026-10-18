import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseCarPasteList } from "@shared/programs";

export function PasteSearchBar({
  onMatch,
  onClear,
  unmatched,
  matchedCount,
  busy,
}: {
  onMatch: (tokens: string[]) => void;
  onClear: () => void;
  unmatched: string[];
  matchedCount: number | null;
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const tokens = parseCarPasteList(text);
  const active = matchedCount != null;
  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <Textarea
          className="min-h-[64px] flex-1 font-mono text-xs"
          placeholder="Paste cars: TFOX 1036, TFOX001036, or Excel TFOX then number"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            onClick={() => onMatch(tokens)}
            disabled={!tokens.length || busy}
          >
            {busy ? "Matching…" : `Match ${tokens.length || ""}`}
          </Button>
          {active ? (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear match
            </Button>
          ) : null}
        </div>
      </div>
      {active ? (
        <div className="text-xs text-muted-foreground">
          Matched {matchedCount} of {tokens.length || matchedCount + unmatched.length} pasted cars
          {unmatched.length ? (
            <span>
              {" · "}
              {unmatched.length} not in fleet{" "}
              <button
                type="button"
                className="underline text-foreground"
                onClick={() => void navigator.clipboard.writeText(unmatched.join("\n"))}
              >
                copy
              </button>
              <span className="ml-1 font-mono text-foreground">{unmatched.join(", ")}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
