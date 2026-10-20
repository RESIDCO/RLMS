import { useMemo, useState } from "react";
import { useCanEdit } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { MoveCarsDialog } from "@/components/MoveCarsDialog";
import SearchableSelect, { riderToOption } from "@/components/SearchableSelect";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import { cn } from "@/lib/utils";
import { displayRailcarStatus, displayStatusInputFromRailcar } from "@shared/fleet-status";
import { apiGet, railcarsQs, asRailcarList } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatUsDateTimeEt } from "@shared/display-date";
import { idsEligibleForMove } from "@shared/move-plan";
import type { RailcarWithAssignment } from "@shared/schema";

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-card-border bg-card p-5">
      <div className="flex items-center gap-3 mb-4">
        <span
          className={cn(
            "h-6 w-6 rounded-full border flex items-center justify-center text-xs font-mono-num",
            done
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground"
          )}
        >
          {n}
        </span>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export default function MoveCars() {
  const canEdit = useCanEdit();
  const initRider = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("rider") ?? ""
    : "";
  const [fromRiderId, setFromRiderId] = useState<string>(initRider);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveCarIds, setMoveCarIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const { data: riders } = useQuery<any[]>({ queryKey: ["/api/riders"] });
  const { data: railcars, isLoading, isError, error } = useQuery<RailcarWithAssignment[]>({
    queryKey: ["/api/railcars", { all: "1", rider_id: fromRiderId, active: "all" }],
    queryFn: () =>
      apiGet<RailcarWithAssignment[]>(
        railcarsQs({ all: "1", rider_id: fromRiderId, active: "all" })
      ),
    enabled: !!fromRiderId,
    staleTime: 45_000,
  });
  const { data: history } = useQuery<any[]>({ queryKey: ["/api/history"] });

  const sourceRiderOptions = useMemo(
    () => (riders ?? []).map(riderToOption),
    [riders],
  );

  const sourceCars = useMemo(() => {
    if (!fromRiderId) return [];
    const rows = asRailcarList(railcars);
    const list = rows.filter(
      (c) => String(c.assignment?.rider_id ?? "") === fromRiderId
    );
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (c) =>
        c.car_number.toLowerCase().includes(q) ||
        c.assignment?.fleet_name?.toLowerCase().includes(q)
    );
  }, [railcars, fromRiderId, search]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const selectAll = () => {
    if (selected.size === sourceCars.length) setSelected(new Set());
    else setSelected(new Set(sourceCars.map((c) => c.id)));
  };

  function openMoveDialog() {
    const known = asRailcarList(railcars).filter((car) => selected.has(car.id));
    const picked = idsEligibleForMove(selected, known);
    if (!picked.ids.length) {
      toast({ title: "Inactive cars were left alone" });
      return;
    }
    if (picked.skippedInactive > 0) {
      toast({
        title: `${picked.skippedInactive} inactive car${picked.skippedInactive === 1 ? "" : "s"} left out of this move`,
      });
    }
    setMoveCarIds(picked.ids);
    setMoveOpen(true);
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="mx-4 sm:mx-8 mt-4 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
        Ending an OL? Prompt: Move to EA x-lessee? Use{" "}
        <a className="underline" href="#/returns/bulk">Bulk return</a> so the preview shows old link → new link.
        Moving onto a new OL clears Rent Start Date unless you supply one in the move dialog — the car stays Idle (awaiting rent start), not Unassigned.
      </div>
      <PageHeader
        title="Move Cars"
        subtitle="Reassign one or more railcars from one rider to another. Every move is logged."
      />

      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 sm:py-6 grid grid-cols-1 xl:grid-cols-3 gap-5 content-start">
        <div className="xl:col-span-2 space-y-4">
          <Step n={1} title="Select source rider" done={!!fromRiderId}>
            <SearchableSelect
              value={fromRiderId}
              onChange={(v) => {
                setFromRiderId(v);
                setSelected(new Set());
              }}
              options={sourceRiderOptions}
              placeholder="Choose a rider…"
              searchPlaceholder="Type OL number, lessee, or rider…"
              emptyText="No riders match."
              testId="select-from-rider"
            />
          </Step>

          <Step
            n={2}
            title={`Select cars${fromRiderId ? ` (${selected.size}/${sourceCars.length})` : ""}`}
            done={selected.size > 0}
          >
            {!fromRiderId ? (
              <div className="py-6 text-center text-sm text-muted-foreground italic">
                Pick a source rider first.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <ClearableSearchInput
                    className="relative flex-1 max-w-none"
                    placeholder="Filter by car # or lessee…"
                    value={search}
                    onChange={setSearch}
                    testId="input-filter-source-cars"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={selectAll}
                    data-testid="button-select-all"
                  >
                    {selected.size === sourceCars.length && sourceCars.length > 0
                      ? "Clear"
                      : "Select all"}
                  </Button>
                </div>

                <div className="rounded-md border border-border max-h-[360px] overflow-auto">
                  {isLoading ? (
                    <Skeleton className="h-40" />
                  ) : isError ? (
                    <div className="py-10 text-sm text-destructive italic text-center">
                      Could not load cars{error instanceof Error ? `: ${error.message}` : "."}
                    </div>
                  ) : sourceCars.length === 0 ? (
                    <div className="py-10 text-sm text-muted-foreground italic text-center">
                      No cars on this rider.
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground bg-muted/30 sticky top-0">
                        <tr className="text-left">
                          <th className="w-10 px-3 py-2" />
                          <th className="px-3 py-2 font-medium">Marks / Car Number</th>
                          <th className="px-3 py-2 font-medium">Lessee</th>
                          <th className="px-3 py-2 font-medium">Rental Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sourceCars.map((c) => {
                          // car_number already contains the full reporting mark (e.g. HWCX010601)
                          // reporting_marks is the alpha prefix (e.g. HWCX)
                          const numericSuffix = c.reporting_marks && c.car_number.toUpperCase().startsWith(c.reporting_marks.toUpperCase())
                            ? c.car_number.slice(c.reporting_marks.length)
                            : null;
                          return (
                            <tr
                              key={c.id}
                              className={cn(
                                "border-t border-border cursor-pointer hover-elevate",
                                selected.has(c.id) && "bg-primary/5"
                              )}
                              onClick={() => toggle(c.id)}
                              data-testid={`source-car-${c.id}`}
                            >
                              <td className="px-3 py-1.5">
                                <Checkbox
                                  checked={selected.has(c.id)}
                                  onCheckedChange={() => toggle(c.id)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <span className="font-mono font-semibold text-foreground">
                                  {c.reporting_marks && numericSuffix !== null ? (
                                    <><span className="text-primary">{c.reporting_marks}</span>{numericSuffix}</>
                                  ) : c.car_number}
                                </span>
                                {c.reporting_marks && (
                                  <span className="block text-[10px] text-muted-foreground font-mono">
                                    {c.reporting_marks} · {numericSuffix ?? c.car_number}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5">
                                {c.assignment?.fleet_name ?? "—"}
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground">
                                {displayRailcarStatus(displayStatusInputFromRailcar(c as any))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </Step>

          <Button
            disabled={!canEdit || selected.size === 0}
            onClick={openMoveDialog}
            data-testid="button-confirm-move"
          >
            {!canEdit ? "View only" : `Move ${selected.size || ""} selected`}
          </Button>
        </div>
      </div>
      <MoveCarsDialog open={moveOpen} onOpenChange={setMoveOpen} carIds={moveCarIds} />

      {/* Recent moves */}
      <div className="px-4 sm:px-8 pb-10">
        <div className="rounded-lg border border-card-border bg-card overflow-hidden">
          <header className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent Moves</h2>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {(history ?? []).length} records
            </span>
          </header>
          <div className="overflow-auto max-h-[300px]">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground bg-muted/40 sticky top-0">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Car</th>
                  <th className="px-4 py-2 font-medium">From → To</th>
                  <th className="px-4 py-2 font-medium">Lessee</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(history ?? []).slice(0, 50).map((h: any) => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="px-4 py-2 font-mono-num text-muted-foreground">
                      {formatUsDateTimeEt(h.moved_at) || "—"}
                    </td>
                    <td className="px-4 py-2 font-mono-num">
                      {h.railcar ? [h.railcar.reporting_marks, h.railcar.car_number].filter(Boolean).join(" ") : `#${h.railcar_id}`}
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-muted-foreground">
                        {h.from_rider?.rider_name ?? "—"}
                      </span>
                      <span className="mx-1.5 text-primary">→</span>
                      {h.to_rider?.rider_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {h.from_fleet_name ?? "—"} → {h.to_fleet_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground italic">
                      {h.reason ?? "—"}
                    </td>
                  </tr>
                ))}
                {(history ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      No moves recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
