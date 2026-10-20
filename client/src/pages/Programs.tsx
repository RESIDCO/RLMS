import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, downloadXlsx } from "@/lib/queryClient";
import { invalidateFleetQueries } from "@/lib/fleetQueryRefresh";
import { useCanEdit, useIsAdmin } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import PageHeader from "@/components/PageHeader";
import { FolderOpen, Plus, Download, FileSpreadsheet } from "lucide-react";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { ColumnPicker } from "@/components/ColumnPicker";
import { mergeColOrder } from "@/lib/grid-columns";
import { ColumnHeaderLabel } from "@/components/ColumnHelp";
import { columnLabel } from "@shared/column-dictionary";
import { cn } from "@/lib/utils";
import { navigateHash, programPathWithFrom, useHashSearch } from "@/lib/hash-location";
import ProgramCarPicker, { type PickedCar } from "@/components/ProgramCarPicker";
import AccountCombobox from "@/components/AccountCombobox";
import { ProgramPreviewDialog } from "@/components/ProgramPreviewDialog";
import { ProgramTrackerSyncDialog } from "@/components/ProgramTrackerSyncDialog";
import {
  LIFECYCLE_BADGE,
  LIFECYCLE_LABEL,
  PROGRAM_ENTITIES,
  PROGRAM_TYPES,
  overlayLifecycle,
  type ProgramLifecycle,
  type ProgramStatus,
} from "@shared/programs";
import { withOnlyColumnsWithData } from "@shared/program-export-columns";
import { OnlyColumnsWithDataToggle } from "@/components/OnlyColumnsWithDataToggle";

type Category = { id: number; name: string };
type ProgramRow = {
  id: number;
  name: string;
  description: string | null;
  status: ProgramStatus;
  lifecycle?: string | null;
  type?: string | null;
  closed_date?: string | null;
  entity: string | null;
  account_manager: string | null;
  target_completion_date?: string | null;
  updated_at: string;
  category: { id: number; name: string } | null;
  progress?: {
    display_type?: string | null;
    lifecycle?: string;
    done?: number;
    remaining?: number;
    total_open_links?: number;
    ready_to_close?: boolean;
    stale?: boolean;
    target_completion_date?: string | null;
  } | null;
};

async function downloadReport(url: string) {
  await downloadXlsx(url, "RLMS_Program_Status_Report.xlsx");
}

const LIFE_FILTERS = new Set(["all", "draft", "active", "closed", "cancelled", "ready", "stale"]);

function statusFromParams(params: URLSearchParams): string {
  const s = params.get("status")?.trim().toLowerCase() ?? "";
  if (s === "open" || s === "on_hold" || s === "complete") return s === "complete" ? "closed" : "active";
  return LIFE_FILTERS.has(s) ? s : "active";
}

type ProgramListFilters = {
  q: string;
  status: string;
  type: string;
  category: string;
  entity: string;
  manager: string;
};

function readListFilters(params: URLSearchParams): ProgramListFilters {
  return {
    q: params.get("q") ?? "",
    status: statusFromParams(params),
    type: params.get("type")?.trim() || "all",
    category: params.get("category")?.trim() || "all",
    entity: params.get("entity")?.trim() || "all",
    manager: params.get("manager")?.trim() || "all",
  };
}

function programsListQuery(filters: ProgramListFilters): string {
  const p = new URLSearchParams();
  if (filters.q.trim()) p.set("q", filters.q.trim());
  if (filters.status && filters.status !== "active") p.set("status", filters.status);
  if (filters.type && filters.type !== "all") p.set("type", filters.type);
  if (filters.category && filters.category !== "all") p.set("category", filters.category);
  if (filters.entity && filters.entity !== "all") p.set("entity", filters.entity);
  if (filters.manager && filters.manager !== "all") p.set("manager", filters.manager);
  return p.toString();
}

function programsListHref(filters: ProgramListFilters): string {
  const qs = programsListQuery(filters);
  return qs ? `/programs?${qs}` : "/programs";
}

