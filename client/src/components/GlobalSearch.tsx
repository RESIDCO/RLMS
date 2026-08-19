import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from "react";
import { Search, X } from "lucide-react";
import { carListSearchTokens } from "@shared/programs";
import { openAppTab } from "@/lib/browse-nav";
import { searchPagePath } from "@/lib/search-query";

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    openAppTab(searchPagePath(trimmed));
    setQuery("");
    inputRef.current?.blur();
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const cars = carListSearchTokens(text);
    if (!cars || cars.length < 2) return;
    e.preventDefault();
    openAppTab(searchPagePath(text.trim()));
    setQuery("");
    inputRef.current?.blur();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      inputRef.current?.blur();
    }
  }

  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="relative flex-1 max-w-xl" data-testid="global-search">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder="Search or paste a list of cars… (Enter)"
          autoComplete="off"
          data-testid="input-global-search"
          className="w-full bg-sidebar-accent/40 border border-sidebar-border rounded-md pl-8 pr-20 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {query && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery("");
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-search-clear"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {!query && (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-sidebar-border bg-muted/30 px-1 py-0.5 text-[10px] text-muted-foreground font-sans pointer-events-none">
              <span className="text-[11px]">⌘</span>K
            </kbd>
          )}
        </div>
      </div>
    </div>
  );
}
