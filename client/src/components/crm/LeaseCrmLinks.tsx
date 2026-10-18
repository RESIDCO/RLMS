import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiGet } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import type { OpportunityRow } from "@shared/crm";
import { OPPORTUNITY_STAGE_LABEL, OPPORTUNITY_TYPE_LABEL } from "@shared/crm";

type LesseePayload = {
  header?: {
    account_id?: number | null;
    is_placeholder?: boolean | null;
  };
};

type RiderPayload = {
  header?: {
    master_lease_id?: number | null;
    is_placeholder?: boolean | null;
  };
};

/**
 * Read-only CRM links on Lease Management pages.
 * Hidden when there is nothing to show, or when a read fails.
 */
export default function LeaseCrmLinks({
  mode,
  id,
  part = "all",
}: {
  mode: "lessee" | "rider";
  id: number;
  /** Split the account link from the opportunities card so each can sit in its own row. */
  part?: "all" | "account" | "opportunities";
}) {
  const rider = useQuery({
    queryKey: ["/api/lease-mgmt/riders", id],
    queryFn: () => apiGet<RiderPayload>(`/api/lease-mgmt/riders/${id}`),
    enabled: mode === "rider" && Number.isFinite(id),
    retry: false,
  });
  const lesseeId = mode === "lessee" ? id : Number(rider.data?.header?.master_lease_id);
  const lessee = useQuery({
    queryKey: ["/api/lease-mgmt/lessees", lesseeId],
    queryFn: () => apiGet<LesseePayload>(`/api/lease-mgmt/lessees/${lesseeId}`),
    enabled: Number.isFinite(lesseeId) && lesseeId > 0,
    retry: false,
  });
  const opps = useQuery({
    queryKey: ["/api/opportunities", "rider", id, "open"],
    queryFn: () => apiGet<OpportunityRow[]>(`/api/opportunities?rider_id=${id}&open=1`),
    enabled: mode === "rider" && Number.isFinite(id),
    retry: false,
  });

  const header = lessee.data?.header;
  const showAccount = part !== "opportunities"
    && !lessee.isError
    && header?.account_id != null
    && header.is_placeholder !== true;
  const showOpps = part !== "account"
    && mode === "rider"
    && !opps.isError
    && (opps.data?.length ?? 0) > 0;
  if (!showAccount && !showOpps) return null;

  const account = showAccount ? (
    <Button size="sm" variant="outline" asChild>
      <Link href={`/accounts/${header?.account_id}`}>Open account →</Link>
    </Button>
  ) : null;

  const opportunities = showOpps ? (
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Opportunities on this OL</span>
            <Link href="/opportunities" className="text-xs text-primary hover:underline">
              #/opportunities
            </Link>
          </div>
          <ul className="space-y-1">
            {(opps.data ?? []).map((row) => (
              <li key={row.id}>
                <Link href={`/accounts/${row.account_id}`} className="hover:underline">
                  {OPPORTUNITY_TYPE_LABEL[row.type]} · {OPPORTUNITY_STAGE_LABEL[row.stage]}
                  {row.owner ? ` · ${row.owner}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
  ) : null;

  if (part === "account") return account;
  if (part === "opportunities") return opportunities;

  return (
    <div className="flex flex-col gap-2 text-sm">
      {account}
      {opportunities}
    </div>
  );
}
