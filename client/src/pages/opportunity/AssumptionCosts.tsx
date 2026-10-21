import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { CAR_TYPE_CLASSES, classLabel, type CarTypeClass, type DealCalcInputs } from "@shared/dealCalc";

type SetRow = { id: number; inputs: DealCalcInputs };

/** Admin editor for per-type new-car costs. Writes through the assumption-set patch, not SQL. */
export default function AssumptionCosts() {
  const qc = useQueryClient();
  const defaults = useQuery({
    queryKey: ["/api/calc/defaults"],
    queryFn: () => apiGet<{ assumption_set: SetRow }>("/api/calc/defaults"),
  });
  const [costs, setCosts] = useState<Partial<Record<CarTypeClass, string>>>({});
  useEffect(() => {
    const current = defaults.data?.assumption_set.inputs.newCarCostByClass ?? {};
    const next: Partial<Record<CarTypeClass, string>> = {};
    for (const carClass of CAR_TYPE_CLASSES) {
      const value = current[carClass];
      next[carClass] = value == null ? "" : String(value);
    }
    setCosts(next);
  }, [defaults.data]);

  const save = useMutation({
    mutationFn: async () => {
      const set = defaults.data?.assumption_set;
      if (!set) throw new Error("Company default not found");
      const newCarCostByClass: Partial<Record<CarTypeClass, number>> = {};
      for (const carClass of CAR_TYPE_CLASSES) {
        const text = (costs[carClass] ?? "").trim();
        if (!text) continue;
        const value = Number(text);
        if (!Number.isFinite(value)) throw new Error(`${classLabel(carClass)} needs a number`);
        newCarCostByClass[carClass] = value;
      }
      const inputs = { ...set.inputs, newCarCostByClass };
      const res = await apiRequest("PATCH", `/api/calc/assumption-sets/${set.id}`, { inputs });
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/calc/defaults"] });
    },
  });

  return (
    <section className="border rounded-md p-3 space-y-2" data-testid="assumption-costs">
      <h3 className="text-sm font-semibold">New-car cost by type</h3>
      <p className="text-xs text-muted-foreground">
        Starting costs for a new scenario on the Replacement basis. A saved scenario keeps the cost it was given. Leave a type blank when you have no default.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {CAR_TYPE_CLASSES.map((carClass) => (
          <label key={carClass} className="text-xs space-y-1">
            <span className="text-muted-foreground">{classLabel(carClass)} ($ / car)</span>
            <Input
              className="h-8"
              inputMode="decimal"
              value={costs[carClass] ?? ""}
              onChange={(event) => setCosts((current) => ({ ...current, [carClass]: event.target.value }))}
            />
          </label>
        ))}
      </div>
      <Button type="button" size="sm" disabled={save.isPending || !defaults.data} onClick={() => save.mutate()}>
        Save assumption-set costs
      </Button>
      {save.isError ? <p className="text-xs text-destructive">{save.error instanceof Error ? save.error.message : "Could not save"}</p> : null}
      {save.isSuccess ? <p className="text-xs text-muted-foreground">Saved.</p> : null}
    </section>
  );
}
