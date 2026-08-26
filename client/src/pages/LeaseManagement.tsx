import { useEffect, useMemo, useState } from "react";
import { useCanEdit, useIsAdmin, usePermissions } from "@/lib/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Users,
  Phone,
  Mail,
  StickyNote,
  Wand2,
  Download,
  Columns3,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { GridColumnTh } from "@/components/GridColumnTh";
import { colWidth, mergeColOrder, moveCol, tableWidthFor } from "@/lib/grid-columns";
import { cn } from "@/lib/utils";
import { apiRequest, apiGet, queryClient, railcarsQs, asRailcarList, downloadXlsx } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { displayLeaseNumber } from "@shared/residco-import";
import { carBuildYear } from "@shared/build-year";
import { formatCalendarDate } from "@shared/lease-authority";
import { leaseExpirationSourceLabel } from "@shared/lease-governance";
import { displayRailcarStatus, displayStatusInputFromRailcar } from "@shared/fleet-status";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import ActivityTimeline from "@/components/ActivityTimeline";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import { confirmDelete, confirmSave } from "@/components/ConfirmActionDialog";
import { carPath } from "@/lib/browse-nav";
import { LeaseTypeBadge } from "@/components/LeaseTypeBadge";
import type {
  MasterLeaseWithRiders,
  RailcarWithAssignment,
  RiderContact,
} from "@shared/schema";

import { matchesSearchQuery } from "@/lib/search-match";
import { InactiveFleetBadge } from "@/components/InactiveFleetBadge";
import { AmCommentThread } from "@/components/AmCommentThread";

function normOlToken(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
}

/** Exact OL / schedule / rider-name match — bypasses the default hide-inactive filter. */
function isExactOlMatch(
  rider: { rider_name?: string | null; schedule_number?: string | null },
  qRaw: string,
): boolean {
  const q = normOlToken(qRaw);
  if (!q) return false;
  return normOlToken(rider.schedule_number) === q || normOlToken(rider.rider_name) === q;
}

function leaseHasExactOlMatch(lease: MasterLeaseWithRiders, qRaw: string): boolean {
  return (lease.riders ?? []).some((r) => isExactOlMatch(r, qRaw));
}

function leaseMatchesSearch(lease: MasterLeaseWithRiders, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase();
  if (!q) return true;
  return matchesSearchQuery(
    [
      lease.lessee,
      lease.lessor,
      displayLeaseNumber(lease.lease_number),
      lease.agreement_number,
      lease.lease_type,
      ...(lease.riders ?? []).flatMap((r: any) => [r.rider_name, r.schedule_number]),
    ],
    q,
  );
}

function riderMatchesSearch(rider: { rider_name?: string | null; schedule_number?: string | null }, qRaw: string): boolean {
  return matchesSearchQuery([rider.rider_name, rider.schedule_number], qRaw);
}

function visibleRidersForLease(
  lease: MasterLeaseWithRiders,
  showInactive: boolean,
  searchQ: string,
  forceRiderId?: number | null,
): MasterLeaseWithRiders["riders"] {
  const riders = lease.riders ?? [];
  if (showInactive) return riders;
  return riders.filter(
    (r) =>
      !r.is_inactive ||
      isExactOlMatch(r, searchQ) ||
      (forceRiderId != null && r.id === forceRiderId),
  );
}

function fmtDate(d: string | null | undefined) {
  return formatCalendarDate(d);
}