const PROGRAM_LIST_COLS: { key: string; label: string; pinned?: boolean }[] = [
  { key: "title", label: "Title", pinned: true },
  { key: "type", label: "Type" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "progress", label: "Progress" },
  { key: "target", label: "Target date" },
  { key: "ready", label: "Ready" },
  { key: "owner", label: "Owner" },
  { key: "entity", label: "Entity" },
];
const PROGRAM_LIST_DEFAULT = new Set(PROGRAM_LIST_COLS.map((c) => c.key));

export default function ProgramsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useCanEdit();
  const isAdmin = useIsAdmin();
  const [trackerOpen, setTrackerOpen] = useState(false);
  const hashSearch = useHashSearch();
  const hashFilters = useMemo(
    () => readListFilters(new URLSearchParams(hashSearch.replace(/^\?/, ""))),
    [hashSearch],
  );
  const [search, setSearch] = useState(hashFilters.q);
  const [statusFilter, setStatusFilter] = useState(hashFilters.status);
  const [typeFilter, setTypeFilter] = useState(hashFilters.type);
  const [categoryFilter, setCategoryFilter] = useState(hashFilters.category);
  const [entityFilter, setEntityFilter] = useState(hashFilters.entity);
  const [managerFilter, setManagerFilter] = useState(hashFilters.manager);
  const [onlyColumnsWithData, setOnlyColumnsWithData] = useState(true);

  useEffect(() => {
    setSearch(hashFilters.q);
    setStatusFilter(hashFilters.status);
    setTypeFilter(hashFilters.type);
    setCategoryFilter(hashFilters.category);
    setEntityFilter(hashFilters.entity);
    setManagerFilter(hashFilters.manager);
  }, [hashFilters]);

  const listFilters: ProgramListFilters = {
    q: search,
    status: statusFilter,
    type: typeFilter,
    category: categoryFilter,
    entity: entityFilter,
    manager: managerFilter,
  };

  function replaceListFilters(next: ProgramListFilters) {
    setSearch(next.q);
    setStatusFilter(next.status);
    setTypeFilter(next.type);
    setCategoryFilter(next.category);
    setEntityFilter(next.entity);
    setManagerFilter(next.manager);
    navigateHash(programsListHref(next), { replace: true });
  }

  function openProgram(id: number) {
    const qs = hashSearch.replace(/^\?/, "") || programsListQuery(listFilters);
    navigateHash(programPathWithFrom(id, qs));
  }
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const colPrefs = useColumnPrefs("programs", PROGRAM_LIST_DEFAULT);
  const programColKeys = useMemo(() => {
    const movable = PROGRAM_LIST_COLS.filter((c) => !c.pinned && colPrefs.visibleCols.has(c.key)).map((c) => c.key);
    return ["title", ...mergeColOrder(movable, colPrefs.colOrder)];
  }, [colPrefs.visibleCols, colPrefs.colOrder]);
  const showProg = (key: string) => programColKeys.includes(key);

  const { data: programs = [], isLoading } = useQuery<ProgramRow[]>({
    queryKey: ["/api/programs"],
  });
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/programs/categories"],
    queryFn: () => apiRequest("GET", "/api/programs/categories").then((r) => r.json()),
  });

  const managers = useMemo(() => {
    const s = new Set<string>();
    for (const p of programs) {
      const m = String(p.account_manager ?? "").trim();
      if (m) s.add(m);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [programs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = programs.filter((p) => {
      const blob = `${p.name} ${p.status_narrative ?? ""} ${p.description ?? ""}`.toLowerCase();
      if (q && !blob.includes(q)) return false;
      const lc = (p.progress?.lifecycle ?? overlayLifecycle(p)) as ProgramLifecycle;
      const type = p.progress?.display_type ?? p.type ?? "";
      if (statusFilter === "ready") {
        if (!p.progress?.ready_to_close) return false;
      } else if (statusFilter === "stale") {
        if (!p.progress?.stale) return false;
      } else if (statusFilter !== "all" && lc !== statusFilter) return false;
      if (typeFilter !== "all" && type !== typeFilter) return false;
      if (categoryFilter !== "all" && String((p as any).category_id) !== categoryFilter) return false;
      if (entityFilter !== "all" && p.entity !== entityFilter) return false;
      if (managerFilter !== "all" && (p.account_manager ?? "") !== managerFilter) return false;
      return true;
    });
    return [...rows].sort((a, b) => Number(a.progress?.lifecycle === "closed") - Number(b.progress?.lifecycle === "closed"));
  }, [programs, search, statusFilter, typeFilter, categoryFilter, entityFilter, managerFilter]);

  function toggle(id: number) {
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
      toast({ title: "Select at least one program", variant: "destructive" });
      return;
    }
    try {
      await downloadReport(withOnlyColumnsWithData(`/api/programs/export?ids=${ids.join(",")}`, onlyColumnsWithData));
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  }

  async function exportOpen() {
    const ids = programs.filter((p) => (p.progress?.lifecycle ?? overlayLifecycle(p)) === "active").map((p) => p.id);
    if (!ids.length) {
      toast({ title: "No open programs to export", variant: "destructive" });
      return;
    }
    try {
      await downloadReport(withOnlyColumnsWithData(`/api/programs/export?ids=${ids.join(",")}`, onlyColumnsWithData));
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  }

  async function exportMaster() {
    try {
      await downloadReport(withOnlyColumnsWithData("/api/programs/export?scope=all", onlyColumnsWithData));
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <ProgramTrackerSyncDialog open={trackerOpen} onClose={() => setTrackerOpen(false)} />
      <PageHeader
        title="Programs"
        subtitle="Open work across the fleet — returns, remarks, acquisitions, qualifications, inspections"
        actions={
          <div className="flex gap-2 flex-wrap items-center">
            <OnlyColumnsWithDataToggle
              id="programs-export-only-columns-with-data"
              checked={onlyColumnsWithData}
              onCheckedChange={setOnlyColumnsWithData}
            />
            <Button size="sm" variant="outline" onClick={exportOpen} data-testid="button-export-open-programs">
              <Download className="h-4 w-4" /> Export open
            </Button>
            <Button size="sm" variant="outline" onClick={exportSelected} disabled={!selected.size} data-testid="button-export-selected-programs">
              <Download className="h-4 w-4" /> Export selected
            </Button>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setTrackerOpen(true)} data-testid="button-tracker-sync">
                <FileSpreadsheet className="h-4 w-4" /> Tracker sync
              </Button>
            )}
            {canEdit && (
              <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-program">
                <Plus className="h-4 w-4" /> New Program
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-4 sm:px-8 py-4 gap-4">
        <div className="shrink-0 rounded-xl border border-card-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Reports</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Every program — open, on hold, and complete — as one workbook. No selection needed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <OnlyColumnsWithDataToggle
              id="programs-master-export-only-columns-with-data"
              checked={onlyColumnsWithData}
              onCheckedChange={setOnlyColumnsWithData}
            />
            <Button size="sm" variant="outline" onClick={exportMaster} data-testid="button-export-master-fleet-report">
              <FileSpreadsheet className="h-4 w-4" /> Export Master Fleet Project Status Report
            </Button>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          <ClearableSearchInput
            className="relative flex-1 min-w-[200px] max-w-sm"
            inputClassName="h-9"
            placeholder="Search name or status narrative…"
            value={search}
            onChange={(v) => replaceListFilters({ ...listFilters, q: v })}
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => replaceListFilters({ ...listFilters, status: v })}
          >
            <SelectTrigger className="h-9 w-48 text-sm"><SelectValue placeholder="Lifecycle" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lifecycles</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="ready">Ready to review</SelectItem>
              <SelectItem value="stale">Stale</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => replaceListFilters({ ...listFilters, type: v })}>
            <SelectTrigger className="h-9 w-48 text-sm"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {PROGRAM_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={(v) => replaceListFilters({ ...listFilters, category: v })}>
            <SelectTrigger className="h-9 w-48 text-sm"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={(v) => replaceListFilters({ ...listFilters, entity: v })}>
            <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {PROGRAM_ENTITIES.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {managers.length > 0 && (
            <Select value={managerFilter} onValueChange={(v) => replaceListFilters({ ...listFilters, manager: v })}>
              <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="Manager" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All managers</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ColumnPicker
            columns={PROGRAM_LIST_COLS.map((c) => ({
              ...c,
              label: columnLabel("programs", c.key, c.label),
            }))}
            prefs={colPrefs}
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground p-4">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-10 text-center">
            <FolderOpen className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground italic">
              {programs.length === 0 ? "No programs yet — create one to get started." : "No programs match your filter."}
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-[240px] rounded-xl border border-card-border bg-card overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card text-[11px] uppercase tracking-wider text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))] [&>tr>th]:bg-card">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  {showProg("title") && <th className="text-left px-3 py-2 font-medium"><ColumnHeaderLabel listKey="programs" colKey="title" /></th>}
                  {showProg("type") && <th className="text-left px-3 py-2 font-medium"><ColumnHeaderLabel listKey="programs" colKey="type" /></th>}
                  {showProg("lifecycle") && <th className="text-left px-3 py-2 font-medium"><ColumnHeaderLabel listKey="programs" colKey="lifecycle" /></th>}
                  {showProg("progress") && <th className="text-left px-3 py-2 font-medium"><ColumnHeaderLabel listKey="programs" colKey="progress" /></th>}
                  {showProg("target") && <th className="text-left px-3 py-2 font-medium"><ColumnHeaderLabel listKey="programs" colKey="target" /></th>}
                  {showProg("ready") && <th className="text-left px-3 py-2 font-medium"><ColumnHeaderLabel listKey="programs" colKey="ready" /></th>}
                  {showProg("owner") && <th className="text-left px-3 py-2 font-medium hidden lg:table-cell"><ColumnHeaderLabel listKey="programs" colKey="owner" /></th>}
                  {showProg("entity") && <th className="text-left px-3 py-2 font-medium hidden md:table-cell"><ColumnHeaderLabel listKey="programs" colKey="entity" /></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const lc = (p.progress?.lifecycle ?? overlayLifecycle(p)) as ProgramLifecycle;
                  const done = p.progress?.done ?? 0;
                  const total = p.progress?.total_open_links ?? 0;
                  const pct = total ? Math.round((done / total) * 100) : 0;
                  const target = (p.progress?.target_completion_date ?? p.target_completion_date ?? "").toString().slice(0, 10);
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-border/50 hover:bg-muted/30 cursor-pointer"
                      onClick={() => openProgram(p.id)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />
                      </td>
                      {showProg("title") && (
                      <td className="px-3 py-2">
                        <div className="font-medium">{p.name}</div>
                      </td>
                      )}
                      {showProg("type") && <td className="px-3 py-2 text-sm">{p.progress?.display_type ?? p.type ?? "—"}</td>}
                      {showProg("lifecycle") && (
                      <td className="px-3 py-2">
                        <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border", LIFECYCLE_BADGE[lc])}>
                          {LIFECYCLE_LABEL[lc]}
                        </span>
                      </td>
                      )}
                      {showProg("progress") && (
                      <td className="px-3 py-2 min-w-[8rem]">
                        <div className="h-1.5 rounded bg-muted overflow-hidden">
                          <div className="h-full bg-umler-teal" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{done}/{total}</div>
                      </td>
                      )}
                      {showProg("target") && (
                      <td className="px-3 py-2 text-xs">
                        {target || "—"}
                        {p.progress?.stale ? (
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-umler-amber">Stale</span>
                        ) : null}
                      </td>
                      )}
                      {showProg("ready") && (
                      <td className="px-3 py-2">
                        {p.progress?.ready_to_close ? (
                          <span className="text-[10px] uppercase tracking-wide font-semibold text-umler-teal">Ready</span>
                        ) : "—"}
                      </td>
                      )}
                      {showProg("owner") && <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{p.account_manager ?? "—"}</td>}
                      {showProg("entity") && <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{p.entity ?? "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      <CreateProgramDialog
        open={createOpen}
        categories={categories}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ["/api/programs"] });
          void invalidateFleetQueries(qc);
          openProgram(id);
        }}
      />
    </div>
  );
}

function CreateProgramDialog({
  open,
  categories,
  onClose,
  onCreated,
}: {
  open: boolean;
  categories: Category[];
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [typeOther, setTypeOther] = useState("");
  const [entity, setEntity] = useState("");
  const [manager, setManager] = useState("");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [cars, setCars] = useState<PickedCar[]>([]);
  const [pending, setPending] = useState(false);
  const [addPreview, setAddPreview] = useState<any>(null);
  const { data: accounts = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/accounts"],
    enabled: open,
  });

  async function save(asDraft: boolean) {
    if (!name.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    setPending(true);
    try {
      const res = await apiRequest("POST", "/api/programs", {
        name: name.trim(),
        as_draft: asDraft,
        type: type || null,
        type_other: type === "Other" ? typeOther.trim() || null : null,
        entity: entity || null,
        account_manager: manager.trim() || null,
        account_id: accountId,
        description: description.trim() || null,
        target_completion_date: target || null,
        railcar_ids: cars.map((c) => c.id),
      });
      const payload = await res.json();
      const row = payload.program ?? payload;
      if (payload.add_preview) {
        setAddPreview({ ...payload.add_preview, programId: row.id });
        return;
      }
      finish(row.id);
    } catch (e: any) {
      toast({ title: "Could not create program", description: e.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  function finish(id: number) {
    onCreated(id);
    setName("");
    setType("");
    setTypeOther("");
    setEntity("");
    setManager("");
    setAccountId(null);
    setDescription("");
    setTarget("");
    setCars([]);
    setAddPreview(null);
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => {
      if (o || addPreview) return;
      onClose();
    }}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New program</DialogTitle>
          <DialogDescription>Title is required. Type, date, entity and cars are optional.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OL2526 — Solvay Return" />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type || "none"} onValueChange={(v) => setType(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {PROGRAM_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {type === "Other" && (
              <Input className="mt-2" value={typeOther} onChange={(e) => setTypeOther(e.target.value)} placeholder="Describe type" />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Entity</Label>
              <Select value={entity || "none"} onValueChange={(v) => setEntity(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Entity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {PROGRAM_ENTITIES.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Account manager</Label>
              <Input value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Bahnline" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Account</Label>
            <AccountCombobox accounts={accounts} value={accountId} onChange={setAccountId} />
            <p className="text-[11px] text-muted-foreground mt-1">
              Optional customer link. Account manager on this program stays independent.
            </p>
          </div>
          <div>
            <Label className="text-xs">Target completion (optional)</Label>
            <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="border-t border-border pt-3">
            <Label className="text-xs">Add cars now (optional)</Label>
            <p className="text-[11px] text-muted-foreground mb-2">Skip this if you want to add cars later from Program Detail.</p>
            <ProgramCarPicker value={cars} onChange={setCars} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Back</Button>
            <Button type="button" variant="outline" onClick={() => save(true)} disabled={pending || Boolean(addPreview)}>Create as Draft</Button>
            <Button type="button" onClick={() => save(false)} disabled={pending || Boolean(addPreview)}>{pending ? "Creating…" : "Create"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <ProgramPreviewDialog
      open={Boolean(addPreview)}
      title="Add cars"
      preview={addPreview}
      pending={pending}
      onClose={() => addPreview?.programId && finish(addPreview.programId)}
      onApply={async () => {
        if (!addPreview?.preview_token) return;
        setPending(true);
        try {
          await apiRequest("POST", `/api/programs/${addPreview.programId}/cars/apply`, {
            preview_token: addPreview.preview_token,
          });
          finish(addPreview.programId);
        } catch (e: any) {
          toast({ title: "Could not add cars", description: e.message, variant: "destructive" });
        } finally {
          setPending(false);
        }
      }}
    />
    </>
  );
}
