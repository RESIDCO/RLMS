import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, downloadXlsx } from "@/lib/queryClient";
import { useCanEdit } from "@/lib/AuthContext";
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
import { cn } from "@/lib/utils";
import { Download, History, Loader2, Plus, Paperclip, UserMinus } from "lucide-react";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { GridColumnTh } from "@/components/GridColumnTh";
import { colWidth, mergeColOrder, moveCol, tableWidthFor } from "@/lib/grid-columns";
import {
  CATEGORY_BADGE,
  PROGRAM_CAR_DOC_CATEGORIES,
  PROGRAM_DOC_CATEGORIES,
  PROGRAM_ENTITIES,
  STATUS_BADGE,
  STATUS_LABEL,
  categoryShortName,
  formatCustomField,
  type ProgramFieldDef,
  type ProgramStatus,
} from "@shared/programs";

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
  updated_at?: string;
  category: { id: number; name: string } | null;
  field_defs: ProgramFieldDef[];
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
  } | null;
  shop: { id: number; name: string } | null;
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
  };
}

function carLabelOf(c: ProgramCar): string {
  return [c.railcar?.reporting_marks, c.railcar?.car_number].filter(Boolean).join(" ") || `#${c.railcar_id}`;
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
  return next;
}

const PD_EMPTY_COLS = new Set<string>();
const PD_CORE = ["status", "flag", "comment", "ol_entry", "ol_now", "shop", "repair"] as const;
const PD_LABELS: Record<string, string> = {
  car: "Car",
  complete: "Complete",
  status: "Status",
  flag: "Flag",
  comment: "Comment",
  ol_entry: "OL at entry",
  ol_now: "OL now",
  shop: "Shop",
  repair: "Repair $",
};
const PD_WIDTHS: Record<string, number> = {
  _select: 36,
  car: 140,
  complete: 84,
  status: 220,
  flag: 140,
  comment: 180,
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
  const canEdit = useCanEdit();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [includeExited, setIncludeExited] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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
  const {
    colOrder,
    setColOrder,
    colWidths,
    setColWidth,
  } = useColumnPrefs(`program_cars_${Number.isFinite(id) ? id : 0}`, PD_EMPTY_COLS);
  const displayKeys = useMemo(() => {
    const pinnedStart = canEdit ? ["_select", "car", "complete"] : ["car", "complete"];
    const movable = [...PD_CORE, ...defs.map((d) => `cf:${d.field_key}`)];
    return [...pinnedStart, ...mergeColOrder(movable, colOrder), "_actions"];
  }, [canEdit, defs, colOrder]);
  const movableKeys = displayKeys.filter((k) => k !== "_select" && k !== "car" && k !== "complete" && k !== "_actions");
  const draftedCars = useMemo(
    () => cars.map((c) => applyCarDraft(c, carDrafts[c.id], shops)),
    [cars, carDrafts, shops],
  );
  const sortedCars = useMemo(
    () => [...draftedCars].sort((a, b) => Number(Boolean(a.completed)) - Number(Boolean(b.completed))),
    [draftedCars],
  );
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

  async function saveCarDrafts() {
    const entries = Object.entries(carDrafts);
    if (!entries.length || !canEdit) return;
    setCarSaving(true);
    setCarSaveError(null);
    try {
      await Promise.all(
        entries.map(([linkId, body]) => apiRequest("PATCH", `/api/programs/${id}/cars/${linkId}`, body)),
      );
      setCarDrafts({});
      setCarSavedFlash(true);
      window.setTimeout(() => setCarSavedFlash(false), 2500);
      await Promise.all([
        qc.invalidateQueries({ queryKey: carsKey }),
        qc.invalidateQueries({ queryKey: ["/api/programs", id], exact: true }),
        qc.invalidateQueries({ queryKey: ["/api/programs"], exact: true }),
      ]);
      if (tab === "activity" || historyFor) {
        await qc.invalidateQueries({ queryKey: ["/api/programs", id, "activity"] });
      }
    } catch (e: any) {
      setCarSaveError(e.message || "Save failed");
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setCarSaving(false);
    }
  }

  function pdHeader(key: string) {
    const pinned = key === "_select" || key === "car" || key === "complete" || key === "_actions";
    const cf = key.startsWith("cf:") ? defs.find((d) => `cf:${d.field_key}` === key) : null;
    const w = colWidth(colWidths, key, PD_WIDTHS[key] ?? 120);
    return (
      <GridColumnTh
        key={key}
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
      >
        {key === "_select" ? (
          <Checkbox
            checked={cars.filter((c) => !c.exited_date).length > 0 && cars.filter((c) => !c.exited_date).every((c) => selected.has(c.id))}
            onCheckedChange={toggleAll}
            aria-label="Select all cars"
          />
        ) : key === "_actions" ? null : (
          PD_LABELS[key] ?? cf?.label ?? key
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
              <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={`Select ${label}`} />
            )}
          </td>
        );
      case "car":
        return (
          <td key={key} className="px-2 py-1.5 font-mono whitespace-nowrap">
            {label}
            {exited && <div className="text-[10px] text-muted-foreground">Exited {String(c.exited_date).slice(0, 10)}</div>}
          </td>
        );
      case "complete":
        return (
          <td key={key} className="px-2 py-1 text-center">
            <Checkbox
              checked={Boolean(c.completed)}
              disabled={!canEdit || exited}
              onCheckedChange={(v) => queueCarPatch(c.id, { completed: v === true })}
              aria-label={`Mark ${label} complete in this program`}
            />
          </td>
        );
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
                  await apiRequest("DELETE", `/api/programs/${id}/cars/${c.id}`);
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
    });
    setSavedFlash(true);
    toast({ title: "Saved" });
    window.setTimeout(() => setSavedFlash(false), 2500);
  }

  function toggle(linkId: number) {
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
    <div className="h-full min-h-[36rem] flex flex-col overflow-hidden">
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
                  await downloadReport(`/api/programs/${id}/export?include_exited=${includeExited ? "1" : "0"}`);
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
          {canEdit ? (
            <Select value={program.status} onValueChange={(v) => patchProgram.mutate({ status: v }, { onSuccess: () => toast({ title: "Saved" }) })}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["open", "on_hold", "complete"] as const).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className={cn("text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border", STATUS_BADGE[program.status])}>
              {STATUS_LABEL[program.status]}
            </span>
          )}
        </div>

        <Textarea
          className="text-sm min-h-[52px] max-h-28 overflow-y-auto"
          rows={2}
          value={header.status_narrative}
          readOnly={!canEdit}
          placeholder="Status narrative — the rolled-up note from the SUMMARY tab"
          onChange={(e) => setHeader({ ...header, status_narrative: e.target.value })}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
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
        {canEdit && dirty && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveHeader} disabled={patchProgram.isPending}>
              {patchProgram.isPending ? "Saving…" : "Save header"}
            </Button>
            <span className="text-xs text-muted-foreground">Unsaved header changes</span>
          </div>
        )}
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="shrink-0 self-start">
            <TabsTrigger value="cars">Cars in Program</TabsTrigger>
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
                      Saving…
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              )}
              {carSavedFlash && !gridDirty ? <span className="text-xs text-emerald-400">Saved</span> : null}
              {carSaveError ? <span className="text-xs text-destructive">{carSaveError}</span> : null}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={includeExited} onCheckedChange={(v) => setIncludeExited(v === true)} />
                Show exited cars
              </label>
              <span className="text-xs text-muted-foreground ml-auto">
                {sortedCars.filter((c) => !c.completed).length} open
                {sortedCars.some((c) => c.completed) ? ` · ${sortedCars.filter((c) => c.completed).length} complete` : ""}
                {` · ${sortedCars.length} rows`}
              </span>
            </div>
            {canEdit && selected.size > 0 && (
              <div className="shrink-0">
              <BulkEditBar
                count={selected.size}
                shops={shops}
                statusOptions={statusOptions}
                defs={defs}
                onApply={async (label, updates) => {
                  const ok = await confirmSave({
                    title: `Set ${label} for ${selected.size} selected car${selected.size === 1 ? "" : "s"}?`,
                    confirmLabel: "Apply",
                  });
                  if (!ok) return;
                  await apiRequest("POST", `/api/programs/${id}/cars/bulk`, {
                    link_ids: Array.from(selected),
                    updates,
                  });
                  setCarDrafts((prev) => {
                    const next = { ...prev };
                    for (const linkId of selected) delete next[linkId];
                    return next;
                  });
                  setSelected(new Set());
                  qc.invalidateQueries({ queryKey: carsKey });
                  qc.invalidateQueries({ queryKey: ["/api/programs", id], exact: true });
                  qc.invalidateQueries({ queryKey: ["/api/programs"], exact: true });
                  toast({ title: `Updated ${selected.size} car${selected.size === 1 ? "" : "s"}` });
                }}
              />
              </div>
            )}
            <div className="flex-1 min-h-0 rounded-xl border border-card-border bg-card overflow-hidden flex flex-col">
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
                  {sortedCars.map((c) => {
                    const label = carLabelOf(c);
                    const exited = Boolean(c.exited_date);
                    const done = Boolean(c.completed);
                    return (
                      <tr
                        key={c.id}
                        className={cn(
                          "border-t border-border/50",
                          exited && "opacity-60",
                          done && !exited && !carDrafts[c.id] && "bg-muted/20",
                          carDrafts[c.id] && "border-l-2 border-l-primary bg-primary/5",
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

      <Sheet open={!!docsFor} onOpenChange={(o) => !o && setDocsFor(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {docsFor ? carLabelOf(docsFor) : ""} attachments
            </SheetTitle>
          </SheetHeader>
          {docsFor && (
            <div className="mt-4">
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
  onApply,
}: {
  count: number;
  shops: ShopOption[];
  statusOptions: StatusOption[];
  defs: ProgramFieldDef[];
  onApply: (label: string, updates: Record<string, unknown>) => Promise<void>;
}) {
  const [field, setField] = useState("shop_id");
  const [text, setText] = useState("");
  const [shopId, setShopId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const shopName = shops.find((s) => s.id === shopId)?.name ?? "";

  const fieldOptions = [
    { value: "shop_id", label: "Shop" },
    { value: "status", label: "Status" },
    { value: "completed", label: "Complete" },
    { value: "flag_tag", label: "Flag" },
    { value: "notes", label: "Comment" },
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
    } else if (field === "completed") {
      const on = text !== "false";
      updates = { completed: on };
      label = on ? "Complete" : "Not complete";
    } else if (field === "flag_tag") {
      updates = { flag_tag: text };
      label = `Flag to '${text || "—"}'`;
    } else if (field === "notes") {
      updates = { notes: text };
      label = "Comment";
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
      ) : (
        <Input className="h-8 w-44 text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      )}
      <Button size="sm" onClick={apply} disabled={pending}>
        Apply to {count} selected car{count === 1 ? "" : "s"}
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
      const res = await apiRequest("POST", `/api/programs/${programId}/cars`, {
        railcar_ids: picked.map((c) => c.id),
      });
      const out = await res.json();
      const added = (out.added ?? []).length;
      const skipped = (out.skipped ?? []).length;
      toast({
        title: `${added} car${added === 1 ? "" : "s"} added`,
        description: skipped ? `${skipped} already in this program` : undefined,
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
