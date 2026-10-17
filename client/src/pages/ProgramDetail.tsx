import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, downloadXlsx } from "@/lib/queryClient";
import { useCanEdit, useIsAdmin } from "@/lib/AuthContext";
import { ProgramPreviewDialog } from "@/components/ProgramPreviewDialog";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { confirmDelete, confirmSave } from "@/components/ConfirmActionDialog";
import ProgramDocsPanel from "@/components/ProgramDocsPanel";
import ProgramCarPicker, { type PickedCar } from "@/components/ProgramCarPicker";
import ShopCombobox, { type ShopOption } from "@/components/ShopCombobox";
import AccountCombobox from "@/components/AccountCombobox";
import { AccountDirectoryPeople } from "@/components/AccountDirectoryPeople";
import { carPathFromProgram, navigateHash, programsPathFromQuery, useHashSearch } from "@/lib/hash-location";
import { cn } from "@/lib/utils";
import { ArrowLeft, ChevronDown, ChevronRight, Download, History, Loader2, Plus, Paperclip, UserMinus } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { ColumnPicker } from "@/components/ColumnPicker";
import { columnLabel } from "@shared/column-dictionary";
import { GridColumnTh } from "@/components/GridColumnTh";
import { colWidth, mergeColOrder, moveCol, tableWidthFor } from "@/lib/grid-columns";
import {
  CATEGORY_BADGE,
  LIFECYCLE_BADGE,
  LIFECYCLE_LABEL,
  MILESTONES_BY_TYPE,
  TRAIL_MILESTONES,
  COMPLETION_LABEL,
  COMPLETION_LEVELS,
  deriveCompletionLevel,
  putOnRentProgramTypes,
  type CompletionLevel,
  PROGRAM_CAR_DOC_CATEGORIES,
  PROGRAM_DOC_CATEGORIES,
  PROGRAM_ENTITIES,
  PROGRAM_TYPES,
  STATUS_BADGE,
  STATUS_LABEL,
  categoryShortName,
  formatCustomField,
  isProgramType,
  overlayLifecycle,
  type ProgramFieldDef,
  type ProgramLifecycle,
  type ProgramStatus,
  type ProgramType,
} from "@shared/programs";
import { COMMITMENT_TYPES } from "@shared/commitment";

type Category = { id: number; name: string };
type StatusOption = { id: number; value: string; sort_order: number };

type Program = {
  id: number;
  name: string;
  description: string | null;
  status: ProgramStatus;
  category_id: number | null;
  tags: string[] | null;
  entity: string | null;
  account_manager: string | null;
  account_id: number | null;
  account: { id: number; name: string } | null;
  status_narrative: string | null;
  percent_complete: number | null;
  target_completion_date: string | null;
  opened_date: string | null;
  closed_date: string | null;
  lifecycle?: string | null;
  type?: string | null;
  type_other?: string | null;
  pending_note?: string | null;
  updated_at?: string;
  category: { id: number; name: string } | null;
  field_defs: ProgramFieldDef[];
  progress?: {
    lifecycle?: string;
    display_type?: string | null;
    done?: number;
    remaining?: number;
    total_open_links?: number;
    ready_to_close?: boolean;
    stale?: boolean;
  } | null;
};

type ProgramCar = {
  id: number;
  railcar_id: number;
  status: string | null;
  notes: string | null;
  flag_tag: string | null;
  joined_date: string | null;
  exited_date: string | null;
  completed?: boolean;
  completed_at?: string | null;
  milestone?: string | null;
  milestone_at?: string | null;
  outcome_reached_at?: string | null;
  rider_external_id_snapshot: string | null;
  shop_id: number | null;
  scrap_yard_id: number | null;
  repair_cost_total: number | null;
  custom_fields: Record<string, unknown>;
  doc_count: number;
  railcar: {
    id: number;
    car_number: string;
    reporting_marks: string | null;
    rider_external_id: string | null;
    active?: boolean | null;
  } | null;
  shop: { id: number; name: string } | null;
  kpi?: { derived_status?: string | null; off_rent?: boolean; on_rent?: boolean } | null;
  open_commitment?: { name?: string | null; type?: string | null; program_id?: number | null } | null;
  in_multiple_programs?: boolean;
  railcar_active?: boolean;
  trail?: { milestone: string; milestone_date: string | null }[];
  completion_level?: CompletionLevel;
  work_complete_at?: string | null;
  arrived_at?: string | null;
  program_done_at?: string | null;
  program_done_step?: string | null;
};

type HeaderDraft = {
  entity: string;
  account_manager: string;
  account_id: number | null;
  description: string;
  status_narrative: string;
  opened_date: string;
  target_completion_date: string;
  closed_date: string;
  tags: string;
  category_id: string;
  type: string;
  type_other: string;
  pending_note: string;
};

function headerFrom(p: Program): HeaderDraft {
  return {
    entity: p.entity ?? "",
    account_manager: p.account_manager ?? "",
    account_id: p.account_id ?? p.account?.id ?? null,
    description: p.description ?? "",
    status_narrative: p.status_narrative ?? "",
    opened_date: p.opened_date?.slice(0, 10) ?? "",
    target_completion_date: p.target_completion_date?.slice(0, 10) ?? "",
    closed_date: p.closed_date?.slice(0, 10) ?? "",
    tags: (p.tags ?? []).join(", "),
    category_id: p.category_id != null ? String(p.category_id) : "",
    type: p.type ?? p.progress?.display_type ?? "",
    type_other: p.type_other ?? "",
    pending_note: p.pending_note ?? "",
  };
}

function carLabelOf(c: ProgramCar): string {
  return [c.railcar?.reporting_marks, c.railcar?.car_number].filter(Boolean).join(" ") || `#${c.railcar_id}`;
}

function programCarSortValue(c: ProgramCar, key: string): string {
  switch (key) {
    case "car":
      return carLabelOf(c).toLowerCase();
    case "complete":
      return c.outcome_reached_at || c.completed ? "1" : "0";
    case "completion":
      return c.completion_level ?? "";
    case "active":
      return c.railcar?.active === true ? "1" : "0";
    case "milestone":
      return (c.milestone ?? "").toLowerCase();
    case "milestone_at":
      return String(c.milestone_at ?? "").slice(0, 10);
    case "status":
      return (c.status ?? "").toLowerCase();
    case "notes":
    case "comment":
      return (c.notes ?? "").toLowerCase();
    case "shop":
      return (c.shop?.name ?? "").toLowerCase();
    case "commitment":
      return `${c.open_commitment?.type ?? ""} ${c.open_commitment?.name ?? ""}`.toLowerCase();
    case "kpi":
      return (c.kpi?.derived_status ?? "").toLowerCase();
    default:
      return "";
  }
}

function mergeCarPatch(cur: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...cur, ...patch };
  if (patch.custom_fields && typeof patch.custom_fields === "object") {
    next.custom_fields = {
      ...((cur.custom_fields && typeof cur.custom_fields === "object" ? cur.custom_fields : {}) as Record<string, unknown>),
      ...(patch.custom_fields as Record<string, unknown>),
    };
  }
  return next;
}

function applyCarDraft(car: ProgramCar, patch: Record<string, unknown> | undefined, shops: ShopOption[]): ProgramCar {
  if (!patch) return car;
  const next: ProgramCar = { ...car, custom_fields: { ...(car.custom_fields ?? {}) } };
  if (patch.completed !== undefined) next.completed = Boolean(patch.completed);
  if (patch.status !== undefined) next.status = patch.status === "" ? null : String(patch.status);
  if (patch.flag_tag !== undefined) next.flag_tag = patch.flag_tag === "" ? null : String(patch.flag_tag);
  if (patch.notes !== undefined) next.notes = patch.notes === "" ? null : String(patch.notes);
  if (patch.shop_id !== undefined) {
    const shopId = patch.shop_id === "" || patch.shop_id == null ? null : Number(patch.shop_id);
    next.shop_id = shopId;
    next.shop = shopId == null ? null : shops.find((s) => s.id === shopId) ?? car.shop;
  }
  if (patch.repair_cost_total !== undefined) {
    const n = patch.repair_cost_total === "" || patch.repair_cost_total == null ? null : Number(patch.repair_cost_total);
    next.repair_cost_total = n != null && Number.isFinite(n) ? n : null;
  }
  if (patch.custom_fields && typeof patch.custom_fields === "object") {
    next.custom_fields = { ...next.custom_fields, ...(patch.custom_fields as Record<string, unknown>) };
  }
  if (patch.milestone !== undefined) next.milestone = patch.milestone === "" ? null : String(patch.milestone);
  if (patch.milestone_at !== undefined) {
    next.milestone_at = patch.milestone_at ? String(patch.milestone_at).slice(0, 10) : null;
  }
  if (patch.outcome_reached === true) {
    next.outcome_reached_at = new Date().toISOString().slice(0, 10);
    next.completed = true;
  }
  if (patch.outcome_reached === false) {
    next.outcome_reached_at = null;
    next.completed = false;
  }
  next.completion_level = deriveCompletionLevel({
    active: next.railcar?.active,
    status: next.status,
    milestone: next.milestone,
    milestones: car.trail,
  });
  return next;
}

