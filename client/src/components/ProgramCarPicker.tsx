import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { carListSearchTokens } from "@shared/programs";
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
  ambiguous: { token: string; matches: { railcar_id: number; label: string }[] }[];
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

  const { data } = useQuery({
    queryKey: ["/api/railcars", "program-picker", q],
    queryFn: () => apiGet(railcarsQs({ search: q || undefined, all: 1, active: "all", pageSize: 80 })),
    enabled: mode === "search",
  });
  const rows = asRailcarList<any>(data as any);
  const pickedIds = useMemo(() => new Set(value.map((c) => c.id)), [value]);

  function addCar(id: number, label: string) {
    if (pickedIds.has(id)) return;
    onChange([...value, { id, label }]);
    setQ("");
  }

  function removeCar(id: number) {
    onChange(value.filter((c) => c.id !== id));
  }

  async function resolvePaste(text = paste) {
    const body = text.trim();
    if (!body) return;
    setResolving(true);
    try {
      const res = await apiRequest("POST", "/api/programs/resolve-cars", {
        text: body,
        program_id: programId ?? null,
      });
      const out = (await res.json()) as ResolveResult;
      setPreview(out);
    } finally {
      setResolving(false);
    }
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
                {rows.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-muted-foreground italic">
                      {q.trim() ? "No matching cars." : "Start typing a car number."}
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
            <Label className="text-xs">Paste car numbers (comma, space, or newline — marks optional)</Label>
            <Textarea
              className="mt-1 font-mono text-xs"
              rows={6}
              value={paste}
              onChange={(e) => {
                setPaste(e.target.value);
                setPreview(null);
              }}
              placeholder={"TFOX 901745\nKCS 310100\n475002"}
            />
          </div>
          <Button type="button" size="sm" variant="outline" onClick={resolvePaste} disabled={!paste.trim() || resolving}>
            {resolving ? "Matching…" : "Match list"}
          </Button>
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
                    <span className="text-amber-400 font-medium">{preview.ambiguous.length} ambiguous</span>
                  </>
                )}
              </div>
              {preview.not_found.length > 0 && (
                <div>
                  <div className="text-muted-foreground mb-0.5">Not found</div>
                  <div className="font-mono">{preview.not_found.map((t) => t.token).join(", ")}</div>
                </div>
              )}
              {preview.already_in_program.length > 0 && (
                <div>
                  <div className="text-muted-foreground mb-0.5">Already in this program</div>
                  <div className="font-mono">{preview.already_in_program.map((t) => t.label || t.token).join(", ")}</div>
                </div>
              )}
              {preview.ambiguous.length > 0 && (
                <div>
                  <div className="text-muted-foreground mb-0.5">Ambiguous (add reporting marks)</div>
                  {preview.ambiguous.map((a) => (
                    <div key={a.token} className="font-mono">
                      {a.token}: {a.matches.map((m) => m.label).join(", ")}
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
