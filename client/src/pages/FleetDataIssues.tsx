import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGet } from "@/lib/queryClient";
import { FLEET_STALE_MS } from "@/lib/fleetQueryRefresh";
import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { kpiDrillPath } from "@shared/kpi-drill-tiles";
import { NO_LEASE_LINK_SUBTITLE, fleetDataIssuesLabel } from "@shared/fleet-data-issues";
import { AlertTriangle, CircleDashed, PackageMinus, PauseCircle, TimerOff } from "lucide-react";
import { KpiCard } from "@/pages/Dashboard";

type IssueKpis = {
  stale_commitments?: number;
  stale_programs?: number;
  no_lease_link?: number;
  sold_needs_tag?: number;
  sale_unclear?: number;
  sold_tag_suspect?: number;
  sold_missing_buyer?: number;
  leased_off_rent?: number;
  unbucketed_count?: number;
  awaiting_rent_start?: number;
  idle_on_ol_review?: number;
  going_on_lease_overdue?: number;
  lease_end_conflict?: number;
  fleet_data_issue_cars?: number;
};

type DashboardPayload = { kpis: IssueKpis };

function warn(count: number | null | undefined): "warning" | "muted" {
  return (count ?? 0) > 0 ? "warning" : "muted";
}

export default function FleetDataIssuesPage() {
  const [, navigate] = useLocation();
  const { data, isLoading, isError, error, refetch } = useQuery<DashboardPayload>({
    queryKey: ["/api/dashboard"],
    queryFn: ({ signal }) => apiGet<DashboardPayload>("/api/dashboard", { timeoutMs: 30_000, signal }),
    staleTime: FLEET_STALE_MS,
    refetchOnMount: true,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
      return failureCount < 2;
    },
    retryDelay: (failureCount) => (failureCount === 0 ? 1_000 : 3_000),
  });
  const kpis = data?.kpis;
  const issueCars = kpis?.fleet_data_issue_cars ?? 0;

  return (
    <div>
      <PageHeader
        title="Fleet data issues"
        subtitle="Checks that are not fleet makeup. Each card opens the same list it used on the dashboard. The header count is distinct cars, so a car on two cards counts once."
        actions={
          kpis ? (
            <span
              className={
                issueCars > 0
                  ? "rounded-full border border-umler-signal/40 bg-umler-signal/10 px-3 py-1.5 text-xs font-semibold text-umler-signal"
                  : "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
              }
              data-testid="fleet-data-issues-count"
            >
              {fleetDataIssuesLabel(issueCars)}
            </span>
          ) : null
        }
      />
      <div className="px-4 sm:px-8 py-5 sm:py-7 space-y-4">
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-primary"
          onClick={() => navigate("/")}
        >
          Back to Dashboard
        </button>
        {isError ? (
          <div className="text-sm text-red-400">
            Couldn't load fleet data issues — {(error as Error)?.message || "request failed"}.{" "}
            <button type="button" className="underline text-foreground" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 [&>*]:min-w-0">
          {isLoading ? (
            Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-[110px] rounded-lg" />)
          ) : kpis ? (
            <>
              <KpiCard
                testId="kpi-stale"
                label="Stale Commitments"
                value={`${kpis.stale_commitments ?? 0} / ${kpis.stale_programs ?? 0}`}
                subtext="Stale Commitments / active programs past target or with no date. The badge counts commitment cars, not programs."
                icon={AlertTriangle}
                onClick={() => navigate("/commitments/stale")}
              />
              <KpiCard
                testId="kpi-no-link"
                label="No lease link"
                value={kpis.no_lease_link ?? 0}
                subtext={NO_LEASE_LINK_SUBTITLE}
                icon={CircleDashed}
                accent={warn(kpis.no_lease_link)}
                onClick={() => navigate(kpiDrillPath("no_link"))}
              />
              <KpiCard
                testId="kpi-sold-needs-tag"
                label="Sold – needs tag"
                value={kpis.sold_needs_tag ?? 0}
                subtext="External sale, still tagged Leased. Bulk Mark Sold after preview."
                icon={PackageMinus}
                accent={warn(kpis.sold_needs_tag)}
                onClick={() => navigate(kpiDrillPath("sold_needs_tag"))}
              />
              <KpiCard
                testId="kpi-sale-unclear"
                label="Sale unclear"
                value={kpis.sale_unclear ?? 0}
                subtext="Classify External or Intercompany. No car-data write."
                icon={AlertTriangle}
                accent={warn(kpis.sale_unclear)}
                onClick={() => navigate(kpiDrillPath("sale_unclear"))}
              />
              <KpiCard
                testId="kpi-sold-tag-suspect"
                label="Sold tag suspect"
                value={kpis.sold_tag_suspect ?? 0}
                subtext="Tagged Sold, live OL, internal owner. Review only."
                icon={AlertTriangle}
                accent={warn(kpis.sold_tag_suspect)}
                onClick={() => navigate(kpiDrillPath("sold_tag_suspect"))}
              />
              <KpiCard
                testId="kpi-sold-missing-buyer"
                label="Sold with blank buyer"
                value={kpis.sold_missing_buyer ?? 0}
                subtext="OL2144 / others tagged Sold with blank sold_to"
                icon={PackageMinus}
                onClick={() => navigate(kpiDrillPath("sold_missing_buyer"))}
              />
              <KpiCard
                testId="kpi-leased-off-rent"
                label="Tagged Leased but off rent"
                value={kpis.leased_off_rent ?? 0}
                subtext="Retag preview. Apply only after sign-off."
                icon={AlertTriangle}
                accent={warn(kpis.leased_off_rent)}
                onClick={() => navigate(kpiDrillPath("leased_off_rent"))}
              />
              <KpiCard
                testId="kpi-unbucketed"
                label="Unbucketed cars"
                value={kpis.unbucketed_count ?? 0}
                subtext="Operating cars the Idle, Abatement, Active, and Unassigned buckets missed."
                icon={AlertTriangle}
                accent={warn(kpis.unbucketed_count)}
                onClick={() => navigate(kpiDrillPath("unbucketed"))}
              />
              <KpiCard
                testId="kpi-awaiting-rent"
                label="Awaiting rent start"
                value={kpis.awaiting_rent_start ?? 0}
                subtext="On an OL but rent_start_date is blank or in the future. Paste and bulk Start rent stay on this list."
                icon={TimerOff}
                accent={warn(kpis.awaiting_rent_start)}
                onClick={() => navigate(kpiDrillPath("awaiting_rent_start"))}
              />
              <KpiCard
                testId="kpi-idle-on-ol"
                label="Idle on OL — under review"
                value={kpis.idle_on_ol_review ?? 0}
                subtext="Tagged Idle and still on an OL. Review queue, not fleet makeup."
                icon={PauseCircle}
                accent={warn(kpis.idle_on_ol_review)}
                onClick={() => navigate(kpiDrillPath("idle_on_ol"))}
              />
              <KpiCard
                testId="kpi-gol-overdue"
                label="Going on lease overdue"
                value={kpis.going_on_lease_overdue ?? 0}
                subtext="Going on lease cars past the rider expiration or the car lease end. The pipeline card stays on the dashboard."
                icon={TimerOff}
                accent={warn(kpis.going_on_lease_overdue)}
                onClick={() => navigate(kpiDrillPath("going_on_lease_overdue"))}
              />
              <KpiCard
                testId="kpi-lease-end-conflict"
                label="Lease end date conflict"
                value={kpis.lease_end_conflict ?? 0}
                subtext="Rider expiration and the car lease end are both set and they differ. Lease-ended watch stays on the dashboard."
                icon={AlertTriangle}
                accent={warn(kpis.lease_end_conflict)}
                onClick={() => navigate(kpiDrillPath("lease_end_conflict"))}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
