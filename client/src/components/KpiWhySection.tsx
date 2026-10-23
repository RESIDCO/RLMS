import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/queryClient";
import { kpiWhyLines } from "@shared/kpi-why";

/** Optional context passed into the railcar sheet when it was opened from a KPI list. */
export type KpiSheetContext = {
  carId: number;
  bucket: string;
};

type KpiCarPayload = {
  row?: {
    reason?: string | null;
    status_tag?: string | null;
    derived_status?: string | null;
    current_lease?: string | null;
    lessee?: string | null;
  } | null;
  primary?: string | null;
};

export function KpiWhySection({ context }: { context: KpiSheetContext }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/kpi/car", context.carId],
    queryFn: () => apiGet<KpiCarPayload>(`/api/kpi/car/${context.carId}`),
    enabled: Number.isFinite(context.carId) && context.carId > 0,
  });
  const lines = kpiWhyLines({
    bucket: context.bucket,
    reason: data?.row?.reason,
    primary: data?.primary,
    statusTag: data?.row?.status_tag,
    derivedStatus: data?.row?.derived_status,
    lease: data?.row?.current_lease,
    lessee: data?.row?.lessee,
  });

  return (
    <div className="rounded-md border border-border p-3 space-y-1 text-sm" data-testid="kpi-why">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Why in this KPI</div>
      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="text-destructive">{error instanceof Error ? error.message : "Could not load this KPI"}</div>
      ) : (
        <>
          <div className="font-medium">{lines.title}</div>
          <div className="text-muted-foreground">{lines.status}</div>
          <div className="text-muted-foreground">{lines.lease}</div>
        </>
      )}
    </div>
  );
}
