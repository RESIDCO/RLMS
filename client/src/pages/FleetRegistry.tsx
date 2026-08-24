import { useMemo, useState, useCallback, useEffect } from "react";
import { useSearch, Link, useLocation } from "wouter";
import { useCanEdit } from "@/lib/AuthContext";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { InactiveFleetBadge, FleetAwareStatusBadge, fleetActiveLabel, displayRailcarStatus } from "@/components/InactiveFleetBadge";
import { LeaseTypeBadge } from "@/components/LeaseTypeBadge";
import { displayStatusInputFromRailcar, FLEET_STATUSES, type FleetStatus } from "@shared/fleet-status";
import { RiderFreeTextInput, resolveRiderLabel } from "@/components/RiderFreeTextInput";
import SearchableSelect, { riderToOption } from "@/components/SearchableSelect";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Pencil, ArrowUpDown, ChevronRight, ChevronLeft, Wrench, Hash, CheckSquare, Square, X as XIcon, ChevronDown, Download, Columns3, Image, ClipboardList, ExternalLink } from "lucide-react";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import { OpsFlagBadge } from "@/components/OpsFlagBadge";
import { OpsFlagPicker } from "@/components/OpsFlagPicker";
import { OPS_FLAG_PRESETS, composeOpsFlag } from "@shared/ops-flag";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { GridColumnTh } from "@/components/GridColumnTh";
import { colWidth, mergeColOrder, moveCol, tableWidthFor } from "@/lib/grid-columns";
import { Checkbox } from "@/components/ui/checkbox";
import { openAppTab, carPath } from "@/lib/browse-nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { apiRequest, apiGet, queryClient, railcarsQs } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { displayLeaseNumber } from "@shared/residco-import";
import { carBuildYear, formatBuiltDisplay } from "@shared/build-year";
import { carLeaseEndDate, formatAssetReportMonth, formatCalendarDate, todayIsoDateOnly } from "@shared/lease-authority";
import type { RailcarWithAssignment } from "@shared/schema";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import ActivityTimeline from "@/components/ActivityTimeline";
import PhotoFinderPanel, { carsToPasteText } from "@/components/PhotoFinderPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { confirmDelete, confirmSave, confirmWithReason } from "@/components/ConfirmActionDialog";
import {
  CAR_STATUS_EDIT_OPTIONS,
  crossesInactiveBoundary,
  isInactiveCarStatus,
} from "@shared/car-lifecycle-status";

type Row = RailcarWithAssignment;

const TRANSIT_STATUSES = [
  { value: "repair", label: "At Repair Shop", color: "bg-umler-signal/15 text-umler-signal border-umler-signal/25" },
  { value: "transit", label: "In Transit", color: "bg-umler-steel/15 text-umler-steel border-umler-steel/25" },
  { value: "cleaning", label: "Cleaning / Prep", color: "bg-umler-teal/15 text-umler-teal border-umler-teal/25" },
  { value: "bad_order", label: "Bad Order", color: "bg-umler-signal/15 text-umler-signal border-umler-signal/25" },
] as const;

// Entity ownership badge
const ENTITY_STYLES: Record<string, { label: string; cls: string }> = {
  "Rail Partners Select": { label: "RPS",  cls: "bg-umler-steel/15 text-umler-steel border-umler-steel/30 font-semibold" },
  "Main":                 { label: "MAIN", cls: "bg-umler-teal/15 text-umler-teal border-umler-teal/30 font-semibold" },
  "Coal":                 { label: "COAL", cls: "bg-umler-faint/15 text-umler-faint border-umler-faint/30 font-semibold" },
};

// Fixed status options for the filter dropdown
// Fleet-status filter (stored column). Lifecycle Status stays on the Edit form.
const STATUS_FILTER_OPTIONS = [
  { value: "Leased",            label: "Leased" },
  { value: "Idle",              label: "Idle" },
  { value: "Sold",              label: "Sold" },
  { value: "Abatement",         label: "Abatement" },
  { value: "Off-Lease",         label: "Off-Lease" },
  { value: "Storage",           label: "Storage" },
  { value: "Bad Order",         label: "Bad Order" },
  { value: "Retired",           label: "Retired" },
  { value: "Scrapped",          label: "Scrapped" },
  { value: "Inactive",          label: "Inactive" },
];

/** Values that may be written to railcars.status (not derived fleet Sold/Idle). */
const STATUS_EDIT_OPTIONS = CAR_STATUS_EDIT_OPTIONS;

function EntityBadge({ entity, size = "sm" }: { entity: string | null | undefined; size?: "sm" | "lg" }) {
  if (!entity) return null;
  const style = ENTITY_STYLES[entity] ?? { label: entity, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn(
      "inline-flex items-center rounded border px-1.5 py-0.5 tracking-wide uppercase",
      size === "lg" ? "text-[11px] px-2 py-1" : "text-[10px]",
      style.cls
    )}>
      {style.label}
    </span>
  );
}

function NeedsCompletionBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300"
      title="New acquisition — still needs lessee, rider, and financials filled in"
      data-testid="badge-needs-completion"
    >
      <ClipboardList className="h-2.5 w-2.5" />
      Needs data
    </span>
  );
}

function TransitBadge({ status, label }: { status: string | null; label: string | null }) {
  if (!status) return null;
  const ts = TRANSIT_STATUSES.find((t) => t.value === status);
  const color = ts?.color ?? "bg-muted text-muted-foreground border-border";
  const text = ts?.label ?? status;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium", color)}>
      <Wrench className="h-2.5 w-2.5" />
      {text}{label ? ` · ${label}` : ""}
    </span>
  );
}

type SortKey =
  | "car_number"
  | "status"
  | "fleet"
  | "rider"
  | "lease"
  | "expiration";

const FR_PINNED_START = ["_select", "marks", "car_number", "lease_type"] as const;
const FR_PINNED_END = ["_actions"] as const;
const FR_CORE_MOVABLE = ["entity", "type", "status", "flag", "lessee", "rider", "lease", "expires"] as const;
const FR_SORT: Record<string, SortKey> = {
  car_number: "car_number",
  status: "status",
  lessee: "fleet",
  rider: "rider",
  lease: "lease",
  expires: "expiration",
};
const FR_LABELS: Record<string, string> = {
  entity: "Entity",
  marks: "Marks",
  car_number: "Car Number",
  lease_type: "Lease Type",
  type: "Type",
  status: "Rental Status",
  flag: "Flag",
  lessee: "Lessee",
  rider: "Rider",
  lease: "Lease",
  expires: "Expires",
};
const FR_WIDTHS: Record<string, number> = {
  _select: 40,
  entity: 88,
  marks: 88,
  car_number: 140,
  lease_type: 130,
  type: 80,
  status: 150,
  flag: 120,
  lessee: 140,
  rider: 130,
  lease: 110,
  expires: 110,
  _actions: 40,
};

function fmtDate(d: string | null | undefined) {
  return formatCalendarDate(d);
}

