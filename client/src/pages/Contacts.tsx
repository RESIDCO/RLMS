import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiGet, apiRequest } from "@/lib/queryClient";
import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Phone, Mail, Building2, ChevronLeft, ChevronRight, MapPin, Plus, Pencil, User, Trash2,
} from "lucide-react";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import { cn } from "@/lib/utils";
import { COMPANY_CONTACT_CUSTOM_FIELD_LABELS } from "@shared/mark-contacts-import";
import { displayLeaseNumber } from "@shared/residco-import";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import NotesSaveField from "@/components/NotesSaveField";
import ContactLeaseLinks from "@/components/ContactLeaseLinks";
import { usePermissions } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import SearchableSelect from "@/components/SearchableSelect";
import { confirmDelete } from "@/components/ConfirmActionDialog";
import { hashSearchParams } from "@/lib/hash-location";
import { readDirectoryNavState, replaceDirectoryHash } from "@/lib/directory-nav";
import { groupDirectoryPeopleById } from "@/lib/directory-people-group";

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
  lease_lessee?: string | null;
  lease_number?: string | null;
  rider_name?: string | null;
  is_agent_contact?: boolean;
  agent_organization_name?: string | null;
  family_parent_id?: number | null;
  family_parent_name?: string | null;
};

type DirectoryPage = {
  rows: DirectoryRow[];
  total_count: number;
  page: number;
  pageSize: number;
};

type LeaseTiedPerson = {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  company_id: number | null;
  company_name: string | null;
  rider_id: number | null;
  via_company?: boolean;
  master_lease?: { lease_number: string | null; lessee: string | null } | null;
  rider?: { rider_name: string | null; schedule_number: string | null } | null;
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
    notes?: string | null;
    source: string;
    is_agent_contact?: boolean;
    agent_organization_name?: string | null;
    agent_home_company_id?: number | null;
  }>;
  company_products: Array<{
    id: number;
    commodity_family: string | null;
    product: string | null;
    estimated_railcars: number | null;
    car_type: string | null;
  }>;
  company_fleet_stats?: Array<{
    id: number;
    car_type: string;
    fleet_size: number;
    as_of_date: string | null;
  }>;
  family_parent_id?: number | null;
  family_parent?: { id: number; name: string } | null;
  family_children?: Array<{ id: number; name: string; reporting_marks: string[] | null }>;
};

