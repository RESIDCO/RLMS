import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { carListSearchTokens, pasteSearchBatches, programPickerFromSearch, type SearchPastePage } from "@shared/programs";
import { apiGet, apiRequest, asRailcarList, railcarsQs } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import { Checkbox } from "@/components/ui/checkbox";
import { X } from "lucide-react";

export type PickedCar = { id: number; label: string };

export type ResolveResult = {
  matched: { token: string; railcar_id: number; label: string }[];
  not_found: { token: string; reason?: string }[];
  already_in_program: { token: string; railcar_id: number; label: string }[];
  ambiguous: {
    token: string;
    reason?: string;
    matches: { railcar_id: number; label: string; active?: boolean | null }[];
  }[];
};

function carLabel(r: { reporting_marks?: string | null; car_number?: string | null }): string {
  return [r.reporting_marks, r.car_number].filter(Boolean).join(" ");
}

export default function ProgramCarPicker({
  programId,
  value,
  onChange,
}: {
  programId?: number | null;
  value: PickedCar[];
  onChange: (next: PickedCar[]) => void;
}) {
  const [mode, setMode] = useState<"search" | "paste">("search");
  const [q, setQ] = useState("");
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<ResolveResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const searchText = q.trim();
  const searchReady = mode === "search" && searchText.length >= 2;
  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["/api/railcars", "program-picker", searchText],
    queryFn: () => apiGet(railcarsQs({ search: searchText, active: "all", pageSize: 25 })),
    enabled: searchReady,
  });
  const rows = searchReady ? asRailcarList<any>(data as any) : [];
  const pickedIds = useMemo(() => new Set(value.map((c) => c.id)), [value]);

  function addCar(id: number, label: string) {
    if (pickedIds.has(id)) return;
    onChange([...value, { id, label }]);
    setQ("");
  }

  function removeCar(id: number) {
    onChange(value.filter((c) => c.id !== id));
  }

  async function resolvePaste(text?: string) {
    const body = (typeof text === "string" ? text : paste).trim();
    if (!body) {
      setResolveError("Paste a car list first.");
      return;
    }
    setResolving(true);
    setResolveError(null);
    try {
      const { batches, rejected } = pasteSearchBatches(body);
      if (!batches.length) {
        setPreview(programPickerFromSearch([], rejected));
        if (!rejected.length) setResolveError("No car numbers found in that paste.");
        return;
      }
      const pages: SearchPastePage[] = [];
      for (const qBatch of batches) {
        const res = await apiRequest("POST", "/api/search", {
          q: qBatch,
          active: "all",
          search_cars: 1,
          search_leases: 0,
          search_car_data: 0,
          ...(programId ? { program_id: programId } : {}),
        });
        pages.push(await res.json());
      }
      const out = programPickerFromSearch(pages, rejected);
      setPreview(out);
      if (!out.matched.length && !out.ambiguous.length && !out.already_in_program.length) {
        setResolveError(out.not_found[0]?.reason ?? "No cars matched.");
      }
    } catch (err) {
      setPreview(null);
      setResolveError(err instanceof Error ? err.message : "Could not match that list.");
    } finally {
      setResolving(false);
    }
  }

  function chooseAmbiguous(token: string, id: number, label: string) {
    addCar(id, label);
    setPreview((prev) =>
      prev
        ? { ...prev, ambiguous: prev.ambiguous.filter((row) => row.token !== token) }
        : prev,
    );
  }

  function acceptMatched() {
    if (!preview) return;
    const next = [...value];
    const have = new Set(next.map((c) => c.id));
    for (const m of preview.matched) {
      if (have.has(m.railcar_id)) continue;
      next.push({ id: m.railcar_id, label: m.label });
      have.add(m.railcar_id);
    }
    onChange(next);
    setPaste("");
    setPreview(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-xs">
        <Button type="button" size="sm" variant={mode === "search" ? "default" : "outline"} onClick={() => setMode("search")}>
          Search
        </Button>
        <Button type="button" size="sm" variant={mode === "paste" ? "default" : "outline"} onClick={() => setMode("paste")}>
          Paste list
        </Button>
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-xs">
              {c.label}
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => removeCar(c.id)}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {mode === "search" ? (
        <>
          <ClearableSearchInput
            placeholder="Type a car number, or paste a list…"
            value={q}
            onChange={setQ}
            inputClassName="h-9"
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!carListSearchTokens(text)) return;
              e.preventDefault();
              const list = text.trim();
              setMode("paste");
              setPaste(list);
              void resolvePaste(list);
            }}
          />
          <div className="max-h-56 overflow-auto border rounded-md">
            <table className="w-full text-xs">
              <tbody>
                {rows.map((r: any) => {
                  const label = carLabel(r);
                  const on = pickedIds.has(r.id);
                  return (
                    <tr key={r.id} className="border-t border-border/40">
                      <td className="px-2 py-1.5 w-8">
                        <Checkbox
                          checked={on}
                          onCheckedChange={() => (on ? removeCar(r.id) : addCar(r.id, label))}
                        />
                      </td>
                      <td
                        className="px-2 py-1.5 font-mono cursor-pointer"
                        onClick={() => (on ? removeCar(r.id) : addCar(r.id, label))}
                      >
                        {label}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{r.lessee_name ?? r.rider_external_id ?? ""}</td>
                    </tr>
                  );
                })}
                {isFetching && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground italic">Searching cars…</td>
                  </tr>
                )}
                {isError && !isFetching && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-destructive">
                      {error instanceof Error ? error.message : "Could not search cars."}
                    </td>
                  </tr>
                )}
                {!isFetching && !isError && rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground italic">
                      {searchReady ? "No matching cars." : "Type at least 2 characters, or paste a list."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div>
            <Label className="text-xs">Paste car numbers. MARKNUMBER, MARK NUMBER, and MARK-NUMBER all match. Leading zeros are optional.</Label>
            <Textarea
              className="mt-1 font-mono text-xs"
              rows={6}
              value={paste}
              onChange={(e) => {
                setPaste(e.target.value);
                setPreview(null);
                setResolveError(null);
              }}
              placeholder={"TFOX 901745\nKCS 310100\n475002"}
            />
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void resolvePaste()} disabled={!paste.trim() || resolving}>
            {resolving ? "Matching…" : "Match list"}
          </Button>
          {resolveError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {resolveError}
            </div>
          )}
          {resolving && <div className="text-xs text-muted-foreground">Matching on the server…</div>}
          {preview && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-2">
              <div>
                <span className="text-emerald-400 font-medium">{preview.matched.length} matched</span>
                {" · "}
                <span className="text-amber-400 font-medium">{preview.not_found.length} not found</span>
                {" · "}
                <span className="text-muted-foreground font-medium">{preview.already_in_program.length} already in this program</span>
                {preview.ambiguous.length > 0 && (
                  <>
                    {" · "}
                    <span className="text-amber-400 font-medium">{preview.ambiguous.length} need a choice</span>
                  </>
                )}
              </div>
              {preview.not_found.length > 0 && (
                <div>
                  <div className="text-muted-foreground mb-0.5">Not found</div>
                  <ul className="space-y-0.5">
                    {preview.not_found.map((t) => (
                      <li key={`${t.token}:${t.reason ?? ""}`} className="font-mono">
                        {t.token}
                        {t.reason ? <span className="text-muted-foreground"> — {t.reason}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.already_in_program.length > 0 && (
                <div>
                  <div className="text-muted-foreground mb-0.5">Already in this program</div>
                  <div className="font-mono">{preview.already_in_program.map((t) => t.label || t.token).join(", ")}</div>
                </div>
              )}
              {preview.ambiguous.length > 0 && (
                <div className="space-y-2">
                  <div className="text-muted-foreground">Needs a choice</div>
                  {preview.ambiguous.map((a) => (
                    <div key={a.token} className="space-y-1">
                      <div className="font-mono">
                        {a.token}
                        {a.reason ? <span className="text-muted-foreground"> — {a.reason}</span> : null}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {a.matches.map((m) =>
                          m.active === false ? (
                            <span key={m.railcar_id} className="rounded border border-border px-1.5 py-0.5 font-mono text-muted-foreground">
                              {m.label} (inactive)
                            </span>
                          ) : (
                            <Button
                              key={m.railcar_id}
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 font-mono text-xs"
                              onClick={() => chooseAmbiguous(a.token, m.railcar_id, m.label)}
                            >
                              Use {m.label}
                            </Button>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button type="button" size="sm" onClick={acceptMatched} disabled={!preview.matched.length}>
                Add {preview.matched.length} matched
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
