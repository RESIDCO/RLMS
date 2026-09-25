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
  Phone, Mail, Building2, ChevronLeft, ChevronRight, MapPin, Plus, Pencil, User,
} from "lucide-react";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import { cn } from "@/lib/utils";
import { COMPANY_CONTACT_CUSTOM_FIELD_LABELS } from "@shared/mark-contacts-import";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import NotesSaveField from "@/components/NotesSaveField";
import ContactLeaseLinks from "@/components/ContactLeaseLinks";
import { usePermissions } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import SearchableSelect from "@/components/SearchableSelect";

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
    notes?: string | null;
    source: string;
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

export default function Contacts() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEditContacts } = usePermissions();
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
  const [contactId, setContactId] = useState<number | null>(null);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(false);
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

  const { data: person, isLoading: personLoading } = useQuery<ContactDetail>({
    queryKey: ["/api/company-contacts", contactId],
    queryFn: () => apiGet<ContactDetail>(`/api/company-contacts/${contactId}`),
    enabled: contactId != null,
  });

  const rows = data?.rows ?? [];
  const total = data?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function invalidateDir() {
    qc.invalidateQueries({ queryKey: ["/api/directory-search"] });
    qc.invalidateQueries({ queryKey: ["/api/companies", companyId] });
    qc.invalidateQueries({ queryKey: ["/api/company-contacts", contactId] });
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
          {canEditContacts && (
            <>
              <Button size="sm" className="gap-1" onClick={() => setAddCompanyOpen(true)}><Plus className="h-3.5 w-3.5" /> Add company</Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setAddContactOpen(true)}><Plus className="h-3.5 w-3.5" /> Add contact</Button>
            </>
          )}
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
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                    Contacts ({detail.contacts.length})
                  </div>
                  <div className="space-y-2">
                    {detail.contacts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left rounded-md border border-border p-3 hover:bg-muted/40"
                        onClick={() => setContactId(c.id)}
                      >
                        <div className="font-medium flex items-center gap-2"><User className="h-3.5 w-3.5" /> {c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[c.title, c.department, c.function_role].filter(Boolean).join(" · ")}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
                          {c.email && <span>{c.email}</span>}
                          {c.phone && <span>{c.phone}</span>}
                        </div>
                      </button>
                    ))}
                    {detail.contacts.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">No people on this company yet.</p>
                    )}
                  </div>
                </div>
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
              onBackToCompany={() => {
                setCompanyId(person.company_id);
                setContactId(null);
              }}
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
  onBackToCompany,
  onSaved,
}: {
  person: ContactDetail;
  canEdit: boolean;
  onBackToCompany: () => void;
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
  const [companySearch, setCompanySearch] = useState("");
  const [companyId, setCompanyId] = useState(defaultCompanyId ? String(defaultCompanyId) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setCompanyId(defaultCompanyId ? String(defaultCompanyId) : "");
  }, [open, defaultCompanyId]);

  const { data: companies } = useQuery<{ rows: Array<{ id: number; name: string }> }>({
    queryKey: ["/api/companies", companySearch],
    queryFn: () => apiGet(`/api/companies?page=1&pageSize=40${companySearch ? `&search=${encodeURIComponent(companySearch)}` : ""}`),
    enabled: open,
  });

  async function submit() {
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/company-contacts", {
        name,
        company_id: Number(companyId),
      });
      const row = await res.json();
      onCreated(row.id, Number(companyId));
      setName("");
    } catch (e: any) {
      toast({ title: "Could not create contact", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add contact</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Name</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
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
