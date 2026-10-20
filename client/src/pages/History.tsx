import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import ActivityTimeline from "@/components/ActivityTimeline";
import { hashSearchParams, navigateHash, useHashSearch } from "@/lib/hash-location";
import { LINEAGE_SEARCH_DEBOUNCE_MS, lineageSearchCommit, lineageSearchPath } from "@shared/lineage-search";
import { safeLineageBack } from "@shared/lineage-link";
import { apiRequest } from "@/lib/queryClient";
import { carPath } from "@/lib/browse-nav";
import { displayLeaseNumber } from "@shared/residco-import";
import { asOne } from "@shared/lease-type";
import { FleetMembershipBadge, FleetAwareStatusBadge } from "@/components/InactiveFleetBadge";
import { displayStatusInputFromRailcar } from "@shared/fleet-status";
import { RailcarDetailSheet } from "@/pages/FleetRegistry";
import { cn } from "@/lib/utils";
import { BackToSearch } from "@/components/BackToSearch";

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
    railcar_ids?: number[];
    rider_ids?: number[];
    railcars?: ResolvedCar[];
    riders?: ResolvedRider[];
  };
};

function carLabel(car: ResolvedCar) {
  return [car.reporting_marks, car.car_number].filter(Boolean).join(" ");
}

export default function HistoryPage() {
  const [, navigate] = useLocation();
  const hashSearch = useHashSearch();
  const urlParams = new URLSearchParams(hashSearch.replace(/^\?/, ""));
  const urlQ = urlParams.get("q") ?? "";
  const back = safeLineageBack(urlParams.get("back"));
  const [search, setSearch] = useState(urlQ);
  const [settled, setSettled] = useState(urlQ.trim());
  const [sheetCarId, setSheetCarId] = useState<number | null>(null);
  const q = settled;

  useEffect(() => {
    const prev = document.title;
    document.title = "Lineage · RLMS";
    return () => { document.title = prev; };
  }, []);

  useEffect(() => {
    setSearch(urlQ);
    setSettled(urlQ.trim());
  }, [urlQ]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const params = hashSearchParams();
      const current = params.get("q") ?? "";
      const backPath = safeLineageBack(params.get("back"));
      const committed = lineageSearchCommit(search, current);
      setSettled(committed.settled);
      if (committed.push) navigateHash(lineageSearchPath(committed.settled, backPath));
    }, LINEAGE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [search]);

  const { data, isLoading } = useQuery<ActivityResponse>({
    queryKey: ["/api/lineage", "history-page", q],
    queryFn: () =>
      apiRequest("GET", q ? `/api/lineage?q=${encodeURIComponent(q)}` : "/api/lineage").then((r) => r.json()),
  });

  const carsFromApi = data?.resolved?.railcars ?? [];
  const riders = data?.resolved?.riders ?? [];
  const railcarIds = (data?.resolved?.railcar_ids ?? []).map(Number).filter((n) => n > 0);
  const needCarFallback = Boolean(q) && railcarIds.length > 0 && carsFromApi.length === 0;

  const { data: fallbackCars } = useQuery<ResolvedCar[]>({
    queryKey: ["/api/railcars", "history-resolve", railcarIds],
    enabled: needCarFallback,
    queryFn: async () => {
      const rows = await Promise.all(
        railcarIds.slice(0, 20).map(async (id) => {
          const body = await apiRequest("GET", `/api/railcars/${id}`).then((r) => r.json());
          return (body.railcar ?? body) as ResolvedCar;
        }),
      );
      return rows.filter((c) => c && c.id);
    },
  });

  const cars = carsFromApi.length ? carsFromApi : (fallbackCars ?? []);
  const showResolved = Boolean(q);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Lineage"
        subtitle="Read-only history from the activity log, change capture, moves, marks, status, rent stops, programs, notes, and imports"
      />

      <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-8 py-4 sm:py-6 gap-4 overflow-auto">
        {back ? (
          <div className="mb-3">
            <Link
              href={back}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
              data-testid="link-lineage-back"
            >
              ‹ Back
            </Link>
          </div>
        ) : null}
        <BackToSearch />
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

        <ActivityTimeline
          q={q || undefined}
          compact
          showSearchHint={!showResolved}
          usDates
          variant="lineage"
          events={data?.events ?? []}
          eventsLoading={isLoading}
        />
      </div>

      <RailcarDetailSheet carId={sheetCarId} onClose={() => setSheetCarId(null)} />
    </div>
  );
}