function EstimatedExpiryMark({
  date,
  snapshotMonth,
}: {
  date: string;
  snapshotMonth?: string | null;
}) {
  const month = formatAssetReportMonth(snapshotMonth);
  const title = month
    ? `Estimated from the ${month} Asset Report`
    : "Estimated from the Asset Report";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="italic text-muted-foreground/90 cursor-help whitespace-nowrap"
          title={title}
        >
          ~ {formatCalendarDate(date)}{" "}
          <span className="text-[10px] not-italic tracking-wide">(est.)</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function ExpiresDisplay({ r }: { r: any }) {
  const real = carLeaseEndDate(r);
  if (real) return <span>{fmtDate(real)}</span>;
  const estimate = String(r.estimated_lease_expiry ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(estimate)) {
    return (
      <EstimatedExpiryMark
        date={estimate}
        snapshotMonth={r.lease_expiry_snapshot_month}
      />
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

function fmtUsd(v: unknown, digits = 0) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Must stay in lockstep with OPT_COLS order — headers iterate that list too. */
function renderOptTd(key: string, r: any) {
  const money = "px-4 py-3 font-mono-num text-muted-foreground whitespace-nowrap";
  const num = "px-4 py-3 font-mono-num text-muted-foreground";
  const text = "px-4 py-3 text-muted-foreground";
  switch (key) {
    case "nbv":
      return <td key={key} className={money}>{fmtUsd(r.nbv, 0)}</td>;
    case "oac":
      return <td key={key} className={money}>{fmtUsd(r.oac, 0)}</td>;
    case "oec":
      return <td key={key} className={money}>{fmtUsd(r.oec, 0)}</td>;
    case "monthly_rent_per_car":
      return <td key={key} className={money}>{fmtUsd(r.monthly_rent_per_car, 2)}</td>;
    case "monthly_depr_per_car":
      return <td key={key} className={money}>{fmtUsd(r.monthly_depr_per_car, 2)}</td>;
    case "capacity_cf":
      return <td key={key} className={num}>{r.capacity_cf != null ? Number(r.capacity_cf).toLocaleString() : "—"}</td>;
    case "lining":
      return <td key={key} className={text}>{r.lining_material || r.lining || r.coating || "—"}</td>;
    case "build_year": {
      const year = carBuildYear(r);
      return <td key={key} className={num}>{year ?? "—"}</td>;
    }
    case "description":
      return <td key={key} className={`${text} max-w-[180px] truncate`}>{r.general_description || r.description || "—"}</td>;
    case "mech_designation":
      return <td key={key} className={text}>{r.mechanical_designation || r.mech_designation || "—"}</td>;
    case "commodity":
      return <td key={key} className={text}>{r.commodity ?? "—"}</td>;
    case "commodity_family":
      return <td key={key} className={text}>{r.commodity_family ?? "—"}</td>;
    case "dot_code":
      return <td key={key} className={num}>{r.dot_code || r.dot_specification || "—"}</td>;
    case "lease_type":
      return <td key={key} className={text}>{r.lease_type ?? "—"}</td>;
    case "lease_start_date":
      return <td key={key} className={num}>{fmtDate(r.lease_start_date)}</td>;
    case "lease_end_date":
      return <td key={key} className={num}>{fmtDate(r.lease_end_date)}</td>;
    case "lease_expiry":
      return <td key={key} className={num}>{fmtDate(r.lease_expiry)}</td>;
    case "data_source":
      return <td key={key} className={text}>{r.data_source ?? "—"}</td>;
    case "active":
      return (
        <td key={key} className="px-4 py-3">
          {r.active === false ? (
            <InactiveFleetBadge active={false} />
          ) : (
            <span className="text-muted-foreground text-xs">Active</span>
          )}
        </td>
      );
    case "rider_external_id":
      return <td key={key} className={num}>{r.rider_external_id ?? "—"}</td>;
    case "comment_event_note":
      return (
        <td key={key} className={`${text} max-w-[220px] truncate`} title={r.comment_event_note ?? ""}>
          {r.comment_event_note ?? "—"}
        </td>
      );
    default:
      return <td key={key} className={text}>—</td>;
  }
}

function downloadRailcarsCsv(rows: RailcarWithAssignment[]) {
  // Headers mirror the RESIDCO Master Car List workbook so an exported file can
  // be re-imported through Bulk Import without manual remapping. Internal
  // assignment/lease join fields are appended after the workbook columns.
  const headers = [
    "Car Number", "Rider ID", "Lessee", "Entity", "Active", "Data Source",
    "Car Type", "Description", "Assignment", "Lease Type",
    "Start Date", "End Date", "Lease Expiry",
    "NBV Per Car ($)", "OEC Per Car ($)",
    "Monthly Rent P/C ($)", "Monthly Depr P/C ($)",
    "Total BV — Rider ($)", "Cars on Rider (AR)",
    "Commodity Family", "Commodity",
    "Build Year", "Lining", "Mech Desig.", "DOT Code",
    "Comment / Event Note",
    // Internal columns (post-workbook)
    "Managed Category", "Reporting Marks", "Car Status", "Rental Status", "Flag", "Transit Status", "Transit Label",
    "Rider Name", "Schedule #", "MLA Lease #", "Lessor", "Expiration Date",
    "OAC",
  ];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const get = (r: any, k: string) => (r[k] == null ? "" : String(r[k]));
  const rows_data = rows.map((r: any) => [
    // Combine marks + number so the export round-trips with the workbook
    // ("TFOX" + "88031" -> "TFOX88031"). The "Reporting Marks" column below
    // still carries marks alone for users who want them split.
    `${r.reporting_marks ?? ""}${r.car_number ?? ""}`,
    get(r, "rider_external_id"),
    r.lessee_name ?? r.assignment?.fleet_name ?? "",
    r.entity ?? "",
    fleetActiveLabel(r.active) || (r.active_status ?? ""),
    get(r, "data_source"),
    r.car_type ?? "",
    r.description ?? r.general_description ?? "",
    get(r, "assignment_label"),
    r.lease_type ?? "",
    get(r, "lease_start_date"),
    get(r, "lease_end_date"),
    get(r, "lease_expiry"),
    r.nbv != null ? String(r.nbv) : "",
    r.oec != null ? String(r.oec) : "",
    r.monthly_rent_per_car != null ? String(r.monthly_rent_per_car) : "",
    r.monthly_depr_per_car != null ? String(r.monthly_depr_per_car) : "",
    r.total_bv_rider != null ? String(r.total_bv_rider) : "",
    r.cars_on_rider_ar != null ? String(r.cars_on_rider_ar) : "",
    get(r, "commodity_family"),
    get(r, "commodity"),
    r.build_year ?? r.built_year ?? "",
    r.lining ?? r.lining_material ?? "",
    r.mechanical_designation ?? "",
    r.dot_code ?? r.dot_specification ?? "",
    get(r, "comment_event_note"),
    // Internal
    r.managed_category ?? "",
    r.reporting_marks ?? "",
    r.status ?? "",
    displayRailcarStatus(displayStatusInputFromRailcar(r)),
    r.ops_flag ?? "",
    r.transit_status ?? "",
    r.transit_label ?? "",
    r.assignment?.rider?.rider_name ?? "",
    r.assignment?.rider?.schedule_number ?? "",
    r.assignment?.rider?.master_lease?.lease_number ?? "",
    r.assignment?.rider?.master_lease?.lessor ?? "",
    r.assignment?.rider?.expiration_date ?? "",
    r.oac != null ? String(r.oac) : "",
  ].map(escape).join(","));
  const csv = [headers.map(escape).join(","), ...rows_data].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `railcars-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseFleetQuery(searchStr: string): {
  assigned: string;
  entity: string;
  riderOl: string;
  turning50: number | null;
  search: string;
  transit: string;
  batch: string;
  needsCompletion: string;
} {
  const fromWouter = new URLSearchParams(String(searchStr || "").replace(/^\?/, ""));
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const fromHash = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
  const fromSearch =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const qs = [...fromWouter.keys()].length
    ? fromWouter
    : [...fromHash.keys()].length
      ? fromHash
      : fromSearch;
  const f = qs.get("filter");
  let assigned =
    f === "unassigned" ||
    f === "assigned" ||
    f === "offrent" ||
    f === "sold" ||
    f === "leased" ||
    f === "offlease" ||
    f === "abatement"
      ? f
      : "all";
  let transit = qs.get("transit") === "in_transit" || qs.get("transit") === "normal" ? qs.get("transit")! : "all";
  if (f === "intransit") {
    assigned = "leased";
    transit = "in_transit";
  }
  const raw = (qs.get("entity") || "").trim().toLowerCase();
  const entity =
    raw === "main" || raw === "owned"
      ? "Main"
      : raw === "rps" || raw === "rail partners select"
        ? "Rail Partners Select"
        : "all";
  const turning50Raw = Number(qs.get("turning50"));
  const turning50 =
    Number.isFinite(turning50Raw) && turning50Raw >= 1900 && turning50Raw <= 2100
      ? turning50Raw
      : null;
  return {
    assigned,
    entity,
    riderOl: (qs.get("rider") || "").trim(),
    turning50,
    search: (qs.get("search") || qs.get("highlight") || "").trim(),
    transit,
    batch: (qs.get("batch") || qs.get("acquisition_batch_id") || "").trim(),
    needsCompletion:
      qs.get("needs_completion") === "yes" || qs.get("filter") === "needscompletion"
        ? "yes"
        : qs.get("needs_completion") === "no"
          ? "no"
          : "all",
  };
}

export default function FleetRegistry() {
  const canEdit = useCanEdit();
  const wouterSearch = useSearch();
  const [location, setLocation] = useLocation();
  const initQ = parseFleetQuery(wouterSearch);

  const [search, setSearch] = useState(initQ.search);
  const [assignedFilter, setAssignedFilter] = useState<string>(initQ.assigned);
  const [riderFilter, setRiderFilter] = useState<string>("all");
  const [olCodeFilter, setOlCodeFilter] = useState<string>(initQ.riderOl);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // §5 fleet membership — distinct from service-status filter below
  const [fleetActiveFilter, setFleetActiveFilter] = useState<"active" | "inactive" | "all">("active");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "car_number",
    dir: "asc",
  });
  const [openCarId, setOpenCarId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [transitFilter, setTransitFilter] = useState<string>(initQ.transit);
  const [entityFilter, setEntityFilter] = useState<string>(initQ.entity);
  const [turning50Year, setTurning50Year] = useState<number | null>(initQ.turning50);
  const [batchFilter, setBatchFilter] = useState<string>(initQ.batch || "all");
  const [needsCompletionFilter, setNeedsCompletionFilter] = useState<string>(initQ.needsCompletion);
  const [flagFilter, setFlagFilter] = useState<string>("all");
  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoSeed, setPhotoSeed] = useState("");
  const [bulkStatusPending, setBulkStatusPending] = useState(false);
  const [bulkFleetStatusPending, setBulkFleetStatusPending] = useState(false);
  const [selectingAllMatching, setSelectingAllMatching] = useState(false);
  const [bulkRiderPending, setBulkRiderPending] = useState(false);
  const [bulkTransitPending, setBulkTransitPending] = useState(false);
  const [bulkValuesOpen, setBulkValuesOpen] = useState(false);
  const [bulkNbv, setBulkNbv] = useState("");
  const [bulkOac, setBulkOac] = useState("");
  const [bulkOec, setBulkOec] = useState("");
  const [bulkValuesPending, setBulkValuesPending] = useState(false);
  const [bulkRentalOpen, setBulkRentalOpen] = useState(false);
  const [bulkRentalTarget, setBulkRentalTarget] = useState<FleetStatus | null>(null);
  const [bulkRentalEffectiveDate, setBulkRentalEffectiveDate] = useState(todayIsoDateOnly);
  const [bulkNeedsCompletionPending, setBulkNeedsCompletionPending] = useState(false);
  const [bulkEntityPending, setBulkEntityPending] = useState(false);
  const [bulkFlagPending, setBulkFlagPending] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 75;
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Dashboard tiles land on ?filter=sold (etc.). A car-number search should look up
  // that car, not stay trapped in Sold / Idle / Leased.
  useEffect(() => {
    if (!debouncedSearch || !/\d/.test(debouncedSearch)) return;
    setAssignedFilter("all");
    setStatusFilter("all");
    const qIndex = location.indexOf("?");
    if (qIndex < 0) return;
    const params = new URLSearchParams(location.slice(qIndex + 1));
    if (!params.has("filter")) return;
    params.delete("filter");
    const next = params.toString();
    const path = location.slice(0, qIndex) || "/railcars";
    setLocation(next ? `${path}?${next}` : path, { replace: true } as any);
  }, [debouncedSearch]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [debouncedSearch, assignedFilter, riderFilter, olCodeFilter, statusFilter, transitFilter, entityFilter, fleetActiveFilter, turning50Year, batchFilter, needsCompletionFilter, flagFilter]);

  // ── Optional column visibility ─────────────────────────────────────────────
  type OptCol =
    | "nbv" | "oac" | "oec" | "capacity_cf" | "lining" | "build_year"
    | "description" | "mech_designation"
    | "monthly_rent_per_car" | "monthly_depr_per_car"
    | "commodity" | "commodity_family"
    | "dot_code" | "lease_expiry" | "lease_start_date" | "lease_end_date"
    | "data_source" | "active" | "comment_event_note" | "rider_external_id";
  const OPT_COLS: { key: OptCol; label: string }[] = [
    { key: "nbv",                 label: "NBV" },
    { key: "oac",                 label: "OAC" },
    { key: "oec",                 label: "OEC" },
    { key: "monthly_rent_per_car", label: "Monthly Rent P/C" },
    { key: "monthly_depr_per_car", label: "Monthly Depr P/C" },
    { key: "build_year",          label: "Build Year" },
    { key: "capacity_cf",         label: "Capacity (cf)" },
    { key: "lining",              label: "Lining" },
    { key: "description",         label: "Description" },
    { key: "mech_designation",    label: "Mech Desig." },
    { key: "commodity",           label: "Commodity" },
    { key: "commodity_family",    label: "Commodity Family" },
    { key: "dot_code",            label: "DOT Code" },
    { key: "lease_start_date",    label: "Lease Start" },
    { key: "lease_end_date",      label: "Lease End" },
    { key: "lease_expiry",        label: "Lease Expiry" },
    { key: "data_source",         label: "Data Source" },
    { key: "active",              label: "Active" },
    { key: "rider_external_id",   label: "Rider ID" },
    { key: "comment_event_note",  label: "Comment / Event Note" },
  ];
  const FR_DEFAULT_COLS = new Set<string>([]);
  const {
    visibleCols: visibleColsRaw,
    toggleCol,
    resetCols: resetVisibleCols,
    prefsLoaded: colPrefsLoaded,
    colOrder,
    setColOrder,
    colWidths,
    setColWidth,
  } =
    useColumnPrefs("fleet_registry", FR_DEFAULT_COLS);
  // Cast for backwards compat with existing Set<OptCol> usage in JSX
  const visibleCols = visibleColsRaw as Set<OptCol>;
  const tableCols = useMemo(() => {
    if (!turning50Year || visibleCols.has("build_year")) return visibleCols;
    const next = new Set(visibleCols);
    next.add("build_year");
    return next;
  }, [turning50Year, visibleCols]);

  const carLookup = Boolean(debouncedSearch && /\d/.test(debouncedSearch));
  const listParams = {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status: turning50Year || carLookup || statusFilter === "all" ? undefined : statusFilter,
    entity: turning50Year || entityFilter === "all" ? undefined : entityFilter,
    active: turning50Year ? "active" : fleetActiveFilter,
    assigned: turning50Year || carLookup || assignedFilter === "all" ? undefined : assignedFilter,
    rider: turning50Year ? undefined : (olCodeFilter || undefined),
    rider_id: turning50Year ? undefined : (riderFilter !== "all" ? riderFilter : undefined),
    transit: turning50Year || transitFilter === "all" ? undefined : transitFilter,
    turning50: turning50Year || undefined,
    batch: turning50Year || batchFilter === "all" ? undefined : batchFilter,
    needs_completion: turning50Year || needsCompletionFilter === "all" ? undefined : needsCompletionFilter,
    flag: turning50Year || carLookup || flagFilter === "all" ? undefined : flagFilter,
  };

  type RailcarPage = { rows: Row[]; total_count: number; page: number; pageSize: number };
  const { data: pageData, isLoading } = useQuery<RailcarPage>({
    queryKey: ["/api/railcars", listParams],
    queryFn: () => apiGet<RailcarPage>(railcarsQs(listParams)),
    staleTime: 45_000,
    // Don't keep the unfiltered page on screen while a search request is in flight —
    // that made mark/lessee queries look like they matched unrelated cars (or didn't fire).
    placeholderData: debouncedSearch ? undefined : keepPreviousData,
  });
  const { data: riders } = useQuery<any[]>({ queryKey: ["/api/riders"] });
  const riderOptions = useMemo(() => (riders ?? []).map(riderToOption), [riders]);
  type AcqBatch = { id: number; label: string; acquisition_date: string; entity: string; car_count: number };
  const { data: acquisitionBatches } = useQuery<AcqBatch[]>({
    queryKey: ["/api/acquisition-batches"],
    queryFn: () => apiGet<AcqBatch[]>("/api/acquisition-batches"),
    staleTime: 60_000,
  });
  const batchOptions = useMemo(
    () =>
      (acquisitionBatches ?? []).map((b) => ({
        value: String(b.id),
        label: b.label,
        hint: `${b.acquisition_date} · ${b.car_count}`,
        keywords: `${b.label} ${b.acquisition_date} ${b.entity}`,
      })),
    [acquisitionBatches],
  );
  const railcars = pageData?.rows ?? [];
  const totalCount = pageData?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  useEffect(() => {
    const q = parseFleetQuery(wouterSearch);
    setAssignedFilter(q.assigned);
    setEntityFilter(q.entity);
    setOlCodeFilter(q.riderOl);
    setTurning50Year(q.turning50);
    setTransitFilter(q.transit);
    setBatchFilter(q.batch || "all");
    setNeedsCompletionFilter(q.needsCompletion);
    if (q.turning50) setFleetActiveFilter("active");
  }, [wouterSearch]);

  const filtered = useMemo(() => {
    const getKey = (r: Row): string => {
      switch (sort.key) {
        case "car_number":
          return r.car_number;
        case "status":
          return displayRailcarStatus(displayStatusInputFromRailcar(r));
        case "fleet":
          return r.assignment?.fleet_name ?? "";
        case "rider":
          return r.assignment?.rider?.rider_name ?? "";
        case "lease":
          return r.assignment?.rider?.master_lease?.lease_number ?? "";
        case "expiration":
          return r.assignment?.rider?.expiration_date ?? "";
      }
    };
    return [...railcars].sort((a, b) => {
      const av = getKey(a);
      const bv = getKey(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [railcars, sort]);

  // ── Multi-select helpers ──────────────────────────────────────────────────
  const allFilteredIds = filtered.map((r) => r.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
  const someSelected = allFilteredIds.some((id) => selectedIds.has(id)) && !allSelected;

  const toggleOne = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allChecked = allFilteredIds.every((id) => prev.has(id));
      if (allChecked) {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.delete(id));
        return next;
      } else {
        return new Set([...prev, ...allFilteredIds]);
      }
    });
  }, [allFilteredIds]);

  const clearSelection = () => setSelectedIds(new Set());

  const selectAllMatchingFilter = async () => {
    setSelectingAllMatching(true);
    try {
      const listUrl = railcarsQs({ ...listParams, page: undefined, pageSize: undefined });
      const idsUrl = listUrl.replace("/api/railcars", "/api/railcars/ids");
      const json = await apiGet<{ ids: number[]; total_count: number }>(idsUrl);
      const ids = json.ids ?? [];
      setSelectedIds(new Set(ids));
      toast({ title: `Selected ${ids.length.toLocaleString()} cars matching this filter` });
    } catch (e: any) {
      toast({ title: "Could not select all matching cars", description: e.message, variant: "destructive" });
    } finally {
      setSelectingAllMatching(false);
    }
  };

  const bulkUpdateFleetStatus = async () => {
    if (!bulkRentalTarget) return;
    const ids = Array.from(selectedIds);
    const next = bulkRentalTarget;
    setBulkFleetStatusPending(true);
    try {
      await apiRequest("POST", "/api/railcars/bulk-fleet-status", {
        ids,
        fleet_status: next,
        effective_date: bulkRentalEffectiveDate || todayIsoDateOnly(),
        moved_by: "bulk-action",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/history"] });
      toast({ title: `${ids.length} car${ids.length !== 1 ? "s" : ""} set to ${next}` });
      setBulkRentalOpen(false);
      setBulkRentalTarget(null);
      clearSelection();
    } catch (e: any) {
      toast({ title: "Bulk rental status update failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkFleetStatusPending(false);
    }
  };

  const bulkUpdateOpsFlag = async (ops_flag: string | null, label: string) => {
    const ids = Array.from(selectedIds);
    setBulkFlagPending(true);
    try {
      await apiRequest("POST", "/api/railcars/bulk-ops-flag", { ids, ops_flag });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      toast({ title: `${ids.length} car${ids.length !== 1 ? "s" : ""} ${label}` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Could not set flag", description: e.message, variant: "destructive" });
    } finally {
      setBulkFlagPending(false);
    }
  };

  const bulkClearNeedsCompletion = async () => {
    const ids = Array.from(selectedIds);
    const ok = await confirmSave({
      title: `Clear Needs Completion on ${ids.length} selected railcar${ids.length !== 1 ? "s" : ""}?`,
      description: "This only clears the flag. It does not change rental status, assignments, or financials.",
    });
    if (!ok) return;
    setBulkNeedsCompletionPending(true);
    try {
      await apiRequest("POST", "/api/railcars/bulk-needs-completion", {
        ids,
        needs_completion: false,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      toast({ title: `Needs Completion cleared on ${ids.length} car${ids.length !== 1 ? "s" : ""}` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Could not clear Needs Completion", description: e.message, variant: "destructive" });
    } finally {
      setBulkNeedsCompletionPending(false);
    }
  };

  const bulkMoveEntity = async (label: "Main" | "RPS" | "Coal") => {
    const ids = Array.from(selectedIds);
    const ok = await confirmSave({
      title: `Move ${ids.length} selected railcar${ids.length !== 1 ? "s" : ""} to ${label}?`,
      description: "This only changes Entity. It does not change rental status, assignments, or financials.",
    });
    if (!ok) return;
    setBulkEntityPending(true);
    try {
      await apiRequest("POST", "/api/railcars/bulk-entity", { ids, entity: label });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `${ids.length} railcar${ids.length !== 1 ? "s" : ""} moved to ${label}` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Bulk entity move failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkEntityPending(false);
    }
  };

  const bulkUpdateStatus = async (newStatus: string) => {
    const ids = Array.from(selectedIds);
    const n = ids.length;
    const goingInactive = isInactiveCarStatus(newStatus);
    const selectedRows = filtered.filter((r) => selectedIds.has(r.id));
    const anyInactiveOnPage = selectedRows.some((r) => isInactiveCarStatus(r.status));
    // Select-all-matching may include Inactive cars not on this page — guard reactivations.
    const mayReactivate =
      !goingInactive && (anyInactiveOnPage || selectedIds.size > filtered.length);
    const needsGuard = goingInactive || mayReactivate;

    let reason: string | null = null;
    if (needsGuard) {
      reason = await confirmWithReason({
        title: goingInactive
          ? `Mark ${n} car${n !== 1 ? "s" : ""} Inactive?`
          : `Set car status to ${newStatus} for ${n} selected railcar${n !== 1 ? "s" : ""}?`,
        description: goingInactive
          ? "This removes them from active fleet counts, and any Lease Management OL/lease may be reclassified as inactive if this was its last active car."
          : "If any selected cars are currently Inactive, this reactivates them into the active fleet. A reason is required for that change.",
        confirmLabel: goingInactive ? "Mark Inactive" : "Confirm",
        variant: goingInactive ? "destructive" : "default",
        reasonLabel: "Reason (required)",
        reasonPlaceholder: goingInactive
          ? "Why are these cars being marked Inactive?"
          : "Why are Inactive cars being reactivated (or status changed)?",
      });
      if (reason == null) return;
    } else {
      const ok = await confirmSave({
        title: `Set car status to ${newStatus} for ${n} selected railcar${n !== 1 ? "s" : ""}?`,
      });
      if (!ok) return;
    }

    setBulkStatusPending(true);
    try {
      await apiRequest("POST", "/api/railcars/car-status", {
        ids,
        status: newStatus,
        reason: reason ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (String(q.queryKey[0] ?? "").startsWith("/api/car-status-history") ||
            q.queryKey[0] === "/api/railcars"),
      });
      toast({ title: `${n} car${n !== 1 ? "s" : ""} updated to "${newStatus}"` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Bulk update failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkStatusPending(false);
    }
  };

  const bulkUpdateTransit = async (transitStatus: string, label: string) => {
    const ids = Array.from(selectedIds);
    const ok = await confirmSave({
      title: `Update transit status for ${ids.length} selected railcar${ids.length !== 1 ? "s" : ""}?`,
      description: transitStatus === "none" ? "Clear transit/repair flags." : `Flag as "${label}".`,
    });
    if (!ok) return;
    setBulkTransitPending(true);
    try {
      await Promise.all(
        ids.map((id) =>
          apiRequest("PATCH", `/api/railcars/${id}`, {
            transit_status: transitStatus === "none" ? null : transitStatus,
            transit_label: transitStatus === "none" ? null : undefined,
          })
        )
      );
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      toast({ title: `${ids.length} car${ids.length !== 1 ? "s" : ""} ${transitStatus === "none" ? "cleared" : `flagged as "${label}"`}` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Bulk transit update failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkTransitPending(false);
    }
  };

  const bulkUpdateValues = async () => {
    if (!bulkNbv.trim() && !bulkOac.trim() && !bulkOec.trim()) return;
    const ids = Array.from(selectedIds);
    const ok = await confirmSave({
      title: `Update values for ${ids.length} selected railcar${ids.length !== 1 ? "s" : ""}?`,
      description: "NBV/OAC/OEC fields will be overwritten on the selected cars.",
    });
    if (!ok) return;
    setBulkValuesPending(true);
    const payload: Record<string, number> = {};
    if (bulkNbv.trim()) payload.nbv = parseFloat(bulkNbv);
    if (bulkOac.trim()) payload.oac = parseFloat(bulkOac);
    if (bulkOec.trim()) payload.oec = parseFloat(bulkOec);
    try {
      await Promise.all(ids.map((id) => apiRequest("PATCH", `/api/railcars/${id}`, payload)));
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      toast({ title: "Values updated", description: `NBV/OAC updated for ${ids.length} car${ids.length !== 1 ? "s" : ""}.` });
      setBulkValuesOpen(false);
      setBulkNbv("");
      setBulkOac("");
      setBulkOec("");
      clearSelection();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setBulkValuesPending(false);
    }
  };

  const bulkAssignRider = async (riderId: number, riderName: string) => {
    const ids = Array.from(selectedIds);
    const ok = await confirmSave({
      title: `Assign ${ids.length} selected railcar${ids.length !== 1 ? "s" : ""} to rider ${riderName}?`,
      description: "This reassigns the internal rider/schedule bucket. Lessee, Rider, and Lease on the list come from the car record and may not change.",
    });
    if (!ok) return;
    setBulkRiderPending(true);
    try {
      await Promise.all(
        ids.map((id) =>
          apiRequest("POST", "/api/move", {
            car_ids: [id],
            to_rider_id: riderId,
            moved_by: "bulk-action",
            reason: "Bulk assignment from Railcars",
          })
        )
      );
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/history"] });
      toast({ title: `${ids.length} car${ids.length !== 1 ? "s" : ""} moved to "${riderName}"` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Bulk move failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkRiderPending(false);
    }
  };

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );

  const displayKeys = useMemo(() => {
    const movable = [
      ...FR_CORE_MOVABLE,
      ...OPT_COLS.filter((c) => tableCols.has(c.key)).map((c) => c.key),
    ];
    return [...FR_PINNED_START, ...mergeColOrder(movable, colOrder), ...FR_PINNED_END];
  }, [tableCols, colOrder]);
  const movableKeys = displayKeys.filter(
    (k) => !(FR_PINNED_START as readonly string[]).includes(k) && !(FR_PINNED_END as readonly string[]).includes(k),
  );
  const tableW = tableWidthFor(displayKeys, colWidths, FR_WIDTHS, 110);

  function frHeader(key: string) {
    const pinned =
      (FR_PINNED_START as readonly string[]).includes(key) ||
      (FR_PINNED_END as readonly string[]).includes(key);
    const w = colWidth(colWidths, key, FR_WIDTHS[key] ?? 110);
    const sortKey = FR_SORT[key];
    return (
      <GridColumnTh
        key={key}
        colKey={key}
        width={w}
        pinned={pinned}
        className={cn(
          "px-4 py-3 font-medium text-[11px] uppercase tracking-wider bg-muted/40",
          key === "_select" && "pl-4 pr-2 py-3 w-10",
          key === "marks" && "hidden sm:table-cell",
          key === "type" && "hidden sm:table-cell",
          key === "_actions" && "w-10",
        )}
        onResize={setColWidth}
        onMove={(from, to) => setColOrder(moveCol(movableKeys, from, to))}
      >
        {key === "_select" ? (
          <Checkbox
            checked={allSelected}
            data-state={someSelected ? "indeterminate" : allSelected ? "checked" : "unchecked"}
            onCheckedChange={toggleAll}
            aria-label="Select all visible cars"
            data-testid="checkbox-select-all"
          />
        ) : key === "_actions" ? null : sortKey ? (
          <SortLabel label={FR_LABELS[key] ?? key} k={sortKey} sort={sort} onClick={toggleSort} />
        ) : (
          FR_LABELS[key] ?? OPT_COLS.find((c) => c.key === key)?.label ?? key
        )}
      </GridColumnTh>
    );
  }

  function frCell(key: string, r: any) {
    if (OPT_COLS.some((c) => c.key === key) && tableCols.has(key as OptCol)) {
      return renderOptTd(key, r);
    }
    switch (key) {
      case "_select":
        return (
          <td key={key} className="pl-4 pr-2 py-3" onClick={(e) => toggleOne(r.id, e)}>
            <Checkbox
              checked={selectedIds.has(r.id)}
              onCheckedChange={() => {/* handled by td onClick */}}
              aria-label={`Select car ${r.car_number}`}
              data-testid={`checkbox-car-${r.id}`}
            />
          </td>
        );
      case "entity":
        return (
          <td key={key} className="px-4 py-3">
            <EntityBadge entity={r.entity} />
          </td>
        );
      case "marks":
        return (
          <td key={key} className="px-4 py-3 font-mono-num text-muted-foreground hidden sm:table-cell">
            {r.reporting_marks ?? "—"}
          </td>
        );
      case "car_number":
        return (
          <td key={key} className="px-4 py-3 font-mono-num font-medium">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="hover:text-primary hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  openAppTab(carPath(r.id));
                }}
                data-testid={`link-car-detail-${r.id}`}
              >
                {r.car_number}
              </button>
              <InactiveFleetBadge active={r.active} />
            </div>
          </td>
        );
      case "lease_type":
        return (
          <td key={key} className="px-4 py-3">
            <LeaseTypeBadge
              carType={r.lease_type}
              mlaType={r.assignment?.rider?.master_lease?.lease_type}
            />
          </td>
        );
      case "type":
        return (
          <td key={key} className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
            {r.car_type ?? "—"}
          </td>
        );
      case "status":
        return (
          <td key={key} className="px-4 py-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <FleetAwareStatusBadge car={displayStatusInputFromRailcar(r)} />
              {r.transit_status && (
                <TransitBadge status={r.transit_status} label={r.transit_label} />
              )}
                  {r.needs_completion && <NeedsCompletionBadge />}
              {r.ops_flag && <OpsFlagBadge flag={r.ops_flag} />}
            </div>
          </td>
        );
      case "flag":
        return (
          <td key={key} className="px-4 py-3">
            <OpsFlagBadge flag={r.ops_flag} />
          </td>
        );
      case "lessee":
        return (
          <td key={key} className="px-4 py-3">
            <div>{r.assignment?.fleet_name ?? <span className="text-muted-foreground">Unassigned</span>}</div>
          </td>
        );
      case "rider":
        return (
          <td key={key} className="px-4 py-3 text-muted-foreground">
            {r.assignment?.rider?.rider_name ?? "—"}
          </td>
        );
      case "lease":
        return (
          <td key={key} className="px-4 py-3 font-mono-num text-muted-foreground">
            {displayLeaseNumber(r.assignment?.rider?.master_lease?.lease_number) || "—"}
          </td>
        );
      case "expires":
        return (
          <td key={key} className="px-4 py-3 font-mono-num text-muted-foreground">
            <ExpiresDisplay r={r} />
          </td>
        );
      case "_actions":
        return (
          <td key={key} className="px-4 py-3 text-muted-foreground">
            <ChevronRight className="h-4 w-4" />
          </td>
        );
      default:
        return renderOptTd(key, r);
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Railcars"
        subtitle="All railcars under management, current assignments, and lease status"
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (selectedIds.size > 0) {
                  const selected = filtered.filter((r) => selectedIds.has(r.id));
                  setPhotoSeed(carsToPasteText(selected));
                } else {
                  setPhotoSeed("");
                }
                setPhotoOpen(true);
              }}
              data-testid="button-find-photos"
            >
              <Image className="h-4 w-4" />
              {selectedIds.size > 0 ? `Find Photos (${selectedIds.size})` : "Find Photos"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const rows = await apiGet<Row[]>(railcarsQs({ ...listParams, page: undefined, pageSize: undefined, all: 1 }));
                downloadRailcarsCsv(rows);
              }}
              disabled={isLoading || totalCount === 0}
              data-testid="button-export-railcars"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            {canEdit && (
              <Button
                size="sm"
                onClick={() => setAddOpen(true)}
                data-testid="button-add-railcar"
              >
                <Plus className="h-4 w-4" />
                Add Railcar
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-8 py-4 sm:py-6 gap-4">
        {/* Filter bar */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          <ClearableSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search marks, car number, lessee, rider / OL…"
            testId="input-search-railcars"
          />
          <Select value={fleetActiveFilter} onValueChange={(v) => setFleetActiveFilter(v as "active" | "inactive" | "all")}>
            <SelectTrigger className="w-[150px]" data-testid="filter-fleet-active">
              <SelectValue placeholder="Active / inactive" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active cars</SelectItem>
              <SelectItem value="inactive">Inactive cars</SelectItem>
              <SelectItem value="all">All cars</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="filter-status">
              <SelectValue placeholder="Service status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rental statuses</SelectItem>
              {STATUS_FILTER_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={flagFilter} onValueChange={setFlagFilter}>
            <SelectTrigger className="w-[170px]" data-testid="filter-ops-flag">
              <SelectValue placeholder="Flag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All flags</SelectItem>
              <SelectItem value="any">Any flag</SelectItem>
              <SelectItem value="none">No flag</SelectItem>
              {OPS_FLAG_PRESETS.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SearchableSelect
            value={riderFilter}
            onChange={setRiderFilter}
            options={riderOptions}
            noneOption={{ value: "all", label: "All riders" }}
            placeholder="Rider"
            searchPlaceholder="Type OL number or lessee…"
            emptyText="No riders match."
            testId="filter-rider"
            triggerClassName="w-[220px]"
          />
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Ownership" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ownership</SelectItem>
              <SelectItem value="Main">MAIN</SelectItem>
              <SelectItem value="Rail Partners Select">RPS</SelectItem>
              <SelectItem value="Coal">COAL</SelectItem>
            </SelectContent>
          </Select>
          <Select value={transitFilter} onValueChange={setTransitFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Transit Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cars</SelectItem>
              <SelectItem value="in_transit">In transit / repair</SelectItem>
              <SelectItem value="normal">Normal service</SelectItem>
            </SelectContent>
          </Select>
          <Select value={needsCompletionFilter} onValueChange={setNeedsCompletionFilter}>
            <SelectTrigger className="w-[180px]" data-testid="filter-needs-completion">
              <SelectValue placeholder="Needs completion" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All completion</SelectItem>
              <SelectItem value="yes">Needs completion</SelectItem>
              <SelectItem value="no">Complete</SelectItem>
            </SelectContent>
          </Select>
          <SearchableSelect
            value={batchFilter}
            onChange={setBatchFilter}
            options={batchOptions}
            noneOption={{ value: "all", label: "All acquisition batches" }}
            placeholder="Acquisition batch"
            searchPlaceholder="Type batch name or date…"
            emptyText="No batches match."
            testId="filter-acquisition-batch"
            triggerClassName="w-[240px]"
          />
          <Select value={assignedFilter} onValueChange={setAssignedFilter}>
            <SelectTrigger className="w-[170px]" data-testid="filter-assigned">
              <SelectValue placeholder="Assignment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cars</SelectItem>
              <SelectItem value="leased">Leased</SelectItem>
              <SelectItem value="offlease">Idle</SelectItem>
              <SelectItem value="abatement">Abatement</SelectItem>
              <SelectItem value="assigned">Assigned only</SelectItem>
              <SelectItem value="unassigned">Unassigned only</SelectItem>
              <SelectItem value="offrent">Off Rent</SelectItem>
              <SelectItem value="sold">Sold</SelectItem>
            </SelectContent>
          </Select>
          {/* Column visibility picker */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Columns3 className="h-3.5 w-3.5" />
                Columns
                {!colPrefsLoaded ? (
                  <span className="h-3.5 w-3.5 rounded-full bg-muted animate-pulse" />
                ) : visibleCols.size > 0 ? (
                  <span className="ml-0.5 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                    {visibleCols.size}
                  </span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Optional columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {OPT_COLS.map(({ key, label }) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={visibleCols.has(key)}
                  onCheckedChange={() => toggleCol(key)}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
              {visibleCols.size > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs text-muted-foreground"
                    onClick={() => resetVisibleCols()}
                  >
                    Reset to default
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="text-xs text-muted-foreground font-mono-num">
            {totalCount.toLocaleString()} cars
            {totalCount > 0 ? ` · page ${page} of ${totalPages}` : ""}
          </div>
        </div>

        {turning50Year && (
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-umler-amber/30 bg-umler-amber/10" data-testid="banner-turning50">
            <div className="text-sm">
              <span className="font-medium">Turning 50 in {turning50Year}</span>
              <span className="text-muted-foreground">
                {" — "}active cars with build year {turning50Year - 50}
                {totalCount ? ` · ${totalCount.toLocaleString()} cars` : ""}
              </span>
            </div>
            <Link href="/railcars" className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0">
              Clear age filter
            </Link>
          </div>
        )}

        {/* Bulk action toolbar — visible when 1+ cars are selected, admin only */}
        {canEdit && selectedIds.size > 0 && (
          <div className="shrink-0 flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-lg border border-primary/30 bg-primary/5">
            <span className="text-sm font-medium text-foreground">
              {selectedIds.size.toLocaleString()} car{selectedIds.size !== 1 ? "s" : ""} selected
            </span>
            {totalCount > filtered.length && selectedIds.size < totalCount && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={selectingAllMatching}
                onClick={selectAllMatchingFilter}
                data-testid="select-all-matching-filter"
              >
                {selectingAllMatching ? "Selecting…" : `Select all ${totalCount.toLocaleString()} matching this filter`}
              </Button>
            )}
            {selectedIds.size === totalCount && totalCount > filtered.length && (
              <span className="text-xs text-muted-foreground">All matching cars selected</span>
            )}
            <div className="flex items-center gap-2 ml-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const selected = filtered.filter((r) => selectedIds.has(r.id));
                  setPhotoSeed(carsToPasteText(selected));
                  setPhotoOpen(true);
                }}
                data-testid="bulk-find-photos"
              >
                <Image className="h-4 w-4" />
                Find Photos
              </Button>
              {/* Bulk fleet status */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={bulkFleetStatusPending} data-testid="bulk-fleet-status-dropdown">
                    Set Rental Status
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Leased / Idle / Sold / Abatement for selected cars</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {FLEET_STATUSES.map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onSelect={() => {
                        setBulkRentalTarget(s);
                        setBulkRentalEffectiveDate(todayIsoDateOnly());
                        setBulkRentalOpen(true);
                      }}
                    >
                      {s}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Bulk status change */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={bulkStatusPending} data-testid="bulk-status-dropdown">
                    Set Car Status
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-[360px] overflow-y-auto">
                  <DropdownMenuLabel>Change car status for selected cars</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    data-testid="bulk-status-inactive"
                    onSelect={() => bulkUpdateStatus("Inactive")}
                  >
                    Inactive
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {STATUS_EDIT_OPTIONS.filter((s) => s.value !== "Inactive").map((s) => (
                    <DropdownMenuItem key={s.value} onSelect={() => bulkUpdateStatus(s.value)}>
                      {s.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Bulk transit/repair status */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={bulkTransitPending} data-testid="bulk-transit-dropdown">
                    Set Transit Flag
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Set transit / repair flag</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => bulkUpdateTransit("none", "Clear")}>
                    — Clear flag (normal service)
                  </DropdownMenuItem>
                  {TRANSIT_STATUSES.map((t) => (
                    <DropdownMenuItem key={t.value} onSelect={() => bulkUpdateTransit(t.value, t.label)}>
                      {t.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={bulkFlagPending} data-testid="bulk-ops-flag-dropdown">
                    Set Flag
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Exception flag (does not change rental status)</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => bulkUpdateOpsFlag(null, "cleared")}>
                    Clear flag
                  </DropdownMenuItem>
                  {OPS_FLAG_PRESETS.map((p) => (
                    <DropdownMenuItem
                      key={p}
                      onSelect={() => {
                        if (p === "Interchange") {
                          const road = window.prompt("Interchange with which road? (e.g. BNSF, UP)");
                          if (road == null) return;
                          const value = composeOpsFlag("Interchange", road) ?? "Interchange";
                          void bulkUpdateOpsFlag(value, `flagged ${value}`);
                          return;
                        }
                        void bulkUpdateOpsFlag(p, `flagged ${p}`);
                      }}
                    >
                      {p === "Interchange" ? "Interchange…" : p}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    onSelect={() => {
                      const name = window.prompt("Custom flag name");
                      if (!name?.trim()) return;
                      void bulkUpdateOpsFlag(name.trim(), `flagged ${name.trim()}`);
                    }}
                  >
                    Custom…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkNeedsCompletionPending}
                onClick={bulkClearNeedsCompletion}
                data-testid="bulk-clear-needs-completion"
              >
                <ClipboardList className="h-4 w-4" />
                Clear Needs Completion
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={bulkEntityPending} data-testid="bulk-entity-dropdown">
                    Move to Entity
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Reclassify selected cars</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(["Main", "RPS", "Coal"] as const).map((label) => (
                    <DropdownMenuItem key={label} onSelect={() => bulkMoveEntity(label)}>
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <SearchableSelect
                value=""
                actionMode
                disabled={bulkRiderPending}
                onChange={(v) => {
                  const r = (riders ?? []).find((x: any) => String(x.id) === v);
                  if (r) bulkAssignRider(r.id, r.rider_name);
                }}
                options={riderOptions}
                placeholder="Assign to Rider"
                searchPlaceholder="Type OL number or lessee…"
                emptyText="No riders match."
                testId="bulk-assign-dropdown"
                triggerClassName="h-8 w-auto min-w-[160px]"
              />
              {/* Bulk NBV / OAC */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setBulkNbv(""); setBulkOac(""); setBulkOec(""); setBulkValuesOpen(true); }}
                data-testid="bulk-values-btn"
              >
                Edit NBV / OAC / OEC
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              onClick={clearSelection}
              data-testid="bulk-clear"
            >
              <XIcon className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>
        )}

        {/* Table — bounded panel: both scrollbars stay on-screen; header sticky */}
        <div className="flex-1 min-h-[240px] rounded-lg border border-card-border bg-card overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="text-sm" style={{ tableLayout: "fixed", width: Math.max(700, tableW) }}>
              <colgroup>
                {displayKeys.map((k) => (
                  <col key={k} style={{ width: colWidth(colWidths, k, FR_WIDTHS[k] ?? 110) }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
                <tr className="text-left">
                  {displayKeys.map((k) => frHeader(k))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t border-border">
                      {displayKeys.map((k) => (
                        <td key={k} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={displayKeys.length} className="px-4 py-16 text-center text-muted-foreground">
                      {search.trim()
                        ? `No railcars match “${search.trim()}”${
                            assignedFilter !== "all" || statusFilter !== "all" || fleetActiveFilter !== "all"
                              ? " with the current filters. Try All cars / All rental statuses."
                              : "."
                          }`
                        : "No railcars match these filters."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-t border-border hover-elevate cursor-pointer",
                        selectedIds.has(r.id) && "bg-primary/5"
                      )}
                      onClick={() => setOpenCarId(r.id)}
                      data-testid={`row-railcar-${r.id}`}
                    >
                      {displayKeys.map((k) => frCell(k, r))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground bg-card">
            <span>
              {totalCount.toLocaleString()} cars
              {totalCount > 0 && (
                <> · page {page} of {totalPages}</>
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk rental status dialog */}
      <Dialog open={bulkRentalOpen} onOpenChange={setBulkRentalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Set rental status to {bulkRentalTarget} for {selectedIds.size} selected car{selectedIds.size !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              {bulkRentalTarget === "Sold"
                ? "Sold / Transferred To is left blank on a bulk change — fill buyer names per car afterward if needed."
                : bulkRentalTarget === "Abatement"
                  ? "Abatement keeps the car leased; rent is paused. Active Assignments / Total Fleet counts do not change."
                  : `This marks the selected cars as ${bulkRentalTarget}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label htmlFor="bulk-rental-effective-date">Effective date</Label>
              <Input
                id="bulk-rental-effective-date"
                type="date"
                value={bulkRentalEffectiveDate}
                onChange={(e) => setBulkRentalEffectiveDate(e.target.value)}
                data-testid="input-bulk-rental-effective-date"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Defaults to today. A past date is stored on the History log. Does not recalculate this month’s rent or depreciation.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkRentalOpen(false)}>Cancel</Button>
            <Button
              disabled={!bulkRentalTarget || bulkFleetStatusPending}
              onClick={bulkUpdateFleetStatus}
              data-testid="button-confirm-bulk-rental-status"
            >
              {bulkFleetStatusPending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Slide-over */}
      {/* Bulk NBV / OAC dialog */}
      <Dialog open={bulkValuesOpen} onOpenChange={setBulkValuesOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit NBV / OAC / OEC</DialogTitle>
            <DialogDescription>
              Updating {selectedIds.size} car{selectedIds.size !== 1 ? "s" : ""}. Leave any field blank to keep existing values.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>NBV — Net Book Value</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 42500.00 — leave blank to keep existing"
                value={bulkNbv}
                onChange={(e) => setBulkNbv(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <Label>OAC — Original Acquired Cost</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 55000.00 — leave blank to keep existing"
                value={bulkOac}
                onChange={(e) => setBulkOac(e.target.value)}
              />
            </div>
            <div>
              <Label>OEC — Original Est. Build Cost</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 48000.00 — leave blank to keep existing"
                value={bulkOec}
                onChange={(e) => setBulkOec(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkValuesOpen(false)}>Cancel</Button>
            <Button
              disabled={(!bulkNbv.trim() && !bulkOac.trim() && !bulkOec.trim()) || bulkValuesPending}
              onClick={bulkUpdateValues}
            >
              {bulkValuesPending ? `Saving…` : `Save to ${selectedIds.size} car${selectedIds.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={photoOpen} onOpenChange={setPhotoOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Railcar photos</DialogTitle>
            <DialogDescription>
              Search RR Picture Archives by reporting mark and number. Paste a list or use the cars you selected.
            </DialogDescription>
          </DialogHeader>
          {photoOpen && (
            <PhotoFinderPanel
              key={photoSeed || "paste"}
              initialText={photoSeed}
              onClose={() => setPhotoOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <RailcarDetailSheet carId={openCarId} onClose={() => setOpenCarId(null)} />

      <RailcarFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        car={null}
      />
    </div>
  );
}

function SortLabel({
  label,
  k,
  sort,
  onClick,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onClick: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <button
      type="button"
      onClick={() => onClick(k)}
      className={cn(
        "inline-flex items-center gap-1 font-medium text-[11px] uppercase tracking-wider hover:text-foreground",
        active && "text-foreground"
      )}
    >
      {label}
      <ArrowUpDown className={cn("h-3 w-3", active ? "opacity-100" : "opacity-40")} />
    </button>
  );
}

function downloadRentEventsCsv(events: any[], carNumber: string) {
  const headers = ["Car Number", "Entity", "Event Type", "Event Date", "Reason", "Logged By", "Logged At"];
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = events.map((e) => [
    carNumber,
    e.railcar?.entity ?? "",
    e.event_type === "off_rent" ? "Off Rent" : "On Rent",
    e.event_date,
    e.reason,
    e.created_by,
    new Date(e.created_at).toLocaleString(),
  ].map(escape).join(","));
  const csv = [headers.map(escape).join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rent-events-${carNumber}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function RailcarDetailSheet({
  carId,
  onClose,
}: {
  carId: number | null;
  onClose: () => void;
}) {
  const canEdit = useCanEdit();
  const { toast } = useToast();
  const [editCar, setEditCar] = useState<Row | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/railcars/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Railcar deleted" });
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Sheet open={carId != null} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full sm:w-[480px] sm:max-w-[480px] overflow-y-auto">
          {carId != null && (
            <CarDetail
              carId={carId}
              onEdit={(car) => setEditCar(car)}
              onDelete={() => deleteMutation.mutate(carId)}
              canEdit={canEdit}
            />
          )}
        </SheetContent>
      </Sheet>
      <RailcarFormDialog
        open={!!editCar}
        onClose={() => setEditCar(null)}
        car={editCar}
      />
    </>
  );
}

export function CarDetail({
  carId,
  onEdit,
  onDelete,
  canEdit,
  showCarPageLink = true,
}: {
  carId: number;
  onEdit: (car: RailcarWithAssignment) => void;
  onDelete: () => void;
  canEdit: boolean;
  /** Hide when already on `#/cars/:id`. */
  showCarPageLink?: boolean;
}) {
  const { toast } = useToast();
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [rentFormOpen, setRentFormOpen] = useState(false);
  const [rentEventType, setRentEventType] = useState<"off_rent" | "on_rent">("off_rent");
  const [rentEventDate, setRentEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [rentReason, setRentReason] = useState("");
  // Assign / reassign state
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRiderId, setAssignRiderId] = useState("");
  const [assignFleet, setAssignFleet] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const { data, isLoading } = useQuery<{
    railcar: RailcarWithAssignment;
    history: any[];
    number_history: any[];
  }>({
    queryKey: ["/api/railcars", carId],
  });

  // Riders list for the assign dropdown (cached from parent's query)
  const { data: ridersData } = useQuery<any[]>({ queryKey: ["/api/riders"] });
  const allRiders: any[] = ridersData ?? [];

  // Rent events for this car
  const { data: rentEventsData } = useQuery<any[]>({
    queryKey: ["/api/rent-events/car", carId],
    queryFn: () => apiRequest("GET", `/api/rent-events/car/${carId}`).then((r) => r.json()),
  });
  const rentEvents: any[] = rentEventsData ?? [];
  const currentRentStatus: "off_rent" | "on_rent" | null =
    rentEvents.length > 0 ? rentEvents[0].event_type : null;

  const rentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/rent-events", {
        car_id: carId,
        event_type: rentEventType,
        event_date: rentEventDate,
        reason: rentReason.trim(),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rent-events/car", carId] });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast({ title: "Rent event logged", description: "Rental status updated successfully." });
      setRentFormOpen(false);
      setRentReason("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to log event", description: err.message, variant: "destructive" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const resolved = await resolveRiderLabel(assignRiderId);
      const res = await apiRequest("POST", "/api/move", {
        car_ids: [carId],
        to_rider_id: resolved.id,
        new_fleet_name: assignFleet.trim() || null,
        reason: assignReason.trim() || null,
        moved_by: "user",
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast({ title: "Car assigned", description: "Assignment saved successfully." });
      setAssignOpen(false);
      setAssignRiderId("");
      setAssignFleet("");
      setAssignReason("");
    },
    onError: (err: any) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3 pt-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  const r = data.railcar;

  return (
    <div>
      {showCarPageLink ? (
        <SheetHeader>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-eyebrow">Railcar Detail</span>
            <EntityBadge entity={(r as any).entity} size="lg" />
          </div>
          <SheetTitle className="font-mono-num">{[r.reporting_marks, r.car_number].filter(Boolean).join(" ")}</SheetTitle>
          <SheetDescription>
            {r.car_type ?? "—"}{(r as any).mechanical_designation ? ` · ${(r as any).mechanical_designation}` : ""}
          </SheetDescription>
        </SheetHeader>
      ) : null}

      {/* Sold banner */}
      {(r as any).sold_to && (
        <div className="mt-4 rounded-md border border-umler-amber/30 bg-umler-amber/10 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-umler-amber uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-umler-amber" />
            SOLD / TRANSFERRED
          </div>
          <p className="mt-1 text-xs text-umler-amber/90">Sold to: {(r as any).sold_to}</p>
        </div>
      )}

      {/* §5 Inactive fleet membership — distinct from Off Rent / service status */}
      {(r as any).active === false && (
        <div className="mt-4 rounded-md border border-zinc-500/30 bg-zinc-500/10 px-4 py-3 flex items-center gap-2">
          <InactiveFleetBadge active={false} />
          <span className="text-xs text-zinc-400">Inactive in fleet (not currently counted in Dashboard KPIs)</span>
        </div>
      )}

      {(r as any).ops_flag && (
        <div className="mt-4 rounded-md border border-border bg-muted/20 px-4 py-3 flex items-center gap-2">
          <OpsFlagBadge flag={(r as any).ops_flag} />
          <span className="text-xs text-muted-foreground">Exception flag — rental status is unchanged</span>
        </div>
      )}

      {/* Transit / repair banner */}
      {r.transit_status && (
        <div className="mt-4 rounded-md border border-umler-signal/30 bg-umler-signal/10 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-umler-signal">
            <Wrench className="h-3.5 w-3.5" />
            <TransitBadge status={r.transit_status} label={null} />
          </div>
          {r.transit_label && (
            <p className="mt-1 text-xs text-umler-signal/80">{r.transit_label}</p>
          )}
        </div>
      )}

      {(r as any).needs_completion && (
        <div className="mt-4 rounded-md border border-sky-500/30 bg-sky-500/10 px-4 py-3 flex items-center gap-2">
          <NeedsCompletionBadge />
          <span className="text-xs text-sky-300/90">Still needs lessee, rider, and financials filled in.</span>
        </div>
      )}

      <div className="flex gap-2 mt-4 flex-wrap">
        {showCarPageLink && (
          <Button size="sm" variant="outline" onClick={() => openAppTab(carPath(r.id))} data-testid="button-open-car-page">
            <ExternalLink className="h-3.5 w-3.5" />
            Car page
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => onEdit(data.railcar)} data-testid="button-edit-car">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setRemarkOpen(true)}>
            <Hash className="h-3.5 w-3.5" />
            Change Number
          </Button>
        )}
        {canEdit && (
          <Button
            size="sm"
            variant="destructive"
            data-testid="button-delete-car"
            onClick={async () => {
              const mark = [r.reporting_marks, r.car_number].filter(Boolean).join(" ");
              const ok = await confirmDelete({
                title: `Delete railcar ${mark}?`,
                description: "This cannot be undone. Cars with active assignments cannot be deleted.",
              });
              if (ok) onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        )}
      </div>

      {/* Entity ownership — prominent section */}
      <div className="mt-5 rounded-md border border-border bg-muted/20 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Ownership Entity</div>
          <div className="font-medium text-sm">{(r as any).entity ?? "—"}</div>
        </div>
        <EntityBadge entity={(r as any).entity} size="lg" />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-5 text-sm">
        <DetailRow label="Rental Status" value={displayRailcarStatus(displayStatusInputFromRailcar(r))} />
        <DetailRow label="Car Status" value={r.status ?? "—"} />
        <DetailRow label="Car Type" value={r.car_type ?? "—"} />
        <DetailRow label="Mech. Designation" value={(r as any).mechanical_designation ?? "—"} />
        <DetailRow label="General Desc." value={(r as any).general_description ?? "—"} />
        <DetailRow label="AAR" value={r.aar_designation ?? "—"} />
        <DetailRow label="DOT" value={r.dot_specification ?? "—"} />
        <DetailRow label="Capacity (cf)" value={r.capacity_cf ?? "—"} />
        <DetailRow label="Tare (lbs)" value={r.tare_weight_lbs ?? "—"} />
        <DetailRow label="Load Limit" value={r.load_limit_lbs ?? "—"} />
        <DetailRow label="Built" value={formatBuiltDisplay(r)} />
        <DetailRow label="Lining" value={(r as any).lining_material || (r as any).coating || "—"} />
        <DetailRow label="Lease Type" value={(r as any).lease_type ?? "—"} />
        <DetailRow label="Managed By" value={(r as any).managed ?? "—"} />
        <DetailRow label="Managed Category" value={(r as any).managed_category ?? "—"} />
        <DetailRow label="Purchase Price" value={(r as any).purchase_price != null ? `$${Number((r as any).purchase_price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
        <DetailRow label="Acquisition Date" value={fmtDate((r as any).acquisition_date) || "—"} />
        <DetailRow label="NBV" value={(r as any).nbv != null ? `$${Number((r as any).nbv).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
        {/* OAC = Original Acquired Cost — distinct from OEC (Original Est. Build Cost). Often blank when Master Car List import only supplies OEC. */}
        <DetailRow label="OAC (Acquired Cost)" value={(r as any).oac != null ? `$${Number((r as any).oac).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
        <DetailRow label="OEC (Est. Build Cost)" value={(r as any).oec != null ? `$${Number((r as any).oec).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
        <DetailRow label="Monthly Rent P/C" value={(r as any).monthly_rent_per_car != null ? `$${Number((r as any).monthly_rent_per_car).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
        <DetailRow label="Monthly Depr P/C" value={(r as any).monthly_depr_per_car != null ? `$${Number((r as any).monthly_depr_per_car).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} />
        <DetailRow label="Total BV (Rider)" value={(r as any).total_bv_rider != null ? `$${Number((r as any).total_bv_rider).toLocaleString()}` : "—"} />
        <DetailRow label="Cars on Rider (AR)" value={(r as any).cars_on_rider_ar ?? "—"} />
        <DetailRow label="Commodity Family" value={(r as any).commodity_family ?? "—"} />
        <DetailRow label="Commodity" value={(r as any).commodity ?? "—"} />
        <DetailRow label="DOT Code" value={(r as any).dot_code ?? r.dot_specification ?? "—"} />
        <DetailRow label="Data Source" value={(r as any).data_source ?? "—"} />
        <DetailRow label="Active" value={(r as any).active_status ?? ((r as any).active === false ? "Inactive" : (r as any).active === true ? "Active" : "—")} />
        <DetailRow label="Rider ID (external)" value={(r as any).rider_external_id ?? "—"} />
        <DetailRow label="Lease Start" value={fmtDate((r as any).lease_start_date)} />
        <DetailRow label="Lease End" value={fmtDate((r as any).lease_end_date)} />
        <DetailRow label="Lease Expiry" value={fmtDate((r as any).lease_expiry)} />
        <DetailRow
          label="Estimated expiry"
          value={
            String((r as any).estimated_lease_expiry ?? "").slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? (
              <EstimatedExpiryMark
                date={String((r as any).estimated_lease_expiry).slice(0, 10)}
                snapshotMonth={(r as any).lease_expiry_snapshot_month}
              />
            ) : (
              "—"
            )
          }
        />
        <DetailRow label="Comment / Event Note" value={(r as any).comment_event_note ?? "—"} />
      </dl>

      {/* Previously known as — sourced from car_number_history (VCF remarks), not flat old_car_* */}
      {(data.number_history ?? []).length > 0 && (() => {
        const latest = data.number_history[0];
        const prior = [latest.old_car_initial, latest.old_car_number].filter(Boolean).join(" ");
        if (!prior) return null;
        return (
          <div className="mt-4 rounded-md bg-muted/30 border border-border px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Previously known as</div>
            <div className="font-mono text-sm">{prior}</div>
          </div>
        );
      })()}

      <div className="mt-6 border-t border-border pt-5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
          Current Assignment
        </div>
        {r.assignment ? (
          <div className="rounded-md border border-border bg-muted/30 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Lessee</span>
              <span className="font-medium">{r.assignment.fleet_name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rider</span>
              <span>{r.assignment.rider?.rider_name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Lease</span>
              <span className="font-mono-num">
                {displayLeaseNumber(r.assignment.rider?.master_lease?.lease_number) || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expires</span>
              <span className="font-mono-num">
                <ExpiresDisplay r={r} />
              </span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground italic">Unassigned</div>
        )}
      </div>

      {/* Assign / Reassign panel */}
      {canEdit && (
        <div className="mt-4">
          {!assignOpen ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setAssignFleet(r.assignment?.fleet_name ?? "");
                setAssignRiderId(r.assignment?.rider?.rider_name ?? "");
                setAssignOpen(true);
              }}
              data-testid="btn-open-assign"
            >
              {r.assignment ? "Reassign to Different Rider" : "Assign to Rider"}
            </Button>
          ) : (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-primary mb-1">
                {r.assignment ? "Reassign Car" : "Assign Car to Rider"}
              </div>

              {/* Rider / OL — free text (new codes allowed) */}
              <div>
                <Label className="text-xs">Rider / OL</Label>
                <RiderFreeTextInput
                  value={assignRiderId}
                  onChange={setAssignRiderId}
                  riders={allRiders}
                  listId={`assign-rider-${carId}`}
                  data-testid="select-assign-rider"
                  placeholder="Type rider / OL code…"
                />
              </div>

              {/* Lessee */}
              <div>
                <Label className="text-xs">Lessee</Label>
                <Input
                  value={assignFleet}
                  onChange={(e) => setAssignFleet(e.target.value)}
                  placeholder="e.g. COVIA, Preferred Sands"
                  data-testid="input-assign-fleet"
                />
              </div>

              {/* Reason */}
              <div>
                <Label className="text-xs">Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  value={assignReason}
                  onChange={(e) => setAssignReason(e.target.value)}
                  placeholder="New Assignment"
                  data-testid="input-assign-reason"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={!assignRiderId.trim() || assignMutation.isPending}
                  onClick={() => assignMutation.mutate()}
                  data-testid="btn-save-assign"
                >
                  {assignMutation.isPending ? "Saving…" : "Save Assignment"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAssignOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Rental Abatement / Rent Status ── */}
      <div className="mt-6 border-t border-border pt-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            On / Off Rent
          </div>
          <div className="flex items-center gap-2">
            {rentEvents.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => downloadRentEventsCsv(rentEvents, r.car_number)}
              >
                <Download className="h-3 w-3 mr-1" />Export
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setRentEventDate(new Date().toISOString().slice(0, 10));
                  setRentEventType(currentRentStatus === "off_rent" ? "on_rent" : "off_rent");
                  setRentReason("");
                  setRentFormOpen(true);
                }}
              >
                Log Event
              </Button>
            )}
          </div>
        </div>

        {/* Current status badge */}
        <div className="flex items-center gap-2 mb-3">
          {currentRentStatus === null && (
            <span className="text-sm text-muted-foreground italic">No rent events recorded</span>
          )}
          {currentRentStatus === "on_rent" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border border-[hsl(var(--success))]/30">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))]" />
              On Rent — as of {rentEvents[0]?.event_date}
            </span>
          )}
          {currentRentStatus === "off_rent" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[hsl(var(--error))]/15 text-[hsl(var(--error))] border border-[hsl(var(--error))]/30">
              <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--error))]" />
              Off Rent — since {rentEvents[0]?.event_date}
            </span>
          )}
        </div>

        {/* Log event form */}
        {rentFormOpen && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3 mb-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-primary">Log Rent Event</div>
            <div>
              <Label className="text-xs">Event Type</Label>
              <Select value={rentEventType} onValueChange={(v) => setRentEventType(v as any)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off_rent">Off Rent (abatement begins)</SelectItem>
                  <SelectItem value="on_rent">On Rent (abatement ends)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Effective Date</Label>
              <Input
                type="date"
                className="h-8 text-xs"
                value={rentEventDate}
                onChange={(e) => setRentEventDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Reason <span className="text-[hsl(var(--error))] text-xs">*</span></Label>
              <Input
                className="h-8 text-xs"
                value={rentReason}
                onChange={(e) => setRentReason(e.target.value)}
                placeholder="e.g. Bad order — sent to shop 4/21/26"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!rentReason.trim() || !rentEventDate || rentMutation.isPending}
                onClick={() => rentMutation.mutate()}
              >
                {rentMutation.isPending ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRentFormOpen(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <ActivityTimeline railcarId={carId} canEdit={canEdit} title="Activity" />

      {/* Railcar-level attachments */}
      <div className="mt-6 border-t border-border pt-5">
        <AttachmentsPanel entityType="railcar" entityId={carId} compact />
      </div>

      <RemarkChangeDialog
        open={remarkOpen}
        onClose={() => setRemarkOpen(false)}
        carId={carId}
        currentLabel={[r.reporting_marks, r.car_number].filter(Boolean).join(" ")}
      />
    </div>
  );
}

function RemarkChangeDialog({
  open, onClose, carId, currentLabel,
}: {
  open: boolean;
  onClose: () => void;
  carId: number;
  currentLabel: string;
}) {
  const { toast } = useToast();
  const [newNumber, setNewNumber] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => { if (open) { setNewNumber(""); setReason(""); } }, [open]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/railcars/${carId}/change-number`, {
        new_car_number: newNumber.trim().toUpperCase(),
        reason: reason.trim() || null,
      });
      return res.json();
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/railcars", carId] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      const from = [d.old_car_initial, d.old_car_number].filter(Boolean).join(" ") || d.old_car_number;
      const to = [d.new_car_initial, d.new_car_number].filter(Boolean).join(" ") || d.new_car_number;
      toast({ title: `Car number changed: ${from} → ${to}` });
      onClose();
    },
    onError: (e: Error) =>
      toast({
        title: "Change failed",
        description: e.message || "Request failed",
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Reporting Mark / Car Number</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-muted/40 px-4 py-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Current number</div>
            <div className="font-mono font-semibold">{currentLabel || "—"}</div>
          </div>
          <p className="text-xs text-muted-foreground">All car attributes (type, lining, capacity, history) are retained. Only the car number / reporting mark changes.</p>
          <div>
            <Label>New Mark + Number <span className="text-destructive">*</span></Label>
            <Input
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value.toUpperCase())}
              placeholder="e.g. OFCX 349699"
              className="font-mono"
            />
          </div>
          <div>
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reporting mark change per lessee request" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!newNumber.trim() || save.isPending}>
            {save.isPending ? "Saving…" : "Change Number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono-num mt-0.5">{value}</dd>
    </div>
  );
}

export function RailcarFormDialog({
  open,
  onClose,
  car,
}: {
  open: boolean;
  onClose: () => void;
  car: Row | null;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(() => ({
    car_number: car?.car_number ?? "",
    reporting_marks: car?.reporting_marks ?? "HWCX",
    car_type: car?.car_type ?? "Hopper",
    status: car?.status ?? "Active/In-Service",
    fleet_status: ((car as any)?.fleet_status as FleetStatus | undefined) ?? "Leased",
    entity: (car as any)?.entity ?? "",
    transit_status: (car as any)?.transit_status ?? "",
    transit_label: (car as any)?.transit_label ?? "",
    mechanical_designation: (car as any)?.mechanical_designation ?? "",
    general_description: (car as any)?.general_description ?? "",
    lease_type: (car as any)?.lease_type ?? "",
    managed: (car as any)?.managed ?? "",
    managed_category: (car as any)?.managed_category ?? "",
    // Merge coating into lining_material — prefer lining_material, fall back to coating
    lining_material: (car as any)?.lining_material || (car as any)?.coating || "",
    notes: car?.notes ?? "",
    sold_to: (car as any)?.sold_to ?? "",
    ops_flag: (car as any)?.ops_flag ?? "",
    nbv: (car as any)?.nbv != null ? String((car as any).nbv) : "",
    oac: (car as any)?.oac != null ? String((car as any).oac) : "",
    oec: (car as any)?.oec != null ? String((car as any).oec) : "",
  }));

  // Assignment fields — only used when car is null (new car mode)
  // Kept separate from `form` since they go to /api/move, not /api/railcars
  const [assignRiderId, setAssignRiderId] = useState("");
  const [assignFleetName, setAssignFleetName] = useState("");
  const [assignReason, setAssignReason] = useState("");

  // reset when opening
  useMemoReset(open, car, setForm);
  useEffect(() => {
    if (open) {
      setAssignRiderId("");
      setAssignFleetName("");
      setAssignReason("");
    }
  }, [open]);

  const { data: ridersData } = useQuery<any[]>({ queryKey: ["/api/riders"] });
  const allRiders: any[] = ridersData ?? [];

  const save = useMutation({
    mutationFn: async (inactiveReason?: string | null) => {
      if (car) {
        const payload: Record<string, unknown> = { ...form };
        delete payload.notes;
        if (inactiveReason) payload.inactive_change_reason = inactiveReason;
        await apiRequest("PATCH", `/api/railcars/${car.id}`, payload);
      } else {
        const res = await apiRequest("POST", `/api/railcars`, form);
        // If a rider/OL was entered, resolve (match or create) then assign
        if (assignRiderId.trim()) {
          const newCar = await res.json();
          const resolved = await resolveRiderLabel(assignRiderId);
          await apiRequest("POST", "/api/move", {
            car_ids: [newCar.id],
            to_rider_id: resolved.id,
            new_fleet_name: assignFleetName.trim() || null,
            reason: assignReason.trim() || "New Assignment",
            moved_by: "user",
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/railcars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/riders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leases"] });
      if (car?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/railcars", car.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/car-status-history/car", car.id] });
      } else {
        queryClient.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            String(q.queryKey[0] ?? "").startsWith("/api/car-status-history"),
        });
      }
      if (!car && assignRiderId.trim()) {
        queryClient.invalidateQueries({ queryKey: ["/api/history"] });
        toast({ title: "Railcar created & assigned", description: `Assigned to ${assignRiderId.trim()}` });
      } else {
        toast({ title: car ? "Railcar updated" : "Railcar created" });
      }
      onClose();
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  async function handleSave() {
    if (car) {
      const mark = [form.reporting_marks, form.car_number].filter(Boolean).join(" ")
        || [car.reporting_marks, car.car_number].filter(Boolean).join(" ")
        || "this railcar";
      const crosses = crossesInactiveBoundary(car.status, form.status);
      if (crosses) {
        const goingInactive = isInactiveCarStatus(form.status);
        const reason = await confirmWithReason({
          title: goingInactive
            ? `Mark ${mark} Inactive?`
            : `Reactivate ${mark}?`,
          description: goingInactive
            ? "This removes the car from active fleet counts, and its Lease Management OL/lease may be reclassified as inactive if this was its last active car."
            : `This returns the car to the active fleet with Car Status “${form.status}”.`,
          confirmLabel: goingInactive ? "Mark Inactive" : "Reactivate",
          variant: goingInactive ? "destructive" : "default",
          reasonLabel: "Reason (required)",
          reasonPlaceholder: goingInactive
            ? "Why is this car being marked Inactive?"
            : "Why is this car being reactivated?",
        });
        if (reason == null) return;
        save.mutate(reason);
        return;
      }
      const ok = await confirmSave({ title: `Save changes to ${mark}?` });
      if (!ok) return;
    }
    save.mutate(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{car ? "Edit Railcar" : "Add Railcar"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: 'calc(80vh - 120px)' }}>
          {/* ── Car ID block with live preview ─────────────────────────────── */}
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Car Identification</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Initial <span className="text-[10px] text-muted-foreground font-normal">(alpha prefix)</span></Label>
                <Input
                  value={form.reporting_marks}
                  onChange={(e) => setForm({ ...form, reporting_marks: e.target.value.toUpperCase() })}
                  placeholder="e.g. HWCX"
                  className="font-mono uppercase"
                  disabled={!!car}
                  data-testid="input-reporting-marks"
                />
              </div>
              <div>
                <Label className="text-xs">Number <span className="text-[10px] text-muted-foreground font-normal">(digits)</span></Label>
                <Input
                  value={form.car_number}
                  onChange={(e) => setForm({ ...form, car_number: e.target.value })}
                  placeholder="e.g. 123456"
                  className="font-mono"
                  disabled={!!car}
                  data-testid="input-car-number"
                />
              </div>
            </div>
            {/* Live preview */}
            <div className="flex items-center gap-2 rounded border border-dashed border-border/60 bg-background/60 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">Full Reporting Mark:</span>
              <span className={"font-mono font-semibold text-sm tracking-wide " + (form.reporting_marks || form.car_number ? "text-foreground" : "text-muted-foreground")}>
                {form.reporting_marks || form.car_number
                  ? `${form.reporting_marks ?? ""}${form.car_number ?? ""}`
                  : "HWCX123456"}
              </span>
              {!form.reporting_marks && !form.car_number && (
                <span className="text-[10px] text-muted-foreground italic">(example)</span>
              )}
            </div>
          </div>
          <div>
            <Label>Car Type</Label>
            <Input
              value={form.car_type}
              onChange={(e) => setForm({ ...form, car_type: e.target.value })}
            />
          </div>
          <div>
            <Label>Ownership Entity</Label>
            <Select
              value={form.entity || "none"}
              onValueChange={(v) => setForm({ ...form, entity: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Not set —</SelectItem>
                <SelectItem value="Main">MAIN</SelectItem>
                <SelectItem value="Rail Partners Select">RPS</SelectItem>
                <SelectItem value="Coal">COAL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Car Status</Label>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                Inactive requires confirm + reason and is logged permanently.
              </p>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="select-car-status">
                  <SelectValue placeholder="Select car status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_EDIT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Mech. Designation</Label>
              <Input value={form.mechanical_designation} onChange={(e) => setForm({ ...form, mechanical_designation: e.target.value })} placeholder="e.g. LO, GT, HTS" />
            </div>
          </div>
          <div>
            <Label>Rental Status</Label>
            <p className="text-[11px] text-muted-foreground mb-1.5">
              Leased / Idle / Sold / Abatement — does not change Car Status or active fleet membership.
            </p>
            <Select
              value={form.fleet_status || "Leased"}
              onValueChange={(v) => setForm({ ...form, fleet_status: v as FleetStatus })}
            >
              <SelectTrigger data-testid="select-fleet-status">
                <SelectValue placeholder="Select rental status" />
              </SelectTrigger>
              <SelectContent>
                {FLEET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.fleet_status === "Sold" && (
            <div>
              <Label>Sold / Transferred To</Label>
              <Input
                value={form.sold_to ?? ""}
                onChange={(e) => setForm({ ...form, sold_to: e.target.value })}
                placeholder="Buyer / transferee company name (leave blank if not sold)"
                data-testid="input-sold-to"
              />
            </div>
          )}
          <OpsFlagPicker
            value={(form as any).ops_flag ?? ""}
            onChange={(ops_flag) => setForm({ ...form, ops_flag })}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lining <span className="text-[10px] text-muted-foreground font-normal">(coating / lining material)</span></Label>
              <Input value={form.lining_material} onChange={(e) => setForm({ ...form, lining_material: e.target.value })} placeholder="e.g. Epoxy, 26, Bare steel" />
            </div>
          </div>
          <div>
            <Label>General Description</Label>
            <Input value={form.general_description} onChange={(e) => setForm({ ...form, general_description: e.target.value })} placeholder="e.g. Covered Hopper" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Lease Type</Label>
              <Input value={form.lease_type} onChange={(e) => setForm({ ...form, lease_type: e.target.value })} placeholder="e.g. Net Lease, Full Service" />
            </div>
            <div>
              <Label>Managed By</Label>
              <Input value={form.managed} onChange={(e) => setForm({ ...form, managed: e.target.value })} placeholder="e.g. Trinity, Greenbrier" />
            </div>
          </div>
          <div>
            <Label>Managed Category</Label>
            <Input value={form.managed_category} onChange={(e) => setForm({ ...form, managed_category: e.target.value })} placeholder="e.g. Net Lease, ALF Marks" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>NBV <span className="text-muted-foreground font-normal text-xs">(Net Book Value)</span></Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.nbv}
                onChange={(e) => setForm({ ...form, nbv: e.target.value })}
                placeholder="e.g. 42500.00"
              />
            </div>
            <div>
              <Label>OAC <span className="text-muted-foreground font-normal text-xs">(Original Acquired Cost)</span></Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.oac}
                onChange={(e) => setForm({ ...form, oac: e.target.value })}
                placeholder="e.g. 55000.00"
              />
            </div>
            <div>
              <Label>OEC <span className="text-muted-foreground font-normal text-xs">(Original Est. Build Cost)</span></Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.oec}
                onChange={(e) => setForm({ ...form, oec: e.target.value })}
                placeholder="e.g. 48000.00"
              />
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Prior reporting marks (remarks) live in Reporting Mark History from the Valid Car File —
            use “Change Reporting Mark / Car Number” to record a new rename. Flat <span className="font-mono">old_car_*</span> fields are no longer edited here.
          </div>
          <div>
            <Label>Transit / Repair Status</Label>
            <Select
              value={form.transit_status || "none"}
              onValueChange={(v) => setForm({ ...form, transit_status: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Normal service (no flag)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Normal service (no flag)</SelectItem>
                {TRANSIT_STATUSES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.transit_status && form.transit_status !== "none" && (
            <div>
              <Label>Transit Identifier</Label>
              <Input
                value={form.transit_label}
                onChange={(e) => setForm({ ...form, transit_label: e.target.value })}
                placeholder="e.g. COVIA Return, being newly assigned to Total Energies"
              />
            </div>
          )}
          {form.fleet_status !== "Sold" && (
            <div>
              <Label>Sold / Transferred To</Label>
              <Input
                value={form.sold_to ?? ""}
                onChange={(e) => setForm({ ...form, sold_to: e.target.value })}
                placeholder="Buyer / transferee company name (leave blank if not sold)"
              />
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Notes are now append-only on the Activity timeline on the car detail panel. Adding a note there keeps every prior comment.
            </p>
          </div>

          {/* ── Assign to Rider (new cars only) ──────────────────────────── */}
          {!car && (
            <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Assign to Rider <span className="normal-case tracking-normal font-normal text-muted-foreground/70">(optional)</span>
              </div>
              <div>
                <Label className="text-xs">Rider / OL</Label>
                <RiderFreeTextInput
                  value={assignRiderId}
                  onChange={setAssignRiderId}
                  riders={allRiders}
                  listId="new-car-rider-suggestions"
                  data-testid="select-new-car-rider"
                  placeholder="Optional — type rider / OL code…"
                />
              </div>
              {assignRiderId.trim() && (
                <>
                  <div>
                    <Label className="text-xs">Lessee Name</Label>
                    <Input
                      value={assignFleetName}
                      onChange={(e) => setAssignFleetName(e.target.value)}
                      placeholder="e.g. COVIA, Preferred Sands"
                      data-testid="input-new-car-fleet"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      value={assignReason}
                      onChange={(e) => setAssignReason(e.target.value)}
                      placeholder="New Assignment"
                      data-testid="input-new-car-reason"
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : car ? "Save" : (assignRiderId.trim() ? "Create & Assign" : "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useMemoReset(
  open: boolean,
  car: Row | null,
  setForm: (v: any) => void
) {
  useEffect(() => {
    if (open) {
      setForm({
        car_number: car?.car_number ?? "",
        reporting_marks: car?.reporting_marks ?? "HWCX",
        car_type: car?.car_type ?? "Hopper",
        status: car?.status ?? "Active/In-Service",
        fleet_status: ((car as any)?.fleet_status as FleetStatus | undefined) ?? "Leased",
        transit_status: (car as any)?.transit_status ?? "",
        transit_label: (car as any)?.transit_label ?? "",
        notes: car?.notes ?? "",
        entity: (car as any)?.entity ?? "",
        mechanical_designation: (car as any)?.mechanical_designation ?? "",
        general_description: (car as any)?.general_description ?? "",
        lease_type: (car as any)?.lease_type ?? "",
        managed: (car as any)?.managed ?? "",
        managed_category: (car as any)?.managed_category ?? "",
        // Merge coating into lining_material
        lining_material: (car as any)?.lining_material || (car as any)?.coating || "",
        sold_to: (car as any)?.sold_to ?? "",
        ops_flag: (car as any)?.ops_flag ?? "",
        active: (car as any)?.active ?? true,
        nbv: (car as any)?.nbv != null ? String((car as any).nbv) : "",
        oac: (car as any)?.oac != null ? String((car as any).oac) : "",
        oec: (car as any)?.oec != null ? String((car as any).oec) : "",
      });
    }
  }, [open, car, setForm]);
}