const PD_CORE = ["completion", "active", "milestone", "milestone_at", "status", "notes", "shop", "commitment", "kpi"] as const;
const PD_DEFAULT_COLS = new Set<string>(PD_CORE);
const PD_LABELS: Record<string, string> = {
  car: "Car",
  complete: "Outcome",
  completion: "Completion",
  active: "Active",
  milestone: "Milestone",
  milestone_at: "Milestone date",
  notes: "Notes",
  status: "Status",
  shop: "Shop / yard",
  commitment: "Commitment",
  kpi: "KPI bucket",
};
const PD_WIDTHS: Record<string, number> = {
  _select: 36,
  car: 140,
  complete: 84,
  status: 220,
  flag: 140,
  comment: 180,
  notes: 180,
  commitment: 200,
  ol_entry: 110,
  ol_now: 110,
  shop: 160,
  repair: 90,
  _actions: 120,
};

function formatActivity(a: any): string {
  const car = a.railcar ? [a.railcar.reporting_marks, a.railcar.car_number].filter(Boolean).join(" ") : "";
  const action = String(a.action ?? "").replace(/_/g, " ");
  const from = a.detail?.from;
  const to = a.detail?.to;
  const change = from != null || to != null ? ` · ${from || "—"} → ${to || "—"}` : "";
  return `${action}${car ? ` · ${car}` : ""}${change}`;
}

async function downloadReport(url: string) {
  await downloadXlsx(url, "RLMS_Program_Status_Report.xlsx");
}

