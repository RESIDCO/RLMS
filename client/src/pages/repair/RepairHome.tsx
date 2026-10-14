/**
 * OWNER_UI §A — Estimates History landing `/#/repair`
 * Layout matched to docs/repair/screenshots/01-estimates-history.png
 * Estimate Review page is unchanged — car/estimate link opens it.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import {
  Paperclip,
  Check,
  X,
  Trash2,
  Search,
  RotateCcw,
  GripVertical,
  Columns3,
} from "lucide-react";
import RepairOwnerShell from "./RepairOwnerShell";
import { repairUserStorageKey, useRepairTheme } from "./repairTheme";

type Shop = {
  id: string;
  reporting_mark: string;
  name: string;
  city?: string | null;
  state?: string | null;
  display_label?: string;
};

type GridRow = {
  estimate_id: string;
  event_id: string;
  estimate_label: string;
  car_mark: string;
  car_number: string;
  status_code: string;
  status_name: string;
  total_display: string;
  total_cents: number;
  issues: string;
  attachment_count: number;
  shop_display: string | null;
  yard_arrived_at: string | null;
  approval_requested_at: string | null;
  approved_at: string | null;
  terminated_at: string | null;
  target_outbound_at: string | null;
  actual_outbound_at: string | null;
  invoice_no: string | null;
  bad_order_reason: string | null;
  ctc: string | null;
  assignment: string | null;
  wreck: string;
  dispo_reqd: string;
  lease_type: string | null;
  resp6_email_at: string | null;
};

type Summary = {
  estimates: number;
  cars: number;
  clients: number;
  totalCostDisplay: string;
  perEstimateDisplay: string;
  perCarDisplay: string;
  perClientDisplay: string;
};

type ColId =
  | "estimate"
  | "status"
  | "total"
  | "issues"
  | "attachment"
  | "shop"
  | "yard"
  | "approval_requested"
  | "approved"
  | "terminated"
  | "action"
  | "outbound_target"
  | "outbound_date"
  | "invoice"
  | "bo_reason"
  | "ctc"
  | "assignment"
  | "wreck"
  | "dispo"
  | "lease"
  | "resp6";

type ColDef = {
  id: ColId;
  label: string;
  width: number;
  align?: "left" | "right" | "center";
  filterable?: boolean;
  hideable?: boolean;
};

const DEFAULT_COLUMNS: ColDef[] = [
  { id: "estimate", label: "Estimate", width: 110, filterable: true },
  { id: "status", label: "Status", width: 150, filterable: true },
  { id: "total", label: "Total", width: 100, align: "right", filterable: true },
  { id: "issues", label: "Issues?", width: 70, filterable: true },
  { id: "attachment", label: "Attachment", width: 80, align: "center" },
  { id: "shop", label: "Shop Name", width: 200, filterable: true },
  { id: "yard", label: "Arrived At Yard", width: 110, filterable: true },
  { id: "approval_requested", label: "Approval Requested", width: 120, filterable: true },
  { id: "approved", label: "Approved", width: 70, align: "center" },
  { id: "terminated", label: "Terminated", width: 70, align: "center" },
  { id: "action", label: "Action", width: 60, align: "center", hideable: true },
  { id: "outbound_target", label: "Outbound Target", width: 110, filterable: true },
  { id: "outbound_date", label: "Outbound Date", width: 100, filterable: true },
  { id: "invoice", label: "Invoice #", width: 90, filterable: true },
  { id: "bo_reason", label: "Bad Order Reason", width: 140, filterable: true },
  { id: "ctc", label: "CTC", width: 60, filterable: true },
  { id: "assignment", label: "Assignment", width: 200, filterable: true },
  { id: "wreck", label: "Wreck?", width: 70, filterable: true },
  { id: "dispo", label: "Dispo Req'd", width: 80, filterable: true },
  { id: "lease", label: "Lease Type", width: 100, filterable: true },
  { id: "resp6", label: "Resp 6 Email", width: 100, filterable: true },
];

const DEFAULT_COL_ORDER = DEFAULT_COLUMNS.map((c) => c.id);
const DEFAULT_WIDTHS = Object.fromEntries(
  DEFAULT_COLUMNS.map((c) => [c.id, c.width]),
) as Record<ColId, number>;
const DEFAULT_VISIBILITY = Object.fromEntries(
  DEFAULT_COLUMNS.map((c) => [c.id, true]),
) as Record<ColId, boolean>;

type SavedView = {
  id: string;
  name: string;
  statuses: string[];
  shopId: string;
  carMark: string;
  carNumber: string;
  from: string;
  to: string;
  dateField: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  groupBy: string;
  pageSize: number;
  columnOrder: ColId[];
  columnWidths: Partial<Record<ColId, number>>;
  columnVisibility: Partial<Record<ColId, boolean>>;
  columnFilters: Partial<Record<ColId, string>>;
};

const ACTIONABLE = [
  "AWAITING_APPROVAL",
  "REVISION_REQUESTED",
  "ADJUSTMENT_FOR_APPROVAL",
  "AWAITING_TERMINATE",
];

const ALL_STATUSES = [
  { code: "AWAITING_APPROVAL", label: "Awaiting Approval" },
  { code: "REVISION_REQUESTED", label: "Revision Requested" },
  { code: "ADJUSTMENT_FOR_APPROVAL", label: "Adjustment for Approval" },
  { code: "AWAITING_TERMINATE", label: "Awaiting Terminate" },
  { code: "APPROVED", label: "Approved" },
  { code: "COMPLETED", label: "Completed" },
  { code: "TERMINATED", label: "Terminated" },
  { code: "QUEUED", label: "Queued" },
  { code: "VOIDED", label: "Voided" },
  { code: "AWAITING_DELETE", label: "Awaiting Delete" },
];

const DATE_FIELDS = [
  { value: "ignore", label: "Ignore Date Range" },
  { value: "yard_arrival", label: "Arrived At Yard" },
  { value: "approval_requested", label: "Approval Requested" },
  { value: "approved", label: "Approved" },
  { value: "outbound_target", label: "Outbound Target" },
  { value: "outbound_date", label: "Outbound Date" },
  { value: "created", label: "Created" },
  { value: "terminated", label: "Terminated" },
];

const VIEWS_PREFIX = "repair.estimatesHistory.views";
const DEFAULT_VIEW_PREFIX = "repair.estimatesHistory.defaultViewId";

/** Auto-approval rules are not shipped yet — hide queue toggle until they exist. */
const HAS_AUTO_APPROVAL_RULES = false;

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(repairUserStorageKey(VIEWS_PREFIX));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveViews(views: SavedView[]) {
  localStorage.setItem(repairUserStorageKey(VIEWS_PREFIX), JSON.stringify(views));
}

