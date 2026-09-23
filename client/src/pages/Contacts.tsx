import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiGet } from "@/lib/queryClient";
import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Phone, Mail, Building2, ChevronLeft, ChevronRight, MapPin,
} from "lucide-react";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import { cn } from "@/lib/utils";
import { COMPANY_CONTACT_CUSTOM_FIELD_LABELS } from "@shared/mark-contacts-import";

type DirectoryBadge = "customer" | "prospect" | "lessor" | "lease_ol" | "unclassified";

type DirectoryRow = {
  total_count?: number;
  badge: DirectoryBadge;
  result_kind: string;
  company_id: number | null;
  company_name: string | null;
  relationship_type: string | null;
  account_id: number | null;
  reporting_marks: string[] | null;
  source: string | null;
  contact_id: number | null;
  contact_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  city: string | null;
  state: string | null;
  rider_id: number | null;
};

type DirectoryPage = {
  rows: DirectoryRow[];
  total_count: number;
  page: number;
  pageSize: number;
};

type Facets = {
  relationship_type: string[];
  priority_tier: string[];
  status: string[];
  source: string[];
  state: string[];
};

type CompanyDetail = {
  id: number;
  name: string;
  relationship_type: string;
  account_id: number | null;
  priority_tier: string | null;
  status: string | null;
  source: string;
  notes: string | null;
  reporting_marks: string[] | null;
  contacts: Array<{
    id: number;
    name: string;
    title: string | null;
    department: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    alt_phone: string | null;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    function_role: string | null;
    custom_fields: Record<string, string> | null;
    source: string;
  }>;
  company_products: Array<{
    id: number;
    commodity_family: string | null;
    product: string | null;
    estimated_railcars: number | null;
    car_type: string | null;
  }>;
};

const BADGE: Record<DirectoryBadge, { label: string; cls: string }> = {
  customer: { label: "Customer", cls: "bg-umler-teal/15 text-umler-teal border-umler-teal/30" },
  prospect: { label: "Prospect", cls: "bg-umler-steel/15 text-umler-steel border-umler-steel/30" },
  lessor: { label: "Lessor", cls: "bg-umler-faint/15 text-umler-faint border-umler-faint/30" },
  lease_ol: { label: "Lease OL", cls: "bg-primary/10 text-primary border-primary/20" },
  unclassified: { label: "Unreviewed", cls: "bg-muted text-muted-foreground border-border" },
};

function DirectoryBadgeChip({ badge }: { badge: DirectoryBadge }) {
  const style = BADGE[badge] ?? BADGE.unclassified;
  return (
    <span className={cn("text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border", style.cls)}>
      {style.label}
    </span>
  );
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="min-w-[140px]">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <Select value={value || "__all__"} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function labeledCustomFields(cf: Record<string, string> | null | undefined) {
  if (!cf) return [];
  return Object.entries(cf)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => ({
      label: COMPANY_CONTACT_CUSTOM_FIELD_LABELS[k] || k.replace(/_/g, " "),
      value: String(v),
    }));
}

