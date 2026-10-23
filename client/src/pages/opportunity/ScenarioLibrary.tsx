import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActorLabel } from "@/components/ActorLabel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { offerUndoToast } from "@/lib/undo";
import { useToast } from "@/hooks/use-toast";

export type LibraryScenario = {
  id: number;
  name: string;
  deal_type: string;
  car_count?: number | null;
  max_bid_per_car?: number | null;
  irr?: number | null;
  verdict?: string | null;
  opportunity_id?: number | null;
  opportunity_label?: string | null;
  updated_at?: string | null;
  author?: string | null;
  created_by?: string | null;
  actor_label?: string | null;
  notes?: string | null;
};

type ListResponse = { numbersHidden: boolean; scenarios: LibraryScenario[] };

function money(value: number | null | undefined, hidden: boolean): string {
  if (hidden || value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function pct(value: number | null | undefined, hidden: boolean): string {
  if (hidden || value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function scenarioLibraryKey(q: string, link: string) {
  return ["/api/deal-calc/scenarios", q, link] as const;
}

export default function ScenarioLibrary({
  canWrite,
  onOpen,
}: {
  canWrite: boolean;
  onOpen: (id: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [link, setLink] = useState<"all" | "unlinked" | "linked">("all");
  const list = useQuery({
    queryKey: scenarioLibraryKey(q, link),
    queryFn: () => apiGet<ListResponse>(`/api/deal-calc/scenarios?q=${encodeURIComponent(q)}&link=${link}`),
    enabled: canWrite,
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/deal-calc/scenarios/${id}/delete`, {});
      return res.json();
    },
    onSuccess: (saved) => {
      offerUndoToast(saved);
      void qc.invalidateQueries({ queryKey: ["/api/deal-calc/scenarios"] });
    },
    onError: (err: Error) => toast({ title: "Could not delete scenario", description: err.message, variant: "destructive" }),
  });

  const duplicate = useMutation({
    mutationFn: async (row: LibraryScenario) => {
      const full = await apiGet<{ scenario: LibraryScenario & { inputs?: unknown; notes?: string | null } }>(`/api/deal-calc/scenarios/${row.id}`);
      const res = await apiRequest("POST", "/api/deal-calc/scenarios", {
        name: `Copy of ${row.name}`,
        notes: full.scenario.notes ?? "",
        inputs: full.scenario.inputs,
      });
      return res.json() as Promise<{ scenario: LibraryScenario }>;
    },
    onSuccess: (saved) => {
      offerUndoToast(saved);
      void qc.invalidateQueries({ queryKey: ["/api/deal-calc/scenarios"] });
      onOpen(saved.scenario.id);
    },
    onError: (err: Error) => toast({ title: "Could not duplicate scenario", description: err.message, variant: "destructive" }),
  });

  if (!canWrite) return <p className="text-sm text-muted-foreground">Sign in as an editor to see saved scenarios.</p>;
  const hidden = list.data?.numbersHidden ?? false;
  const rows = list.data?.scenarios ?? [];

  return (
    <div className="space-y-3" data-testid="calc-scenario-library">
      <div className="flex flex-wrap gap-2">
        <Input className="h-9 w-64" placeholder="Search name or notes" aria-label="Search scenarios" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Link filter" value={link} onChange={(event) => setLink(event.target.value as "all" | "unlinked" | "linked")}>
          <option value="all">All</option>
          <option value="unlinked">Unlinked</option>
          <option value="linked">Linked</option>
        </select>
      </div>
      {list.isLoading ? <p className="text-sm text-muted-foreground">Loading scenarios…</p> : null}
      {list.isError ? <p className="text-sm text-destructive">Could not load scenarios.</p> : null}
      <div className="overflow-auto border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Deal</th>
              <th className="px-2 py-2">Cars</th>
              <th className="px-2 py-2">Max bid / car</th>
              <th className="px-2 py-2">IRR</th>
              <th className="px-2 py-2">Verdict</th>
              <th className="px-2 py-2">Opportunity</th>
              <th className="px-2 py-2">Updated</th>
              <th className="px-2 py-2">Author</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="px-2 py-2">{row.name}</td>
                <td className="px-2 py-2">{String(row.deal_type ?? "").replaceAll("_", " ")}</td>
                <td className="px-2 py-2">{row.car_count ?? "—"}</td>
                <td className="px-2 py-2 font-mono-num">{money(row.max_bid_per_car, hidden)}</td>
                <td className="px-2 py-2 font-mono-num">{pct(row.irr, hidden)}</td>
                <td className="px-2 py-2">{hidden ? "—" : row.verdict ?? "—"}</td>
                <td className="px-2 py-2">{row.opportunity_id == null ? "Unlinked" : row.opportunity_label ?? `Opportunity ${row.opportunity_id}`}</td>
                <td className="px-2 py-2">{row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}</td>
                <td className="px-2 py-2">
                  <ActorLabel label={row.actor_label ?? row.author} raw={row.created_by ?? row.author} empty="—" />
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpen(row.id)}>Open</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => duplicate.mutate(row)}>Duplicate</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => remove.mutate(row.id)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !list.isLoading ? (
              <tr><td className="px-2 py-3 text-muted-foreground" colSpan={10}>No saved scenarios.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
