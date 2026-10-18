import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseCarPasteList } from "@shared/programs";

export function PasteSearchBar({
  onSearch,
}: {
  onSearch: (tokens: string[]) => void;
}) {
  const [text, setText] = useState("");
  const tokens = parseCarPasteList(text);
  return (
    <div className="flex flex-wrap items-start gap-2 mb-3">
      <Textarea
        className="min-h-[64px] flex-1 font-mono text-xs"
        placeholder="Paste cars: TFOX 1036, TFOX001036, or one per line"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        size="sm"
        onClick={() => onSearch(tokens)}
        disabled={!tokens.length}
      >
        Match {tokens.length || ""}
      </Button>
    </div>
  );
}