export default function Contacts() {
  const [, navigate] = useLocation();
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [includeIndustry, setIncludeIndustry] = useState(false);
  const [relationshipType, setRelationshipType] = useState("");
  const [priorityTier, setPriorityTier] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [state, setState] = useState("");
  const [companyId, setCompanyId] = useState<number | null>(null);
  const pageSize = 50;

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [includeIndustry, relationshipType, priorityTier, status, source, state]);

  const params = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    if (includeIndustry) sp.set("include_industry", "true");
    if (relationshipType) sp.set("relationship_type", relationshipType);
    if (priorityTier) sp.set("priority_tier", priorityTier);
    if (status) sp.set("status", status);
    if (source) sp.set("source", source);
    if (state) sp.set("state", state);
    return sp.toString();
  }, [q, page, includeIndustry, relationshipType, priorityTier, status, source, state]);

  const { data, isLoading } = useQuery<DirectoryPage>({
    queryKey: ["/api/directory-search", params],
    queryFn: () => apiGet<DirectoryPage>(`/api/directory-search?${params}`),
  });

  const { data: facets } = useQuery<Facets>({
    queryKey: ["/api/directory-facets"],
    queryFn: () => apiGet<Facets>("/api/directory-facets"),
  });

  const { data: detail, isLoading: detailLoading } = useQuery<CompanyDetail>({
    queryKey: ["/api/companies", companyId],
    queryFn: () => apiGet<CompanyDetail>(`/api/companies/${companyId}`),
    enabled: companyId != null,
  });

  const rows = data?.rows ?? [];
  const total = data?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function openRow(row: DirectoryRow) {
    if (row.company_id) {
      setCompanyId(row.company_id);
      return;
    }
    if (row.rider_id) navigate(`/leases?rider=${row.rider_id}`);
  }

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Companies and people directory — MARK Contacts and later CRM imports. Lease OL contacts stay on each rider."
      />

      <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <ClearableSearchInput
            placeholder="Search company, person, mark, email…"
            value={searchInput}
            onChange={setSearchInput}
            testId="directory-search"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={includeIndustry}
              onCheckedChange={(v) => setIncludeIndustry(v === true)}
            />
            Include industry / competitors
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <FacetSelect label="Relationship" value={relationshipType} options={facets?.relationship_type ?? []} onChange={setRelationshipType} />
          <FacetSelect label="Priority" value={priorityTier} options={facets?.priority_tier ?? []} onChange={setPriorityTier} />
          <FacetSelect label="Status" value={status} options={facets?.status ?? []} onChange={setStatus} />
          <FacetSelect label="State" value={state} options={facets?.state ?? []} onChange={setState} />
          <FacetSelect label="Source" value={source} options={facets?.source ?? []} onChange={setSource} />
        </div>

        <div className="text-xs text-muted-foreground font-mono-num">
          {isLoading ? "Loading…" : `${total.toLocaleString()} result${total === 1 ? "" : "s"}`}
          {q ? ` for “${q}”` : " · alphabetical"}
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground italic py-8 text-center">
            {q ? "No directory matches." : "No companies in the directory yet."}
          </div>
        )}

        {!isLoading && rows.map((row) => (
          <button
            key={`${row.result_kind}-${row.company_id ?? "x"}-${row.contact_id ?? "x"}-${row.rider_id ?? "x"}`}
            type="button"
            className="w-full text-left rounded-lg border border-card-border bg-card px-4 py-3 hover:border-primary/30 transition-colors"
            onClick={() => openRow(row)}
            data-testid={`directory-row-${row.contact_id ?? row.company_id}`}
          >
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <DirectoryBadgeChip badge={row.badge} />
                  <span className="font-medium text-sm">{row.company_name || "Lease OL contact"}</span>
                  {row.reporting_marks && row.reporting_marks.length > 0 && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {row.reporting_marks.slice(0, 6).join(" · ")}
                      {row.reporting_marks.length > 6 ? "…" : ""}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-sm">
                  {row.contact_name || "—"}
                  {row.title ? <span className="text-muted-foreground"> · {row.title}</span> : null}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                  {row.email && (
                    <a href={`mailto:${row.email}`} onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <Mail className="h-3 w-3" />{row.email}
                    </a>
                  )}
                  {(row.phone || row.mobile) && (
                    <a href={`tel:${row.phone || row.mobile}`} onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <Phone className="h-3 w-3" />{row.phone || row.mobile}
                    </a>
                  )}
                  {(row.city || row.state) && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />{[row.city, row.state].filter(Boolean).join(", ")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        ))}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <div className="text-xs text-muted-foreground font-mono-num">Page {page} / {totalPages}</div>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>

      <Sheet open={companyId != null} onOpenChange={(o) => { if (!o) setCompanyId(null); }}>
        <SheetContent side="right" className="sm:max-w-xl overflow-y-auto">
          {detailLoading && <Skeleton className="h-40 rounded-lg" />}
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>{detail.name}</SheetTitle>
                <SheetDescription className="flex flex-wrap gap-2 items-center">
                  <DirectoryBadgeChip
                    badge={
                      detail.account_id ? "customer"
                        : detail.relationship_type === "prospect" ? "prospect"
                        : detail.relationship_type === "lessor" || detail.relationship_type === "railroad" ? "lessor"
                        : "unclassified"
                    }
                  />
                  <span>{detail.source}</span>
                  {detail.status ? <span>· {detail.status}</span> : null}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-5 text-sm">
                {detail.reporting_marks && detail.reporting_marks.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Reporting marks</div>
                    <div className="font-mono text-xs">{detail.reporting_marks.join(" · ")}</div>
                  </div>
                )}
                {detail.notes && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Notes</div>
                    <p className="text-muted-foreground whitespace-pre-wrap">{detail.notes}</p>
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                    Contacts ({detail.contacts.length})
                  </div>
                  <div className="space-y-3">
                    {detail.contacts.map((c) => (
                      <div key={c.id} className="rounded-md border border-border p-3">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[c.title, c.department, c.function_role].filter(Boolean).join(" · ")}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
                          {c.email && <a className="text-primary hover:underline" href={`mailto:${c.email}`}>{c.email}</a>}
                          {c.phone && <a className="text-primary hover:underline" href={`tel:${c.phone}`}>{c.phone}</a>}
                          {c.mobile && <a className="text-primary hover:underline" href={`tel:${c.mobile}`}>{c.mobile}</a>}
                        </div>
                        {(c.street || c.city) && (
                          <div className="text-xs text-muted-foreground mt-1 whitespace-pre-line">
                            {[c.street, [c.city, c.state, c.zip].filter(Boolean).join(", ")].filter(Boolean).join("\n")}
                          </div>
                        )}
                        {labeledCustomFields(c.custom_fields).length > 0 && (
                          <dl className="mt-2 grid grid-cols-1 gap-1 text-xs">
                            {labeledCustomFields(c.custom_fields).map((f) => (
                              <div key={f.label} className="grid grid-cols-[9rem_1fr] gap-2">
                                <dt className="text-muted-foreground">{f.label}</dt>
                                <dd>{f.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {detail.company_products.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Products</div>
                    <ul className="text-xs space-y-1">
                      {detail.company_products.map((p) => (
                        <li key={p.id}>{[p.product, p.commodity_family, p.car_type].filter(Boolean).join(" · ")}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
