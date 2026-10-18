import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/queryClient";
import { OPPORTUNITY_STAGE_LABEL, OPPORTUNITY_TYPE_LABEL, type OpportunityRow } from "@shared/crm";

export default function ContactOpportunities({ contactId }: { contactId: number }) {
  const opps = useQuery({
    queryKey: ["/api/opportunities", "contact", contactId],
    queryFn: () => apiGet<OpportunityRow[]>(`/api/opportunities?contact_id=${contactId}`),
  });
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Opportunities</div>
      {opps.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
      {opps.isError ? <p className="text-xs text-destructive">Could not load opportunities.</p> : null}
      {!opps.isLoading && (opps.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> : null}
      <ul className="text-sm space-y-1">
        {(opps.data ?? []).map((row) => (
          <li key={row.id}>
            <Link href={`/opportunities?contact_id=${contactId}`} className="hover:underline">
              {OPPORTUNITY_TYPE_LABEL[row.type]}
            </Link>
            <span className="text-muted-foreground"> · {OPPORTUNITY_STAGE_LABEL[row.stage]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CompanyOpportunities({ companyId }: { companyId: number }) {
  const opps = useQuery({
    queryKey: ["/api/opportunities", "company", companyId],
    queryFn: () => apiGet<OpportunityRow[]>(`/api/opportunities?company_id=${companyId}`),
  });
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Opportunities</div>
      {opps.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
      {!opps.isLoading && (opps.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> : null}
      <ul className="text-sm space-y-1">
        {(opps.data ?? []).map((row) => (
          <li key={row.id}>
            <Link href={`/opportunities?company_id=${companyId}`} className="hover:underline">
              {OPPORTUNITY_TYPE_LABEL[row.type]}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {OPPORTUNITY_STAGE_LABEL[row.stage]}
              {row.account_name ? ` · ${row.account_name}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