function ExpirationSourceTag({ rider }: { rider: { expiration_source?: string | null; expiration_snapshot_month?: string | null } }) {
  const label = leaseExpirationSourceLabel(rider.expiration_source, rider.expiration_snapshot_month);
  if (!label) return null;
  return (
    <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/80" title={label}>
      {label}
    </span>
  );
}
function fmtPct(n: number | null) {
  return n == null ? "—" : `${Number(n).toFixed(3)}%`;
}
function fmtMoney(n: number | null) {
  if (n == null) return "—";
  return Number(n).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
function olCodesForLease(lease: MasterLeaseWithRiders): string[] {
  return (lease.riders ?? [])
    .map((r: any) => String(r.schedule_number || r.rider_name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function formatOlSummary(codes: string[], max = 4): string {
  if (codes.length === 0) return "";
  if (codes.length <= max) return codes.join(", ");
  return `${codes.slice(0, max).join(", ")} +${codes.length - max} more`;
}

export default function LeaseManagement() {
  const canEdit = useCanEdit();
  const isAdmin = useIsAdmin();
  const [, navigate] = useLocation();
  const [hashLoc] = useHashLocation();
  const hashQs = new URLSearchParams(hashLoc.includes("?") ? hashLoc.slice(hashLoc.indexOf("?") + 1) : "");
  const targetRiderId = Number(hashQs.get("rider")) || null;
  const filterRiders = hashQs.get("filter") === "riders";
  const filterExpiring = hashQs.get("filter") === "expiring";
  const filterExpiring6 = hashQs.get("filter") === "expiring6";
  const [expandedLeases, setExpandedLeases] = useState<Set<number>>(new Set());
  const [expandedRiders, setExpandedRiders] = useState<Set<number>>(new Set());
  const [addLeaseOpen, setAddLeaseOpen] = useState(false);
  const [editLease, setEditLease] = useState<any | null>(null);
  const [addRiderFor, setAddRiderFor] = useState<number | null>(null);
  const [editRider, setEditRider] = useState<any | null>(null);
  const [sortBy, setSortBy] = useState<"lessee" | "ol">("lessee");
  const [leaseSearch, setLeaseSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const { data: leases, isLoading } = useQuery<MasterLeaseWithRiders[]>({
    queryKey: ["/api/leases"],
  });

  const sortedLeases = useMemo(() => {
    const list = [...(leases ?? [])];
    if (sortBy === "ol") {
      list.sort((a, b) => {
        const ao = olCodesForLease(a)[0] ?? "\uffff";
        const bo = olCodesForLease(b)[0] ?? "\uffff";
        const cmp = ao.localeCompare(bo, undefined, { numeric: true, sensitivity: "base" });
        if (cmp !== 0) return cmp;
        return (a.lessee ?? a.lease_number).localeCompare(b.lessee ?? b.lease_number, undefined, { sensitivity: "base" });
      });
    } else {
      list.sort((a, b) =>
        (a.lessee ?? displayLeaseNumber(a.lease_number) ?? "").localeCompare(
          b.lessee ?? displayLeaseNumber(b.lease_number) ?? "",
          undefined,
          { sensitivity: "base" }
        )
      );
    }
    return list;
  }, [leases, sortBy]);

  const filteredLeases = useMemo(() => {
    const q = leaseSearch.trim();
    return sortedLeases.filter((l) => {
      if (q && !leaseMatchesSearch(l, q)) return false;
      const exactOl = q ? leaseHasExactOlMatch(l, q) : false;
      const deepLinked =
        targetRiderId != null &&
        (l.riders ?? []).some((r) => r.id === targetRiderId);
      if (!showInactive && l.is_inactive && !exactOl && !deepLinked) return false;
      if (!showInactive && !exactOl && !deepLinked) {
        const visible = visibleRidersForLease(l, false, q, targetRiderId);
        if (visible.length === 0) return false;
      }
      return true;
    });
  }, [sortedLeases, leaseSearch, showInactive, targetRiderId]);

  useEffect(() => {
    const q = leaseSearch.trim();
    if (!q) return;
    const matched = sortedLeases.filter((l) => {
      if (!leaseMatchesSearch(l, q)) return false;
      const exactOl = leaseHasExactOlMatch(l, q);
      if (!showInactive && l.is_inactive && !exactOl) return false;
      return true;
    });
    if (!matched.length) return;
    setExpandedLeases(new Set(matched.map((l) => l.id)));
    const rids = new Set<number>();
    for (const l of matched) {
      for (const r of visibleRidersForLease(l, showInactive, q, targetRiderId)) {
        if (riderMatchesSearch(r, q) || isExactOlMatch(r, q)) rids.add(r.id);
      }
    }
    setExpandedRiders(rids);
  }, [leaseSearch, sortedLeases, showInactive, targetRiderId]);

  // Auto-expand: deep-link rider > ?filter=riders (all) > default first lease
  useEffect(() => {
    if (!leases || !leases.length) return;
    if (targetRiderId) {
      // Find the MLA that contains this rider
      const parentLease = leases.find((l) =>
        l.riders?.some((r: any) => r.id === targetRiderId)
      );
      if (parentLease) {
        setExpandedLeases(new Set([parentLease.id]));
        setExpandedRiders(new Set([targetRiderId]));
        setTimeout(() => {
          const el = document.getElementById(`rider-row-${targetRiderId}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
      }
    } else if (filterRiders) {
      // Expand all leases and all riders so every active rider is visible
      setExpandedLeases(new Set(leases.map((l) => l.id)));
      setExpandedRiders(new Set(leases.flatMap((l) => (l.riders ?? []).map((r: any) => r.id))));
    } else if (filterExpiring) {
      // Expand only MLAs/riders expiring within 12 months, sorted by closest expiration
      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() + 12);
      const expiringRiders = leases
        .flatMap((l) => (l.riders ?? []).map((r: any) => ({ ...r, leaseId: l.id })))
        .filter((r) => {
          if (!r.expiration_date) return false;
          const d = new Date(r.expiration_date);
          return d >= now && d <= cutoff;
        })
        .sort((a, b) => new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime());
      const parentLeaseIds = new Set(expiringRiders.map((r) => r.leaseId));
      const riderIds = new Set(expiringRiders.map((r) => r.id));
      setExpandedLeases(parentLeaseIds);
      setExpandedRiders(riderIds);
    } else if (filterExpiring6) {
      // Expand only MLAs/riders expiring within 6 months, sorted by closest expiration
      const now = new Date();
      const cutoff6 = new Date(now);
      cutoff6.setMonth(cutoff6.getMonth() + 6);
      const expiring6Riders = leases
        .flatMap((l) => (l.riders ?? []).map((r: any) => ({ ...r, leaseId: l.id })))
        .filter((r) => {
          if (!r.expiration_date) return false;
          const d = new Date(r.expiration_date);
          return d >= now && d <= cutoff6;
        })
        .sort((a, b) => new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime());
      const parentLeaseIds6 = new Set(expiring6Riders.map((r) => r.leaseId));
      const riderIds6 = new Set(expiring6Riders.map((r) => r.id));
      setExpandedLeases(parentLeaseIds6);
      setExpandedRiders(riderIds6);
    } else if (expandedLeases.size === 0) {
      const firstActive = leases.find((l) => !l.is_inactive) ?? leases[0];
      if (firstActive) setExpandedLeases(new Set([firstActive.id]));
    }
  }, [leases, targetRiderId, filterRiders, filterExpiring, filterExpiring6]);

  const toggleLease = (id: number) =>
    setExpandedLeases((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleRider = (id: number) =>
    setExpandedRiders((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const deleteLease = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/leases/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      toast({ title: "Master lease deleted" });
    },
    onError: (e: Error) =>
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });
  const deleteRider = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/riders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      toast({ title: "Rider deleted" });
    },
    onError: (e: Error) =>
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    const ids = [...selected];
    if (!ids.length) {
      toast({ title: "Select at least one master lease", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      await downloadXlsx(`/api/leases/export?ids=${ids.join(",")}`, "RLMS_Leases.xlsx");
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  async function exportAll() {
    setExporting(true);
    try {
      await downloadXlsx("/api/leases/export?scope=all", "RLMS_Leases.xlsx");
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Lease Management"
        subtitle="Master lease agreements, rider schedules, and assigned cars"
        actions={
          <div className="flex gap-2 flex-wrap items-center">
            <ClearableSearchInput
              className="relative w-[220px] sm:w-[280px] max-w-md flex-none"
              inputClassName="h-8"
              placeholder="Search OL number, lessee…"
              value={leaseSearch}
              onChange={setLeaseSearch}
              testId="input-lease-search"
            />
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as "lessee" | "ol")}>
              <SelectTrigger className="h-8 w-[170px]" data-testid="sort-leases">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lessee">Lessee name</SelectItem>
                <SelectItem value="ol">OL / Rider number</SelectItem>
              </SelectContent>
            </Select>
            <label
              className="flex items-center gap-2 h-8 px-2 rounded-md border border-border bg-background text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap"
              data-testid="toggle-show-inactive-leases"
            >
              <Checkbox
                checked={showInactive}
                onCheckedChange={(v) => setShowInactive(v === true)}
              />
              Show inactive
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={exportSelected}
              data-testid="button-export-selected-leases"
              disabled={!selected.size || exporting}
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting…" : "Export selected"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={exportAll}
              data-testid="button-export-all-leases"
              disabled={!leases || leases.length === 0 || exporting}
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting…" : "Export all"}
            </Button>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddLeaseOpen(true)}
                data-testid="button-add-mla"
              >
                <Plus className="h-4 w-4" />
                Add MLA
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                onClick={() => navigate("/lease-wizard")}
                data-testid="button-new-lease-wizard"
              >
                <Wand2 className="h-4 w-4" />
                New Lease Setup
              </Button>
            )}
          </div>
        }
      />

      {filterExpiring && (
        <div className="mx-4 sm:mx-8 mt-1 px-4 py-2.5 rounded-lg border border-warning/30 bg-warning/5 text-sm text-warning flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-umler-amber shrink-0" />
          Showing riders expiring within 12 months, sorted by closest expiration date
        </div>
      )}
      {filterExpiring6 && (
        <div className="mx-4 sm:mx-8 mt-1 px-4 py-2.5 rounded-lg border border-[hsl(var(--error))]/30 bg-[hsl(var(--error))]/5 text-sm text-[hsl(var(--error))] flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-umler-signal shrink-0" />
          Showing riders expiring within 6 months, sorted by closest expiration date
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 sm:py-6 space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))
        ) : filteredLeases.length === 0 ? (
          <div className="rounded-lg border border-card-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            {leaseSearch.trim()
              ? `No deals match “${leaseSearch.trim()}”. Try an OL number or lessee name.`
              : showInactive
                ? "No master leases yet."
                : "No active master leases. Turn on “Show inactive” to see historical deals."}
          </div>
        ) : (
          filteredLeases.map((lease) => {
            const open = expandedLeases.has(lease.id);
            const q = leaseSearch.trim();
            const ridersShown = visibleRidersForLease(lease, showInactive, q, targetRiderId);
            const ols = ridersShown
              .map((r: any) => String(r.schedule_number || r.rider_name || "").trim())
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
            const olLine = formatOlSummary(ols);
            return (
              <div
                key={lease.id}
                className="rounded-lg border border-card-border bg-card overflow-hidden"
              >
                <div
                  className="px-5 py-4 flex items-center gap-4 cursor-pointer hover-elevate"
                  onClick={() => toggleLease(lease.id)}
                  data-testid={`lease-row-${lease.id}`}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(lease.id)}
                      onCheckedChange={() => toggleSelected(lease.id)}
                      aria-label={`Select ${displayLeaseNumber(lease.lease_number)}`}
                      data-testid={`checkbox-lease-${lease.id}`}
                    />
                  </div>
                  {open ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="font-mono-num text-base font-semibold">
                        {displayLeaseNumber(lease.lease_number)}
                      </span>
                      <LeaseTypeBadge mlaType={lease.lease_type} />
                      {lease.is_inactive && <InactiveFleetBadge active={false} />}
                      <span className="text-xs text-muted-foreground">
                        {lease.agreement_number ?? "—"}
                      </span>
                      {(lease as any).sold_to && (
                        <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded border bg-umler-amber/15 text-umler-amber border-umler-amber/30">
                          SOLD
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {lease.lessor ?? "—"} <span className="opacity-50">lessor</span>
                      <span className="mx-2 opacity-30">·</span>
                      {lease.lessee ?? "—"} <span className="opacity-50">lessee</span>
                      {olLine && (
                        <>
                          <span className="mx-2 opacity-30">·</span>
                          <span className="font-mono-num text-foreground/80">{olLine}</span>
                        </>
                      )}
                      {(lease as any).sold_to && (
                        <span className="ml-2 text-amber-400">→ {(lease as any).sold_to}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Cars / Riders
                    </div>
                    <div className="font-mono-num text-sm">
                      {lease.car_count} <span className="text-muted-foreground">/</span>{" "}
                      {lease.riders.length}
                    </div>
                  </div>
                  <div
                    className="flex gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit && <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditLease(lease)}
                      data-testid={`button-edit-lease-${lease.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>}
                    {isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          const name = lease.lease_number || lease.agreement_number || `lease #${lease.id}`;
                          const ok = await confirmDelete({
                            title: `Delete master lease ${name}?`,
                            description: "Cannot delete a lease that has riders. Remove the riders first.",
                          });
                          if (ok) deleteLease.mutate(lease.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {open && (
                  <div className="border-t border-border bg-background/40">
                    <div className="px-5 py-3 flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        Riders
                      </div>
                      {canEdit && <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setAddRiderFor(lease.id)}
                        data-testid={`button-add-rider-${lease.id}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Rider
                      </Button>}
                    </div>
                    <div className="divide-y divide-border">
                      {ridersShown.length === 0 && (
                        <div className="px-5 py-8 text-sm text-muted-foreground italic text-center">
                          No riders under this master lease.
                        </div>
                      )}
                      {ridersShown.map((rider) => {
                        const open = expandedRiders.has(rider.id);
                        return (
                          <div key={rider.id}>
                            <div
                              id={`rider-row-${rider.id}`}
                              className={cn(
                                "px-5 py-3 flex items-center gap-4 cursor-pointer hover-elevate transition-colors",
                                targetRiderId === rider.id && "ring-1 ring-primary/40 bg-primary/5 rounded"
                              )}
                              onClick={() => toggleRider(rider.id)}
                              data-testid={`rider-row-${rider.id}`}
                            >
                              {open ? (
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-3 flex-wrap">
                                  <span className="text-sm font-medium">
                                    {rider.rider_name}
                                  </span>
                                  <LeaseTypeBadge mlaType={lease.lease_type} />
                                  <span className="text-xs text-muted-foreground">
                                    {rider.schedule_number ?? "—"}
                                  </span>
                                  {rider.is_inactive && <InactiveFleetBadge active={false} />}
                                  {(rider as any).sold_to && (
                                    <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border bg-umler-amber/15 text-umler-amber border-umler-amber/30">
                                      SOLD
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5 font-mono-num">
                                  <span title="Effective Date">Effective: {fmtDate(rider.effective_date)}</span>
                                  {" · "}
                                  <span title="Expiration Date">
                                    Expires: {fmtDate(rider.expiration_date)}
                                    <ExpirationSourceTag rider={rider as any} />
                                  </span>
                                  {" · "}
                                  <span title="Monthly Rate %">Rate: {fmtPct(rider.monthly_rate_pct)}</span>
                  {lease.account_manager ? (
                    <> · <span title="Account Manager">Acct Mgr: {lease.account_manager}</span></>
                  ) : null}
                                  {" · "}
                                  <span title="Lessor's Cost">Lessor's Cost: {fmtMoney(rider.lessors_cost)}</span>
                                  {(rider as any).monthly_rent_per_car != null && (
                                    <>
                                      {" · "}
                                      <span title="Monthly Rent per Car" className="text-foreground">
                                        Rent/car: {fmtMoney((rider as any).monthly_rent_per_car)}
                                      </span>
                                    </>
                                  )}
                                  {(rider as any).owner_entity ? (
                                    <>
                                      {" · "}
                                      <span title="Owner Entity">{(rider as any).owner_entity}</span>
                                    </>
                                  ) : null}
                                  {(rider as any).sold_to && (
                                    <> · <span className="text-amber-400">→ {(rider as any).sold_to}</span></>
                                  )}
                                </div>
                              </div>
                              <div className="text-right text-sm font-mono-num">
                                {rider.active_car_count ?? rider.car_count}
                                <span className="text-muted-foreground text-xs ml-1">
                                  cars
                                </span>
                              </div>
                              <div
                                className="flex gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {canEdit && <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setEditRider(rider)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>}
                                {canEdit && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={async () => {
                                      const ok = await confirmDelete({
                                        title: `Delete rider "${rider.rider_name}"?`,
                                        description: "Cannot delete a rider with cars assigned. Move cars first.",
                                      });
                                      if (ok) deleteRider.mutate(rider.id);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </div>
                            {open && (
                              <>
                                <RiderCars riderId={rider.id} leaseType={lease.lease_type} />
                                <RiderContactsPanel riderId={rider.id} />
                                <div className="px-5 pb-3">
                                  <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-2">
                                    Account Management notes
                                  </div>
                                  <AmCommentThread riderId={rider.id} canCompose={false} canDelete={false} compact />
                                </div>
                                <div className="px-5 pb-2">
                                  <ActivityTimeline riderId={rider.id} canEdit={canEdit} title="Rider activity" />
                                </div>
                                <div className="px-5 py-4 border-t border-border/50">
                                  <AttachmentsPanel entityType="rider" entityId={rider.id} compact />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* MLA-level attachments */}
                    <div className="px-5 py-4 border-t border-border/50 bg-background/20">
                      <AttachmentsPanel entityType="master_lease" entityId={lease.id} compact />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <MasterLeaseForm
        open={addLeaseOpen || !!editLease}
        onClose={() => {
          setAddLeaseOpen(false);
          setEditLease(null);
        }}
        lease={editLease}
      />
      <RiderForm
        open={!!addRiderFor || !!editRider}
        onClose={() => {
          setAddRiderFor(null);
          setEditRider(null);
        }}
        masterLeaseId={addRiderFor}
        rider={editRider}
        accountManager={
          (leases ?? []).find((l) => l.id === (editRider?.master_lease_id ?? addRiderFor))
            ?.account_manager ?? null
        }
      />
    </div>
  );
}

// Optional columns definition for RiderCars (module-level so it's not re-created)
type RCOptCol = "entity" | "nbv" | "oac" | "oec" | "capacity_cf" | "lining" | "build_year";
const RC_OPT_COLS: { key: RCOptCol; label: string }[] = [
  { key: "entity",      label: "Entity" },
  { key: "nbv",         label: "NBV" },
  { key: "oac",         label: "OAC" },
  { key: "oec",         label: "OEC" },
  { key: "capacity_cf", label: "Capacity (cf)" },
  { key: "lining",      label: "Lining" },
  { key: "build_year",  label: "Build Year" },
];
const LC_DEFAULT_COLS = new Set<string>([]);
const RC_PINNED = ["marks", "car_number", "lease_type"] as const;
const RC_CORE_MOVABLE = ["lessee", "rental_status"] as const;
const RC_LABELS: Record<string, string> = {
  marks: "Marks",
  car_number: "Car Number",
  lessee: "Lessee",
  rental_status: "Rental Status",
  lease_type: "Lease Type",
  entity: "Entity",
  nbv: "NBV",
  oac: "OAC",
  oec: "OEC",
  capacity_cf: "Capacity (cf)",
  lining: "Lining",
  build_year: "Build Year",
};
const RC_WIDTHS: Record<string, number> = {
  marks: 80,
  car_number: 110,
  lessee: 140,
  rental_status: 120,
  lease_type: 150,
  entity: 90,
  nbv: 100,
  oac: 100,
  oec: 100,
  capacity_cf: 100,
  lining: 110,
  build_year: 90,
};

function fmtUsdCell(v: unknown) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function renderRcTd(key: string, c: any, leaseType: string | null | undefined) {
  const money = "px-3 py-1.5 font-mono-num text-muted-foreground whitespace-nowrap";
  const text = "px-3 py-1.5 text-muted-foreground";
  switch (key) {
    case "marks":
      return <td key={key} className="px-3 py-1.5 font-mono-num text-muted-foreground">{c.reporting_marks ?? "—"}</td>;
    case "car_number":
      return <td key={key} className="px-3 py-1.5 font-mono-num">{c.car_number}</td>;
    case "lessee":
      return <td key={key} className="px-3 py-1.5">{c.assignment?.fleet_name ?? "—"}</td>;
    case "rental_status":
      return <td key={key} className={text}>{displayRailcarStatus(displayStatusInputFromRailcar(c))}</td>;
    case "lease_type":
      return (
        <td key={key} className="px-3 py-1.5">
          <LeaseTypeBadge
            carType={c.lease_type}
            mlaType={c.assignment?.rider?.master_lease?.lease_type ?? leaseType}
          />
        </td>
      );
    case "entity":
      return <td key={key} className={text}>{c.entity ?? "—"}</td>;
    case "nbv":
      return <td key={key} className={money}>{fmtUsdCell(c.nbv)}</td>;
    case "oac":
      return <td key={key} className={money}>{fmtUsdCell(c.oac)}</td>;
    case "oec":
      return <td key={key} className={money}>{fmtUsdCell(c.oec)}</td>;
    case "capacity_cf":
      return <td key={key} className="px-3 py-1.5 font-mono-num text-muted-foreground">{c.capacity_cf != null ? Number(c.capacity_cf).toLocaleString() : "—"}</td>;
    case "lining":
      return <td key={key} className={text}>{c.lining_material || c.lining || c.coating || "—"}</td>;
    case "build_year":
      return <td key={key} className="px-3 py-1.5 font-mono-num text-muted-foreground">{carBuildYear(c) ?? "—"}</td>;
    default:
      return <td key={key} className={text}>—</td>;
  }
}

function RiderCars({ riderId, leaseType }: { riderId: number; leaseType?: string | null }) {
  const [, navigate] = useLocation();
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const { data: cars, isLoading, isError, error, refetch } = useQuery<RailcarWithAssignment[] | { rows?: RailcarWithAssignment[] }>({
    queryKey: ["/api/railcars", { all: "1", rider_id: riderId, active: activeFilter }],
    queryFn: () =>
      apiGet<RailcarWithAssignment[] | { rows?: RailcarWithAssignment[] }>(
        railcarsQs({ all: "1", rider_id: riderId, active: activeFilter })
      ),
    staleTime: 45_000,
  });
  const {
    visibleCols: visibleColsRaw,
    toggleCol,
    resetCols: resetVisibleCols,
    prefsLoaded: colPrefsLoaded,
    colOrder,
    setColOrder,
    colWidths,
    setColWidth,
  } = useColumnPrefs("lease_rider_cars", LC_DEFAULT_COLS);
  const visibleCols = visibleColsRaw as Set<RCOptCol>;

  const filtered = asRailcarList(cars).filter((c) => c.assignment?.rider_id === riderId);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const slice = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const displayKeys = useMemo(() => {
    const movable = [
      ...RC_CORE_MOVABLE,
      ...RC_OPT_COLS.filter((c) => visibleCols.has(c.key)).map((c) => c.key),
    ];
    return [...RC_PINNED, ...mergeColOrder(movable, colOrder)];
  }, [visibleCols, colOrder]);
  const tableW = tableWidthFor(displayKeys, colWidths, RC_WIDTHS, 110);

  return (
    <div className="px-5 pb-5 bg-muted/20 border-t border-border/60">
      {isLoading ? (
        <Skeleton className="h-10 mt-3 rounded" />
      ) : isError ? (
        <div className="text-sm text-red-400 flex items-center gap-2 px-2 py-3">
          Couldn't load cars for this rider — {(error as Error)?.message || "request failed"}.
          <button type="button" className="underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="pt-3 flex items-center justify-between mb-2 gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Assigned cars · {total}
            </span>
            <div className="flex items-center gap-2">
              <Select
                value={activeFilter}
                onValueChange={(v) => {
                  setActiveFilter(v as "active" | "inactive" | "all");
                  setPage(0);
                }}
              >
                <SelectTrigger className="h-7 w-[140px] text-[11px]" data-testid={`filter-rider-active-${riderId}`}>
                  <SelectValue placeholder="Active / inactive" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active cars</SelectItem>
                  <SelectItem value="inactive">Inactive cars</SelectItem>
                  <SelectItem value="all">All cars</SelectItem>
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    <Columns3 className="h-3 w-3" />
                    Columns
                    {!colPrefsLoaded ? (
                      <span className="h-2.5 w-2.5 rounded-full bg-muted animate-pulse" />
                    ) : visibleCols.size > 0 ? (
                      <span className="bg-primary text-primary-foreground rounded-full px-1 text-[9px] font-bold">{visibleCols.size}</span>
                    ) : null}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Show columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {RC_OPT_COLS.map(({ key, label }) => (
                    <DropdownMenuCheckboxItem key={key} checked={visibleCols.has(key)} onCheckedChange={() => toggleCol(key)}>
                      {label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {(visibleCols.size > 0 || colOrder.length > 0) && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-xs text-muted-foreground" onClick={() => resetVisibleCols()}>Reset</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {total === 0 ? (
            <div className="py-6 text-xs text-muted-foreground italic text-center">
              {activeFilter === "all" ? "No cars assigned to this rider." : `No ${activeFilter} cars assigned to this rider.`}
            </div>
          ) : (
            <>
          <div className="rounded-md border border-border bg-card overflow-auto max-h-[360px]">
            <table className="text-xs" style={{ tableLayout: "fixed", width: Math.max(480, tableW) }}>
              <colgroup>
                {displayKeys.map((k) => (
                  <col key={k} style={{ width: colWidth(colWidths, k, RC_WIDTHS[k] ?? 110) }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
                <tr>
                  {displayKeys.map((k) => (
                    <GridColumnTh
                      key={k}
                      colKey={k}
                      width={colWidth(colWidths, k, RC_WIDTHS[k] ?? 110)}
                      pinned={RC_PINNED.includes(k as (typeof RC_PINNED)[number])}
                      className="text-left px-3 py-2 font-medium bg-muted/40"
                      onResize={setColWidth}
                      onMove={(from, to) => setColOrder(moveCol(displayKeys.filter((x) => !RC_PINNED.includes(x as (typeof RC_PINNED)[number])), from, to))}
                    >
                      {RC_LABELS[k] ?? k}
                    </GridColumnTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-border hover-elevate cursor-pointer"
                    onClick={() => navigate(carPath(c.id))}
                    data-testid={`row-lease-car-${c.id}`}
                  >
                    {displayKeys.map((k) => renderRcTd(k, c, leaseType))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-xs">
              <Button
                size="sm"
                variant="ghost"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </Button>
              <span className="font-mono-num text-muted-foreground">
                {page + 1} / {pages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---- Rider Contacts Panel ----

function RiderContactsPanel({ riderId }: { riderId: number }) {
  const { toast } = useToast();
  const { canDeleteContacts } = usePermissions();
  const [addOpen, setAddOpen] = useState(false);
  const [editContact, setEditContact] = useState<RiderContact | null>(null);

  const { data: contacts, isLoading } = useQuery<RiderContact[]>({
    queryKey: ["/api/riders", riderId, "contacts"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/riders/${riderId}/contacts`);
      return res.json();
    },
  });

  const deleteContact = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/contacts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/riders", riderId, "contacts"] });
      toast({ title: "Contact removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="px-5 pb-5 bg-muted/10 border-t border-border/60">
      <div className="pt-3 flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Lessee Contacts
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAddOpen(true)} className="h-7 text-xs gap-1">
          <Plus className="h-3.5 w-3.5" /> Add Contact
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-12 rounded" />
      ) : (contacts ?? []).length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-4 text-center">
          No contacts added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {(contacts ?? []).map((c) => (
            <div key={c.id} className="rounded-md border border-border bg-card px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{c.name}</span>
                  {c.title && <span className="text-xs text-muted-foreground">· {c.title}</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <Mail className="h-3 w-3" />{c.email}
                    </a>
                  )}
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <Phone className="h-3 w-3" />{c.phone}
                    </a>
                  )}
                </div>
                {c.notes && <div className="text-xs text-muted-foreground mt-1 italic">{c.notes}</div>}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditContact(c)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                {canDeleteContacts && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={async () => {
                      const ok = await confirmDelete({
                        title: `Delete contact "${c.name}"?`,
                        description: "This will permanently delete this contact.",
                      });
                      if (ok) deleteContact.mutate(c.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ContactForm
        open={addOpen || !!editContact}
        onClose={() => { setAddOpen(false); setEditContact(null); }}
        riderId={riderId}
        contact={editContact}
      />
    </div>
  );
}

function ContactForm({
  open, onClose, riderId, contact,
}: {
  open: boolean;
  onClose: () => void;
  riderId: number;
  contact: RiderContact | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (open) {
      setForm({
        name: contact?.name ?? "",
        title: contact?.title ?? "",
        email: contact?.email ?? "",
        phone: contact?.phone ?? "",
        notes: contact?.notes ?? "",
      });
    }
  }, [open, contact]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        title: form.title || null,
        email: form.email || null,
        phone: form.phone || null,
        notes: form.notes || null,
      };
      if (contact) {
        await apiRequest("PATCH", `/api/contacts/${contact.id}`, body);
      } else {
        await apiRequest("POST", `/api/riders/${riderId}/contacts`, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/riders", riderId, "contacts"] });
      toast({ title: contact ? "Contact updated" : "Contact added" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Lessee Contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" />
          </div>
          <div>
            <Label>Title / Role</Label>
            <Input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Fleet Manager" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input type="tel" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (555) 000-0000" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Preferred contact for billing disputes…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={async () => {
              if (contact) {
                const ok = await confirmSave({
                  title: `Save changes to ${form.name?.trim() || contact.name}?`,
                  description: "Updates will be written to this contact record.",
                });
                if (!ok) return;
              }
              save.mutate();
            }}
            disabled={save.isPending || !form.name?.trim()}
          >
            {save.isPending ? "Saving…" : contact ? "Save" : "Add Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Forms ----

function MasterLeaseForm({
  open,
  onClose,
  lease,
}: {
  open: boolean;
  onClose: () => void;
  lease: any | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (open) {
      setForm({
        lease_number: lease?.lease_number ?? "",
        agreement_number: lease?.agreement_number ?? "",
        lessor: lease?.lessor ?? "",
        lessee: lease?.lessee ?? "",
        lease_type: lease?.lease_type ?? "",
        effective_date: lease?.effective_date ?? "",
        sold_to: lease?.sold_to ?? "",
        notes: lease?.notes ?? "",
      });
    }
  }, [open, lease]);

  const save = useMutation({
    mutationFn: async () => {
      if (lease) await apiRequest("PATCH", `/api/leases/${lease.id}`, form);
      else await apiRequest("POST", `/api/leases`, form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      toast({ title: lease ? "Lease updated" : "Lease created" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {lease ? "Edit Master Lease" : "Add Master Lease"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lease Number</Label>
              <Input
                value={form.lease_number ?? ""}
                onChange={(e) => setForm({ ...form, lease_number: e.target.value })}
              />
            </div>
            <div>
              <Label>Agreement Number</Label>
              <Input
                value={form.agreement_number ?? ""}
                onChange={(e) =>
                  setForm({ ...form, agreement_number: e.target.value })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lessor</Label>
              <Input
                value={form.lessor ?? ""}
                onChange={(e) => setForm({ ...form, lessor: e.target.value })}
              />
            </div>
            <div>
              <Label>Lessee</Label>
              <Input
                value={form.lessee ?? ""}
                onChange={(e) => setForm({ ...form, lessee: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lease Type</Label>
              <Select
                value={form.lease_type || undefined}
                onValueChange={(v) => setForm({ ...form, lease_type: v })}
              >
                <SelectTrigger data-testid="select-lease-type">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Net Lease">Net Lease</SelectItem>
                  <SelectItem value="Full Service Lease">Full Service Lease</SelectItem>
                  <SelectItem value="Modified Lease">Modified Lease</SelectItem>
                  {form.lease_type &&
                    !["Net Lease", "Full Service Lease", "Modified Lease"].includes(form.lease_type) && (
                      <SelectItem value={form.lease_type}>{form.lease_type}</SelectItem>
                    )}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Maintained here only — imports never overwrite this.
              </p>
            </div>
            <div>
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={form.effective_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, effective_date: e.target.value === "" ? null : e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <Label>Sold / Transferred To</Label>
            <Input
              value={form.sold_to ?? ""}
              onChange={(e) => setForm({ ...form, sold_to: e.target.value })}
              placeholder="Buyer / transferee company name (leave blank if not sold)"
            />
            {form.sold_to?.trim() && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                This MLA will be marked as SOLD
              </p>
            )}
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              if (lease) {
                const name = form.lease_number || lease.lease_number || `lease #${lease.id}`;
                const ok = await confirmSave({
                  title: `Save changes to ${name}?`,
                  description: "Master lease details will be updated.",
                });
                if (!ok) return;
              }
              save.mutate();
            }}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : lease ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RiderForm({
  open,
  onClose,
  masterLeaseId,
  rider,
  accountManager,
}: {
  open: boolean;
  onClose: () => void;
  masterLeaseId: number | null;
  rider: any | null;
  accountManager?: string | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (open) {
      setForm({
        master_lease_id: rider?.master_lease_id ?? masterLeaseId,
        rider_name: rider?.rider_name ?? "",
        schedule_number: rider?.schedule_number ?? "",
        effective_date: rider?.effective_date ?? "",
        expiration_date: rider?.expiration_date ?? "",
        permissible_commodity: rider?.permissible_commodity ?? "",
        monthly_rate_pct: rider?.monthly_rate_pct ?? "",
        lessors_cost: rider?.lessors_cost ?? "",
        base_term_months: rider?.base_term_months ?? "",
        monthly_rent_per_car: rider?.monthly_rent_per_car ?? "",
        owner_entity: rider?.owner_entity ?? "",
        sold_to: rider?.sold_to ?? "",
        notes: rider?.notes ?? "",
      });
    }
  }, [open, rider, masterLeaseId]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        monthly_rate_pct: form.monthly_rate_pct === "" ? null : Number(form.monthly_rate_pct),
        lessors_cost: form.lessors_cost === "" ? null : Number(form.lessors_cost),
        base_term_months: form.base_term_months === "" ? null : Number(form.base_term_months),
        monthly_rent_per_car: form.monthly_rent_per_car === "" ? null : Number(form.monthly_rent_per_car),
        owner_entity: form.owner_entity?.trim() || null,
        sold_to: form.sold_to?.trim() || null,
      };
      delete (body as any).notes;
      delete (body as any).account_manager;
      if (rider) await apiRequest("PATCH", `/api/riders/${rider.id}`, body);
      else await apiRequest("POST", `/api/riders`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: rider ? "Rider updated" : "Rider created" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rider ? "Edit Rider" : "Add Rider"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Rider Name</Label>
              <Input
                value={form.rider_name ?? ""}
                onChange={(e) => setForm({ ...form, rider_name: e.target.value })}
              />
            </div>
            <div>
              <Label>Schedule Number</Label>
              <Input
                value={form.schedule_number ?? ""}
                onChange={(e) =>
                  setForm({ ...form, schedule_number: e.target.value })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={form.effective_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, effective_date: e.target.value === "" ? null : e.target.value })
                }
              />
            </div>
            <div>
              <Label>Expiration Date</Label>
              <Input
                type="date"
                value={form.expiration_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, expiration_date: e.target.value === "" ? null : e.target.value })
                }
              />
              {rider ? <p className="text-[11px] text-muted-foreground mt-1"><ExpirationSourceTag rider={rider as any} /></p> : null}
            </div>
          </div>
          <div>
            <Label>Permissible Commodity</Label>
            <Input
              value={form.permissible_commodity ?? ""}
              onChange={(e) =>
                setForm({ ...form, permissible_commodity: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Monthly Rate %</Label>
              <Input
                type="number"
                step="0.001"
                value={form.monthly_rate_pct ?? ""}
                onChange={(e) =>
                  setForm({ ...form, monthly_rate_pct: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Lessor's Cost</Label>
              <Input
                type="number"
                step="0.01"
                value={form.lessors_cost ?? ""}
                onChange={(e) => setForm({ ...form, lessors_cost: e.target.value })}
              />
            </div>
            <div>
              <Label>Base Term (mo)</Label>
              <Input
                type="number"
                value={form.base_term_months ?? ""}
                onChange={(e) =>
                  setForm({ ...form, base_term_months: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <Label>Monthly Rent per Car ($)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 450.00"
              value={form.monthly_rent_per_car ?? ""}
              onChange={(e) => setForm({ ...form, monthly_rent_per_car: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">Typical range: $100 – $850 per car / month</p>
          </div>
          <div>
            <Label>Owner Entity</Label>
            <Input
              value={form.owner_entity ?? ""}
              onChange={(e) => setForm({ ...form, owner_entity: e.target.value })}
              placeholder="e.g. ALF P-I, RPS LLC"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Legal owning entity for this OL. Loaded once from the Asset Report — not overwritten by imports.
            </p>
          </div>
          <div>
            <Label>Account Manager</Label>
            <Input value={accountManager?.trim() ? accountManager : "—"} readOnly />
            <p className="text-xs text-muted-foreground mt-1">
              Set on the Account in Account Management — applies to every OL under this customer.
            </p>
          </div>
          <div>
            <Label>Sold / Transferred To</Label>
            <Input
              value={form.sold_to ?? ""}
              onChange={(e) => setForm({ ...form, sold_to: e.target.value })}
              placeholder="Buyer / transferee company name (leave blank if not sold)"
            />
            {form.sold_to?.trim() && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                This rider will be marked as SOLD
              </p>
            )}
          </div>
          <div>
            <Label>Notes</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Add timestamped notes on the rider Activity timeline after saving. Prior comments are never overwritten.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              if (rider) {
                const name = form.rider_name || rider.rider_name || `rider #${rider.id}`;
                const ok = await confirmSave({
                  title: `Save changes to ${name}?`,
                  description: "Rider details will be updated.",
                });
                if (!ok) return;
              }
              save.mutate();
            }}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : rider ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
