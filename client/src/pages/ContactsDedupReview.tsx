import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { hashSearchParams } from "@/lib/hash-location";
import { isDirectoryLeaseReviewTab } from "@/lib/directory-review-tab";
import { apiGet, apiRequest } from "@/lib/queryClient";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/lib/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { displayLeaseNumber } from "@shared/residco-import";

type Candidate = {
  id: number;
  kind: "agent_contact" | "company_family" | "company_duplicate";
  status: string;
  email: string | null;
  signal: string;
  confidence: number | null;
  note: string | null;
  agent_organization_name: string | null;
  agent_home_company_id: number | null;
  company_id_a: number | null;
  company_id_b: number | null;
  company_a: { id: number; name: string; reporting_marks: string[] | null } | null;
  company_b: { id: number; name: string; reporting_marks: string[] | null } | null;
  home_company: { id: number; name: string } | null;
  contact: { id: number; name: string; email: string | null } | null;
};

type LeaseGap = {
  master_lease_id: number;
  lessee: string;
  lease_number: string | null;
  candidates: Array<{ id: number; name: string }>;
};

type LeaseGapPage = {
  rows: LeaseGap[];
  unmatched_other: LeaseGap[];
  unmatched_other_total: number;
  unmatched_other_offset: number;
  linked_leases: number;
  unmatched_leases: number;
  suggestions: number;
};

