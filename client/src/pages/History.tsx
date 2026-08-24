import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import ActivityTimeline from "@/components/ActivityTimeline";
import { hashSearchParams } from "@/lib/hash-location";
import { apiRequest } from "@/lib/queryClient";
import { carPath } from "@/lib/browse-nav";
import { displayLeaseNumber } from "@shared/residco-import";
import { asOne } from "@shared/lease-type";
import { FleetMembershipBadge, FleetAwareStatusBadge } from "@/components/InactiveFleetBadge";
import { displayStatusInputFromRailcar } from "@shared/fleet-status";
import { RailcarDetailSheet } from "@/pages/FleetRegistry";
import { cn } from "@/lib/utils";

type ResolvedCar = {
  id: number;
  car_number: string;
  reporting_marks: string | null;
  car_type?: string | null;
  active?: boolean | null;
  lessee_name?: string | null;
  rider_external_id?: string | null;
  assignment?: {
    fleet_name?: string | null;
    rider?: {
      id: number;
      rider_name?: string | null;
      master_lease?: { lease_number?: string | null; lessee?: string | null } | null;
    } | null;
  } | null;
};

type ResolvedRider = {
  id: number;
  rider_name: string;
  schedule_number?: string | null;
  master_lease?: { lease_number?: string | null; lessee?: string | null } | null;
};

type ActivityResponse = {
  events: any[];
  resolved?: {
    railcars?: ResolvedCar[];
    riders?: ResolvedRider[];
  };
};

function carLabel(car: ResolvedCar) {
  return [car.reporting_marks, car.car_number].filter(Boolean).join(" ");
}

export default function HistoryPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState(() => hashSearchParams().get("q") ?? "");
  const [sheetCarId, setSheetCarId] = useState<number | null>(null);
  const q = search.trim();

  const { data, isLoading } = useQuery<ActivityResponse>({
    queryKey: ["/api/activity", { railcarId: undefined, riderId: undefined, q }],
    queryFn: () =>
      apiRequest("GET", q ? `/api/activity?q=${encodeURIComponent(q)}` : "/api/activity").then((r) => r.json()),
  });

  const cars = data?.resolved?.railcars ?? [];
  const riders = data?.resolved?.riders ?? [];
  const showResolved = Boolean(q);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="History"
        subtitle="Lineage of railcars and leases — mark changes, assignments, notes, status, and rent events"
      />

      <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-8 py-4 sm:py-6 gap-4 overflow-auto">
        <ClearableSearchInput
          className="flex-none w-full max-w-md"
          placeholder="Search car number, mark+number, or OL / rider…"
          value={search}
          onChange={setSearch}
          testId="input-search-history"
        />

        {showResolved && (
          <div className="rounded-lg border border-card-border bg-card">
            {isLoading ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">Resolving…</div>
            ) : cars.length === 0 && riders.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No matching car or rider. Try a current or prior mark+number, a bare car number, or an OL.
              </div>
            ) : (
              <div>
                {cars.map((car) => {
                  const rider = asOne(car.assignment?.rider);
                  const lease = asOne(rider?.master_lease);
                  const label = carLabel(car);
                  return (
                    <button
                      key={car.id}
                      type="button"
                      onClick={() => setSheetCarId(car.id)}
                      className="w-full flex items-start gap-4 px-4 py-3 text-left border-b border-border/40 last:border-0 hover:bg-muted/30"
                      data-testid={`history-resolved-car-${car.id}`}
                    >
                      <div className="min-w-[140px]">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <FleetMembershipBadge active={car.active} />
                        </div>
                        <div className="font-mono text-sm font-semibold">{label}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{car.car_type ?? "—"}</div>
                      </div>
                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <div className="text-muted-foreground mb-0.5">Fleet / Lessee</div>
                          <div className="font-medium">
                            {car.assignment?.fleet_name ?? car.lessee_name ?? (
                              <span className="text-muted-foreground italic">Unassigned</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-0.5">Rider</div>
                          <div>{rider?.rider_name ?? car.rider_external_id ?? "—"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-0.5">Master Lease</div>
                          <div>{displayLeaseNumber(lease?.lease_number) || "—"}</div>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <FleetAwareStatusBadge car={displayStatusInputFromRailcar(car as any)} />
                        <Link
                          href={carPath(car.id)}
                          className={cn("text-[11px] text-primary hover:underline")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open page
                        </Link>
                      </div>
                    </button>
                  );
                })}
                {riders.map((rider) => (
                  <button
                    key={rider.id}
                    type="button"
                    onClick={() => navigate(`/leases?rider=${rider.id}`)}
                    className="w-full flex items-center gap-4 px-4 py-3 text-left border-b border-border/40 last:border-0 hover:bg-muted/30"
                    data-testid={`history-resolved-rider-${rider.id}`}
                  >
                    <div className="min-w-[140px]">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rider</div>
                      <div className="text-sm font-semibold">{rider.rider_name}</div>
                    </div>
                    <div className="flex-1 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-muted-foreground mb-0.5">Lessee</div>
                        <div>{rider.master_lease?.lessee ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-0.5">Master Lease</div>
                        <div>{displayLeaseNumber(rider.master_lease?.lease_number) || "—"}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <ActivityTimeline q={q || undefined} compact showSearchHint={!showResolved} />
      </div>

      <RailcarDetailSheet carId={sheetCarId} onClose={() => setSheetCarId(null)} />
    </div>
  );
}