export default function ProgramDetailPage() {
  const [, params] = useRoute("/programs/:id");
  const id = Number(params?.id);
  const hashSearch = useHashSearch();
  const fromListQuery = new URLSearchParams(hashSearch.replace(/^\?/, "")).get("from");
  const programQuery = hashSearch.replace(/^\?/, "");
  const programsHref = programsPathFromQuery(fromListQuery);
  function goBackToPrograms() {
    navigateHash(programsHref);
  }
  const canEdit = useCanEdit();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [includeExited, setIncludeExited] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [levelFilter, setLevelFilter] = useState<Set<CompletionLevel>>(
    () => new Set(["not_started", "in_progress", "work_done"]),
  );
  const [moreFields, setMoreFields] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [lifePreview, setLifePreview] = useState<any>(null);
  const [docsFor, setDocsFor] = useState<ProgramCar | null>(null);
  const [historyFor, setHistoryFor] = useState<ProgramCar | null>(null);
  const [tab, setTab] = useState("cars");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [header, setHeader] = useState<HeaderDraft | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [carDrafts, setCarDrafts] = useState<Record<number, Record<string, unknown>>>({});
  const [carSaving, setCarSaving] = useState(false);
  const [carSavedFlash, setCarSavedFlash] = useState(false);
  const [carSaveError, setCarSaveError] = useState<string | null>(null);
  const [carFilter, setCarFilter] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteMatch, setPasteMatch] = useState<{
    requested: number;
    matched_count: number;
    matched: { token: string; link_id: number; label: string }[];
    not_found: { token: string }[];
    ambiguous: { token: string; matches: { label: string }[] }[];
  } | null>(null);
  const [pastePending, setPastePending] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [rentOpen, setRentOpen] = useState(false);
  const lastSelectId = useRef<number | null>(null);
  const leaveDirtyRef = useRef(false);
  const heldHashRef = useRef(typeof window !== "undefined" ? window.location.hash : "");
  const skipHashRef = useRef(false);

  const { data: program, isLoading, error } = useQuery<Program>({
    queryKey: ["/api/programs", id],
    queryFn: () => apiRequest("GET", `/api/programs/${id}`).then((r) => r.json()),
    enabled: Number.isFinite(id) && id > 0,
  });
  const carsKey = ["/api/programs", id, "cars", includeExited] as const;
  const { data: cars = [] } = useQuery<ProgramCar[]>({
    queryKey: carsKey,
    queryFn: () =>
      apiRequest("GET", `/api/programs/${id}/cars?include_exited=${includeExited ? "1" : "0"}`).then((r) => r.json()),
    enabled: Number.isFinite(id) && id > 0,
  });
  const { data: activity = [] } = useQuery<any[]>({
    queryKey: ["/api/programs", id, "activity"],
    queryFn: () => apiRequest("GET", `/api/programs/${id}/activity`).then((r) => r.json()),
    enabled: Number.isFinite(id) && id > 0 && (tab === "activity" || !!historyFor),
  });
  const { data: shops = [] } = useQuery<ShopOption[]>({
    queryKey: ["/api/programs/shops"],
    queryFn: () => apiRequest("GET", "/api/programs/shops").then((r) => r.json()),
  });
  const { data: riders = [] } = useQuery<{ id: number; rider_name: string | null; schedule_number: string | null }[]>({
    queryKey: ["/api/riders"],
    queryFn: () => apiRequest("GET", "/api/riders").then((r) => r.json()),
    enabled: rentOpen,
  });
  const { data: trail = [] } = useQuery<
    { id: number; milestone: string; milestone_date: string; note: string | null; actor: string | null }[]
  >({
    queryKey: ["/api/programs", id, "cars", detailId, "milestones"],
    queryFn: () =>
      apiRequest("GET", `/api/programs/${id}/cars/${detailId}/milestones`).then((r) => r.json()),
    enabled: Number.isFinite(id) && detailId != null,
  });
  const { data: accounts = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/accounts"],
  });
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/programs/categories"],
    queryFn: () => apiRequest("GET", "/api/programs/categories").then((r) => r.json()),
  });
  const { data: statusOptions = [] } = useQuery<StatusOption[]>({
    queryKey: ["/api/programs/status-options", program?.category_id],
    queryFn: () =>
      apiRequest("GET", `/api/programs/status-options?category_id=${program!.category_id}`).then((r) => r.json()),
    enabled: !!program?.category_id,
  });
  const { data: carActivity = [] } = useQuery<any[]>({
    queryKey: ["/api/programs", id, "activity", historyFor?.id],
    queryFn: () =>
      apiRequest("GET", `/api/programs/${id}/activity?program_car_id=${historyFor!.id}`).then((r) => r.json()),
    enabled: !!historyFor,
  });

  useEffect(() => {
    if (program) setHeader(headerFrom(program));
  }, [program?.id, program?.updated_at]);

  const dirty = useMemo(() => {
    if (!program || !header) return false;
    return JSON.stringify(header) !== JSON.stringify(headerFrom(program));
  }, [program, header]);
  const gridDirty = Object.keys(carDrafts).length > 0;
  leaveDirtyRef.current = dirty || gridDirty;

  const patchProgram = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest("PATCH", `/api/programs/${id}`, body).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/programs", id], exact: true });
      qc.invalidateQueries({ queryKey: ["/api/programs"], exact: true });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    heldHashRef.current = window.location.hash;
    const onHash = () => {
      if (skipHashRef.current) {
        skipHashRef.current = false;
        return;
      }
      if (!leaveDirtyRef.current) {
        heldHashRef.current = window.location.hash;
        return;
      }
      if (window.confirm("You have unsaved changes. Leave anyway?")) {
        heldHashRef.current = window.location.hash;
        return;
      }
      skipHashRef.current = true;
      window.location.hash = heldHashRef.current;
    };
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!leaveDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("beforeunload", onBefore);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("beforeunload", onBefore);
    };
  }, []);

  const defs = program?.field_defs ?? [];
  const catName = program?.category?.name ?? "";
  const colPrefs = useColumnPrefs("program_cars", PD_DEFAULT_COLS);
  const {
    visibleCols,
    colOrder,
    setColOrder,
    colWidths,
    setColWidth,
    sort,
    setSort,
  } = colPrefs;
  const displayKeys = useMemo(() => {
    const pinnedStart = canEdit ? ["_select", "car", "complete"] : ["car", "complete"];
    const movable = [
      ...PD_CORE.filter((k) => visibleCols.has(k)),
      ...(moreFields ? defs.map((d) => `cf:${d.field_key}`) : []),
    ];
    return [...pinnedStart, ...mergeColOrder(movable, colOrder), "_actions"];
  }, [canEdit, defs, colOrder, moreFields, visibleCols]);
  const movableKeys = displayKeys.filter((k) => k !== "_select" && k !== "car" && k !== "complete" && k !== "_actions");
  const draftedCars = useMemo(
    () => cars.map((c) => applyCarDraft(c, carDrafts[c.id], shops)),
    [cars, carDrafts, shops],
  );
  const sortedCars = useMemo(() => {
    const q = carFilter.trim().toLowerCase();
    const filtered = q
      ? draftedCars.filter((c) => {
          const hay = [
            carLabelOf(c),
            c.status,
            c.notes,
            c.milestone,
            c.open_commitment?.name,
            c.open_commitment?.type,
            c.kpi?.derived_status,
            c.shop?.name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : draftedCars;
    const key = sort?.key;
    const dir = sort?.dir === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (!key) return Number(Boolean(a.completed)) - Number(Boolean(b.completed));
      const va = programCarSortValue(a, key);
      const vb = programCarSortValue(b, key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [draftedCars, carFilter, sort]);
  const tableW = tableWidthFor(displayKeys, colWidths, PD_WIDTHS, 120);
  const gridW = Math.max(1100, tableW);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  function syncGridScroll(from: "top" | "body") {
    const top = topScrollRef.current;
    const body = bodyScrollRef.current;
    if (!top || !body) return;
    if (from === "top") body.scrollLeft = top.scrollLeft;
    else top.scrollLeft = body.scrollLeft;
  }

  function queueCarPatch(linkId: number, patch: Record<string, unknown>) {
    setCarDrafts((prev) => ({ ...prev, [linkId]: mergeCarPatch(prev[linkId] ?? {}, patch) }));
  }

  async function runPatchApply(
    n: number,
    body: Record<string, unknown>,
  ): Promise<{ updated?: number; commitments_written?: number }> {
    setCarSaving(true);
    setCarSaveError(null);
    toast({ title: `Saving ${n} car${n === 1 ? "" : "s"}…` });
    try {
      const prev = await apiRequest("POST", `/api/programs/${id}/cars/patch/preview`, body).then((r) => r.json());
      const applied = await apiRequest("POST", `/api/programs/${id}/cars/patch/apply`, {
        preview_token: prev.preview_token,
      }).then((r) => r.json());
      const u = Number(applied.updated ?? n);
      toast({
        title: `Saved ${u} program car${u === 1 ? "" : "s"}`,
        description:
          applied.commitments_written > 0
            ? `${applied.commitments_written} commitment${applied.commitments_written === 1 ? "" : "s"} written`
            : undefined,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: carsKey }),
        qc.invalidateQueries({ queryKey: ["/api/programs", id], exact: true }),
        qc.invalidateQueries({ queryKey: ["/api/programs"], exact: true }),
      ]);
      if (tab === "activity" || historyFor || detailId) {
        await qc.invalidateQueries({ queryKey: ["/api/programs", id, "activity"] });
        if (detailId) qc.invalidateQueries({ queryKey: ["/api/programs", id, "cars", detailId, "milestones"] });
      }
      return applied;
    } catch (e: any) {
      setCarSaveError(e.message || "Save failed");
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
      throw e;
    } finally {
      setCarSaving(false);
    }
  }

  async function saveCarDrafts() {
    const entries = Object.entries(carDrafts);
    if (!entries.length || !canEdit) return;
    try {
      await runPatchApply(entries.length, {
        items: entries.map(([linkId, updates]) => ({ link_id: Number(linkId), updates })),
      });
      setCarDrafts({});
      setCarSavedFlash(true);
      window.setTimeout(() => setCarSavedFlash(false), 2500);
    } catch {
      /* toast already shown */
    }
  }

  async function runPasteMatch(text: string) {
    const t = text.trim();
    if (!t) {
      setPasteMatch(null);
      return;
    }
    setPastePending(true);
    try {
      const r = await apiRequest("POST", `/api/programs/${id}/cars/match`, { text: t }).then((x) => x.json());
      setPasteMatch(r);
    } catch (e: any) {
      toast({ title: "Paste search failed", description: e.message, variant: "destructive" });
    } finally {
      setPastePending(false);
    }
  }

  function pdHeader(key: string) {
    const pinned = key === "_select" || key === "car" || key === "complete" || key === "_actions";
    const cf = key.startsWith("cf:") ? defs.find((d) => `cf:${d.field_key}` === key) : null;
    const w = colWidth(colWidths, key, PD_WIDTHS[key] ?? 120);
    return (
      <GridColumnTh
        key={key}
        listKey="program_cars"
        colKey={key}
        width={w}
        pinned={pinned}
        className={cn(
          "px-2 py-2 font-medium bg-card",
          key === "repair" ? "text-right" : "text-left",
          key === "_select" && "w-8",
          key === "complete" && "text-center",
          key === "_actions" && "w-24",
        )}
        onResize={setColWidth}
        onMove={(from, to) => setColOrder(moveCol(movableKeys, from, to))}
        onSort={
          key === "_select" || key === "_actions"
            ? undefined
            : () => {
                if (sort?.key === key) setSort({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
                else setSort({ key, dir: "asc" });
              }
        }
        sortDir={sort?.key === key ? sort.dir : null}
      >
        {key === "_select" ? (
          <Checkbox
            checked={cars.filter((c) => !c.exited_date).length > 0 && cars.filter((c) => !c.exited_date).every((c) => selected.has(c.id))}
            onCheckedChange={toggleAll}
            aria-label="Select all cars"
          />
        ) : key === "_actions" ? null : (
          columnLabel("program_cars", key, PD_LABELS[key] ?? cf?.label ?? key)
        )}
      </GridColumnTh>
    );
  }

  function pdCell(key: string, c: ProgramCar, label: string, exited: boolean) {
    const def = key.startsWith("cf:") ? defs.find((d) => `cf:${d.field_key}` === key) : null;
    if (def) {
      return (
        <td key={key} className="px-2 py-1">
          <CustomCell
            def={def}
            value={c.custom_fields?.[def.field_key]}
            readOnly={!canEdit || exited}
            onSave={(v) => queueCarPatch(c.id, { custom_fields: { [def.field_key]: v } })}
          />
        </td>
      );
    }
    switch (key) {
      case "_select":
        return (
          <td key={key} className="px-2 py-1">
            {!exited && (
              <Checkbox
                checked={selected.has(c.id)}
                onClick={(e) => selectClick(e, c.id)}
                onCheckedChange={() => {}}
                aria-label={`Select ${label}`}
              />
            )}
          </td>
        );
      case "car":
        return (
          <td key={key} className="px-2 py-1.5 font-mono whitespace-nowrap">
            {c.railcar_id ? (
              <Link
                href={carPathFromProgram(c.railcar_id, id, programQuery)}
                className="hover:underline"
                data-testid={`link-program-car-${c.railcar_id}`}
              >
                {label}
              </Link>
            ) : (
              label
            )}
            {exited && <div className="text-[10px] text-muted-foreground">Exited {String(c.exited_date).slice(0, 10)}</div>}
          </td>
        );
      case "complete":
        return (
          <td key={key} className="px-2 py-1 text-center">
            <Checkbox
              checked={Boolean(c.outcome_reached_at || c.completed)}
              disabled={!canEdit || exited || c.railcar?.active !== true}
              onCheckedChange={(v) => queueCarPatch(c.id, { outcome_reached: v === true })}
              aria-label={`Mark ${label} outcome reached`}
            />
          </td>
        );
      case "completion": {
        const level = c.completion_level ?? "not_started";
        return (
          <td key={key} className="px-2 py-1">
            <span
              className={cn(
                "text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap",
                level === "program_done" && "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
                level === "work_done" && "bg-umler-teal/15 text-umler-teal border-umler-teal/30",
                level === "in_progress" && "bg-umler-amber/15 text-umler-amber border-umler-amber/30",
                level === "not_started" && "bg-muted text-muted-foreground border-border",
              )}
            >
              {COMPLETION_LABEL[level]}
            </span>
          </td>
        );
      }
      case "active":
        return (
          <td key={key} className="px-2 py-1">{c.railcar?.active === true ? "Yes" : "No"}</td>
        );
      case "milestone":
        return (
          <td key={key} className="px-2 py-1">
            <CellInput
              readOnly={!canEdit || exited || c.railcar?.active !== true}
              value={c.milestone ?? ""}
              onSave={(v) => queueCarPatch(c.id, { milestone: v })}
            />
          </td>
        );
      case "milestone_at":
        return (
          <td key={key} className="px-2 py-1">
            <CellInput
              readOnly={!canEdit || exited || c.railcar?.active !== true}
              value={c.milestone_at ? String(c.milestone_at).slice(0, 10) : ""}
              onSave={(v) => queueCarPatch(c.id, { milestone_at: v })}
            />
          </td>
        );
      case "notes":
      case "comment":
        return (
          <td key={key} className="px-2 py-1 overflow-hidden">
            <CellInput
              readOnly={!canEdit || exited || c.railcar?.active !== true}
              value={c.notes ?? ""}
              onSave={(v) => queueCarPatch(c.id, { notes: v })}
            />
          </td>
        );
      case "commitment":
        return (
          <td key={key} className="px-2 py-1">
            {c.open_commitment?.name
              ? `${c.open_commitment.type ? `${c.open_commitment.type} · ` : ""}${c.open_commitment.name}`
              : "—"}
            {c.in_multiple_programs ? <div className="text-[10px] text-umler-amber">In 2 programs</div> : null}
          </td>
        );
      case "kpi":
        return <td key={key} className="px-2 py-1">{c.kpi?.derived_status ?? "—"}</td>;
      case "status":
        return (
          <td key={key} className="px-2 py-1 overflow-hidden">
            <StatusCell
              value={c.status ?? ""}
              options={statusOptions}
              readOnly={!canEdit || exited}
              onSave={(v) => queueCarPatch(c.id, { status: v })}
            />
          </td>
        );
      case "flag":
        return (
          <td key={key} className="px-2 py-1 overflow-hidden">
            <CellInput
              readOnly={!canEdit || exited}
              value={c.flag_tag ?? ""}
              placeholder="Watch, Priority…"
              onSave={(v) => queueCarPatch(c.id, { flag_tag: v })}
            />
          </td>
        );
      case "comment":
        return (
          <td key={key} className="px-2 py-1 overflow-hidden">
            <CellInput
              readOnly={!canEdit || exited}
              value={c.notes ?? ""}
              onSave={(v) => queueCarPatch(c.id, { notes: v })}
            />
          </td>
        );
      case "ol_entry":
        return <td key={key} className="px-2 py-1.5 font-mono">{c.rider_external_id_snapshot ?? "—"}</td>;
      case "ol_now":
        return <td key={key} className="px-2 py-1.5 font-mono">{c.railcar?.rider_external_id ?? "—"}</td>;
      case "shop":
        return (
          <td key={key} className="px-2 py-1 overflow-hidden">
            {canEdit && !exited ? (
              <ShopCombobox
                compact
                shops={shops}
                value={c.shop_id}
                onChange={(shopId) => queueCarPatch(c.id, { shop_id: shopId })}
              />
            ) : (
              c.shop?.name ?? "—"
            )}
          </td>
        );
      case "repair":
        return (
          <td key={key} className="px-2 py-1">
            <CellInput
              readOnly={!canEdit || exited}
              className="text-right"
              value={c.repair_cost_total != null ? String(c.repair_cost_total) : ""}
              onSave={(v) => queueCarPatch(c.id, { repair_cost_total: v })}
            />
          </td>
        );
      case "_actions":
        return (
          <td key={key} className="px-1 py-1 whitespace-nowrap">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Status history for ${label}`}
              onClick={() => setHistoryFor(c)}
            >
              <History className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Attachments for ${label}`}
              onClick={() => setDocsFor(c)}
            >
              <Paperclip className="h-3.5 w-3.5" />
              {c.doc_count > 0 && <span className="text-[9px] ml-0.5">{c.doc_count}</span>}
            </Button>
            {canEdit && !exited && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={`Remove ${label} from program`}
                onClick={async () => {
                  const ok = await confirmDelete({
                    title: `Remove ${label} from ${program?.name}?`,
                    description: "The car stays in program history with an exit date. It is not deleted.",
                    confirmLabel: "Remove from program",
                  });
                  if (!ok) return;
                  if (carDrafts[c.id] && !window.confirm("This car has unsaved edits. Remove anyway?")) return;
                  const prev = await apiRequest("POST", `/api/programs/${id}/cars/remove/preview`, {
                    link_ids: [c.id],
                  }).then((r) => r.json());
                  await apiRequest("POST", `/api/programs/${id}/cars/remove/apply`, { preview_token: prev.preview_token });
                  setCarDrafts((prev) => {
                    if (!prev[c.id]) return prev;
                    const next = { ...prev };
                    delete next[c.id];
                    return next;
                  });
                  qc.invalidateQueries({ queryKey: carsKey });
                  qc.invalidateQueries({ queryKey: ["/api/programs", id], exact: true });
                  qc.invalidateQueries({ queryKey: ["/api/programs"], exact: true });
                }}
              >
                <UserMinus className="h-3.5 w-3.5" />
              </Button>
            )}
          </td>
        );
      default:
        return <td key={key} className="px-2 py-1">—</td>;
    }
  }

  async function saveHeader() {
    if (!header || !canEdit) return;
    await patchProgram.mutateAsync({
      entity: header.entity || null,
      account_manager: header.account_manager.trim() || null,
      account_id: header.account_id,
      description: header.description.trim() || null,
      status_narrative: header.status_narrative,
      opened_date: header.opened_date || null,
      target_completion_date: header.target_completion_date || null,
      closed_date: header.closed_date || null,
      tags: header.tags.split(",").map((t) => t.trim()).filter(Boolean),
      category_id: header.category_id ? Number(header.category_id) : null,
      type: header.type || null,
      type_other: header.type === "Other" ? header.type_other.trim() || null : null,
      pending_note: header.pending_note.trim() || null,
    });
    setSavedFlash(true);
    toast({ title: "Saved" });
    window.setTimeout(() => setSavedFlash(false), 2500);
  }

  const visibleCars = useMemo(() => {
    const pasteIds = pasteMatch ? new Set(pasteMatch.matched.map((m) => m.link_id)) : null;
    return sortedCars.filter((c) => {
      if (pasteIds && !pasteIds.has(c.id)) return false;
      const level = c.completion_level ?? deriveCompletionLevel({
        active: c.railcar?.active,
        status: c.status,
        milestone: c.milestone,
        milestones: c.trail,
      });
      if (!levelFilter.has(level)) return false;
      return true;
    });
  }, [sortedCars, pasteMatch, levelFilter]);
  const detailCar = draftedCars.find((c) => c.id === detailId) ?? null;
  const splitListPct = Math.min(90, Math.max(30, Number(colWidths._split_list) || 68));
  const showPutOnRent = putOnRentProgramTypes().includes(header?.type as ProgramType);

  function selectClick(e: MouseEvent, linkId: number) {
    e.preventDefault();
    e.stopPropagation();
    const ids = visibleCars.filter((c) => !c.exited_date).map((c) => c.id);
    if (e.shiftKey && lastSelectId.current != null) {
      const a = ids.indexOf(lastSelectId.current);
      const b = ids.indexOf(linkId);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(ids[i]);
          return next;
        });
        lastSelectId.current = linkId;
        return;
      }
    }
    lastSelectId.current = linkId;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(linkId)) next.delete(linkId);
      else next.add(linkId);
      return next;
    });
  }

  function toggleAll() {
    const openIds = cars.filter((c) => !c.exited_date).map((c) => c.id);
    setSelected((prev) => {
      if (openIds.length && openIds.every((id) => prev.has(id))) return new Set();
      return new Set(openIds);
    });
  }

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading program…</div>;
  }
  if (error || !program || !header) {
    return <div className="p-8 text-sm text-destructive">Program not found.</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 sm:px-8 pt-4 pb-0 space-y-1.5">
        <button
          type="button"
          onClick={goBackToPrograms}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
          data-testid="button-back-to-programs"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Programs
        </button>
        <nav className="flex items-center gap-1.5 flex-wrap" aria-label="Breadcrumb">
          <button
            type="button"
            onClick={goBackToPrograms}
            className="text-sm text-muted-foreground hover:text-primary"
          >
            Programs
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-sm text-foreground font-medium">{program.name}</span>
        </nav>
      </div>
      <PageHeader
        title={program.name}
        subtitle={catName}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && dirty && (
              <Button size="sm" onClick={saveHeader} disabled={patchProgram.isPending}>
                {patchProgram.isPending ? "Saving…" : "Save"}
              </Button>
            )}
            {savedFlash && !dirty && (
              <span className="text-xs text-emerald-400">Saved</span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await downloadReport(
                    `/api/programs/${id}/export?include_exited=1&cols=all`,
                  );
                } catch (e: any) {
                  toast({ title: "Export failed", description: e.message, variant: "destructive" });
                }
              }}
            >
              <Download className="h-4 w-4" /> Export Report
            </Button>
          </div>
        }
      />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-4 sm:px-8 py-3 gap-2">
        <div className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            title={catName || undefined}
            className={cn("inline-flex items-center text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border leading-none whitespace-nowrap", CATEGORY_BADGE[catName] ?? "bg-muted border-border")}
          >
            {categoryShortName(catName) || "Uncategorized"}
          </span>
          {(() => {
            const lc = (program.progress?.lifecycle ?? overlayLifecycle(program)) as ProgramLifecycle;
            return (
              <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border", LIFECYCLE_BADGE[lc])}>
                {LIFECYCLE_LABEL[lc]}
              </span>
            );
          })()}
          {program.progress && (
            <span className="text-xs text-muted-foreground">
              {program.progress.done ?? 0} of {program.progress.total_open_links ?? 0} done · {program.progress.remaining ?? 0} remaining
            </span>
          )}
          {program.progress?.ready_to_close && (
            <span className="text-xs text-umler-teal font-medium">All cars done – close or note what's pending</span>
          )}
          {canEdit && (program.progress?.lifecycle ?? overlayLifecycle(program)) === "active" && (
            <Button size="sm" variant="outline" onClick={async () => {
              const p = await apiRequest("POST", `/api/programs/${id}/close/preview`).then((r) => r.json());
              setLifePreview({ ...p, applyPath: `/api/programs/${id}/close/apply` });
            }}>Close</Button>
          )}
          {canEdit && (program.progress?.lifecycle ?? overlayLifecycle(program)) === "draft" && (
            <Button size="sm" variant="outline" onClick={async () => {
              const p = await apiRequest("POST", `/api/programs/${id}/activate/preview`).then((r) => r.json());
              setLifePreview({ ...p, applyPath: `/api/programs/${id}/activate/apply` });
            }}>Activate</Button>
          )}
          {isAdmin && (program.progress?.lifecycle ?? overlayLifecycle(program)) === "draft" && (
            <Button size="sm" variant="outline" onClick={async () => {
              const p = await apiRequest("POST", `/api/programs/${id}/cancel/preview`).then((r) => r.json());
              setLifePreview({ ...p, applyPath: `/api/programs/${id}/cancel/apply` });
            }}>Cancel</Button>
          )}
          {isAdmin && (program.progress?.lifecycle ?? overlayLifecycle(program)) === "closed" && (
            <Button size="sm" variant="outline" onClick={async () => {
              const p = await apiRequest("POST", `/api/programs/${id}/reopen/preview`).then((r) => r.json());
              setLifePreview({ ...p, applyPath: `/api/programs/${id}/reopen/apply` });
            }}>Reopen</Button>
          )}
        </div>

        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          onClick={() => setHeaderOpen((v) => !v)}
        >
          {headerOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {headerOpen ? "Hide program details" : "Show program details"}
        </button>
        {headerOpen && (
        <>
        <Textarea
          className="text-sm min-h-[52px] max-h-28 overflow-y-auto"
          rows={2}
          value={header.status_narrative}
          readOnly={!canEdit}
          placeholder="Status narrative — the rolled-up note from the SUMMARY tab"
          onChange={(e) => setHeader({ ...header, status_narrative: e.target.value })}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
          <HeaderField label="Type">
            <Select value={header.type || "none"} onValueChange={(v) => setHeader({ ...header, type: v === "none" ? "" : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {PROGRAM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </HeaderField>
          <HeaderField label="Pending note">
            <Input className="h-8 text-xs" value={header.pending_note} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, pending_note: e.target.value })} placeholder="awaiting legal docs" />
          </HeaderField>
          <HeaderField label="Category">
            <Select value={header.category_id || "none"} onValueChange={(v) => setHeader({ ...header, category_id: v === "none" ? "" : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </HeaderField>
          <HeaderField label="Entity">
            <Select value={header.entity || "none"} onValueChange={(v) => setHeader({ ...header, entity: v === "none" ? "" : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {PROGRAM_ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </HeaderField>
          <HeaderField label="Account">
            <AccountCombobox
              accounts={accounts}
              value={header.account_id}
              onChange={(id) => setHeader({ ...header, account_id: id })}
              disabled={!canEdit}
              compact
            />
          </HeaderField>
          <HeaderField label="Account manager">
            <Input className="h-8 text-xs" value={header.account_manager} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, account_manager: e.target.value })} />
          </HeaderField>
          <HeaderField label="% Complete">
            <div className="h-8 px-2 flex items-center text-xs font-mono-num tabular-nums">
              {program.percent_complete != null ? `${program.percent_complete}%` : "—"}
            </div>
          </HeaderField>
          <HeaderField label="Opened">
            <Input className="h-8 text-xs" type="date" value={header.opened_date} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, opened_date: e.target.value })} />
          </HeaderField>
          <HeaderField label="Target">
            <Input className="h-8 text-xs" type="date" value={header.target_completion_date} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, target_completion_date: e.target.value })} />
          </HeaderField>
          <HeaderField label="Closed">
            <Input className="h-8 text-xs" type="date" value={header.closed_date} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, closed_date: e.target.value })} />
          </HeaderField>
          <HeaderField label="Tags">
            <Input className="h-8 text-xs" value={header.tags} readOnly={!canEdit} onChange={(e) => setHeader({ ...header, tags: e.target.value })} placeholder="NLD, Sale" />
          </HeaderField>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Description</div>
          <Textarea
            className="text-xs min-h-[36px] max-h-16 overflow-y-auto"
            rows={1}
            value={header.description}
            readOnly={!canEdit}
            onChange={(e) => setHeader({ ...header, description: e.target.value })}
          />
        </div>
        <AccountDirectoryPeople
          accountId={header.account_id}
          searchHint={program.name}
          compact
          onOpen={navigateHash}
        />
        {canEdit && dirty && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveHeader} disabled={patchProgram.isPending}>
              {patchProgram.isPending ? "Saving…" : "Save header"}
            </Button>
            <span className="text-xs text-muted-foreground">Unsaved header changes</span>
          </div>
        )}
        </>
        )}
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="shrink-0 self-start">
            <TabsTrigger value="cars">Cars</TabsTrigger>
            <TabsTrigger value="milestones">Milestones</TabsTrigger>
            <TabsTrigger value="docs">Documents</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="cars" className="mt-2 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden overflow-hidden">
            <div className="shrink-0 flex items-center gap-3 mb-2 flex-wrap">
              {canEdit && (
                <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add cars</Button>
              )}
              {canEdit && (
                <Button size="sm" disabled={!gridDirty || carSaving} onClick={() => void saveCarDrafts()} data-testid="button-save-program-cars">
                  {carSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving {Object.keys(carDrafts).length || ""} car{Object.keys(carDrafts).length === 1 ? "" : "s"}…
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              )}
              {carSavedFlash && !gridDirty ? <span className="text-xs text-emerald-400">Saved</span> : null}
              {carSaveError ? <span className="text-xs text-destructive">{carSaveError}</span> : null}
              <div className="flex items-center gap-1 flex-wrap">
                {COMPLETION_LEVELS.map((level) => {
                  const n = sortedCars.filter((c) => (c.completion_level ?? "not_started") === level).length;
                  const on = levelFilter.has(level);
                  return (
                    <button
                      key={level}
                      type="button"
                      className={cn(
                        "text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border",
                        on ? "bg-primary/15 border-primary/40 text-foreground" : "bg-muted border-border text-muted-foreground",
                      )}
                      onClick={() => {
                        setLevelFilter((prev) => {
                          const next = new Set(prev);
                          if (next.has(level)) next.delete(level);
                          else next.add(level);
                          if (next.size === 0) next.add(level);
                          setShowCompleted(next.has("program_done"));
                          return next;
                        });
                      }}
                    >
                      {COMPLETION_LABEL[level]} ({n})
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={levelFilter.has("program_done")}
                  onCheckedChange={(v) => {
                    const on = v === true;
                    setShowCompleted(on);
                    setLevelFilter((prev) => {
                      const next = new Set(prev);
                      if (on) next.add("program_done");
                      else next.delete("program_done");
                      if (next.size === 0) next.add("in_progress");
                      return next;
                    });
                  }}
                />
                Show program done ({sortedCars.filter((c) => c.completion_level === "program_done").length})
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={includeExited} onCheckedChange={(v) => setIncludeExited(v === true)} />
                Show exited cars
              </label>
              <Button size="sm" variant="ghost" onClick={() => setMoreFields((v) => !v)}>
                {moreFields ? "Hide extra fields" : "More fields"}
              </Button>
              <Input
                className="h-8 w-52 text-xs"
                value={carFilter}
                onChange={(e) => setCarFilter(e.target.value)}
                placeholder="Filter cars…"
                aria-label="Filter program cars"
              />
              <Textarea
                className="h-8 min-h-8 w-72 text-xs py-1.5"
                value={pasteText}
                onChange={(e) => {
                  const v = e.target.value;
                  setPasteText(v);
                  if (!v.trim()) setPasteMatch(null);
                }}
                onPaste={(e) => {
                  const next = e.clipboardData.getData("text");
                  if (next && /[\n\r,]/.test(next)) {
                    window.setTimeout(() => void runPasteMatch(next), 0);
                  }
                }}
                onBlur={() => {
                  if (pasteText.trim() && (pasteText.includes("\n") || pasteText.includes(",") || pasteText.trim().split(/\s+/).length >= 2)) {
                    void runPasteMatch(pasteText);
                  }
                }}
                placeholder="Paste a list of cars…"
                aria-label="Paste car list to filter"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pastePending || !pasteText.trim()}
                onClick={() => void runPasteMatch(pasteText)}
              >
                {pastePending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Match paste"}
              </Button>
              {pasteMatch ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    {pasteMatch.matched_count} of {pasteMatch.requested} matched
                    {pasteMatch.not_found.length ? ` · ${pasteMatch.not_found.length} not found` : ""}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelected(new Set(pasteMatch.matched.map((m) => m.link_id)))}
                  >
                    Select all matched
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPasteText(""); setPasteMatch(null); }}>
                    Clear paste
                  </Button>
                </>
              ) : null}
              {showPutOnRent && canEdit && selected.size > 0 && (
                <Button size="sm" variant="outline" disabled={carSaving} onClick={() => setRentOpen(true)}>
                  Put on rent
                </Button>
              )}
              <ColumnPicker
                columns={PD_CORE.map((key) => ({ key, label: PD_LABELS[key] ?? key }))}
                prefs={colPrefs}
              />
              <span className="text-xs text-muted-foreground ml-auto">
                {sortedCars.filter((c) => !c.completed).length} open
                {sortedCars.some((c) => c.completed) ? ` · ${sortedCars.filter((c) => c.completed).length} complete` : ""}
                {` · ${sortedCars.length} rows`}
              </span>
            </div>
            {pasteMatch && pasteMatch.not_found.length > 0 && (
              <div className="text-xs text-destructive mb-2">
                Not found: {pasteMatch.not_found.map((n) => n.token).join(", ")}
                {pasteMatch.ambiguous?.length
                  ? ` · Ambiguous: ${pasteMatch.ambiguous.map((a) => a.token).join(", ")}`
                  : ""}
              </div>
            )}
            {canEdit && selected.size > 0 && (
              <div className="shrink-0">
              <BulkEditBar
                count={selected.size}
                shops={shops}
                statusOptions={statusOptions}
                defs={defs}
                saving={carSaving}
                onApply={async (label, updates) => {
                  const ok = await confirmSave({
                    title: `Set ${label} for ${selected.size} selected car${selected.size === 1 ? "" : "s"}?`,
                    confirmLabel: "Apply",
                  });
                  if (!ok) return;
                  const ids = Array.from(selected);
                  await runPatchApply(ids.length, { link_ids: ids, updates });
                  setCarDrafts((prev) => {
                    const next = { ...prev };
                    for (const linkId of ids) delete next[linkId];
                    return next;
                  });
                  setSelected(new Set());
                }}
              />
              </div>
            )}
            <ResizablePanelGroup
              direction="vertical"
              className="flex-1 min-h-0"
              onLayout={(sizes) => {
                const n = Math.round(sizes[0]);
                if (Number.isFinite(n) && n !== Number(colWidths._split_list)) setColWidth("_split_list", n);
              }}
            >
            <ResizablePanel defaultSize={splitListPct} minSize={30}>
            <div className="h-full min-h-0 rounded-xl border border-card-border bg-card overflow-hidden flex flex-col">
              <div
                ref={topScrollRef}
                className="shrink-0 h-3 overflow-x-auto overflow-y-hidden border-b border-border"
                onScroll={() => syncGridScroll("top")}
                aria-hidden
              >
                <div style={{ width: gridW, height: 1 }} />
              </div>
              <div
                ref={bodyScrollRef}
                className="flex-1 min-h-0 overflow-auto"
                onScroll={() => syncGridScroll("body")}
              >
              <table className="text-xs" style={{ tableLayout: "fixed", width: gridW }}>
                <colgroup>
                  {displayKeys.map((k) => (
                    <col key={k} style={{ width: colWidth(colWidths, k, PD_WIDTHS[k] ?? 120) }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-card text-[10px] uppercase tracking-wider text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))] [&>tr>th]:bg-card">
                  <tr>
                    {displayKeys.map((k) => pdHeader(k))}
                  </tr>
                </thead>
                <tbody>
                  {visibleCars.map((c) => {
                    const label = carLabelOf(c);
                    const exited = Boolean(c.exited_date);
                    const done = Boolean(c.completed);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => setDetailId(c.id)}
                        className={cn(
                          "border-t border-border/50 cursor-pointer",
                          exited && "opacity-60",
                          done && !exited && !carDrafts[c.id] && "bg-muted/20",
                          carDrafts[c.id] && "border-l-2 border-l-primary bg-primary/5",
                          detailId === c.id && "bg-primary/10",
                        )}
                      >
                        {displayKeys.map((k) => pdCell(k, c, label, exited))}
                      </tr>
                    );
                  })}
                  {cars.length === 0 && (
                    <tr><td colSpan={displayKeys.length} className="px-3 py-10 text-center text-muted-foreground italic">No cars in this program yet.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={Math.max(10, 100 - splitListPct)} minSize={12}>
              <div className="h-full min-h-0 rounded-xl border border-card-border bg-card overflow-auto p-3">
                {detailCar ? (
                  <CarDetailPanel
                    car={detailCar}
                    trail={trail}
                    onOpenDocs={() => setDocsFor(detailCar)}
                    onOpenHistory={() => setHistoryFor(detailCar)}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground italic">Select a car to see notes, commitment, and milestone trail.</p>
                )}
              </div>
            </ResizablePanel>
            </ResizablePanelGroup>
          </TabsContent>
          <TabsContent value="milestones" className="mt-2 flex-1 min-h-0 overflow-auto data-[state=inactive]:hidden">
            <p className="text-xs text-muted-foreground mb-2">Suggested for this type. Optional — never enforced.</p>
            <div className="flex flex-wrap gap-2">
              {(isProgramType(header.type) ? MILESTONES_BY_TYPE[header.type as ProgramType] : ["Started", "Done"]).map((m) => (
                <span key={m} className="text-xs px-2 py-1 rounded border border-border">{m}</span>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="docs" className="mt-2 flex-1 min-h-0 overflow-auto data-[state=inactive]:hidden">
            <ProgramDocsPanel
              listUrl={`/api/programs/${id}/documents`}
              uploadUrl={`/api/programs/${id}/documents`}
              deleteUrl={(docId) => `/api/programs/${id}/documents/${docId}`}
              categories={[...PROGRAM_DOC_CATEGORIES]}
            />
          </TabsContent>
          <TabsContent value="activity" className="mt-2 flex-1 min-h-0 overflow-auto data-[state=inactive]:hidden">
            <ActivityList rows={activity} />
          </TabsContent>
        </Tabs>
      </div>

      <AddCarsDialog
        open={addOpen}
        programId={id}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          qc.invalidateQueries({ queryKey: carsKey });
          qc.invalidateQueries({ queryKey: ["/api/programs", id], exact: true });
          qc.invalidateQueries({ queryKey: ["/api/programs"], exact: true });
        }}
      />
      <PutOnRentDialog
        open={rentOpen}
        programId={id}
        linkIds={Array.from(selected)}
        riders={riders}
        onClose={() => setRentOpen(false)}
        onApplied={() => {
          setRentOpen(false);
          setSelected(new Set());
          qc.invalidateQueries({ queryKey: carsKey });
          qc.invalidateQueries({ queryKey: ["/api/programs", id], exact: true });
        }}
      />
      <ProgramPreviewDialog
        open={Boolean(lifePreview)}
        title="Program change"
        preview={lifePreview}
        onClose={() => setLifePreview(null)}
        onApply={async () => {
          if (!lifePreview?.preview_token || !lifePreview?.applyPath) return;
          await apiRequest("POST", lifePreview.applyPath, { preview_token: lifePreview.preview_token });
          setLifePreview(null);
          qc.invalidateQueries({ queryKey: ["/api/programs", id], exact: true });
          qc.invalidateQueries({ queryKey: ["/api/programs"], exact: true });
          toast({ title: "Applied" });
        }}
      />

      <Sheet open={!!docsFor} onOpenChange={(o) => !o && setDocsFor(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {docsFor ? carLabelOf(docsFor) : ""} attachments
            </SheetTitle>
          </SheetHeader>
          {docsFor && (
            <div className="mt-4 space-y-3">
              <div className="text-sm space-y-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Program note</div>
                  <div className="whitespace-pre-wrap">{docsFor.notes || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Commitment</div>
                  <div>
                    {docsFor.open_commitment?.name
                      ? `${docsFor.open_commitment.type ? `${docsFor.open_commitment.type} · ` : ""}${docsFor.open_commitment.name}`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
                  <div>{docsFor.status || "—"}</div>
                </div>
              </div>
              <ProgramDocsPanel
                compact
                listUrl={`/api/programs/${id}/cars/${docsFor.id}/documents`}
                uploadUrl={`/api/programs/${id}/cars/${docsFor.id}/documents`}
                deleteUrl={(docId) => `/api/programs/${id}/cars/${docsFor.id}/documents/${docId}`}
                categories={[...PROGRAM_CAR_DOC_CATEGORIES]}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{historyFor ? carLabelOf(historyFor) : ""} status history</DialogTitle>
            <DialogDescription>Newest first. Current status is the latest value on the car row.</DialogDescription>
          </DialogHeader>
          <ActivityList
            rows={(carActivity as any[]).filter((a) => a.action === "status_change")}
            empty="No status changes recorded for this car yet."
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CarDetailPanel({
  car,
  trail,
  onOpenDocs,
  onOpenHistory,
}: {
  car: ProgramCar;
  trail: { id: number; milestone: string; milestone_date: string; note: string | null; actor: string | null }[];
  onOpenDocs: () => void;
  onOpenHistory: () => void;
}) {
  const label = carLabelOf(car);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{label}</div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onOpenHistory}><History className="h-3.5 w-3.5" /> History</Button>
          <Button size="sm" variant="ghost" onClick={onOpenDocs}><Paperclip className="h-3.5 w-3.5" /> Files</Button>
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Latest milestone</div>
        <div>{car.milestone || "—"}{car.milestone_at ? ` · ${String(car.milestone_at).slice(0, 10)}` : ""}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Trail</div>
        {trail.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No trail rows yet. Saving a milestone keeps each date.</p>
        ) : (
          <ol className="space-y-1.5 mt-1">
            {trail.map((m) => (
              <li key={m.id} className="text-xs border-l-2 border-primary/40 pl-2">
                <span className="font-medium">{m.milestone}</span>
                <span className="text-muted-foreground"> · {String(m.milestone_date).slice(0, 10)}</span>
                {m.note ? <div>{m.note}</div> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Program note</div>
        <div className="whitespace-pre-wrap text-xs">{car.notes || "—"}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Commitment</div>
        <div className="text-xs">
          {car.open_commitment?.name
            ? `${car.open_commitment.type ? `${car.open_commitment.type} · ` : ""}${car.open_commitment.name}`
            : "—"}
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Arrived (program done)</div>
        <div className="text-xs">{car.outcome_reached_at ? String(car.outcome_reached_at).slice(0, 10) : "—"}</div>
      </div>
    </div>
  );
}

function ActivityList({ rows, empty }: { rows: any[]; empty?: string }) {
  return (
    <ul className="space-y-2">
      {rows.map((a) => (
        <li key={a.id} className="text-xs border-l-2 border-primary/40 pl-3 py-1">
          <div className="text-muted-foreground font-mono-num">{new Date(a.created_at).toLocaleString()}</div>
          <div>{formatActivity(a)}</div>
        </li>
      ))}
      {rows.length === 0 && <p className="text-xs text-muted-foreground italic">{empty ?? "No activity yet."}</p>}
    </ul>
  );
}

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

function CellInput({
  value,
  onSave,
  readOnly,
  className,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);

  function commit(next: string) {
    if (next !== value) onSave(next);
  }

  return (
    <input
      className={cn("h-7 w-full bg-transparent border border-transparent hover:border-border rounded px-1", className)}
      value={v}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={(e) => {
        const next = e.target.value;
        setV(next);
        if (next !== value) onSave(next);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Tab") commit((e.target as HTMLInputElement).value);
      }}
    />
  );
}

function StatusCell({
  value,
  options,
  onSave,
  readOnly,
}: {
  value: string;
  options: StatusOption[];
  onSave: (v: string) => void;
  readOnly?: boolean;
}) {
  const [custom, setCustom] = useState(false);
  const inList = !value || options.some((o) => o.value === value);
  const selectValue = custom ? "__custom__" : (inList ? (value || "__none__") : "__current__");
  if (readOnly) return <span>{value || "—"}</span>;
  if (custom) {
    return (
      <input
        autoFocus
        className="h-7 w-full min-w-[120px] bg-transparent border border-border rounded px-1"
        defaultValue={inList ? "" : value}
        placeholder="Custom status"
        onBlur={(e) => {
          const v = e.target.value.trim();
          setCustom(false);
          if (v && v !== value) onSave(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setCustom(false);
        }}
      />
    );
  }
  return (
    <select
      className="h-7 w-full min-w-0 max-w-full bg-transparent border border-border rounded px-1 [color-scheme:dark]"
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__custom__") {
          setCustom(true);
          return;
        }
        if (v === "__none__") onSave("");
        else if (v !== "__current__") onSave(v);
      }}
    >
      <option value="__none__">—</option>
      {!inList && value && <option value="__current__">{value}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.value}>{o.value}</option>
      ))}
      <option value="__custom__">Custom…</option>
    </select>
  );
}

function CustomCell({
  def,
  value,
  onSave,
  readOnly,
}: {
  def: ProgramFieldDef;
  value: unknown;
  onSave: (v: unknown) => void;
  readOnly?: boolean;
}) {
  if (def.field_type === "boolean") {
    const on = value === true || value === "true";
    return (
      <Checkbox
        checked={on}
        disabled={readOnly}
        onCheckedChange={(c) => onSave(c === true)}
      />
    );
  }
  if (def.field_type === "select") {
    return (
      <select
        className="h-7 bg-transparent border border-border rounded px-1 [color-scheme:dark]"
        value={value == null ? "" : String(value)}
        disabled={readOnly}
        onChange={(e) => onSave(e.target.value || null)}
      >
        <option value="">—</option>
        {(def.select_options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (readOnly) return <span>{formatCustomField(value, def.field_type) || "—"}</span>;
  const str = value == null || value === "" ? "" : String(value);
  return (
    <CellInput
      value={str}
      onSave={(v) => onSave(def.field_type === "number" || def.field_type === "currency" ? (v === "" ? null : Number(v)) : v || null)}
    />
  );
}

function BulkEditBar({
  count,
  shops,
  statusOptions,
  defs,
  saving,
  onApply,
}: {
  count: number;
  shops: ShopOption[];
  statusOptions: StatusOption[];
  defs: ProgramFieldDef[];
  saving?: boolean;
  onApply: (label: string, updates: Record<string, unknown>) => Promise<void>;
}) {
  const [field, setField] = useState("shop_id");
  const [text, setText] = useState("");
  const [commitType, setCommitType] = useState<string>("scrap");
  const [shopId, setShopId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const shopName = shops.find((s) => s.id === shopId)?.name ?? "";
  const busy = pending || Boolean(saving);

  const fieldOptions = [
    { value: "shop_id", label: "Shop" },
    { value: "status", label: "Status" },
    { value: "milestone", label: "Milestone" },
    { value: "completed", label: "Complete" },
    { value: "flag_tag", label: "Flag" },
    { value: "notes", label: "Program note" },
    { value: "commitment", label: "Commit" },
    { value: "repair_cost_total", label: "Repair $" },
    ...defs.map((d) => ({ value: `custom:${d.field_key}`, label: d.label })),
  ];

  async function apply() {
    let updates: Record<string, unknown> = {};
    let label = fieldOptions.find((f) => f.value === field)?.label ?? field;
    if (field === "shop_id") {
      updates = { shop_id: shopId };
      label = `Shop to '${shopName || "—"}'`;
    } else if (field === "status") {
      updates = { status: text };
      label = `Status to '${text || "—"}'`;
    } else if (field === "milestone") {
      const [mile, date] = text.split("|");
      updates = { milestone: mile ?? "", milestone_at: date ?? "" };
      label = `Milestone '${mile || "—"}'${date ? ` on ${date}` : ""}`;
    } else if (field === "completed") {
      const on = text !== "false";
      updates = { completed: on };
      label = on ? "Complete" : "Not complete";
    } else if (field === "flag_tag") {
      updates = { flag_tag: text };
      label = `Flag to '${text || "—"}'`;
    } else if (field === "notes") {
      updates = { notes: text };
      label = `Program note to '${text || "—"}'`;
    } else if (field === "commitment") {
      updates = { commitment: { type: commitType, name: text } };
      label = `Commit ${commitType} '${text}'`;
    } else if (field === "repair_cost_total") {
      updates = { repair_cost_total: text };
      label = `Repair $ to '${text || "—"}'`;
    } else if (field.startsWith("custom:")) {
      const key = field.slice(7);
      const def = defs.find((d) => d.field_key === key);
      let v: unknown = text;
      if (def?.field_type === "boolean") v = text === "true";
      else if (def?.field_type === "number" || def?.field_type === "currency") v = text === "" ? null : Number(text);
      updates = { custom_fields: { [key]: v } };
      label = `${def?.label ?? key} to '${text}'`;
    }
    setPending(true);
    try {
      await onApply(label, updates);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2.5 rounded-lg border border-primary/30 bg-primary/5">
      <span className="text-sm font-medium">{count} selected</span>
      <Select value={field} onValueChange={(v) => { setField(v); setText(v === "completed" ? "true" : ""); }}>
        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {fieldOptions.map((f) => (
            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field === "shop_id" ? (
        <ShopCombobox shops={shops} value={shopId} onChange={setShopId} compact />
      ) : field === "status" ? (
        <select
          className="h-8 bg-background border border-border rounded px-2 text-xs max-w-[220px] [color-scheme:dark]"
          value={text}
          onChange={(e) => setText(e.target.value)}
        >
          <option value="">—</option>
          {statusOptions.map((o) => (
            <option key={o.id} value={o.value}>{o.value}</option>
          ))}
        </select>
      ) : field === "milestone" ? (
        <>
          <select
            className="h-8 bg-background border border-border rounded px-2 text-xs max-w-[220px] [color-scheme:dark]"
            value={text.split("|")[0] ?? ""}
            onChange={(e) => setText(`${e.target.value}|${text.split("|")[1] ?? new Date().toISOString().slice(0, 10)}`)}
          >
            <option value="">—</option>
            {TRAIL_MILESTONES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <Input
            className="h-8 w-36 text-xs"
            type="date"
            value={text.split("|")[1] ?? ""}
            onChange={(e) => setText(`${text.split("|")[0] ?? ""}|${e.target.value}`)}
          />
        </>
      ) : field === "completed" ? (
        <select
          className="h-8 bg-background border border-border rounded px-2 text-xs [color-scheme:dark]"
          value={text || "true"}
          onChange={(e) => setText(e.target.value)}
        >
          <option value="true">Mark complete</option>
          <option value="false">Clear complete</option>
        </select>
      ) : field === "flag_tag" ? (
        <input
          className="h-8 border border-border rounded px-2 text-xs bg-background"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Watch, Priority…"
        />
      ) : field === "commitment" ? (
        <>
          <select
            className="h-8 bg-background border border-border rounded px-2 text-xs [color-scheme:dark]"
            value={commitType}
            onChange={(e) => setCommitType(e.target.value)}
          >
            {COMMITMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <Input
            className="h-8 w-48 text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Metalico, Scrap…"
          />
        </>
      ) : (
        <Input
          className="h-8 w-44 text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={field === "notes" ? "Program note" : undefined}
        />
      )}
      <Button size="sm" onClick={apply} disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving {count} car{count === 1 ? "" : "s"}…
          </>
        ) : (
          `Apply to ${count} selected car${count === 1 ? "" : "s"}`
        )}
      </Button>
    </div>
  );
}

function AddCarsDialog({
  open,
  programId,
  onClose,
  onAdded,
}: {
  open: boolean;
  programId: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<PickedCar[]>([]);
  const [pending, setPending] = useState(false);

  async function add() {
    if (!picked.length) return;
    setPending(true);
    try {
      const preview = await apiRequest("POST", `/api/programs/${programId}/cars/preview`, {
        railcar_ids: picked.map((c) => c.id),
      }).then((r) => r.json());
      await apiRequest("POST", `/api/programs/${programId}/cars/apply`, { preview_token: preview.preview_token });
      toast({
        title: `${(preview.matched ?? []).length} car(s) added`,
        description: preview.inactive?.length ? `${preview.inactive.length} inactive skipped` : undefined,
      });
      setPicked([]);
      onAdded();
    } catch (e: any) {
      toast({ title: "Could not add cars", description: e.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add cars</DialogTitle>
          <DialogDescription>Search and pick several, or paste a list and review matches before adding.</DialogDescription>
        </DialogHeader>
        <ProgramCarPicker programId={programId} value={picked} onChange={setPicked} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={add} disabled={!picked.length || pending}>
            {pending ? "Adding…" : `Add ${picked.length || ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PutOnRentDialog({
  open,
  programId,
  linkIds,
  riders,
  onClose,
  onApplied,
}: {
  open: boolean;
  programId: number;
  linkIds: number[];
  riders: { id: number; rider_name: string | null; schedule_number: string | null }[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const [riderId, setRiderId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState<any>(null);
  const [pending, setPending] = useState(false);

  async function runPreview() {
    setPending(true);
    try {
      const p = await apiRequest("POST", `/api/programs/${programId}/cars/put-on-rent/preview`, {
        link_ids: linkIds,
        rider_id: Number(riderId),
        rent_start_date: date,
      }).then((r) => r.json());
      setPreview(p);
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  async function apply() {
    if (!preview?.preview_token) return;
    setPending(true);
    try {
      const r = await apiRequest("POST", `/api/programs/${programId}/cars/put-on-rent/apply`, {
        preview_token: preview.preview_token,
      }).then((x) => x.json());
      toast({ title: `Put on rent: ${r.written ?? 0} cars` });
      setPreview(null);
      onApplied();
    } catch (e: any) {
      toast({ title: "Apply failed", description: e.message, variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Put on rent</DialogTitle>
          <DialogDescription>
            Preview first. Writes rent_start_date on the current assignment using the same lease logic as Move, one change group.
            Program done is still arrival; On rent is the trail step after.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <select
            className="h-8 w-full bg-background border border-border rounded px-2 text-xs [color-scheme:dark]"
            value={riderId}
            onChange={(e) => { setRiderId(e.target.value); setPreview(null); }}
          >
            <option value="">Select OL / rider…</option>
            {riders.map((r) => (
              <option key={r.id} value={String(r.id)}>
                {r.rider_name || r.schedule_number || r.id}
              </option>
            ))}
          </select>
          <Input type="date" className="h-8 text-xs" value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} />
          {preview ? (
            <div className="text-xs space-y-1 border border-border rounded p-2">
              <div>Will write: {(preview.to_write ?? []).length}</div>
              <div>Already on rider: {(preview.already_on_rider ?? []).length}</div>
              <div>Skip (has date): {(preview.skip_has_date ?? []).length}</div>
              <div>Sold skipped: {(preview.rejected_sold ?? []).length}</div>
              <div>Inactive skipped: {(preview.rejected_inactive ?? []).length}</div>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={runPreview} disabled={!riderId || pending || !linkIds.length}>
            {pending && !preview ? <Loader2 className="h-4 w-4 animate-spin" /> : "Preview"}
          </Button>
          <Button onClick={apply} disabled={!preview?.preview_token || pending}>
            {pending && preview ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply after preview"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