function CompanySearchLink({
  masterLeaseId,
  disabled,
  onLinked,
}: {
  masterLeaseId: number;
  disabled: boolean;
  onLinked: (companyId: number) => void;
}) {
  const [q, setQ] = useState("");
  const { data } = useQuery<{ rows: Array<{ id: number; name: string }> }>({
    queryKey: ["/api/companies", q, masterLeaseId],
    queryFn: () => apiGet(`/api/companies?page=1&pageSize=12${q.trim() ? `&search=${encodeURIComponent(q.trim())}` : ""}`),
    enabled: q.trim().length >= 2,
  });
  return (
    <div className="space-y-1 w-full max-w-md">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search directory company…"
        disabled={disabled}
        className="h-8 text-xs"
      />
      {q.trim().length >= 2 && (
        <div className="flex flex-wrap gap-1">
          {(data?.rows ?? []).slice(0, 8).map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={disabled}
              onClick={() => onLinked(c.id)}
            >
              {c.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ContactsDedupReview() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { canEditFleet, canEditContacts } = usePermissions();
  const [tab, setTab] = useState<"pending_review" | "auto_applied" | "lease_gaps">("pending_review");
  const [otherOffset, setOtherOffset] = useState(0);

  useEffect(() => {
    function applyTabFromHash() {
      if (isDirectoryLeaseReviewTab(hashSearchParams())) setTab("lease_gaps");
    }
    applyTabFromHash();
    window.addEventListener("hashchange", applyTabFromHash);
    return () => window.removeEventListener("hashchange", applyTabFromHash);
  }, []);

  const { data: rows = [], isLoading } = useQuery<Candidate[]>({
    queryKey: ["/api/directory-dedup", tab],
    queryFn: () => apiGet(`/api/directory-dedup?status=${tab}`),
    enabled: tab !== "lease_gaps",
  });

  const { data: gapPage, isLoading: gapsLoading } = useQuery<LeaseGapPage>({
    queryKey: ["/api/directory-lease-gaps", otherOffset],
    queryFn: () => apiGet(`/api/directory-lease-gaps?other_offset=${otherOffset}`),
    enabled: tab === "lease_gaps",
  });
  const gaps = gapPage?.rows ?? [];
  const unmatchedOther = gapPage?.unmatched_other ?? [];

  const act = useMutation({
    mutationFn: async (opts: { id: number; body: Record<string, unknown> }) => {
      await apiRequest("POST", `/api/directory-dedup/${opts.id}`, opts.body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/directory-dedup"] });
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const linkLease = useMutation({
    mutationFn: async (opts: { companyId: number; masterLeaseId: number }) => {
      await apiRequest("POST", `/api/companies/${opts.companyId}/lease-links`, {
        master_lease_id: opts.masterLeaseId,
        relationship_note: "Linked from directory review",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/directory-lease-gaps"] });
      toast({ title: "Company linked to lease" });
    },
    onError: (e: Error) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  const createFromLessee = useMutation({
    mutationFn: async (opts: { lessee: string; masterLeaseId: number }) => {
      await apiRequest("POST", "/api/directory-lease-gaps/link", {
        master_lease_id: opts.masterLeaseId,
        lessee: opts.lessee,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/directory-lease-gaps"] });
      toast({ title: "Lessee linked to the directory" });
    },
    onError: (e: Error) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  const applyUnique = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/directory-lease-gaps/apply-unique", {});
      return res.json() as Promise<{ linked: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/directory-lease-gaps"] });
      qc.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: data.linked ? `Linked ${data.linked} unique lessee matches` : "No additional unique matches" });
    },
    onError: (e: Error) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <PageHeader
        title="Directory review"
        subtitle="Agent-contact tags, company families, and unmatched lessees that need a directory company picked by hand."
      />
      <div className="px-4 sm:px-8 py-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/contacts")}>← Directory</Button>
          <Button size="sm" variant={tab === "pending_review" ? "default" : "outline"} onClick={() => { setTab("pending_review"); navigate("/contacts/review"); }}>Needs review</Button>
          <Button size="sm" variant={tab === "auto_applied" ? "default" : "outline"} onClick={() => { setTab("auto_applied"); navigate("/contacts/review"); }}>Auto-applied (audit)</Button>
          <Button size="sm" variant={tab === "lease_gaps" ? "default" : "outline"} onClick={() => { setTab("lease_gaps"); navigate("/contacts/review?tab=leases"); }}>Lease links</Button>
        </div>
        {tab === "lease_gaps" && canEditContacts && (
          <Button
            size="sm"
            variant="outline"
            disabled={applyUnique.isPending}
            onClick={() => applyUnique.mutate()}
          >
            Link unique lessee matches
          </Button>
        )}
        {tab === "lease_gaps" && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                const res = await apiRequest("GET", "/api/directory-lease-gaps/export");
                if (!res.ok) {
                  const err = await res.json().catch(() => ({ message: res.statusText }));
                  throw new Error(err.message || "Export failed");
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "unmatched-lessees.csv";
                a.click();
                URL.revokeObjectURL(url);
              } catch (e: any) {
                toast({ title: "Export failed", description: e.message, variant: "destructive" });
              }
            }}
          >
            Download unmatched lessees
          </Button>
        )}
        {tab !== "lease_gaps" && isLoading && <Skeleton className="h-24 rounded-lg" />}
        {tab === "lease_gaps" && gapsLoading && <Skeleton className="h-24 rounded-lg" />}
        {tab === "lease_gaps" && gapPage && (
          <p className="text-xs text-muted-foreground">
            {gapPage.linked_leases} leases already tied to a directory company · {gapPage.unmatched_leases} still unmatched · showing {gapPage.suggestions} with a suggested company (pick the right one; Ineos-style groups are listed on purpose).
          </p>
        )}
        {tab === "lease_gaps" && !gapsLoading && gaps.length === 0 && unmatchedOther.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No unmatched leases with a directory company to suggest.</p>
        )}
        {tab === "lease_gaps" && gaps.map((g) => (
          <div key={g.master_lease_id} className="rounded-lg border border-border p-3 text-sm space-y-2">
            <div className="font-medium">{g.lessee}</div>
            <div className="text-xs text-muted-foreground">{displayLeaseNumber(g.lease_number) || `MLA ${g.master_lease_id}`}</div>
            <div className="flex flex-wrap gap-2 pt-1">
              {g.candidates.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant="outline"
                  disabled={!canEditContacts || linkLease.isPending}
                  onClick={() => linkLease.mutate({ companyId: c.id, masterLeaseId: g.master_lease_id })}
                >
                  Link {c.name}
                </Button>
              ))}
            </div>
            <CompanySearchLink
              masterLeaseId={g.master_lease_id}
              disabled={!canEditContacts || linkLease.isPending}
              onLinked={(companyId) => linkLease.mutate({ companyId, masterLeaseId: g.master_lease_id })}
            />
            {canEditContacts && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={createFromLessee.isPending}
                onClick={() => createFromLessee.mutate({ lessee: g.lessee, masterLeaseId: g.master_lease_id })}
              >
                Add / link this lessee in the directory
              </Button>
            )}
          </div>
        ))}
        {tab === "lease_gaps" && unmatchedOther.length > 0 && (
          <div className="text-xs uppercase tracking-widest text-muted-foreground pt-2">No automatic suggestion — search the directory</div>
        )}
        {tab === "lease_gaps" && unmatchedOther.map((g) => (
          <div key={`o-${g.master_lease_id}`} className="rounded-lg border border-border p-3 text-sm space-y-2">
            <div className="font-medium">{g.lessee}</div>
            <div className="text-xs text-muted-foreground">{displayLeaseNumber(g.lease_number) || `MLA ${g.master_lease_id}`}</div>
            <CompanySearchLink
              masterLeaseId={g.master_lease_id}
              disabled={!canEditContacts || linkLease.isPending}
              onLinked={(companyId) => linkLease.mutate({ companyId, masterLeaseId: g.master_lease_id })}
            />
            {canEditContacts && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={createFromLessee.isPending}
                onClick={() => createFromLessee.mutate({ lessee: g.lessee, masterLeaseId: g.master_lease_id })}
              >
                Add / link this lessee in the directory
              </Button>
            )}
          </div>
        ))}
        {tab === "lease_gaps" && (gapPage?.unmatched_other_total ?? 0) > 50 && (
          <div className="flex flex-wrap gap-2 items-center">
            <Button size="sm" variant="outline" disabled={otherOffset <= 0} onClick={() => setOtherOffset((o) => Math.max(0, o - 50))}>Previous unmatched</Button>
            <Button
              size="sm"
              variant="outline"
              disabled={otherOffset + 50 >= (gapPage?.unmatched_other_total ?? 0)}
              onClick={() => setOtherOffset((o) => o + 50)}
            >
              Next unmatched
            </Button>
            <span className="text-xs text-muted-foreground">
              {otherOffset + 1}–{Math.min(otherOffset + 50, gapPage?.unmatched_other_total ?? 0)} of {gapPage?.unmatched_other_total}
            </span>
          </div>
        )}
        {tab !== "lease_gaps" && !isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground italic">Nothing in this list.</p>
        )}
        {tab !== "lease_gaps" && rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-3 text-sm space-y-2">
            <div className="flex flex-wrap gap-2 items-center text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>{r.kind.replace(/_/g, " ")}</span>
              <span>· {r.signal}</span>
              {r.confidence != null && <span>· {Number(r.confidence).toFixed(2)}</span>}
            </div>
            {r.kind === "agent_contact" && (
              <div>
                <div className="font-medium">{r.contact?.name || r.email}</div>
                <div className="text-xs text-muted-foreground">{r.email} · via {r.agent_organization_name || r.home_company?.name || "unknown org"}</div>
              </div>
            )}
            {(r.kind === "company_family" || r.kind === "company_duplicate") && (
              <div className="text-xs space-y-1">
                <div><span className="font-medium">{r.company_a?.name}</span> {r.company_a?.reporting_marks?.length ? `(${r.company_a.reporting_marks.join(", ")})` : "(no marks)"}</div>
                <div><span className="font-medium">{r.company_b?.name}</span> {r.company_b?.reporting_marks?.length ? `(${r.company_b.reporting_marks.join(", ")})` : "(no marks)"}</div>
                {r.note && <div className="text-muted-foreground">{r.note}</div>}
              </div>
            )}
            {canEditFleet && tab === "pending_review" && (
              <div className="flex flex-wrap gap-2 pt-1">
                {r.kind === "agent_contact" && (
                  <>
                    {r.company_id_a && (
                      <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, body: { action: "approve", home_company_id: r.company_id_a } })}>Home: {r.company_a?.name || "A"}</Button>
                    )}
                    {r.company_id_b && (
                      <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, body: { action: "approve", home_company_id: r.company_id_b } })}>Home: {r.company_b?.name || "B"}</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: r.id, body: { action: "not_agent" } })}>Not an agent</Button>
                  </>
                )}
                {r.kind === "company_family" && r.company_id_a && r.company_id_b && (
                  <>
                    <Button size="sm" onClick={() => act.mutate({ id: r.id, body: { action: "group_family", parent_company_id: r.company_id_a, child_company_id: r.company_id_b } })}>Group B under A</Button>
                    <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, body: { action: "group_family", parent_company_id: r.company_id_b, child_company_id: r.company_id_a } })}>Group A under B</Button>
                  </>
                )}
                {r.kind === "company_duplicate" && r.company_id_a && r.company_id_b && (
                  <>
                    <Button size="sm" variant="destructive" onClick={() => act.mutate({ id: r.id, body: { action: "merge_duplicate", survivor_company_id: r.company_id_a, loser_company_id: r.company_id_b } })}>Merge B into A</Button>
                    <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, body: { action: "merge_duplicate", survivor_company_id: r.company_id_b, loser_company_id: r.company_id_a } })}>Merge A into B</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: r.id, body: { action: "dismiss" } })}>Not related</Button>
              </div>
            )}
            {canEditFleet && tab === "auto_applied" && r.kind === "agent_contact" && (
              <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, body: { action: "undo" } })}>Undo tag</Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
