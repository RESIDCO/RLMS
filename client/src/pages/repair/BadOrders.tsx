/**
 * OWNER_UI §C — Bad Orders `/#/repair/bad-orders`
 * Three parts: search · New Bad Order · Bad Order History
 * Shot: docs/repair/screenshots/06-bad-orders.png
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
  Search,
  RotateCcw,
  GripVertical,
  Columns3,
  FileText,
} from "lucide-react";
import RepairOwnerShell from "./RepairOwnerShell";
import { WorkspaceBanner } from "./WorkspaceTitle";
import { repairUserStorageKey, useRepairTheme } from "./repairTheme";

type Shop = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  shop_mark?: string | null;
  display_label?: string;
  billing_road?: string | null;
};

type BoRule = {
  code: string;
  description: string;
  requires_other_text: boolean;
  allows_additional_detail: boolean;
  active: boolean;
};

type Stcc = { code: string; description?: string | null };

type GridRow = {
  bad_order_id: string;
  event_id: string;
  shop_display: string | null;
  car_mark: string;
  car_number: string;
  attachment_count: number;
  bo_date: string | null;
  bad_order_reason: string | null;
  dest_city: string | null;
  dest_state: string | null;
  lifecycle_status: string;
  status_display: string;
  yard_arrived_at: string | null;
  estimate_id: string | null;
  wreck_estimate: boolean;
  is_wreck: boolean;
  travel_on_own_wheels: boolean;
  stcc: string | null;
  incident_date: string | null;
  assignment: string | null;
  entity_code?: string | null;
  ddct_event_id?: string | null;
};

type ColId =
  | "shop"
  | "car_mark"
  | "car_number"
  | "attachment"
  | "bo_date"
  | "reason"
  | "dest_city"
  | "dest_state"
  | "status"
  | "yard"
  | "estimate"
  | "wreck_est"
  | "is_wreck"
  | "wheel"
  | "stcc"
  | "incident"
  | "assignment"
  | "entity";

type ColDef = {
  id: ColId;
  label: string;
  width: number;
  align?: "left" | "right" | "center";
  filterable?: boolean;
};

const DEFAULT_COLUMNS: ColDef[] = [
  { id: "shop", label: "Shop", width: 220, filterable: true },
  { id: "car_mark", label: "Car Initials", width: 90, filterable: true },
  { id: "car_number", label: "Car Number", width: 100, filterable: true },
  { id: "attachment", label: "", width: 44, align: "center" },
  { id: "bo_date", label: "Bad Order", width: 100, filterable: true },
  { id: "reason", label: "Bad Order Reason", width: 160, filterable: true },
  { id: "dest_city", label: "Destination City", width: 130, filterable: true },
  { id: "dest_state", label: "State", width: 60, filterable: true },
  { id: "status", label: "Status", width: 140, filterable: true },
  { id: "yard", label: "Yard Arrival", width: 110, filterable: true },
  { id: "estimate", label: "Estimate", width: 110, filterable: true },
  { id: "wreck_est", label: "Wreck Est", width: 80, align: "center" },
  { id: "is_wreck", label: "Is Wreck?", width: 80, align: "center" },
  { id: "wheel", label: "Wheel Travel", width: 90, align: "center" },
  { id: "stcc", label: "STCC", width: 90, filterable: true },
  { id: "incident", label: "Incident Date", width: 110, filterable: true },
  { id: "assignment", label: "Assignment", width: 200, filterable: true },
  { id: "entity", label: "Entity", width: 70, filterable: true },
];

const DEFAULT_COL_ORDER = DEFAULT_COLUMNS.map((c) => c.id);
const DEFAULT_WIDTHS = Object.fromEntries(
  DEFAULT_COLUMNS.map((c) => [c.id, c.width]),
) as Record<ColId, number>;
const DEFAULT_VISIBILITY = Object.fromEntries(
  DEFAULT_COLUMNS.map((c) => [c.id, true]),
) as Record<ColId, boolean>;

const BO_STATUSES = [
  { code: "QUEUED", label: "Queued" },
  { code: "ACCEPTED_PENDING", label: "Accepted-Pending" },
  { code: "ACCEPTED_WORKING", label: "Accepted-Working" },
  { code: "CLOSED", label: "Closed" },
  { code: "DECLINED", label: "Declined" },
];

const DEFAULT_STATUSES = ["QUEUED", "ACCEPTED_PENDING", "ACCEPTED_WORKING"];

const DATE_FIELDS = [
  { value: "ignore", label: "Ignore Date Range" },
  { value: "bo_date", label: "Bad Order Date" },
  { value: "arrival", label: "Arrival Date" },
  { value: "incident", label: "Incident Date" },
  { value: "yard_arrival", label: "Yard Arrival" },
  { value: "created", label: "Created" },
];

const VIEWS_PREFIX = "repair.badOrders.views";
const DEFAULT_VIEW_PREFIX = "repair.badOrders.defaultViewId";

type SavedView = {
  id: string;
  name: string;
  statuses: string[];
  shopIds: string[];
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

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function statusClass(code: string): string {
  switch (code) {
    case "QUEUED":
      return "bg-sky-100 text-slate-900 font-medium";
    case "ACCEPTED_PENDING":
      return "bg-yellow-200 text-slate-900 font-semibold";
    case "ACCEPTED_WORKING":
      return "bg-amber-300 text-slate-900 font-semibold";
    case "CLOSED":
      return "bg-emerald-200 text-slate-900 font-semibold";
    case "DECLINED":
      return "bg-red-200 text-slate-900 font-semibold";
    default:
      return "bg-slate-100 text-slate-900";
  }
}

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

function colFilterValue(row: GridRow, id: ColId): string {
  switch (id) {
    case "shop":
      return row.shop_display ?? "";
    case "car_mark":
      return row.car_mark ?? "";
    case "car_number":
      return row.car_number ?? "";
    case "attachment":
      return String(row.attachment_count ?? "");
    case "bo_date":
      return fmtDate(row.bo_date);
    case "reason":
      return row.bad_order_reason ?? "";
    case "dest_city":
      return row.dest_city ?? "";
    case "dest_state":
      return row.dest_state ?? "";
    case "status":
      return row.status_display ?? "";
    case "yard":
      return fmtDate(row.yard_arrived_at);
    case "estimate":
      return row.estimate_id ?? "";
    case "wreck_est":
      return row.wreck_estimate ? "Y" : "";
    case "is_wreck":
      return row.is_wreck ? "Y" : "";
    case "wheel":
      return row.travel_on_own_wheels ? "Y" : "";
    case "stcc":
      return row.stcc ?? "";
    case "incident":
      return fmtDate(row.incident_date);
    case "assignment":
      return row.assignment ?? "";
    case "entity":
      return row.entity_code ?? "";
    default:
      return "";
  }
}

type FormState = {
  carMark: string;
  carNumber: string;
  multiCar: boolean;
  multiCarList: string;
  reportingRoad: string;
  dcRoad: string;
  stcc: string;
  destCity: string;
  destState: string;
  routing: string;
  arrivalDate: string;
  boRuleCode: string;
  boRuleOtherText: string;
  lastContents: string;
  carLoad: "EMPTY" | "LOADED";
  cleaned: boolean;
  travelOnOwnWheels: boolean;
  boDate: string;
  boCity: string;
  boState: string;
  incidentDate: string;
  ddctIncidentId: string;
  ddctEventId: string;
  comments: string;
  shopId: string;
  billingRoad: string;
  billingRoadOverrideReason: string;
  allowDuplicates: boolean;
  isWreck: boolean;
  wreckEstimate: boolean;
  distributionEmails: string;
};

function emptyForm(): FormState {
  return {
    carMark: "",
    carNumber: "",
    multiCar: false,
    multiCarList: "",
    reportingRoad: "",
    dcRoad: "",
    stcc: "",
    destCity: "",
    destState: "",
    routing: "",
    arrivalDate: "",
    boRuleCode: "RULE_1",
    boRuleOtherText: "",
    lastContents: "",
    carLoad: "EMPTY",
    cleaned: false,
    travelOnOwnWheels: true,
    boDate: todayIso(),
    boCity: "",
    boState: "",
    incidentDate: "",
    ddctIncidentId: "",
    ddctEventId: "",
    comments: "",
    shopId: "",
    billingRoad: "",
    billingRoadOverrideReason: "",
    allowDuplicates: false,
    isWreck: false,
    wreckEstimate: false,
    distributionEmails: "",
  };
}

function BadOrdersBody() {
  const { theme } = useRepairTheme();
  const dark = theme === "dark";

  const [shops, setShops] = useState<Shop[]>([]);
  const [rules, setRules] = useState<BoRule[]>([]);
  const [stccCodes, setStccCodes] = useState<Stcc[]>([]);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingDocs, setPendingDocs] = useState(0);
  const [entitySnap, setEntitySnap] = useState<{
    code: string | null;
    sourceValue: string | null;
  } | null>(null);
  const [entitySnapsMulti, setEntitySnapsMulti] = useState<
    Array<{ car: string; code: string | null }>
  >([]);

  // Search
  const [shopIds, setShopIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([...DEFAULT_STATUSES]);
  const [carMark, setCarMark] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dateField, setDateField] = useState("ignore");
  const [sortBy, setSortBy] = useState("bo_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [groupBy, setGroupBy] = useState("none");
  const [pageSize, setPageSize] = useState(500);
  const [page, setPage] = useState(1);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeView, setActiveView] = useState("default");
  const [defaultViewId, setDefaultViewId] = useState("default");
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [showCreateFilter, setShowCreateFilter] = useState(false);

  const [columnOrder, setColumnOrder] = useState<ColId[]>([...DEFAULT_COL_ORDER]);
  const [columnWidths, setColumnWidths] = useState<Record<ColId, number>>({
    ...DEFAULT_WIDTHS,
  });
  const [columnVisibility, setColumnVisibility] = useState<Record<ColId, boolean>>({
    ...DEFAULT_VISIBILITY,
  });
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColId, string>>>({});

  const dragCol = useRef<ColId | null>(null);
  const resizeRef = useRef<{ id: ColId; startX: number; startW: number } | null>(
    null,
  );

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

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
    apiRequest("GET", "/api/repair/bo-rules")
      .then((r) => r.json())
      .then((d) => setRules(d.rules ?? []))
      .catch(() => undefined);
    apiRequest("GET", "/api/repair/stcc")
      .then((r) => r.json())
      .then((d) => setStccCodes(d.codes ?? []))
      .catch(() => undefined);
    apiRequest("GET", "/api/repair/distribution-list")
      .then((r) => r.json())
      .then((d) => {
        const entries = d.entries ?? d.list ?? [];
        if (Array.isArray(entries) && entries.length) {
          setForm((f) => ({
            ...f,
            distributionEmails: entries
              .map((e: { email?: string }) => e.email)
              .filter(Boolean)
              .join(", "),
          }));
        }
      })
      .catch(() => undefined);
  }, []);

  // Entity snapshot when car changes
  useEffect(() => {
    if (form.multiCar) {
      const lines = form.multiCarList
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!lines.length) {
        setEntitySnapsMulti([]);
        return;
      }
      let cancelled = false;
      (async () => {
        const out: Array<{ car: string; code: string | null }> = [];
        for (const line of lines.slice(0, 20)) {
          const m =
            /^([A-Za-z]{2,4})\s*[- ]?\s*(\d{1,6})$/.exec(line) ||
            /^([A-Za-z]{2,4})(\d{1,6})$/.exec(line);
          const mark = m?.[1] ?? form.carMark;
          const num = m?.[2] ?? line.replace(/\D/g, "");
          if (!mark || !num) continue;
          try {
            const r = await apiRequest(
              "GET",
              `/api/repair/cars/entity?carMark=${encodeURIComponent(mark)}&carNumber=${encodeURIComponent(num)}`,
            );
            const d = await r.json();
            out.push({
              car: `${mark.toUpperCase()} ${num}`,
              code: d.entity?.code ?? null,
            });
          } catch {
            out.push({ car: `${mark} ${num}`, code: null });
          }
        }
        if (!cancelled) setEntitySnapsMulti(out);
      })();
      return () => {
        cancelled = true;
      };
    }
    if (!form.carMark.trim() || !form.carNumber.trim()) {
      setEntitySnap(null);
      return;
    }
    const t = setTimeout(() => {
      apiRequest(
        "GET",
        `/api/repair/cars/entity?carMark=${encodeURIComponent(form.carMark)}&carNumber=${encodeURIComponent(form.carNumber)}`,
      )
        .then((r) => r.json())
        .then((d) => setEntitySnap(d.entity ?? null))
        .catch(() => setEntitySnap(null));
    }, 300);
    return () => clearTimeout(t);
  }, [form.carMark, form.carNumber, form.multiCar, form.multiCarList]);

  // Prefill billing road + BO city/ST from shop
  useEffect(() => {
    if (!form.shopId) return;
    const shop = shops.find((s) => s.id === form.shopId);
    if (!shop) return;
    setForm((f) => ({
      ...f,
      billingRoad: f.billingRoad || shop.billing_road || "",
      boCity: f.boCity || shop.city || "",
      boState: f.boState || shop.state || "",
      destCity: f.destCity || shop.city || "",
      destState: f.destState || shop.state || "",
    }));
  }, [form.shopId, shops]);

  const loadGrid = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (statuses.length) qs.set("status", statuses.join(","));
      if (shopIds.length) qs.set("shopId", shopIds.join(","));
      if (carMark.trim()) qs.set("carMark", carMark.trim());
      if (carNumber.trim()) qs.set("carNumber", carNumber.trim());
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      qs.set("dateField", dateField);
      qs.set("sortBy", sortBy);
      qs.set("sortDir", sortDir);
      qs.set("limit", String(pageSize));
      qs.set("offset", String((page - 1) * pageSize));
      const r = await apiRequest("GET", `/api/repair/bad-orders/grid?${qs}`);
      const d = await r.json();
      setRows(d.rows ?? []);
      setTotal(d.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grid load failed");
    } finally {
      setLoading(false);
    }
  }, [
    statuses,
    shopIds,
    carMark,
    carNumber,
    from,
    to,
    dateField,
    sortBy,
    sortDir,
    pageSize,
    page,
  ]);

  useEffect(() => {
    void loadGrid();
  }, [loadGrid]);

  const visibleCols = useMemo(
    () => columnOrder.filter((id) => columnVisibility[id] !== false),
    [columnOrder, columnVisibility],
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) =>
      visibleCols.every((id) => {
        const f = columnFilters[id];
        if (!f?.trim()) return true;
        return colFilterValue(row, id).toLowerCase().includes(f.toLowerCase());
      }),
    );
  }, [rows, visibleCols, columnFilters]);

  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key: "", rows: filteredRows }];
    const map = new Map<string, GridRow[]>();
    for (const r of filteredRows) {
      const key =
        groupBy === "status"
          ? r.status_display
          : groupBy === "shop"
            ? r.shop_display || "(no shop)"
            : groupBy === "entity"
              ? r.entity_code || "UNASSIGNED"
              : "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }));
  }, [filteredRows, groupBy]);

  const onHeaderDragStart = (id: ColId) => {
    dragCol.current = id;
  };
  const onHeaderDragOver = (e: DragEvent, overId: ColId) => {
    e.preventDefault();
    const from = dragCol.current;
    if (!from || from === overId) return;
    setColumnOrder((order) => {
      const next = [...order];
      const fi = next.indexOf(from);
      const ti = next.indexOf(overId);
      if (fi < 0 || ti < 0) return order;
      next.splice(fi, 1);
      next.splice(ti, 0, from);
      return next;
    });
    dragCol.current = overId;
  };

  const onResizeStart = (e: ReactMouseEvent, id: ColId) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { id, startX: e.clientX, startW: columnWidths[id] };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const w = Math.max(44, resizeRef.current.startW + dx);
      setColumnWidths((prev) => ({ ...prev, [resizeRef.current!.id]: w }));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetForm = () => {
    setForm(emptyForm());
    setPendingDocs(0);
    setEntitySnap(null);
    setEntitySnapsMulti([]);
    setMsg("");
  };

  const submitNew = async () => {
    setSubmitting(true);
    setError("");
    setMsg("");
    try {
      const selectedRule = rules.find((r) => r.code === form.boRuleCode);
      if (selectedRule?.requires_other_text && !form.boRuleOtherText.trim()) {
        setError("This Bad Order Reason requires keyed detail");
        setSubmitting(false);
        return;
      }
      if (!form.shopId) {
        setError("Shop is required");
        setSubmitting(false);
        return;
      }
      if (!form.boCity.trim() || !form.boState.trim()) {
        setError("B/O City and State are required");
        setSubmitting(false);
        return;
      }

      // Distribution list: add any new emails before create
      const emails = form.distributionEmails
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@"));
      for (const email of emails) {
        await apiRequest("POST", "/api/repair/distribution-list", {
          email,
        }).catch(() => undefined);
      }

      if (form.multiCar) {
        const r = await apiRequest("POST", "/api/repair/bad-orders/bulk", {
          pastedCars: form.multiCarList,
          headerInitials: form.carMark || undefined,
          shopId: form.shopId,
          boRuleCode: form.boRuleCode,
          boRuleOtherText: form.boRuleOtherText || undefined,
          boDate: form.boDate || undefined,
          boCity: form.boCity,
          boState: form.boState,
          destCity: form.destCity || undefined,
          destState: form.destState || undefined,
          reportingRoad: form.reportingRoad || undefined,
          dcRoad: form.dcRoad || undefined,
          stcc: form.stcc || undefined,
          routing: form.routing || undefined,
          lastContents: form.lastContents || undefined,
          carLoad: form.carLoad,
          cleaned: form.cleaned,
          travelOnOwnWheels: form.travelOnOwnWheels,
          incidentDate: form.incidentDate || undefined,
          comments: form.comments || undefined,
          arrivalDate: form.arrivalDate || undefined,
          billingRoad: form.billingRoad || undefined,
          billingRoadOverrideReason: form.billingRoadOverrideReason || undefined,
          ddctEventId: form.ddctEventId || undefined,
          ddctIncidentId: form.ddctIncidentId || undefined,
          allowDuplicates: form.allowDuplicates,
          isWreck: form.isWreck,
          wreckEstimate: form.wreckEstimate,
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Bulk create failed");
        setMsg(
          `Created ${d.created?.length ?? 0} Bad Order(s)` +
            (d.rejected?.length ? `; ${d.rejected.length} rejected` : ""),
        );
      } else {
        const r = await apiRequest("POST", "/api/repair/bad-orders", {
          carMark: form.carMark,
          carNumber: form.carNumber,
          shopId: form.shopId,
          boRuleCode: form.boRuleCode,
          boRuleOtherText: form.boRuleOtherText || undefined,
          boDate: form.boDate || undefined,
          boCity: form.boCity,
          boState: form.boState,
          destCity: form.destCity || undefined,
          destState: form.destState || undefined,
          reportingRoad: form.reportingRoad || undefined,
          dcRoad: form.dcRoad || undefined,
          stcc: form.stcc || undefined,
          routing: form.routing || undefined,
          lastContents: form.lastContents || undefined,
          carLoad: form.carLoad,
          cleaned: form.cleaned,
          travelOnOwnWheels: form.travelOnOwnWheels,
          incidentDate: form.incidentDate || undefined,
          comments: form.comments || undefined,
          arrivalDate: form.arrivalDate || undefined,
          billingRoad: form.billingRoad || undefined,
          billingRoadOverrideReason: form.billingRoadOverrideReason || undefined,
          ddctEventId: form.ddctEventId || undefined,
          ddctIncidentId: form.ddctIncidentId || undefined,
          allowDuplicates: form.allowDuplicates,
          isWreck: form.isWreck,
          wreckEstimate: form.wreckEstimate,
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Create failed");
        setMsg(
          `Bad Order Queued for ${form.carMark} ${form.carNumber}` +
            (d.event?.entity_code ? ` · Entity ${d.event.entity_code}` : ""),
        );
      }
      resetForm();
      await loadGrid();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const exportGrid = async () => {
    const qs = new URLSearchParams();
    if (statuses.length) qs.set("status", statuses.join(","));
    if (shopIds.length) qs.set("shopId", shopIds.join(","));
    if (carMark.trim()) qs.set("carMark", carMark.trim());
    if (carNumber.trim()) qs.set("carNumber", carNumber.trim());
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    qs.set("dateField", dateField);
    qs.set("sortBy", sortBy);
    qs.set("sortDir", sortDir);
    const r = await apiRequest("GET", `/api/repair/bad-orders/grid/export?${qs}`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bad-orders-grid.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveCurrentView = () => {
    const name = window.prompt("View name?");
    if (!name?.trim()) return;
    const view: SavedView = {
      id: `v-${Date.now()}`,
      name: name.trim(),
      statuses: [...statuses],
      shopIds: [...shopIds],
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
    const next = [...views, view];
    setViews(next);
    saveViews(next);
    setActiveView(view.id);
  };

  const applyView = (v: SavedView | "default") => {
    if (v === "default") {
      setShopIds([]);
      setStatuses([...DEFAULT_STATUSES]);
      setCarMark("");
      setCarNumber("");
      setFrom("");
      setTo("");
      setDateField("ignore");
      setSortBy("bo_date");
      setSortDir("desc");
      setGroupBy("none");
      setPageSize(500);
      setPage(1);
      setColumnOrder([...DEFAULT_COL_ORDER]);
      setColumnWidths({ ...DEFAULT_WIDTHS });
      setColumnVisibility({ ...DEFAULT_VISIBILITY });
      setColumnFilters({});
      setActiveView("default");
      return;
    }
    setStatuses(v.statuses?.length ? [...v.statuses] : [...DEFAULT_STATUSES]);
    setShopIds(v.shopIds ?? []);
    setCarMark(v.carMark ?? "");
    setCarNumber(v.carNumber ?? "");
    setFrom(v.from ?? "");
    setTo(v.to ?? "");
    setDateField(v.dateField ?? "ignore");
    setSortBy(v.sortBy ?? "bo_date");
    setSortDir(v.sortDir ?? "desc");
    setGroupBy(v.groupBy ?? "none");
    setPageSize(v.pageSize ?? 500);
    setColumnOrder(v.columnOrder?.length ? [...v.columnOrder] : [...DEFAULT_COL_ORDER]);
    setColumnWidths({ ...DEFAULT_WIDTHS, ...(v.columnWidths ?? {}) });
    setColumnVisibility({ ...DEFAULT_VISIBILITY, ...(v.columnVisibility ?? {}) });
    setColumnFilters({ ...(v.columnFilters ?? {}) });
    setActiveView(v.id);
  };

  const selectedRule = rules.find((r) => r.code === form.boRuleCode);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const panel = dark
    ? "bg-slate-900/60 border-slate-700 text-slate-100"
    : "bg-slate-100 border-slate-300 text-slate-900";
  const inputCls = dark
    ? "h-8 bg-slate-950 border-slate-600 text-slate-100"
    : "h-8 bg-white border-slate-300";

  const renderCell = (row: GridRow, id: ColId) => {
    switch (id) {
      case "shop":
        return row.shop_display ?? "";
      case "car_mark":
        return row.car_mark;
      case "car_number":
        return row.car_number;
      case "attachment":
        return row.attachment_count > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-sky-700">
            <Paperclip className="h-3.5 w-3.5" />
            {row.attachment_count}
          </span>
        ) : (
          ""
        );
      case "bo_date":
        return fmtDate(row.bo_date);
      case "reason":
        return row.bad_order_reason ?? "";
      case "dest_city":
        return row.dest_city ?? "";
      case "dest_state":
        return row.dest_state ?? "";
      case "status":
        return (
          <span
            className={`inline-block px-1.5 py-0.5 rounded text-xs ${statusClass(row.lifecycle_status)}`}
          >
            {row.status_display}
          </span>
        );
      case "yard":
        return fmtDate(row.yard_arrived_at);
      case "estimate":
        return row.estimate_id ? (
          <Link
            href={`/repair/estimates/${row.estimate_id}`}
            className="text-sky-700 underline"
          >
            {row.estimate_id.slice(0, 8)}
          </Link>
        ) : (
          ""
        );
      case "wreck_est":
        return (
          <input type="checkbox" checked={row.wreck_estimate} readOnly disabled />
        );
      case "is_wreck":
        return <input type="checkbox" checked={row.is_wreck} readOnly disabled />;
      case "wheel":
        return (
          <input
            type="checkbox"
            checked={row.travel_on_own_wheels}
            readOnly
            disabled
          />
        );
      case "stcc":
        return row.stcc ?? "";
      case "incident":
        return fmtDate(row.incident_date);
      case "assignment":
        return row.assignment ?? "";
      case "entity":
        return row.entity_code ?? "";
      default:
        return "";
    }
  };

  return (
    <div className={dark ? "bg-slate-950 text-slate-100" : "bg-white text-slate-900"}>
      <WorkspaceBanner subtitle="Bad Orders" />

      {/* C1 — Search */}
      <div className={`border-b px-3 py-2 flex flex-wrap items-end gap-2 ${panel}`}>
        <div className="min-w-[140px]">
          <Label className="text-xs">Shops</Label>
          <select
            multiple
            className={`${inputCls} w-full min-h-[32px] text-sm rounded-md border px-1`}
            value={shopIds}
            onChange={(e) =>
              setShopIds([...e.target.selectedOptions].map((o) => o.value))
            }
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_label || s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px]">
          <Label className="text-xs">Statuses</Label>
          <select
            multiple
            className={`${inputCls} w-full min-h-[32px] text-sm rounded-md border px-1`}
            value={statuses}
            onChange={(e) =>
              setStatuses([...e.target.selectedOptions].map((o) => o.value))
            }
          >
            {BO_STATUSES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Initials</Label>
          <Input
            className={`${inputCls} w-20`}
            value={carMark}
            onChange={(e) => setCarMark(e.target.value.toUpperCase())}
          />
        </div>
        <div>
          <Label className="text-xs">Number</Label>
          <Input
            className={`${inputCls} w-24`}
            value={carNumber}
            onChange={(e) => setCarNumber(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Date Range</Label>
          <div className="flex gap-1">
            <Input
              type="date"
              className={`${inputCls} w-[130px]`}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              type="date"
              className={`${inputCls} w-[130px]`}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <div className="min-w-[160px]">
          <Label className="text-xs">Date Range Filter</Label>
          <Select value={dateField} onValueChange={setDateField}>
            <SelectTrigger className={inputCls}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FIELDS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          className="h-8"
          onClick={() => {
            setPage(1);
            void loadGrid();
          }}
        >
          <Search className="h-4 w-4 mr-1" /> Search
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => applyView("default")}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* C2 — New Bad Order */}
      <div className={`border-b px-3 py-3 ${panel}`}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            New Bad Order
          </h2>
          <Link
            href="/repair/bo-reasons"
            className="text-xs text-sky-700 underline"
          >
            Manage Bad Order Reasons
          </Link>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label className="text-xs">Car Initials</Label>
                <Input
                  className={`${inputCls} w-24`}
                  value={form.carMark}
                  onChange={(e) => setField("carMark", e.target.value.toUpperCase())}
                  disabled={form.multiCar && !form.carMark}
                />
              </div>
              <div>
                <Label className="text-xs">Car Number</Label>
                <Input
                  className={`${inputCls} w-28`}
                  value={form.carNumber}
                  onChange={(e) => setField("carNumber", e.target.value)}
                  disabled={form.multiCar}
                />
              </div>
              <label className="flex items-center gap-1.5 pb-1 text-xs">
                <Checkbox
                  checked={form.multiCar}
                  onCheckedChange={(v) => setField("multiCar", Boolean(v))}
                />
                Multi Car
              </label>
            </div>
            {form.multiCar && (
              <div>
                <Label className="text-xs">
                  Car list (one per line; blank initials use header Initials)
                </Label>
                <textarea
                  className={`w-full min-h-[72px] rounded-md border px-2 py-1 text-sm ${inputCls}`}
                  value={form.multiCarList}
                  onChange={(e) => setField("multiCarList", e.target.value)}
                  placeholder={"OFOX 528313\nARSX 100001"}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <div>
                <Label className="text-xs">Reporting Road</Label>
                <Input
                  className={`${inputCls} w-24`}
                  value={form.reportingRoad}
                  onChange={(e) =>
                    setField("reportingRoad", e.target.value.toUpperCase())
                  }
                />
              </div>
              <div>
                <Label className="text-xs">D/C Road</Label>
                <Input
                  className={`${inputCls} w-24`}
                  value={form.dcRoad}
                  onChange={(e) => setField("dcRoad", e.target.value.toUpperCase())}
                />
              </div>
              <div className="min-w-[140px]">
                <Label className="text-xs">STCC</Label>
                <Select
                  value={form.stcc || "__none"}
                  onValueChange={(v) => setField("stcc", v === "__none" ? "" : v)}
                >
                  <SelectTrigger className={inputCls}>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {stccCodes.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code}
                        {c.description ? ` — ${c.description}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div>
                <Label className="text-xs">Dest. City</Label>
                <Input
                  className={`${inputCls} w-36`}
                  value={form.destCity}
                  onChange={(e) => setField("destCity", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">State</Label>
                <Input
                  className={`${inputCls} w-14`}
                  maxLength={2}
                  value={form.destState}
                  onChange={(e) =>
                    setField("destState", e.target.value.toUpperCase())
                  }
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <Label className="text-xs">Routing</Label>
                <Input
                  className={inputCls}
                  value={form.routing}
                  onChange={(e) => setField("routing", e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div>
                <Label className="text-xs">Status</Label>
                <Input className={`${inputCls} w-40`} value="Queued" readOnly disabled />
              </div>
              <div>
                <Label className="text-xs">Arrival Date</Label>
                <Input
                  type="date"
                  className={`${inputCls} w-[140px]`}
                  value={form.arrivalDate}
                  onChange={(e) => setField("arrivalDate", e.target.value)}
                />
              </div>
            </div>
            <div className="min-w-[220px]">
              <Label className="text-xs">Shop</Label>
              <Select
                value={form.shopId || "__none"}
                onValueChange={(v) => setField("shopId", v === "__none" ? "" : v)}
              >
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder="Select shop…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {shops.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.display_label || s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!shops.length && (
                <p className="text-xs text-amber-700 mt-0.5">
                  No shops yet — create one under Shops.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <div>
                <Label className="text-xs">Billing road (optional)</Label>
                <Input
                  className={`${inputCls} w-28`}
                  value={form.billingRoad}
                  onChange={(e) =>
                    setField("billingRoad", e.target.value.toUpperCase())
                  }
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs">Billing override reason</Label>
                <Input
                  className={inputCls}
                  value={form.billingRoadOverrideReason}
                  onChange={(e) =>
                    setField("billingRoadOverrideReason", e.target.value)
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <Label className="text-xs">Reason</Label>
              <Select
                value={form.boRuleCode}
                onValueChange={(v) => setField("boRuleCode", v)}
              >
                <SelectTrigger className={inputCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rules.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.description} ({r.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(selectedRule?.requires_other_text ||
                selectedRule?.allows_additional_detail) && (
                <Input
                  className={`${inputCls} mt-1`}
                  placeholder={
                    selectedRule?.requires_other_text
                      ? "Keyed detail (required)"
                      : "Additional keyed detail (optional)"
                  }
                  value={form.boRuleOtherText}
                  onChange={(e) => setField("boRuleOtherText", e.target.value)}
                />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <div>
                <Label className="text-xs">B/O Date</Label>
                <Input
                  type="date"
                  className={`${inputCls} w-[140px]`}
                  value={form.boDate}
                  onChange={(e) => setField("boDate", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">B/O City</Label>
                <Input
                  className={`${inputCls} w-32`}
                  value={form.boCity}
                  onChange={(e) => setField("boCity", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">ST</Label>
                <Input
                  className={`${inputCls} w-14`}
                  maxLength={2}
                  value={form.boState}
                  onChange={(e) => setField("boState", e.target.value.toUpperCase())}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Last Contents</Label>
              <Input
                className={inputCls}
                value={form.lastContents}
                onChange={(e) => setField("lastContents", e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <Label className="text-xs">Incident Date</Label>
                <Input
                  type="date"
                  className={`${inputCls} w-[140px]`}
                  value={form.incidentDate}
                  onChange={(e) => setField("incidentDate", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Incident ID</Label>
                <Input
                  className={`${inputCls} w-32`}
                  value={form.ddctIncidentId}
                  onChange={(e) => setField("ddctIncidentId", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">DDCT Event ID</Label>
                <Input
                  className={`${inputCls} w-36`}
                  value={form.ddctEventId}
                  onChange={(e) => setField("ddctEventId", e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <Label className="text-xs">Car Load</Label>
                <Select
                  value={form.carLoad}
                  onValueChange={(v) =>
                    setField("carLoad", v === "LOADED" ? "LOADED" : "EMPTY")
                  }
                >
                  <SelectTrigger className={`${inputCls} w-28`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMPTY">Empty</SelectItem>
                    <SelectItem value="LOADED">Loaded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-1.5 text-xs pt-4">
                <Checkbox
                  checked={form.cleaned}
                  onCheckedChange={(v) => setField("cleaned", Boolean(v))}
                />
                Cleaned
              </label>
              <label className="flex items-center gap-1.5 text-xs pt-4">
                <Checkbox
                  checked={form.travelOnOwnWheels}
                  onCheckedChange={(v) =>
                    setField("travelOnOwnWheels", Boolean(v))
                  }
                />
                Travel On Own Wheels
              </label>
              <label className="flex items-center gap-1.5 text-xs pt-4">
                <Checkbox
                  checked={form.isWreck}
                  onCheckedChange={(v) => setField("isWreck", Boolean(v))}
                />
                Is Wreck?
              </label>
              <label className="flex items-center gap-1.5 text-xs pt-4">
                <Checkbox
                  checked={form.wreckEstimate}
                  onCheckedChange={(v) => setField("wreckEstimate", Boolean(v))}
                />
                Wreck Est
              </label>
            </div>
            <div>
              <Label className="text-xs">Comments</Label>
              <textarea
                className={`w-full min-h-[64px] rounded-md border px-2 py-1 text-sm ${inputCls}`}
                value={form.comments}
                onChange={(e) => setField("comments", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">
                Distribution list (notifications — emails, comma-separated)
              </Label>
              <Input
                className={inputCls}
                value={form.distributionEmails}
                onChange={(e) => setField("distributionEmails", e.target.value)}
                placeholder="shop@example.com, fleet@example.com"
              />
            </div>
          </div>
        </div>

        {/* Entity snapshot */}
        <div className="mt-2 text-xs">
          {form.multiCar ? (
            entitySnapsMulti.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <span className="font-medium">Entity snapshot:</span>
                {entitySnapsMulti.map((e) => (
                  <span
                    key={e.car}
                    className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800"
                  >
                    {e.car}: {e.code || "—"}
                  </span>
                ))}
              </div>
            )
          ) : entitySnap ? (
            <span>
              Entity snapshot:{" "}
              <strong>{entitySnap.code || "—"}</strong>
              {entitySnap.sourceValue
                ? ` (from ${entitySnap.sourceValue})`
                : ""}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="destructive"
            size="sm"
            onClick={resetForm}
            disabled={submitting}
          >
            Cancel / Reset Form
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => void submitNew()}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit New"}
          </Button>
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={form.allowDuplicates}
              onCheckedChange={(v) => setField("allowDuplicates", Boolean(v))}
            />
            Allow Duplicates
          </label>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-600">
            <FileText className="h-4 w-4" />
            {pendingDocs > 0
              ? `${pendingDocs} documents`
              : "No New Bad Order Documents"}
            <span className="text-[10px] text-slate-500">
              (SDS / scope / photos attach after submit on the event)
            </span>
          </span>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
      </div>

      {/* C3 — History */}
      <div className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
          <span className="font-semibold">Bad Order History</span>
          <span className="text-xs text-slate-500">{total} rows</span>
          <div className="flex items-center gap-1 ml-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={page <= 1}
              onClick={() => setPage(1)}
            >
              First
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <span className="text-xs px-1">
              {page} / {pageCount}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={page >= pageCount}
              onClick={() => setPage(pageCount)}
            >
              Last
            </Button>
          </div>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              setPageSize(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-7 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[50, 100, 250, 500].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7" onClick={() => void exportGrid()}>
            Export Grid
          </Button>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="h-7 w-[140px]">
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No group</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="shop">Shop</SelectItem>
              <SelectItem value="entity">Entity</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={activeView}
            onValueChange={(id) => {
              if (id === "default") applyView("default");
              else {
                const v = views.find((x) => x.id === id);
                if (v) applyView(v);
              }
            }}
          >
            <SelectTrigger className="h-7 w-[160px]">
              <SelectValue placeholder="Views" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              {views.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7" onClick={saveCurrentView}>
            Save view
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => {
              saveDefaultViewId(activeView);
              setDefaultViewId(activeView);
            }}
          >
            Set default
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => setShowCreateFilter((s) => !s)}
          >
            Create Filter
          </Button>
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setShowColumnsMenu((s) => !s)}
            >
              <Columns3 className="h-3.5 w-3.5 mr-1" /> Columns
            </Button>
            {showColumnsMenu && (
              <div
                className={`absolute right-0 z-20 mt-1 w-52 border rounded shadow p-2 ${dark ? "bg-slate-900 border-slate-600" : "bg-white"}`}
              >
                {DEFAULT_COLUMNS.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs py-0.5">
                    <Checkbox
                      checked={columnVisibility[c.id] !== false}
                      onCheckedChange={(v) =>
                        setColumnVisibility((prev) => ({
                          ...prev,
                          [c.id]: Boolean(v),
                        }))
                      }
                    />
                    {c.label || c.id}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {showCreateFilter && (
          <p className="text-xs text-slate-500 mb-1">
            Drag a column header here to group by that column — or use Group by /
            per-column filter row below.
          </p>
        )}

        <div className="overflow-auto border rounded max-h-[55vh]">
          <table className="text-xs border-collapse min-w-full">
            <thead className={dark ? "bg-slate-800 sticky top-0" : "bg-slate-200 sticky top-0"}>
              <tr>
                {visibleCols.map((id) => {
                  const def = DEFAULT_COLUMNS.find((c) => c.id === id)!;
                  return (
                    <th
                      key={id}
                      draggable
                      onDragStart={() => onHeaderDragStart(id)}
                      onDragOver={(e) => onHeaderDragOver(e, id)}
                      className="relative border px-1 py-1 text-left font-semibold whitespace-nowrap select-none"
                      style={{ width: columnWidths[id], minWidth: columnWidths[id] }}
                      onClick={() => {
                        if (sortBy === id) {
                          setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                        } else {
                          setSortBy(id === "reason" ? "reason" : id);
                          setSortDir("asc");
                        }
                      }}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        <GripVertical className="h-3 w-3 opacity-40" />
                        {def.label}
                        {sortBy === id || (id === "reason" && sortBy === "reason")
                          ? sortDir === "asc"
                            ? " ↑"
                            : " ↓"
                          : ""}
                      </span>
                      <span
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                        onMouseDown={(e) => onResizeStart(e, id)}
                      />
                    </th>
                  );
                })}
              </tr>
              <tr>
                {visibleCols.map((id) => {
                  const def = DEFAULT_COLUMNS.find((c) => c.id === id)!;
                  return (
                    <th key={`f-${id}`} className="border px-0.5 py-0.5">
                      {def.filterable !== false ? (
                        <Input
                          className="h-6 text-xs px-1"
                          value={columnFilters[id] ?? ""}
                          onChange={(e) =>
                            setColumnFilters((prev) => ({
                              ...prev,
                              [id]: e.target.value,
                            }))
                          }
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={visibleCols.length}
                    className="p-4 text-center text-slate-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleCols.length}
                    className="p-4 text-center text-slate-500"
                  >
                    No Bad Orders match the current filters.
                  </td>
                </tr>
              )}
              {!loading &&
                grouped.map((g) => (
                  <Fragment key={g.key || "all"}>
                    {g.key && (
                      <tr className={dark ? "bg-slate-800" : "bg-slate-100"}>
                        <td
                          colSpan={visibleCols.length}
                          className="px-2 py-1 font-semibold"
                        >
                          {g.key}
                        </td>
                      </tr>
                    )}
                    {g.rows.map((row, i) => (
                      <tr
                        key={row.bad_order_id}
                        className={
                          i % 2 === 0
                            ? dark
                              ? "bg-slate-900/40"
                              : "bg-white"
                            : dark
                              ? "bg-slate-900/80"
                              : "bg-sky-50/60"
                        }
                      >
                        {visibleCols.map((id) => (
                          <td
                            key={id}
                            className="border px-1.5 py-1 whitespace-nowrap align-middle"
                            style={{ maxWidth: columnWidths[id] }}
                          >
                            {renderCell(row, id)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
        {defaultViewId !== "default" && (
          <p className="text-[10px] text-slate-500 mt-1">
            Default view: {views.find((v) => v.id === defaultViewId)?.name ?? defaultViewId}
          </p>
        )}
      </div>
    </div>
  );
}

export default function BadOrders() {
  return (
    <RepairOwnerShell>
      <BadOrdersBody />
    </RepairOwnerShell>
  );
}