type ContactDetail = {
  id: number;
  company_id: number;
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
  linkedin_url: string | null;
  linkedin_job_title: string | null;
  function_role: string | null;
  notes: string | null;
  custom_fields: Record<string, string> | null;
  is_agent_contact?: boolean;
  agent_organization_name?: string | null;
  agent_home_company_id?: number | null;
  company?: CompanyDetail | null;
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

function viaLabel(row: DirectoryRow) {
  if (row.is_agent_contact) {
    return row.agent_organization_name ? `via ${row.agent_organization_name}` : "agent / third-party";
  }
  const leaseBits = [row.lease_lessee, displayLeaseNumber(row.lease_number), row.rider_name].filter(Boolean);
  if (leaseBits.length) return leaseBits.join(" · ");
  if (row.result_kind !== "lease_ol" && row.rider_id) return "Linked to an OL";
  return null;
}

function CompanyGroupedCards({
  rows,
  onOpenCompany,
  onOpenRow,
}: {
  rows: DirectoryRow[];
  onOpenCompany: (id: number) => void;
  onOpenRow: (row: DirectoryRow) => void;
}) {
  const [openKids, setOpenKids] = useState<Record<number, boolean>>({});
  const ol = rows.filter((r) => r.result_kind === "lease_ol");
  const rest = rows.filter((r) => r.result_kind !== "lease_ol");
  const by = new Map<number, DirectoryRow[]>();
  for (const r of rest) {
    if (!r.company_id) continue;
    const list = by.get(r.company_id) ?? [];
    list.push(r);
    by.set(r.company_id, list);
  }
  const topIds: number[] = [];
  by.forEach((list, id) => {
    const parent = list[0]?.family_parent_id;
    if (parent && by.has(parent)) return;
    topIds.push(id);
  });
  return (
    <>
      {topIds.map((id) => {
        const list = by.get(id) ?? [];
        const head = list[0];
        const childIds = Array.from(by.keys()).filter((cid) => by.get(cid)?.[0]?.family_parent_id === id);
        const own = list.filter((r) => r.contact_id);
        return (
          <div key={id} className="rounded-lg border border-card-border bg-card px-4 py-3">
            <button type="button" className="w-full text-left" onClick={() => onOpenCompany(id)}>
              <div className="flex items-center gap-2 flex-wrap">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <DirectoryBadgeChip badge={head.badge} />
                <span className="font-medium text-sm">{head.company_name}</span>
                {childIds.length > 0 && (
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {childIds.length + 1} entities
                  </span>
                )}
              </div>
            </button>
            {head.family_parent_name && (
              <div className="text-xs text-muted-foreground mt-1">Part of {head.family_parent_name}</div>
            )}
            <div className="mt-2 space-y-1">
              {own.slice(0, 4).map((r) => (
                <button key={r.contact_id} type="button" className="block text-left text-sm w-full hover:underline" onClick={() => onOpenRow(r)}>
                  {r.contact_name}
                  {r.title ? <span className="text-muted-foreground"> · {r.title}</span> : null}
                  {viaLabel(r) ? <span className="text-muted-foreground"> · {viaLabel(r)}</span> : null}
                </button>
              ))}
              {own.length > 4 && <div className="text-xs text-muted-foreground">+{own.length - 4} more</div>}
            </div>
            {childIds.length > 0 && (
              <div className="mt-2">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpenKids((s) => ({ ...s, [id]: !s[id] }))}>
                  {openKids[id] ? "Hide locations" : `Locations (${childIds.length})`}
                </Button>
                {openKids[id] && childIds.map((cid) => {
                  const cl = by.get(cid) ?? [];
                  return (
                    <button key={cid} type="button" className="block w-full text-left text-xs pl-4 py-1 hover:underline" onClick={() => onOpenCompany(cid)}>
                      {cl[0]?.company_name} · {cl.filter((x) => x.contact_id).length} people
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {ol.map((row) => (
        <button
          key={`ol-${row.contact_id}-${row.rider_id}`}
          type="button"
          className="w-full text-left rounded-lg border border-card-border bg-card px-4 py-3"
          onClick={() => onOpenRow(row)}
        >
          <DirectoryBadgeChip badge="lease_ol" /> {row.contact_name}
        </button>
      ))}
    </>
  );
}

export default function Contacts() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEditContacts, canDeleteContacts } = usePermissions();
  const boot = useMemo(() => readDirectoryNavState(), []);
  const [viewMode, setViewMode] = useState<"company" | "people">(boot.people ? "people" : "company");
  const [searchInput, setSearchInput] = useState(boot.q);
  const [q, setQ] = useState(boot.q);
  const [page, setPage] = useState(1);
  const [includeIndustry, setIncludeIndustry] = useState(false);
  const [leaseTiedOnly, setLeaseTiedOnly] = useState(boot.leaseTied);
  const [relationshipType, setRelationshipType] = useState("");
  const [priorityTier, setPriorityTier] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [state, setState] = useState("");
  const [companyId, setCompanyId] = useState<number | null>(boot.companyId);
  const [contactId, setContactId] = useState<number | null>(boot.contactId);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(Boolean(boot.addContact));
  const [editCompanyOpen, setEditCompanyOpen] = useState(false);
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

  useEffect(() => {
    replaceDirectoryHash({
      q,
      companyId,
      contactId,
      people: viewMode === "people",
      leaseTied: leaseTiedOnly,
    });
  }, [q, companyId, contactId, viewMode, leaseTiedOnly]);

  useEffect(() => {
    const apply = () => {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
      const pathOnly = hash.split("?")[0] || "/";
      if (pathOnly !== "/contacts") return;
      const next = readDirectoryNavState(hashSearchParams());
      setSearchInput(next.q);
      setQ(next.q);
      setCompanyId(next.companyId);
      setContactId(next.contactId);
      setViewMode(next.people ? "people" : "company");
      setLeaseTiedOnly(next.leaseTied);
      if (next.addContact) setAddContactOpen(true);
    };
    window.addEventListener("hashchange", apply);
    window.addEventListener("popstate", apply);
    return () => {
      window.removeEventListener("hashchange", apply);
      window.removeEventListener("popstate", apply);
    };
  }, []);

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

  const { data: leaseTiedPeople = [], isLoading: leaseTiedLoading } = useQuery<LeaseTiedPerson[]>({
    queryKey: ["/api/contacts"],
    queryFn: () => apiGet<LeaseTiedPerson[]>("/api/contacts"),
    enabled: leaseTiedOnly,
  });

  const { data: leaseGapSummary } = useQuery<{ linked_leases: number; unmatched_leases: number }>({
    queryKey: ["/api/directory-lease-gaps", "banner"],
    queryFn: () => apiGet("/api/directory-lease-gaps?limit=1"),
  });

  const { data: detail, isLoading: detailLoading } = useQuery<CompanyDetail>({
    queryKey: ["/api/companies", companyId],
    queryFn: () => apiGet<CompanyDetail>(`/api/companies/${companyId}`),
    enabled: companyId != null,
  });

  const { data: person, isLoading: personLoading } = useQuery<ContactDetail>({
    queryKey: ["/api/company-contacts", contactId],
    queryFn: () => apiGet<ContactDetail>(`/api/company-contacts/${contactId}`),
    enabled: contactId != null,
  });

  const rows = data?.rows ?? [];
  const total = data?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const leaseTiedFiltered = useMemo(() => {
    const n = q.toLowerCase();
    if (!n) return leaseTiedPeople;
    return leaseTiedPeople.filter((p) =>
      [p.name, p.company_name, p.email, p.title, p.master_lease?.lessee, p.master_lease?.lease_number, p.rider?.rider_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(n),
    );
  }, [leaseTiedPeople, q]);
  const leaseTiedGrouped = useMemo(
    () => groupDirectoryPeopleById(leaseTiedFiltered),
    [leaseTiedFiltered],
  );

  function invalidateDir() {
    qc.invalidateQueries({ queryKey: ["/api/directory-search"] });
    qc.invalidateQueries({ queryKey: ["/api/companies", companyId] });
    qc.invalidateQueries({ queryKey: ["/api/company-contacts", contactId] });
    qc.invalidateQueries({ queryKey: ["/api/contacts"] });
  }

  function openRow(row: DirectoryRow) {
    if (row.result_kind !== "lease_ol" && row.contact_id) {
      setCompanyId(row.company_id);
      setContactId(row.contact_id);
      return;
    }
    if (row.company_id) {
      setContactId(null);
      setCompanyId(row.company_id);
      return;
    }
    if (row.rider_id) navigate(`/leases?rider=${row.rider_id}`);
  }

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Searchable directory of companies and people. Add a contact on an OL and it lives here, linked to that lease."
      />

      <div className="px-4 sm:px-8 py-4 sm:py-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <ClearableSearchInput
            placeholder="Search company, person, mark, email…"
            value={searchInput}
            onChange={setSearchInput}
            testId="directory-search"
          />
          {canEditContacts && (
            <>
              <Button size="sm" className="gap-1" onClick={() => setAddCompanyOpen(true)}><Plus className="h-3.5 w-3.5" /> Add company</Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setAddContactOpen(true)}><Plus className="h-3.5 w-3.5" /> Add contact</Button>
            </>
          )}
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <Button size="sm" variant={viewMode === "company" ? "default" : "ghost"} className="rounded-none h-8" onClick={() => setViewMode("company")}>By Company</Button>
            <Button size="sm" variant={viewMode === "people" ? "default" : "ghost"} className="rounded-none h-8" onClick={() => setViewMode("people")}>By People</Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => navigate("/contacts/review")}>Review queue</Button>
          <Button size="sm" variant="ghost" onClick={() => navigate("/contacts/review?tab=leases")}>Lease links</Button>
          {canEditContacts && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  const res = await apiRequest("POST", "/api/contacts/promote-legacy", {});
                  const out = await res.json();
                  invalidateDir();
                  toast({ title: `Moved ${out.promoted ?? 0} OL contacts into the directory` });
                } catch (e: any) {
                  toast({ title: "Promote failed", description: e.message, variant: "destructive" });
                }
              }}
            >
              Import leftover OL contacts
            </Button>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={includeIndustry}
              onCheckedChange={(v) => setIncludeIndustry(v === true)}
            />
            Include industry / competitors
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={leaseTiedOnly}
              onCheckedChange={(v) => setLeaseTiedOnly(v === true)}
            />
            On a lease
          </label>
        </div>

        <div className="flex flex-wrap gap-3">
          <FacetSelect label="Relationship" value={relationshipType} options={facets?.relationship_type ?? []} onChange={setRelationshipType} />
          <FacetSelect label="Priority" value={priorityTier} options={facets?.priority_tier ?? []} onChange={setPriorityTier} />
          <FacetSelect label="Status" value={status} options={facets?.status ?? []} onChange={setStatus} />
          <FacetSelect label="State" value={state} options={facets?.state ?? []} onChange={setState} />
          <FacetSelect label="Source" value={source} options={facets?.source ?? []} onChange={setSource} />
        </div>

        {leaseGapSummary && leaseGapSummary.unmatched_leases > 0 && (
          <button
            type="button"
            className="w-full text-left rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30"
            onClick={() => navigate("/contacts/review?tab=leases")}
          >
            {leaseGapSummary.linked_leases.toLocaleString()} leases tied to a directory company · {leaseGapSummary.unmatched_leases.toLocaleString()} still unmatched. Open lease links to attach people to the rest.
          </button>
        )}

        <div className="text-xs text-muted-foreground font-mono-num">
          {leaseTiedOnly
            ? (leaseTiedLoading ? "Loading…" : `${leaseTiedGrouped.length.toLocaleString()} people on a linked lease`)
            : (isLoading ? "Loading…" : `${total.toLocaleString()} result${total === 1 ? "" : "s"}`)}
          {q ? ` for “${q}”` : leaseTiedOnly ? "" : " · alphabetical"}
        </div>

        {leaseTiedOnly && leaseTiedLoading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] rounded-lg" />
            ))}
          </div>
        )}

        {leaseTiedOnly && !leaseTiedLoading && leaseTiedGrouped.length === 0 && (
          <div className="text-sm text-muted-foreground italic py-8 text-center">
            No directory people are linked to a lease yet.
          </div>
        )}

        {leaseTiedOnly && !leaseTiedLoading && leaseTiedGrouped.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left rounded-lg border border-card-border bg-card px-4 py-3 hover:border-primary/30 transition-colors"
              onClick={() => { setCompanyId(p.company_id); setContactId(p.id); }}
            >
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{p.name}</span>
                    {p.via_company && <span className="text-[11px] text-muted-foreground">Via company on lease</span>}
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {p.company_name || "Company"}
                    {p.title ? ` · ${p.title}` : ""}
                  </div>
                  {p.leases.length > 0 ? (
                    <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
                      {p.leases.map((l) => <div key={l}>{l}</div>)}
                    </div>
                  ) : null}
                </div>
              </div>
            </button>
        ))}

        {!leaseTiedOnly && isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] rounded-lg" />
            ))}
          </div>
        )}

        {!leaseTiedOnly && !isLoading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground italic py-8 text-center">
            {q ? "No directory matches." : "No companies in the directory yet."}
          </div>
        )}

        {!leaseTiedOnly && !isLoading && viewMode === "company" && rows.length > 0 && (
          <div className="space-y-2">
            <CompanyGroupedCards
              rows={rows}
              onOpenCompany={(id) => { setContactId(null); setCompanyId(id); }}
              onOpenRow={openRow}
            />
          </div>
        )}

        {!leaseTiedOnly && !isLoading && viewMode === "people" && rows.map((row) => (
          <button
            key={`${row.result_kind}-${row.company_id ?? "x"}-${row.contact_id ?? "x"}-${row.rider_id ?? "x"}`}
            type="button"
            className="w-full text-left rounded-lg border border-card-border bg-card px-4 py-3 hover:border-primary/30 transition-colors"
            onClick={() => openRow(row)}
            data-testid={`directory-row-${row.contact_id ?? row.company_id}`}
          >
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <DirectoryBadgeChip badge={row.badge} />
                  <span className="font-medium text-sm">{row.contact_name || row.company_name || "Lease OL contact"}</span>
                  {viaLabel(row) && <span className="text-[11px] text-muted-foreground">{viaLabel(row)}</span>}
                </div>
                <div className="mt-0.5 text-sm">
                  <button type="button" className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); if (row.company_id) { setContactId(null); setCompanyId(row.company_id); } }}>
                    {row.company_name || "Lease OL"}
                  </button>
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

        {!leaseTiedOnly && totalPages > 1 && (
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

      <Sheet
        open={companyId != null && contactId == null}
        onOpenChange={(o) => { if (!o) setCompanyId(null); }}
      >
        <SheetContent side="right" className="sm:max-w-xl overflow-y-auto">
          {detailLoading && <Skeleton className="h-40 rounded-lg" />}
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>{detail.name}</SheetTitle>
                <SheetDescription className="flex flex-wrap gap-2 items-center">
                  {detail.family_parent && (
                    <button type="button" className="text-primary hover:underline" onClick={() => setCompanyId(detail.family_parent!.id)}>
                      Part of {detail.family_parent.name}
                    </button>
                  )}
                  <DirectoryBadgeChip
                    badge={
                      detail.account_id ? "customer"
                        : detail.relationship_type === "prospect" ? "prospect"
                        : detail.relationship_type === "lessor" || detail.relationship_type === "railroad" ? "lessor"
                        : "unclassified"
                    }
                  />
                  <span>{detail.source}</span>
                  {detail.priority_tier ? <span>· {detail.priority_tier}</span> : null}
                  {detail.status ? <span>· {detail.status}</span> : null}
                </SheetDescription>
              </SheetHeader>
              {canEditContacts && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditCompanyOpen(true)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit company
                  </Button>
                  <Button size="sm" className="gap-1" onClick={() => setAddContactOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Add contact
                  </Button>
                </div>
              )}
              <div className="mt-4 space-y-6 text-sm">
                {detail.reporting_marks && detail.reporting_marks.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Reporting marks</div>
                    <div className="font-mono text-xs">{detail.reporting_marks.join(" · ")}</div>
                  </div>
                )}
                <NotesSaveField
                  value={detail.notes}
                  disabled={!canEditContacts}
                  onSave={async (v) => {
                    await apiRequest("PATCH", `/api/companies/${detail.id}`, { notes: v });
                    invalidateDir();
                    toast({ title: "Notes saved" });
                  }}
                />
                <div>
                  {(() => {
                    const staff = detail.contacts.filter((c) => !c.is_agent_contact);
                    const agents = detail.contacts.filter((c) => c.is_agent_contact);
                    return (
                      <>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                          Contacts ({staff.length})
                        </div>
                        <div className="space-y-2">
                          {staff.map((c) => (
                            <button key={c.id} type="button" className="w-full text-left rounded-md border border-border p-3 hover:bg-muted/40" onClick={() => setContactId(c.id)}>
                              <div className="font-medium flex items-center gap-2"><User className="h-3.5 w-3.5" /> {c.name}</div>
                              <div className="text-xs text-muted-foreground">{[c.title, c.department, c.function_role].filter(Boolean).join(" · ")}</div>
                              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
                                {c.email && <span>{c.email}</span>}
                                {c.phone && <span>{c.phone}</span>}
                              </div>
                            </button>
                          ))}
                          {staff.length === 0 && <p className="text-xs text-muted-foreground italic">No in-house people on this company yet.</p>}
                        </div>
                        {agents.length > 0 && (
                          <div className="mt-4">
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                              Agents / Third-Party Contacts ({agents.length})
                            </div>
                            <div className="space-y-2">
                              {agents.map((c) => (
                                <button key={c.id} type="button" className="w-full text-left rounded-md border border-dashed border-border p-3 hover:bg-muted/40" onClick={() => setContactId(c.id)}>
                                  <div className="font-medium">{c.name}{c.agent_organization_name ? ` — via ${c.agent_organization_name}` : ""}</div>
                                  <div className="text-xs text-muted-foreground">{c.email}</div>
                                  {c.agent_home_company_id && (
                                    <button type="button" className="text-xs text-primary hover:underline mt-1" onClick={(e) => { e.stopPropagation(); setCompanyId(c.agent_home_company_id!); setContactId(null); }}>
                                      Open {c.agent_organization_name}
                                    </button>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                {detail.family_children && detail.family_children.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Locations</div>
                    <div className="space-y-1">
                      {detail.family_children.map((ch) => (
                        <button key={ch.id} type="button" className="block text-left text-sm hover:underline" onClick={() => setCompanyId(ch.id)}>
                          {ch.name}
                          {ch.reporting_marks?.length ? <span className="text-xs text-muted-foreground"> · {ch.reporting_marks.join(" · ")}</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <FleetProductsSection
                  products={detail.company_products}
                  fleet={detail.company_fleet_stats ?? []}
                />
                <ContactLeaseLinks
                  mode="company"
                  companyId={detail.id}
                  contacts={detail.contacts.map((c) => ({ id: c.id, name: c.name }))}
                  canAdd={canEditContacts}
                  canRemove={canEditContacts}
                />
                <AttachmentsPanel entityType="company" entityId={detail.id} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={contactId != null}
        onOpenChange={(o) => { if (!o) setContactId(null); }}
      >
        <SheetContent side="right" className="sm:max-w-xl overflow-y-auto">
          {personLoading && <Skeleton className="h-40 rounded-lg" />}
          {person && (
            <ContactDetailSheet
              person={person}
              canEdit={canEditContacts}
              canDelete={canDeleteContacts}
              onBackToCompany={() => {
                setCompanyId(person.company_id);
                setContactId(null);
              }}
              onOpenCompany={(id) => { setContactId(null); setCompanyId(id); }}
              onSaved={invalidateDir}
            />
          )}
        </SheetContent>
      </Sheet>

      <AddCompanyDialog
        open={addCompanyOpen}
        onOpenChange={setAddCompanyOpen}
        onCreated={(id) => {
          invalidateDir();
          setAddCompanyOpen(false);
          setContactId(null);
          setCompanyId(id);
        }}
      />
      <AddContactDialog
        open={addContactOpen}
        onOpenChange={setAddContactOpen}
        defaultCompanyId={companyId}
        onCreated={(id, cid) => {
          invalidateDir();
          setAddContactOpen(false);
          setCompanyId(cid);
          setContactId(id);
        }}
      />
      {detail && (
        <EditCompanyDialog
          open={editCompanyOpen}
          onOpenChange={setEditCompanyOpen}
          company={detail}
          onSaved={() => {
            invalidateDir();
            setEditCompanyOpen(false);
          }}
        />
      )}
    </div>
  );
}

function FleetProductsSection({
  products,
  fleet,
}: {
  products: CompanyDetail["company_products"];
  fleet: NonNullable<CompanyDetail["company_fleet_stats"]>;
}) {
  const empty = products.length === 0 && fleet.length === 0;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Fleet &amp; Products</div>
      {empty && (
        <p className="text-xs text-muted-foreground italic">
          No product lines or fleet stats yet. These fill in after the Company &amp; Product and Lessors imports.
        </p>
      )}
      {products.length > 0 && (
        <table className="w-full text-xs mb-3">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">Commodity</th>
              <th className="py-1 font-normal">Product</th>
              <th className="py-1 font-normal">Car type</th>
              <th className="py-1 font-normal text-right">Est. cars</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="py-1">{p.commodity_family || "—"}</td>
                <td className="py-1">{p.product || "—"}</td>
                <td className="py-1">{p.car_type || "—"}</td>
                <td className="py-1 text-right font-mono-num">{p.estimated_railcars ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {fleet.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-normal">Car type</th>
              <th className="py-1 font-normal text-right">Fleet size</th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((f) => (
              <tr key={f.id} className="border-t border-border">
                <td className="py-1">{f.car_type}</td>
                <td className="py-1 text-right font-mono-num">{f.fleet_size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ContactDetailSheet({
  person,
  canEdit,
  canDelete,
  onBackToCompany,
  onOpenCompany,
  onSaved,
}: {
  person: ContactDetail;
  canEdit: boolean;
  canDelete?: boolean;
  onBackToCompany: () => void;
  onOpenCompany?: (id: number) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: person.name ?? "",
    title: person.title ?? "",
    department: person.department ?? "",
    email: person.email ?? "",
    phone: person.phone ?? "",
    mobile: person.mobile ?? "",
    alt_phone: person.alt_phone ?? "",
    street: person.street ?? "",
    city: person.city ?? "",
    state: person.state ?? "",
    zip: person.zip ?? "",
    function_role: person.function_role ?? "",
    linkedin_url: person.linkedin_url ?? "",
    linkedin_job_title: person.linkedin_job_title ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      name: person.name ?? "",
      title: person.title ?? "",
      department: person.department ?? "",
      email: person.email ?? "",
      phone: person.phone ?? "",
      mobile: person.mobile ?? "",
      alt_phone: person.alt_phone ?? "",
      street: person.street ?? "",
      city: person.city ?? "",
      state: person.state ?? "",
      zip: person.zip ?? "",
      function_role: person.function_role ?? "",
      linkedin_url: person.linkedin_url ?? "",
      linkedin_job_title: person.linkedin_job_title ?? "",
    });
  }, [person.id]);

  async function saveFields() {
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/company-contacts/${person.id}`, form);
      onSaved();
      toast({ title: "Contact saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<{ key: keyof typeof form; label: string }> = [
    { key: "name", label: "Name" },
    { key: "title", label: "Title" },
    { key: "department", label: "Department" },
    { key: "function_role", label: "Function / role" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "mobile", label: "Mobile" },
    { key: "alt_phone", label: "Alt phone" },
    { key: "street", label: "Street" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "zip", label: "ZIP" },
    { key: "linkedin_job_title", label: "LinkedIn title" },
    { key: "linkedin_url", label: "LinkedIn URL" },
  ];

  return (
    <>
      <SheetHeader>
        <SheetTitle>{person.name}</SheetTitle>
        <SheetDescription>
          {person.company?.name ?? "Contact"}
          {person.title ? ` · ${person.title}` : ""}
        </SheetDescription>
      </SheetHeader>
      {person.is_agent_contact && (
        <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          This person is a contact via {person.agent_organization_name || "a third party"}, not {person.company?.name || "this company"}'s own staff.
          {person.agent_home_company_id && onOpenCompany && (
            <button type="button" className="block text-primary hover:underline mt-1" onClick={() => onOpenCompany(person.agent_home_company_id!)}>
              Open {person.agent_organization_name}
            </button>
          )}
        </div>
      )}
      <Button variant="ghost" size="sm" className="mt-2 px-0" onClick={onBackToCompany}>
        ← Back to company
      </Button>
      <div className="mt-4 space-y-5 text-sm">
        <div className="grid grid-cols-1 gap-3">
          {fields.map((f) => (
            <label key={f.key} className="block">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{f.label}</div>
              <Input
                value={form[f.key]}
                disabled={!canEdit}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => void saveFields()} disabled={saving}>
            {saving ? "Saving…" : "Save fields"}
          </Button>
        )}
        {canDelete && (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={async () => {
              const ok = await confirmDelete({
                title: `Delete contact “${person.name}”?`,
                description: "This removes them from the directory and unlinks them from every lease.",
              });
              if (!ok) return;
              try {
                await apiRequest("DELETE", `/api/company-contacts/${person.id}`);
                onBackToCompany();
                onSaved();
                toast({ title: "Contact deleted" });
              } catch (e: any) {
                toast({ title: "Delete failed", description: e.message, variant: "destructive" });
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete contact
          </Button>
        )}
        {labeledCustomFields(person.custom_fields).length > 0 && (
          <dl className="grid grid-cols-1 gap-1 text-xs">
            {labeledCustomFields(person.custom_fields).map((f) => (
              <div key={f.label} className="grid grid-cols-[9rem_1fr] gap-2">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <NotesSaveField
          value={person.notes}
          disabled={!canEdit}
          onSave={async (v) => {
            await apiRequest("PATCH", `/api/company-contacts/${person.id}`, { notes: v });
            onSaved();
            toast({ title: "Notes saved" });
          }}
        />
        <ContactLeaseLinks mode="contact" contactId={person.id} canAdd={canEdit} canRemove={canEdit} />
        <AttachmentsPanel entityType="company_contact" entityId={person.id} />
      </div>
    </>
  );
}

function AddCompanyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("unclassified");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/companies", { name, relationship_type: relationship });
      const row = await res.json();
      onCreated(row.id);
      setName("");
    } catch (e: any) {
      toast({ title: "Could not create company", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add company</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Relationship</div>
            <Select value={relationship} onValueChange={setRelationship}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["unclassified", "prospect", "lessor", "railroad", "vendor", "other"].map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || busy} onClick={() => void submit()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddContactDialog({
  open,
  onOpenChange,
  defaultCompanyId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultCompanyId: number | null;
  onCreated: (id: number, companyId: number) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [companyId, setCompanyId] = useState(defaultCompanyId ? String(defaultCompanyId) : "");
  const [mlaId, setMlaId] = useState("");
  const [olId, setOlId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCompanyId(defaultCompanyId ? String(defaultCompanyId) : "");
      setMlaId("");
      setOlId("");
    }
  }, [open, defaultCompanyId]);

  const { data: companies } = useQuery<{ rows: Array<{ id: number; name: string }> }>({
    queryKey: ["/api/companies", companySearch],
    queryFn: () => apiGet(`/api/companies?page=1&pageSize=40${companySearch ? `&search=${encodeURIComponent(companySearch)}` : ""}`),
    enabled: open,
  });

  const { data: leases = [] } = useQuery<Array<{
    id: number;
    lease_number: string | null;
    lessee: string | null;
    riders?: Array<{ id: number; rider_name: string | null; schedule_number: string | null }>;
  }>>({
    queryKey: ["/api/leases"],
    enabled: open,
  });
  const riders = leases.find((l) => String(l.id) === mlaId)?.riders ?? [];

  async function submit() {
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/company-contacts", {
        name,
        title: title || null,
        email: email || null,
        phone: phone || null,
        company_id: Number(companyId),
      });
      const row = await res.json();
      if (mlaId) {
        await apiRequest("POST", `/api/company-contacts/${row.id}/lease-links`, {
          master_lease_id: Number(mlaId),
          rider_id: olId ? Number(olId) : null,
        });
      }
      onCreated(row.id, Number(companyId));
      setName("");
      setTitle("");
      setEmail("");
      setPhone("");
    } catch (e: any) {
      toast({ title: "Could not create contact", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add contact</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Title</div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Email</div>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Phone</div>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Company</div>
            <Input
              className="mb-2 h-8 text-xs"
              placeholder="Filter companies…"
              value={companySearch}
              onChange={(e) => setCompanySearch(e.target.value)}
            />
            <SearchableSelect
              value={companyId}
              onChange={setCompanyId}
              options={(companies?.rows ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
              placeholder="Select company…"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Lease (optional)</div>
            <SearchableSelect
              value={mlaId}
              onChange={(v) => { setMlaId(v); setOlId(""); }}
              options={leases.map((l) => ({
                value: String(l.id),
                label: displayLeaseNumber(l.lease_number) || `MLA ${l.id}`,
                hint: l.lessee ?? undefined,
                keywords: [l.lease_number, l.lessee].filter(Boolean).join(" "),
              }))}
              placeholder="MLA…"
              searchPlaceholder="Lessee or lease…"
            />
            <div className="mt-2">
              <SearchableSelect
                value={olId}
                onChange={setOlId}
                options={riders.map((r) => ({
                  value: String(r.id),
                  label: r.rider_name || r.schedule_number || `OL ${r.id}`,
                }))}
                placeholder="OL (optional)…"
                disabled={!mlaId}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || !companyId || busy} onClick={() => void submit()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCompanyDialog({
  open,
  onOpenChange,
  company,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  company: CompanyDetail;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(company.name);
  const [relationship, setRelationship] = useState(
    company.relationship_type === "customer" ? "customer" : company.relationship_type,
  );
  const [priority, setPriority] = useState(company.priority_tier || "");
  const [status, setStatus] = useState(company.status || "target");
  const [busy, setBusy] = useState(false);
  const isCustomer = company.relationship_type === "customer" || company.account_id != null;

  useEffect(() => {
    setName(company.name);
    setRelationship(company.relationship_type);
    setPriority(company.priority_tier || "");
    setStatus(company.status || "target");
  }, [company.id, open]);

  async function submit() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name, priority_tier: priority || null, status };
      if (!isCustomer) body.relationship_type = relationship;
      await apiRequest("PATCH", `/api/companies/${company.id}`, body);
      onSaved();
    } catch (e: any) {
      toast({ title: "Could not save company", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit company</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Relationship</div>
            <Select value={relationship} onValueChange={setRelationship} disabled={isCustomer}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(isCustomer ? ["customer"] : ["unclassified", "prospect", "lessor", "railroad", "vendor", "other"]).map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Priority</div>
            <Select value={priority || "__none__"} onValueChange={(v) => setPriority(v === "__none__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {["A", "B", "C", "D"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Status</div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["target", "contacted", "in_discussion", "lost", "won"].map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <DialogFooter>
          <Button disabled={!name.trim() || busy} onClick={() => void submit()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
