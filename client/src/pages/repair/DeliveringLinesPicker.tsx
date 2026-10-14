/**
 * Type-ahead multi-select for operating railroads (NARN).
 * "BP" → BPRR – Buffalo & Pittsburgh. Manual entry allowed → needs review.
 */
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

export type DeliveringLineValue = {
  mark: string;
  name: string | null;
  label: string;
  manualEntry: boolean;
  needsReview: boolean;
};

type Suggestion = {
  mark: string;
  name: string | null;
  label: string;
};

type Props = {
  value: DeliveringLineValue[];
  onChange: (next: DeliveringLineValue[]) => void;
  dark?: boolean;
  inputClassName?: string;
};

export default function DeliveringLinesPicker({
  value,
  onChange,
  dark,
  inputClassName,
}: Props) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [manualMark, setManualMark] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      void apiRequest(
        "GET",
        `/api/repair/railroads?q=${encodeURIComponent(term)}&limit=25`,
      )
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          const selected = new Set(value.map((v) => v.mark));
          setSuggestions(
            ((data.railroads ?? []) as Suggestion[]).filter(
              (r) => !selected.has(r.mark),
            ),
          );
          setOpen(true);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, value]);

  function addKnown(s: Suggestion) {
    if (value.some((v) => v.mark === s.mark)) return;
    onChange([
      ...value,
      {
        mark: s.mark,
        name: s.name,
        label: s.label || `${s.mark}${s.name ? ` – ${s.name}` : ""}`,
        manualEntry: false,
        needsReview: false,
      },
    ]);
    setQ("");
    setSuggestions([]);
    setOpen(false);
  }

  function addManual() {
    const mark = manualMark.trim().toUpperCase();
    if (!mark || !/^[A-Z0-9]{2,8}$/.test(mark)) return;
    if (value.some((v) => v.mark === mark)) {
      setManualMark("");
      return;
    }
    // If it exists in the railroad table, prefer known (search once)
    void apiRequest("GET", `/api/repair/railroads?q=${encodeURIComponent(mark)}&limit=5`)
      .then((r) => r.json())
      .then((data) => {
        const hit = ((data.railroads ?? []) as Suggestion[]).find(
          (r) => r.mark === mark,
        );
        if (hit) {
          addKnown(hit);
        } else {
          onChange([
            ...value,
            {
              mark,
              name: null,
              label: mark,
              manualEntry: true,
              needsReview: true,
            },
          ]);
        }
        setManualMark("");
      })
      .catch(() => {
        onChange([
          ...value,
          {
            mark,
            name: null,
            label: mark,
            manualEntry: true,
            needsReview: true,
          },
        ]);
        setManualMark("");
      });
  }

  function remove(mark: string) {
    onChange(value.filter((v) => v.mark !== mark));
  }

  return (
    <div className="space-y-2" ref={boxRef} data-testid="delivering-lines-picker">
      <div className="relative">
        <Input
          className={inputClassName}
          value={q}
          onChange={(e) => setQ(e.target.value.toUpperCase())}
          onFocus={() => q.trim() && setOpen(true)}
          placeholder='Type mark or name — e.g. "BP" → BPRR – Buffalo & Pittsburgh'
          aria-label="Search delivering railroads"
        />
        {open && (suggestions.length > 0 || loading) ? (
          <ul
            className={`absolute z-20 mt-1 max-h-48 w-full overflow-auto border text-xs shadow-md ${
              dark ? "bg-slate-900 border-slate-600" : "bg-white border-slate-300"
            }`}
            role="listbox"
          >
            {loading ? (
              <li className="px-2 py-1.5 opacity-70">Searching…</li>
            ) : (
              suggestions.map((s) => (
                <li key={s.mark}>
                  <button
                    type="button"
                    className={`w-full text-left px-2 py-1.5 hover:bg-sky-100 dark:hover:bg-slate-700 ${
                      dark ? "text-slate-100" : "text-slate-900"
                    }`}
                    onClick={() => addKnown(s)}
                  >
                    <span className="font-semibold">{s.mark}</span>
                    {s.name ? (
                      <span className="opacity-80"> – {s.name}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5 min-h-[1.75rem]">
        {value.length === 0 ? (
          <span className="text-xs opacity-60">No delivering lines selected.</span>
        ) : (
          value.map((v) => (
            <span
              key={v.mark}
              className={`inline-flex items-center gap-1 border px-2 py-0.5 text-xs ${
                v.needsReview
                  ? dark
                    ? "border-amber-500 bg-amber-950/40 text-amber-200"
                    : "border-amber-600 bg-amber-50 text-amber-900"
                  : dark
                    ? "border-slate-500 bg-slate-800"
                    : "border-slate-300 bg-slate-50"
              }`}
              title={
                v.needsReview
                  ? "Manual entry — flagged for review"
                  : v.label
              }
            >
              {v.label}
              {v.needsReview ? (
                <span className="uppercase tracking-wide text-[10px] font-bold">
                  review
                </span>
              ) : null}
              <button
                type="button"
                className="opacity-70 hover:opacity-100"
                aria-label={`Remove ${v.mark}`}
                onClick={() => remove(v.mark)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[10rem]">
          <label className="text-[10px] uppercase tracking-wide opacity-70">
            Manual mark (missing from list)
          </label>
          <Input
            className={inputClassName}
            value={manualMark}
            maxLength={8}
            onChange={(e) => setManualMark(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManual();
              }
            }}
            placeholder="e.g. XYZR"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 text-xs"
          onClick={() => addManual()}
        >
          Add + flag review
        </Button>
      </div>
    </div>
  );
}