function loadDefaultViewId(): string {
  try {
    return localStorage.getItem(repairUserStorageKey(DEFAULT_VIEW_PREFIX)) || "default";
  } catch {
    return "default";
  }
}

function saveDefaultViewId(id: string) {
  localStorage.setItem(repairUserStorageKey(DEFAULT_VIEW_PREFIX), id);
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    if (m) return `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}`;
    return String(v);
  }
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function money(display: string | undefined): string {
  if (!display) return "$0.00";
  const n = Number(display);
  if (!Number.isFinite(n)) return `$${display}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Status cell fill: colored background + dark text — distinct in light and dark chrome. */
function statusClass(code: string): string {
  switch (code) {
    case "AWAITING_APPROVAL":
      return "bg-yellow-300 text-slate-900 font-semibold";
    case "REVISION_REQUESTED":
      return "bg-yellow-200 text-slate-900 font-semibold";
    case "ADJUSTMENT_FOR_APPROVAL":
      return "bg-orange-400 text-slate-900 font-semibold";
    case "AWAITING_TERMINATE":
      return "bg-rose-300 text-slate-900 font-semibold";
    case "APPROVED":
      return "bg-emerald-200 text-slate-900 font-semibold";
    case "COMPLETED":
      return "bg-slate-200 text-slate-900 font-medium";
    case "TERMINATED":
    case "VOIDED":
      return "bg-red-200 text-slate-900 font-semibold";
    case "QUEUED":
      return "bg-sky-100 text-slate-900 font-medium";
    default:
      return "bg-slate-100 text-slate-900";
  }
}

function isOutboundOverdue(target: string | null): boolean {
  if (!target) return false;
  const d = new Date(target);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function colFilterValue(row: GridRow, id: ColId): string {
  switch (id) {
    case "estimate":
      return row.estimate_label ?? "";
    case "status":
      return row.status_name ?? "";
    case "total":
      return row.total_display ?? "";
    case "issues":
      return row.issues ?? "";
    case "attachment":
      return String(row.attachment_count ?? "");
    case "shop":
      return row.shop_display ?? "";
    case "yard":
      return fmtDate(row.yard_arrived_at);
    case "approval_requested":
      return fmtDate(row.approval_requested_at);
    case "approved":
      return row.approved_at ? "yes" : "";
    case "terminated":
      return row.terminated_at ? "yes" : "";
    case "action":
      return "";
    case "outbound_target":
      return fmtDate(row.target_outbound_at);
    case "outbound_date":
      return fmtDate(row.actual_outbound_at);
    case "invoice":
      return row.invoice_no ?? "";
    case "bo_reason":
      return row.bad_order_reason ?? "";
    case "ctc":
      return row.ctc ?? "";
    case "assignment":
      return row.assignment ?? "";
    case "wreck":
      return row.wreck ?? "";
    case "dispo":
      return row.dispo_reqd ?? "";
    case "lease":
      return row.lease_type ?? "";
    case "resp6":
      return fmtDate(row.resp6_email_at);
    default:
      return "";
  }
}

function EstimatesHistoryBody() {
  const { theme } = useRepairTheme();
  const dark = theme === "dark";

  const [shops, setShops] = useState<Shop[]>([]);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [shopId, setShopId] = useState("all");
  const [statuses, setStatuses] = useState<string[]>([...ACTIONABLE]);
  const [carMark, setCarMark] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dateField, setDateField] = useState("ignore");
  const [sortBy, setSortBy] = useState("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [groupBy, setGroupBy] = useState("none");
  const [pageSize, setPageSize] = useState(500);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeView, setActiveView] = useState("default");
  const [defaultViewId, setDefaultViewId] = useState("default");
  const [showCreateFilter, setShowCreateFilter] = useState(false);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);

  const [columnOrder, setColumnOrder] = useState<ColId[]>([...DEFAULT_COL_ORDER]);
  const [columnWidths, setColumnWidths] = useState<Record<ColId, number>>({ ...DEFAULT_WIDTHS });
  const [columnVisibility, setColumnVisibility] = useState<Record<ColId, boolean>>({
    ...DEFAULT_VISIBILITY,
  });
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColId, string>>>({});

  const [tankGateOn, setTankGateOn] = useState(false);
  const [tankDocCompleteCount, setTankDocCompleteCount] = useState(0);

  const dragCol = useRef<ColId | null>(null);
  const resizeRef = useRef<{ id: ColId; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const savedViews = loadViews();
    setViews(savedViews);
    const def = loadDefaultViewId();
    setDefaultViewId(def);
    setActiveView(def);

    apiRequest("GET", "/api/repair/shops")
      .then((r) => r.json())
      .then((d) => setShops(d.shops ?? []))
      .catch(() => undefined);

    apiRequest("GET", "/api/repair/settings/tank-doc-gate")
      .then((r) => r.json())
      .then((d) => {
        const on = d.enabled === true;
        setTankGateOn(on);
        if (!on) return;
        return apiRequest("GET", "/api/repair/tank-docs/pending")
          .then((r2) => r2.json())
          .then((p) => {
            const list = p.packets ?? p.rows ?? p.items ?? [];
            setTankDocCompleteCount(Array.isArray(list) ? list.length : 0);
          })
          .catch(() => setTankDocCompleteCount(0));
      })
      .catch(() => setTankGateOn(false));
  }, []);

  const applyViewState = useCallback((v: SavedView | "default") => {
    if (v === "default") {
      setShopId("all");
      setStatuses([...ACTIONABLE]);
      setCarMark("");
      setCarNumber("");
      setFrom("");
      setTo("");
      setDateField("ignore");
      setSortBy("created");
      setSortDir("desc");
      setGroupBy("none");
      setPageSize(500);
      setPage(1);
      setColumnOrder([...DEFAULT_COL_ORDER]);
      setColumnWidths({ ...DEFAULT_WIDTHS });
      setColumnVisibility({ ...DEFAULT_VISIBILITY });
      setColumnFilters({});
      return;
    }
    setStatuses(v.statuses?.length ? [...v.statuses] : [...ACTIONABLE]);
    setShopId(v.shopId || "all");
    setCarMark(v.carMark ?? "");
    setCarNumber(v.carNumber ?? "");
    setFrom(v.from ?? "");
    setTo(v.to ?? "");
    setDateField(v.dateField ?? "ignore");
    setSortBy(v.sortBy ?? "created");
    setSortDir(v.sortDir ?? "desc");
    setGroupBy(v.groupBy ?? "none");
    setPageSize(v.pageSize ?? 500);
    setPage(1);
    setColumnOrder(
      v.columnOrder?.length
        ? (v.columnOrder.filter((id) => DEFAULT_COL_ORDER.includes(id)) as ColId[])
        : [...DEFAULT_COL_ORDER],
    );
    setColumnWidths({ ...DEFAULT_WIDTHS, ...(v.columnWidths as Record<ColId, number>) });
    setColumnVisibility({
      ...DEFAULT_VISIBILITY,
      ...(v.columnVisibility as Record<ColId, boolean>),
    });
    setColumnFilters({ ...(v.columnFilters ?? {}) });
  }, []);

  // Apply default view once views are loaded
  const didApplyDefault = useRef(false);
  useEffect(() => {
    if (didApplyDefault.current) return;
    didApplyDefault.current = true;
    const def = loadDefaultViewId();
    if (def !== "default") {
      const v = loadViews().find((x) => x.id === def);
      if (v) {
        setActiveView(def);
        applyViewState(v);
        return;
      }
    }
    setActiveView("default");
  }, [applyViewState]);

  const buildQuery = useCallback(() => {
    const qs = new URLSearchParams();
    if (statuses.length) qs.set("status", statuses.join(","));
    if (shopId && shopId !== "all") qs.set("shopId", shopId);
    if (carMark.trim()) qs.set("carMark", carMark.trim());
    if (carNumber.trim()) qs.set("carNumber", carNumber.trim());
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (dateField) qs.set("dateField", dateField);
    qs.set("limit", String(pageSize));
    qs.set("offset", String((page - 1) * pageSize));
    qs.set("sortBy", sortBy);
    qs.set("sortDir", sortDir);
    if (statuses.includes("QUEUED") || statuses.includes("VOIDED")) {
      qs.set("includeShopDraft", "1");
      qs.set("includeHidden", "1");
    }
    return qs.toString();
  }, [
    statuses,
    shopId,
    carMark,
    carNumber,
    from,
    to,
    dateField,
    pageSize,
    page,
    sortBy,
    sortDir,
  ]);

  const loadGrid = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest("GET", `/api/repair/estimates/grid?${buildQuery()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load estimates");
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load estimates");
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    loadGrid();
  }, [loadGrid]);

  function toggleStatus(code: string) {
    setPage(1);
    setStatuses((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  function resetFilters() {
    applyViewState("default");
    setActiveView("default");
  }

  function applyView(id: string) {
    setActiveView(id);
    if (id === "default") {
      applyViewState("default");
      return;
    }
    const v = views.find((x) => x.id === id);
    if (!v) return;
    applyViewState(v);
  }

  function snapshotView(name: string, id?: string): SavedView {
    return {
      id: id ?? `v-${Date.now()}`,
      name: name.trim(),
      statuses: [...statuses],
      shopId,
      carMark,
      carNumber,
      from,
      to,
      dateField,
      sortBy,
      sortDir,
      groupBy,
      pageSize,
      columnOrder: [...columnOrder],
      columnWidths: { ...columnWidths },
      columnVisibility: { ...columnVisibility },
      columnFilters: { ...columnFilters },
    };
  }

  function saveCurrentView() {
    const name = window.prompt("View name");
    if (!name?.trim()) return;
    const existing = views.find((v) => v.name === name.trim());
    const next = snapshotView(name, existing?.id);
    const updated = [...views.filter((v) => v.name !== next.name), next];
    setViews(updated);
    saveViews(updated);
    setActiveView(next.id);
  }

  function setCurrentAsDefault() {
    if (activeView === "default") {
      saveDefaultViewId("default");
      setDefaultViewId("default");
      setMsg("Default view set to built-in action queue");
      return;
    }
    // Persist latest column/filter state into the named view first
    const v = views.find((x) => x.id === activeView);
    if (!v) return;
    const next = snapshotView(v.name, v.id);
    const updated = views.map((x) => (x.id === next.id ? next : x));
    setViews(updated);
    saveViews(updated);
    saveDefaultViewId(next.id);
    setDefaultViewId(next.id);
    setMsg(`Default view set to “${next.name}”`);
  }

  function manageViews() {
    if (!views.length) {
      window.alert("No saved views yet. Use Save view first.");
      return;
    }
    const names = views
      .map((v, i) => `${i + 1}. ${v.name}${v.id === defaultViewId ? " (default)" : ""}`)
      .join("\n");
    const pick = window.prompt(
      `Saved views:\n${names}\n\nEnter number to delete, or Cancel.`,
    );
    if (!pick) return;
    const idx = Number(pick) - 1;
    if (idx < 0 || idx >= views.length) return;
    const removed = views[idx];
    const updated = views.filter((_, i) => i !== idx);
    setViews(updated);
    saveViews(updated);
    if (activeView === removed.id) {
      setActiveView("default");
      applyViewState("default");
    }
    if (defaultViewId === removed.id) {
      saveDefaultViewId("default");
      setDefaultViewId("default");
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleSelectAll(visible: GridRow[]) {
    if (selected.size === visible.length && visible.length > 0) setSelected(new Set());
    else setSelected(new Set(visible.map((r) => r.estimate_id)));
  }

  async function bulkApprove() {
    setMsg("");
    setError("");
    const ids = [...selected];
    if (!ids.length) {
      setError("Select one or more estimates");
      return;
    }
    const res = await apiRequest("POST", "/api/repair/estimates/bulk-approve", {
      estimateIds: ids,
    });
    const data = await res.json();
    setMsg(`Approved ${data.approved ?? 0}; failed ${data.failed ?? 0}`);
    await loadGrid();
  }

  async function getBrc() {
    setMsg("");
    setError("");
    const ids = [...selected];
    if (!ids.length) {
      setError("Select one or more estimates");
      return;
    }
    const res = await apiRequest("POST", "/api/repair/estimates/brc-export", {
      estimateIds: ids,
    });
    const blob = await res.blob();
    downloadBlob(blob, "brc-detail.csv");
    setMsg("BRC detail downloaded");
  }

  async function exportExcelSelection() {
    await exportGrid("csv");
  }

  async function export500() {
    setMsg("");
    setError("");
    const ids = selected.size ? [...selected] : rows.map((r) => r.estimate_id);
    if (!ids.length) {
      setError("No estimates to export");
      return;
    }
    const res = await apiRequest("POST", "/api/repair/estimates/export-aar", {
      estimateIds: ids,
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "500-byte export failed");
      return;
    }
    const files = data.files ?? [];
    if (!files.length) {
      setMsg("No 500-byte content for selection");
      return;
    }
    for (const f of files) {
      downloadBlob(
        new Blob([f.content], { type: "text/plain" }),
        f.filename || "estimate-500.txt",
      );
    }
    setMsg(`Exported ${files.length} 500-byte file(s)`);
  }

  async function exportGrid(format: "csv" | "excel") {
    const qs = buildQuery();
    const res = await apiRequest("GET", `/api/repair/estimates/grid/export?${qs}`);
    const blob = await res.blob();
    downloadBlob(blob, format === "excel" ? "estimates-grid.csv" : "estimates-grid.csv");
    setMsg("Grid exported");
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const visibleCols = useMemo(
    () => columnOrder.filter((id) => columnVisibility[id] !== false),
    [columnOrder, columnVisibility],
  );

  const filteredRows = useMemo(() => {
    const entries = Object.entries(columnFilters).filter(([, v]) => v?.trim());
    if (!entries.length) return rows;
    return rows.filter((row) =>
      entries.every(([id, raw]) => {
        const needle = String(raw).toLowerCase();
        return colFilterValue(row, id as ColId).toLowerCase().includes(needle);
      }),
    );
  }, [rows, columnFilters]);

  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key: "", rows: filteredRows }];
    const map = new Map<string, GridRow[]>();
    for (const r of filteredRows) {
      let key = "";
      if (groupBy === "status") key = r.status_name;
      else if (groupBy === "shop") key = r.shop_display || "(no shop)";
      else if (groupBy === "wreck") key = r.wreck;
      else key = "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].map(([key, groupRows]) => ({ key, rows: groupRows }));
  }, [filteredRows, groupBy]);

  const totalPages = Math.max(1, Math.ceil((summary?.estimates ?? rows.length) / pageSize) || 1);
  const statusLabel = statuses
    .map((c) => ALL_STATUSES.find((s) => s.code === c)?.label ?? c)
    .join("; ");

  const colSpan = visibleCols.length + 1;

  function onHeaderDragStart(id: ColId) {
    dragCol.current = id;
  }

  function onHeaderDragOver(e: DragEvent, overId: ColId) {
    e.preventDefault();
    const from = dragCol.current;
    if (!from || from === overId) return;
    setColumnOrder((prev) => {
      const next = [...prev];
      const fi = next.indexOf(from);
      const ti = next.indexOf(overId);
      if (fi < 0 || ti < 0) return prev;
      next.splice(fi, 1);
      next.splice(ti, 0, from);
      return next;
    });
    dragCol.current = overId;
  }

  function onHeaderDragEnd() {
    dragCol.current = null;
  }

  function startResize(e: ReactMouseEvent, id: ColId) {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { id, startX: e.clientX, startW: columnWidths[id] ?? 100 };
    function onMove(ev: MouseEvent) {
      const cur = resizeRef.current;
      if (!cur) return;
      const w = Math.max(56, cur.startW + (ev.clientX - cur.startX));
      setColumnWidths((prev) => ({ ...prev, [cur.id]: w }));
    }
    function onUp() {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function renderCell(r: GridRow, id: ColId) {
    switch (id) {
      case "estimate":
        return (
          <Link
            href={`/repair/estimates/${r.estimate_id}`}
            className="text-blue-700 dark:text-sky-300 underline font-semibold"
          >
            {r.estimate_label}
          </Link>
        );
      case "status":
        return r.status_name;
      case "total":
        return (
          <span className="font-bold tabular-nums">{money(r.total_display)}</span>
        );
      case "issues":
        return r.issues;
      case "attachment":
        return r.attachment_count > 0 ? (
          <span
            className="inline-flex items-center gap-0.5"
            title={`${r.attachment_count} attachment(s)`}
          >
            <Paperclip className="h-3.5 w-3.5" />
            {r.attachment_count > 1 ? r.attachment_count : null}
          </span>
        ) : null;
      case "shop":
        return r.shop_display;
      case "yard":
        return fmtDate(r.yard_arrived_at);
      case "approval_requested":
        return fmtDate(r.approval_requested_at);
      case "approved":
        return r.approved_at ? (
          <span title={fmtDate(r.approved_at)} className="text-emerald-700 inline-flex">
            <Check className="h-4 w-4" />
          </span>
        ) : (
          <span className="text-emerald-700/50 inline-flex" title="Approve via bulk or estimate page">
            <Check className="h-4 w-4" />
          </span>
        );
      case "terminated":
        return (
          <span
            className="text-red-700 inline-flex"
            title={r.terminated_at ? fmtDate(r.terminated_at) : "Terminate on estimate page"}
          >
            <X className="h-4 w-4" />
          </span>
        );
      case "action":
        return (
          <Link
            href={`/repair/estimates/${r.estimate_id}`}
            className="inline-flex opacity-80 hover:opacity-100"
            title="Open estimate"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Link>
        );
      case "outbound_target":
        return (
          <span
            className={
              isOutboundOverdue(r.target_outbound_at)
                ? "bg-red-600 text-white font-semibold px-1"
                : undefined
            }
          >
            {fmtDate(r.target_outbound_at)}
          </span>
        );
      case "outbound_date":
        return fmtDate(r.actual_outbound_at);
      case "invoice":
        return r.invoice_no ?? "";
      case "bo_reason":
        return r.bad_order_reason ? (
          <span className="text-blue-700 dark:text-sky-300 underline font-medium">
            {r.bad_order_reason}
          </span>
        ) : null;
      case "ctc":
        return r.ctc ?? "";
      case "assignment":
        return (
          <span className="block max-w-[220px] truncate" title={r.assignment ?? ""}>
            {r.assignment}
          </span>
        );
      case "wreck":
        return r.wreck;
      case "dispo":
        return r.dispo_reqd;
      case "lease":
        return r.lease_type;
      case "resp6":
        return fmtDate(r.resp6_email_at);
      default:
        return null;
    }
  }

  const panel = dark ? "border-slate-600 bg-slate-800/80" : "border-slate-400 bg-[#e8eaed]";
  const labelCls = dark ? "text-xs text-slate-100 font-semibold" : "text-xs text-slate-900 font-semibold";
  const inputCls = dark
    ? "h-8 bg-slate-900 text-slate-100 border-slate-500"
    : "h-8 bg-white text-slate-900 border-slate-500";
  const btnOutline = dark
    ? "h-8 text-slate-100 border-slate-500 bg-slate-900 hover:bg-slate-800"
    : "h-8 text-slate-900 border-slate-500 bg-white";

  return (
    <div
      className={
        dark
          ? "min-h-full bg-slate-950 text-sm text-slate-100"
          : "min-h-full bg-[#f3f4f6] text-sm text-slate-900"
      }
    >
      <div className="bg-[#8B1E1E] text-white px-4 py-2 flex items-center justify-between">
        <div className="font-semibold tracking-wide">
          Residco — Main — Default :: Estimates History
        </div>
        <button
          type="button"
          className="text-white hover:text-white text-xs underline font-medium"
          onClick={() => loadGrid()}
        >
          Refresh
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div className={`flex flex-wrap gap-2 items-center text-xs ${dark ? "text-slate-100" : "text-slate-900"}`}>
          <Label className={labelCls}>Views</Label>
          <Select value={activeView} onValueChange={applyView}>
            <SelectTrigger className={`h-8 w-[220px] ${inputCls}`}>
              <SelectValue placeholder="Default action queue" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">
                Default action queue{defaultViewId === "default" ? " ★" : ""}
              </SelectItem>
              {views.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                  {v.id === defaultViewId ? " ★" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" className={btnOutline} onClick={saveCurrentView}>
            Save view
          </Button>
          <Button type="button" variant="outline" size="sm" className={btnOutline} onClick={setCurrentAsDefault}>
            Set as default
          </Button>
          <Button type="button" variant="outline" size="sm" className={btnOutline} onClick={manageViews}>
            Manage views
          </Button>
          <div className="relative">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={btnOutline}
              onClick={() => setShowColumnsMenu((v) => !v)}
            >
              <Columns3 className="h-3.5 w-3.5 mr-1" />
              Columns
            </Button>
            {showColumnsMenu ? (
              <div
                className={`absolute z-40 mt-1 w-56 border rounded shadow-lg p-2 space-y-1 max-h-72 overflow-auto ${
                  dark ? "bg-slate-900 border-slate-600 text-slate-100" : "bg-white border-slate-300 text-slate-900"
                }`}
              >
                {DEFAULT_COLUMNS.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={columnVisibility[c.id] !== false}
                      onCheckedChange={(v) =>
                        setColumnVisibility((prev) => ({ ...prev, [c.id]: Boolean(v) }))
                      }
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr_0.9fr]">
          <fieldset className={`border rounded p-3 space-y-2 ${panel}`}>
            <legend className={`px-1 text-xs font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>
              Search
            </legend>
            <div className="grid gap-2">
              <div className="grid gap-1">
                <Label className={labelCls}>Shop</Label>
                <Select value={shopId} onValueChange={(v) => { setShopId(v); setPage(1); }}>
                  <SelectTrigger className={inputCls}>
                    <SelectValue placeholder="--- All Shop Locations ---" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">--- All Shop Locations ---</SelectItem>
                    {shops.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.display_label || s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className={labelCls}>Initials</Label>
                  <Input
                    className={inputCls}
                    value={carMark}
                    onChange={(e) => { setCarMark(e.target.value.toUpperCase()); setPage(1); }}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className={labelCls}>Number</Label>
                  <Input
                    className={inputCls}
                    value={carNumber}
                    onChange={(e) => { setCarNumber(e.target.value); setPage(1); }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className={labelCls}>Date Range</Label>
                  <div className="flex gap-1">
                    <Input
                      type="date"
                      className={inputCls}
                      value={from}
                      onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                    />
                    <Input
                      type="date"
                      className={inputCls}
                      value={to}
                      onChange={(e) => { setTo(e.target.value); setPage(1); }}
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label className={labelCls}>Date Range Filter</Label>
                  <Select value={dateField} onValueChange={(v) => { setDateField(v); setPage(1); }}>
                    <SelectTrigger className={inputCls}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1">
                <Label className={labelCls}>Status</Label>
                <div className="flex gap-2 items-start">
                  <div
                    className={`flex-1 border rounded p-2 max-h-28 overflow-auto text-xs space-y-1 ${
                      dark
                        ? "border-slate-600 bg-slate-900 text-slate-100"
                        : "border-slate-400 bg-white text-slate-900"
                    }`}
                  >
                    <div className="mb-1 truncate font-medium" title={statusLabel}>
                      {statusLabel || "(none)"}
                    </div>
                    {ALL_STATUSES.map((s) => (
                      <label key={s.code} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={statuses.includes(s.code)}
                          onCheckedChange={() => toggleStatus(s.code)}
                        />
                        <span>{s.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button type="button" size="icon" className="h-8 w-8 bg-slate-700 text-white border-slate-700" onClick={() => loadGrid()}>
                      <Search className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className={`h-8 w-8 ${dark ? "text-red-300 border-slate-500 bg-slate-900" : "text-red-700 border-slate-500 bg-white"}`}
                      onClick={resetFilters}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </fieldset>

          <fieldset className={`border rounded p-3 space-y-2 ${panel}`}>
            <legend className={`px-1 text-xs font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>
              Apply to Checked Estimates
            </legend>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className={
                  dark
                    ? "h-8 border-sky-400 text-sky-200 bg-slate-900 font-medium"
                    : "h-8 border-blue-700 text-blue-800 bg-white font-medium"
                }
                onClick={bulkApprove}
              >
                Approve
              </Button>
              <Button type="button" variant="outline" className={btnOutline} onClick={getBrc}>
                Get BRC
              </Button>
              <Button type="button" variant="outline" className={btnOutline} onClick={exportExcelSelection}>
                Excel
              </Button>
              <Button type="button" variant="outline" className={btnOutline} onClick={export500}>
                500
              </Button>
            </div>
            {HAS_AUTO_APPROVAL_RULES ? (
              <label className={`flex items-center gap-2 text-xs font-medium ${dark ? "text-slate-100" : "text-slate-900"}`}>
                <Checkbox checked={false} disabled />
                View Auto Approval Queue
              </label>
            ) : null}
            {tankGateOn ? (
              <div className={`text-xs font-medium ${dark ? "text-slate-200" : "text-slate-800"}`}>
                Tank Car Doc Complete ({tankDocCompleteCount} estimates)
              </div>
            ) : null}
          </fieldset>

          <fieldset className={`border rounded p-3 ${panel}`}>
            <legend className={`px-1 text-xs font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>
              Summary
            </legend>
            <dl className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs ${dark ? "text-slate-100" : "text-slate-900"}`}>
              <dt className="font-medium">Estimates:</dt>
              <dd className="text-right font-bold">{summary?.estimates ?? 0}</dd>
              <dt className="font-medium"># of cars:</dt>
              <dd className="text-right font-bold">{summary?.cars ?? 0}</dd>
              <dt className="font-medium"># of clients:</dt>
              <dd className="text-right font-bold">{summary?.clients ?? 0}</dd>
              <dt className="font-medium">Total Cost ($):</dt>
              <dd className="text-right font-bold">{money(summary?.totalCostDisplay)}</dd>
              <dt className="font-medium">$ per estimate:</dt>
              <dd className="text-right font-bold">{money(summary?.perEstimateDisplay)}</dd>
              <dt className="font-medium">$ per car:</dt>
              <dd className="text-right font-bold">{money(summary?.perCarDisplay)}</dd>
              <dt className="font-medium">$ per client:</dt>
              <dd className="text-right font-bold">{money(summary?.perClientDisplay)}</dd>
            </dl>
          </fieldset>
        </div>

        {error ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 dark:bg-red-950 dark:text-red-200 dark:border-red-800">
            {error}
          </div>
        ) : null}
        {msg ? (
          <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800">
            {msg}
          </div>
        ) : null}

        <div className={`flex flex-wrap items-center gap-3 text-xs font-medium ${dark ? "text-slate-100" : "text-slate-900"}`}>
          <span>
            Page {page} of {totalPages} ({summary?.estimates ?? rows.length} items
            {filteredRows.length !== rows.length ? `; ${filteredRows.length} after column filters` : ""})
          </span>
          {[
            { label: "« First", disabled: page <= 1, onClick: () => setPage(1) },
            { label: "‹ Prev", disabled: page <= 1, onClick: () => setPage((p) => Math.max(1, p - 1)) },
          ].map((b) => (
            <Button
              key={b.label}
              type="button"
              variant="outline"
              size="sm"
              className={`h-7 ${btnOutline}`}
              disabled={b.disabled}
              onClick={b.onClick}
            >
              {b.label}
            </Button>
          ))}
          <span>Select Page: {page}</span>
          {[
            { label: "Next ›", disabled: page >= totalPages, onClick: () => setPage((p) => p + 1) },
            { label: "Last »", disabled: page >= totalPages, onClick: () => setPage(totalPages) },
          ].map((b) => (
            <Button
              key={b.label}
              type="button"
              variant="outline"
              size="sm"
              className={`h-7 ${btnOutline}`}
              disabled={b.disabled}
              onClick={b.onClick}
            >
              {b.label}
            </Button>
          ))}
          <Label className={`${labelCls} ml-2`}>Items per page</Label>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
          >
            <SelectTrigger className={`h-7 w-[80px] ${inputCls}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 250, 500].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value="export"
            onValueChange={(v) => {
              if (v === "csv" || v === "excel") exportGrid(v);
            }}
          >
            <SelectTrigger className="h-7 w-[130px] bg-slate-800 text-white border-slate-800 font-semibold">
              <SelectValue placeholder="Export Grid" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="export" disabled>
                Export Grid
              </SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="excel">Excel (CSV)</SelectItem>
            </SelectContent>
          </Select>
          <Label className={labelCls}>Group by</Label>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className={`h-7 w-[140px] ${inputCls}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="shop">Shop</SelectItem>
              <SelectItem value="wreck">Wreck?</SelectItem>
            </SelectContent>
          </Select>
          <Label className={labelCls}>Sort</Label>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v)}>
            <SelectTrigger className={`h-7 w-[160px] ${inputCls}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created">Created</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="total">Total</SelectItem>
              <SelectItem value="shop">Shop</SelectItem>
              <SelectItem value="estimate">Estimate</SelectItem>
              <SelectItem value="yard_arrival">Arrived At Yard</SelectItem>
              <SelectItem value="outbound_target">Outbound Target</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`h-7 ${btnOutline}`}
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </Button>
        </div>

        <div
          className={`border rounded overflow-hidden ${
            dark ? "border-slate-600 bg-slate-900 text-slate-100" : "border-slate-400 bg-white text-slate-900"
          }`}
        >
          <div
            className={`text-xs px-3 py-1.5 border-b font-medium ${
              dark
                ? "bg-slate-800 text-slate-200 border-slate-600"
                : "bg-slate-200 text-slate-800 border-slate-300"
            }`}
          >
            Drag column handles to reorder · filter row under headers · Columns menu for show/hide
            {groupBy !== "none" ? ` · grouped by ${groupBy}` : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[1600px]">
              <thead>
                <tr className="bg-slate-700 text-white">
                  <th className="px-2 py-2 text-left font-medium w-8 sticky left-0 bg-slate-700 z-10">
                    <Checkbox
                      checked={
                        filteredRows.length > 0 && selected.size === filteredRows.length
                      }
                      onCheckedChange={() => toggleSelectAll(filteredRows)}
                    />
                  </th>
                  {visibleCols.map((id) => {
                    const def = DEFAULT_COLUMNS.find((c) => c.id === id)!;
                    return (
                      <th
                        key={id}
                        draggable
                        onDragStart={() => onHeaderDragStart(id)}
                        onDragOver={(e) => onHeaderDragOver(e, id)}
                        onDragEnd={onHeaderDragEnd}
                        style={{ width: columnWidths[id], minWidth: columnWidths[id] }}
                        className={`px-1 py-2 font-medium whitespace-nowrap relative select-none ${
                          def.align === "right"
                            ? "text-right"
                            : def.align === "center"
                              ? "text-center"
                              : "text-left"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          <GripVertical
                            className="h-3.5 w-3.5 opacity-80 shrink-0 cursor-grab active:cursor-grabbing"
                            aria-hidden
                          />
                          <span>{def.label}</span>
                        </span>
                        <span
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/50"
                          onMouseDown={(e) => startResize(e, id)}
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${def.label}`}
                        />
                      </th>
                    );
                  })}
                </tr>
                <tr
                  className={
                    dark
                      ? "bg-slate-800 text-slate-100 border-b border-slate-600"
                      : "bg-slate-100 text-slate-900 border-b border-slate-300"
                  }
                >
                  <th className="px-1 py-1" />
                  {visibleCols.map((id) => {
                    const def = DEFAULT_COLUMNS.find((c) => c.id === id)!;
                    if (!def.filterable) {
                      return <th key={id} className="px-1 py-1" />;
                    }
                    return (
                      <th key={id} className="px-1 py-1">
                        <Input
                          className={`h-7 text-xs ${inputCls}`}
                          value={columnFilters[id] ?? ""}
                          placeholder="Filter"
                          aria-label={`Filter ${def.label}`}
                          onChange={(e) =>
                            setColumnFilters((prev) => ({ ...prev, [id]: e.target.value }))
                          }
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={colSpan} className="px-3 py-8 text-center font-medium">
                      Loading estimates…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-3 py-8 text-center font-medium">
                      No estimates match the current filters. Try filtering in Approved, or run{" "}
                      <code>npm run repair:seed:estimates-history</code>.
                    </td>
                  </tr>
                ) : (
                  grouped.map((g) => (
                    <Fragment key={g.key || "all"}>
                      {g.key ? (
                        <tr className={dark ? "bg-slate-800 text-slate-100" : "bg-slate-200 text-slate-900"}>
                          <td colSpan={colSpan} className="px-3 py-1 font-semibold">
                            {g.key} ({g.rows.length})
                          </td>
                        </tr>
                      ) : null}
                      {g.rows.map((r, idx) => (
                        <tr
                          key={r.estimate_id}
                          className={
                            dark
                              ? idx % 2 === 0
                                ? "bg-slate-900"
                                : "bg-slate-800/80"
                              : idx % 2 === 0
                                ? "bg-white"
                                : "bg-[#e8f4fc]"
                          }
                        >
                          <td className={`px-2 py-1.5 border-b ${dark ? "border-slate-700" : "border-slate-200"}`}>
                            <Checkbox
                              checked={selected.has(r.estimate_id)}
                              onCheckedChange={() => toggleSelect(r.estimate_id)}
                            />
                          </td>
                          {visibleCols.map((id) => {
                            const def = DEFAULT_COLUMNS.find((c) => c.id === id)!;
                            const isStatus = id === "status";
                            return (
                              <td
                                key={id}
                                style={{ width: columnWidths[id], minWidth: columnWidths[id] }}
                                className={`px-2 py-1.5 border-b whitespace-nowrap ${
                                  dark ? "border-slate-700" : "border-slate-200"
                                } ${
                                  def.align === "right"
                                    ? "text-right"
                                    : def.align === "center"
                                      ? "text-center"
                                      : "text-left"
                                } ${isStatus ? statusClass(r.status_code) : ""}`}
                              >
                                {isStatus ? r.status_name : renderCell(r, id)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div
            className={`flex items-center justify-between px-3 py-2 border-t text-xs font-medium ${
              dark ? "border-slate-600 text-slate-300" : "border-slate-300 text-slate-800"
            }`}
          >
            <button
              type="button"
              className="text-blue-700 dark:text-sky-300 underline font-semibold"
              onClick={() => setShowCreateFilter((v) => !v)}
            >
              Create Filter
            </button>
            <span>RLMS Repair · Estimates History</span>
          </div>
          {showCreateFilter ? (
            <div className={`px-3 pb-3 text-xs ${dark ? "text-slate-300" : "text-slate-800"}`}>
              Use Search filters above and the filter row under column headers. Save view stores
              column order, width, visibility, and filters (per user). Set as default chooses which
              view opens next time.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function RepairHome() {
  return (
    <RepairOwnerShell>
      <EstimatesHistoryBody />
    </RepairOwnerShell>
  );
}
