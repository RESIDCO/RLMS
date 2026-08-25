import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import { useToast } from "@/hooks/use-toast";
import { useCanEdit, usePermissions } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";
import { formatCalendarDate } from "@shared/lease-authority";
import { ArrowLeft, Building2, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { programPath } from "@/lib/browse-nav";
import { AmCommentThread } from "@/components/AmCommentThread";
import { InactiveFleetBadge } from "@/components/InactiveFleetBadge";
import { RailcarDetailSheet } from "@/pages/FleetRegistry";
import { navigateHash } from "@/lib/hash-location";
import {
  UNASSIGNED_AM,
  accountDetailPath,
  accountListPath,
  readAccountMgmtListState,
  replaceAccountMgmtListState,
  type AccountKpiFilter,
  type AccountMgmtListState,
} from "@/lib/account-mgmt-nav";

type StatusTag = "good" | "watch" | "risk";

type OverviewAccount = {
  id: number;
  name: string;
  notes: string | null;
  account_manager: string | null;
  program_count: number;
  expire_years: number[];
  status_tags: StatusTag[];
  ol_count: number;
  active_car_count: number;
  is_inactive: boolean;
};

type Overview = {
  managers: string[];
  manager_pills: { name: string; account_count: number }[];
  unassigned_count: number;
  all_count: number;
  expire_years: number[];
  kpis: {
    expiring: { year: number; count: number }[];
    status: { good: number; watch: number; risk: number };
  };
  accounts: OverviewAccount[];
};

type AccountOl = {
  id: number;
  rider_name: string;
  schedule_number: string | null;
  master_lease_id: number;
  lease_number: string | null;
  expiration_date: string | null;
  status_tag: StatusTag | null;
  active_car_count: number;
  is_inactive: boolean;
};

type AccountDetail = {
  id: number;
  name: string;
  notes: string | null;
  account_manager: string | null;
  counts: { mlas: number; ols: number; active_cars: number };
  ols: AccountOl[];
  programs: { id: number; name: string; status: string | null; account_manager: string | null }[];
};

type OlCar = {
  id: number;
  car_number: string | null;
  reporting_marks: string | null;
  car_type: string | null;
  expiration_date: string | null;
};

const TAG_LABEL: Record<StatusTag, string> = { good: "Good", watch: "Watch", risk: "Risk" };
const TAG_CLASS: Record<StatusTag, string> = {
  good: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  watch: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  risk: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function AccountsPage() {
  const [match, params] = useRoute("/accounts/:id");
  if (match && params?.id) return <AccountDetailView id={Number(params.id)} />;
  return <AccountListView />;
}

function AccountListView() {
  const { toast } = useToast();
  const canEdit = useCanEdit();
  const initial = readAccountMgmtListState();
  const [search, setSearch] = useState(initial.search);
  const [manager, setManager] = useState<string | null>(initial.manager);
  const [kpi, setKpi] = useState<AccountKpiFilter>(initial.kpi);
  const [showInactive, setShowInactive] = useState(initial.showInactive);
  const [createOpen, setCreateOpen] = useState(false);

  const listState: AccountMgmtListState = { manager, kpi, showInactive, search };

  useEffect(() => {
    replaceAccountMgmtListState(listState);
  }, [manager, kpi, showInactive, search]);

  const { data, isLoading } = useQuery<Overview>({
    queryKey: ["/api/account-management/overview", manager, showInactive],
    queryFn: () => {
      const p = new URLSearchParams();
      if (manager) p.set("account_manager", manager);
      if (showInactive) p.set("include_inactive", "1");
      const q = p.toString() ? `?${p.toString()}` : "";
      return apiRequest("GET", `/api/account-management/overview${q}`).then((r) => r.json());
    },
  });

  const filtered = useMemo(() => {
    const rows = data?.accounts ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((a) => {
      if (kpi?.kind === "year" && !a.expire_years.includes(kpi.year)) return false;
      if (kpi?.kind === "tag" && !a.status_tags.includes(kpi.tag)) return false;
      if (!q) return true;
      return `${a.name} ${a.account_manager ?? ""} ${a.notes ?? ""}`.toLowerCase().includes(q);
    });
  }, [data?.accounts, search, kpi]);

  function toggleKpi(next: AccountKpiFilter) {
    if (
      kpi &&
      next &&
      ((kpi.kind === "year" && next.kind === "year" && kpi.year === next.year) ||
        (kpi.kind === "tag" && next.kind === "tag" && kpi.tag === next.tag))
    ) {
      setKpi(null);
      return;
    }
    setKpi(next);
  }

  const kpiLabel =
    kpi?.kind === "year" ? `Expiring ${kpi.year}` : kpi?.kind === "tag" ? TAG_LABEL[kpi.tag] : null;
  const showingLabel =
    manager === UNASSIGNED_AM
      ? "Unassigned accounts"
      : manager
        ? manager
        : "All accounts";

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Account Management"
        subtitle="OL status, comments, and expiration — owned here, not by Lease Management"
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-new-account">
              <Plus className="h-4 w-4" /> New Account
            </Button>
          ) : undefined
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1">Account Manager</span>
          <FilterPill active={!manager} onClick={() => setManager(null)}>
            ALL{data ? ` · ${data.all_count}` : ""}
          </FilterPill>
          {(data?.manager_pills ?? []).map((m) => (
            <FilterPill key={m.name} active={manager === m.name} onClick={() => setManager(m.name)}>
              {m.name} · {m.account_count}
            </FilterPill>
          ))}
          <button
            type="button"
            onClick={() => setManager(UNASSIGNED_AM)}
            className={cn(
              "h-7 px-3 rounded-full text-xs border border-dashed transition-colors",
              manager === UNASSIGNED_AM
                ? "bg-amber-500/15 text-amber-200 border-amber-500/50"
                : "border-amber-500/35 text-amber-400/90 hover:text-amber-200 hover:border-amber-500/50",
            )}
            title="Accounts with no account manager set"
            data-testid="filter-unassigned-am"
          >
            Unassigned{data ? ` · ${data.unassigned_count}` : ""}
          </button>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Deals Expiring</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {(data?.kpis.expiring ?? data?.expire_years.map((year) => ({ year, count: 0 })) ?? []).map((tile) => (
              <KpiTile
                key={tile.year}
                label={String(tile.year)}
                value={isLoading ? "—" : tile.count}
                active={kpi?.kind === "year" && kpi.year === tile.year}
                onClick={() => toggleKpi({ kind: "year", year: tile.year })}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">OL Status</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(["good", "watch", "risk"] as StatusTag[]).map((tag) => (
              <KpiTile
                key={tag}
                label={TAG_LABEL[tag]}
                value={isLoading ? "—" : data?.kpis.status[tag] ?? 0}
                active={kpi?.kind === "tag" && kpi.tag === tag}
                tone={tag}
                onClick={() => toggleKpi({ kind: "tag", tag })}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-3">
          <div className="text-sm font-medium">Account Transitions</div>
          <p className="text-xs text-muted-foreground mt-1">Coming soon.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ClearableSearchInput
            className="relative w-full max-w-sm shrink-0 flex-none"
            inputClassName="h-9"
            placeholder="Search accounts…"
            value={search}
            onChange={setSearch}
          />
          <label
            className="flex items-center gap-2 h-9 px-2 rounded-md border border-border bg-background text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap"
            data-testid="toggle-show-inactive-ols"
          >
            <Checkbox
              checked={showInactive}
              onCheckedChange={(v) => setShowInactive(v === true)}
            />
            Show inactive OLs
          </label>
          {kpiLabel && (
            <button
              type="button"
              className="text-xs border border-border rounded-full px-2.5 py-1 text-muted-foreground hover:text-foreground"
              onClick={() => setKpi(null)}
            >
              Filter: {kpiLabel} <X className="inline h-3 w-3 ml-0.5" />
            </button>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border flex flex-wrap items-center justify-between gap-2">
              <span>Showing: {showingLabel}</span>
              <span>Account-level status rollup — coming soon</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Name</th>
                  <th className="text-left font-medium px-4 py-2">Account Manager</th>
                  <th className="text-right font-medium px-4 py-2"># OLs</th>
                  <th className="text-right font-medium px-4 py-2"># Active Cars</th>
                  <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Programs</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2">
                      <Link href={accountDetailPath(a.id, listState)} className="font-medium text-foreground hover:underline">
                        {a.name}
                      </Link>
                      {a.is_inactive && (
                        <span className="ml-2">
                          <InactiveFleetBadge active={false} />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{a.account_manager || ""}</td>
                    <td className="px-4 py-2 text-right font-mono-num">{a.ol_count}</td>
                    <td className="px-4 py-2 text-right font-mono-num">{a.active_car_count}</td>
                    <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell">{a.program_count || ""}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      No accounts match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NewAccountDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          toast({ title: "Account created" });
        }}
      />
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 px-3 rounded-full text-xs border transition-colors",
        active
          ? "bg-primary/15 text-foreground border-primary/40"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function KpiTile({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number | string;
  active: boolean;
  onClick: () => void;
  tone?: StatusTag;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border bg-card shadow-card p-4 text-left transition-all",
        active ? "border-primary/50 ring-1 ring-primary/30" : "border-card-border hover:border-border",
        tone && active ? TAG_CLASS[tone] : "",
      )}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold font-mono-num mt-1">{value}</div>
    </button>
  );
}

function AccountDetailView({ id }: { id: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const canEdit = useCanEdit();
  const { canEditAccountMgmtTags, canEditAccountMgmtComments, canDeleteAccountMgmtComments } = usePermissions();
  const listState = readAccountMgmtListState();
  const [showInactive, setShowInactive] = useState(listState.showInactive);
  const { data, isLoading } = useQuery<AccountDetail>({
    queryKey: ["/api/accounts", id],
    queryFn: () => apiRequest("GET", `/api/accounts/${id}`).then((r) => r.json()),
  });
  const [name, setName] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [accountManager, setAccountManager] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sheetCarId, setSheetCarId] = useState<number | null>(null);
  const displayName = name ?? data?.name ?? "";
  const displayNotes = notes ?? data?.notes ?? "";
  const displayManager = accountManager ?? data?.account_manager ?? "";

  const visibleOls = useMemo(() => {
    const rows = data?.ols ?? [];
    if (showInactive) return rows;
    return rows.filter((ol) => !ol.is_inactive);
  }, [data?.ols, showInactive]);

  const visibleCounts = useMemo(() => {
    const mlas = new Set(visibleOls.map((ol) => ol.master_lease_id));
    return {
      mlas: mlas.size,
      ols: visibleOls.length,
      active_cars: visibleOls.reduce((n, ol) => n + (ol.active_car_count ?? 0), 0),
    };
  }, [visibleOls]);

  function setDetailInactive(next: boolean) {
    setShowInactive(next);
    navigateHash(accountDetailPath(id, { ...listState, showInactive: next }), { replace: true });
  }

  const save = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/accounts/${id}`, {
        name: displayName,
        notes: displayNotes,
        account_manager: displayManager.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <div className="p-8">
        <Skeleton className="h-32 w-full max-w-xl" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title={data.name}
        subtitle="Account"
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => navigate(accountListPath({ ...listState, showInactive }))}
            data-testid="button-back-accounts"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to accounts
          </button>
        }
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-5 space-y-6 max-w-5xl">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {data.account_manager ? (
            <span className="h-7 px-3 rounded-full text-xs border border-border">{data.account_manager}</span>
          ) : (
            <span className="text-xs text-muted-foreground">No account manager</span>
          )}
          <span className="text-muted-foreground font-mono-num">
            {visibleCounts.mlas} MLA · {visibleCounts.ols} OL · {visibleCounts.active_cars} active cars
          </span>
          <label
            className="flex items-center gap-2 h-7 px-2 rounded-md border border-border bg-background text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap"
            data-testid="toggle-show-inactive-ols-detail"
          >
            <Checkbox
              checked={showInactive}
              onCheckedChange={(v) => setDetailInactive(v === true)}
            />
            Show inactive OLs
          </label>
        </div>
        <p className="text-xs text-muted-foreground max-w-3xl">
          Status tags and notes are owned by Account Management. Anyone with access to this page (including Viewers)
          can set tags and post notes; notes are append-only. Car lists, dates, and other OL fields are Lease
          Management / Railcars data shown for reference only and are not editable here.
        </p>

        {canEdit && (
          <div className="space-y-3 max-w-xl">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={displayName} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={displayNotes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Account Manager</Label>
              <Input
                value={displayManager}
                onChange={(e) => setAccountManager(e.target.value)}
                placeholder="Initials, e.g. GS"
              />
            </div>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save account"}
            </Button>
          </div>
        )}

        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2">OL</th>
                <th className="text-left font-medium px-4 py-2">MLA</th>
                <th className="text-right font-medium px-4 py-2">Active cars</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-left font-medium px-4 py-2">Comment</th>
              </tr>
            </thead>
            <tbody>
              {(visibleOls).map((ol) => (
                <OlRows
                  key={ol.id}
                  accountId={id}
                  ol={ol}
                  expanded={expanded === ol.id}
                  onToggle={() => setExpanded(expanded === ol.id ? null : ol.id)}
                  onOpenCar={setSheetCarId}
                  canTag={canEditAccountMgmtTags}
                  canComment={canEditAccountMgmtComments}
                  canDeleteComment={canDeleteAccountMgmtComments}
                />
              ))}
              {visibleOls.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    {showInactive ? "No OLs linked to this account." : "No active OLs. Turn on “Show inactive OLs” to see historical deals."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Linked programs</div>
          {data.programs.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.programs.map((p) => (
                <li key={p.id}>
                  <Link href={programPath(p.id)} className="hover:underline">
                    {p.name}
                  </Link>
                  {p.account_manager ? (
                    <span className="text-muted-foreground"> · {p.account_manager}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <RailcarDetailSheet carId={sheetCarId} onClose={() => setSheetCarId(null)} readOnly />
    </div>
  );
}

function OlRows({
  accountId,
  ol,
  expanded,
  onToggle,
  onOpenCar,
  canTag,
  canComment,
  canDeleteComment,
}: {
  accountId: number;
  ol: AccountOl;
  expanded: boolean;
  onToggle: () => void;
  onOpenCar: (carId: number) => void;
  canTag: boolean;
  canComment: boolean;
  canDeleteComment: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cars = useQuery<{ cars: OlCar[] }>({
    queryKey: ["/api/account-management/riders", ol.id, "cars"],
    queryFn: () => apiRequest("GET", `/api/account-management/riders/${ol.id}/cars`).then((r) => r.json()),
    enabled: expanded,
  });

  const tagMut = useMutation({
    mutationFn: (status_tag: StatusTag | null) =>
      apiRequest("PATCH", `/api/account-management/riders/${ol.id}/status-tag`, { status_tag }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts", accountId] });
      qc.invalidateQueries({ queryKey: ["/api/account-management/overview"] });
    },
    onError: (e: Error) => toast({ title: "Could not save status", description: e.message, variant: "destructive" }),
  });

  function setTag(next: StatusTag) {
    tagMut.mutate(ol.status_tag === next ? null : next);
  }

  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="px-4 py-2 font-mono-num">
          {ol.schedule_number || ol.rider_name}
          {ol.is_inactive ? (
            <span className="ml-2">
              <InactiveFleetBadge active={false} />
            </span>
          ) : null}
          {ol.expiration_date ? (
            <div className="text-[11px] text-muted-foreground">Exp {formatCalendarDate(ol.expiration_date)}</div>
          ) : null}
        </td>
        <td className="px-4 py-2 text-muted-foreground font-mono-num">{ol.lease_number || ""}</td>
        <td className="px-4 py-2 text-right">
          <button
            type="button"
            className="inline-flex items-center gap-1 font-mono-num hover:underline"
            onClick={onToggle}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {ol.active_car_count}
          </button>
        </td>
        <td className="px-4 py-2">
          <div className="flex flex-wrap gap-1">
            {(["good", "watch", "risk"] as StatusTag[]).map((tag) => (
              <button
                key={tag}
                type="button"
                disabled={!canTag || tagMut.isPending}
                onClick={() => setTag(tag)}
                className={cn(
                  "h-6 px-2 rounded-full text-[10px] uppercase tracking-wide border",
                  ol.status_tag === tag ? TAG_CLASS[tag] : "border-border text-muted-foreground",
                )}
              >
                {TAG_LABEL[tag]}
              </button>
            ))}
          </div>
        </td>
        <td className="px-4 py-2 min-w-[16rem]">
          <AmCommentThread
            riderId={ol.id}
            canCompose={canComment}
            canDelete={canDeleteComment}
          />
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-border bg-muted/10">
          <td colSpan={5} className="px-8 py-3">
            {cars.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading cars…</p>
            ) : (cars.data?.cars ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No active cars on this OL.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium py-1">Car</th>
                    <th className="text-left font-medium py-1">Type</th>
                    <th className="text-left font-medium py-1">Expiration</th>
                  </tr>
                </thead>
                <tbody>
                  {(cars.data?.cars ?? []).map((c) => (
                    <tr key={c.id}>
                      <td className="py-0.5 font-mono-num">
                        <button
                          type="button"
                          className="text-left hover:underline text-foreground"
                          onClick={() => onOpenCar(c.id)}
                          data-testid={`open-am-car-${c.id}`}
                        >
                          {(c.reporting_marks || "") + (c.car_number || "")}
                        </button>
                      </td>
                      <td className="py-0.5 text-muted-foreground">{c.car_type || ""}</td>
                      <td className="py-0.5 text-muted-foreground">
                        {c.expiration_date ? formatCalendarDate(c.expiration_date) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function NewAccountDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () => apiRequest("POST", "/api/accounts", { name: name.trim(), notes: notes.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/account-management/overview"] });
      setName("");
      setNotes("");
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Could not create account", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> New Account
          </DialogTitle>
          <DialogDescription>Prospects do not need an OL or MLA yet.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer or prospect name" />
          </div>
          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
              {save.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
