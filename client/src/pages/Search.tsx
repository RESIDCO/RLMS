import { Search as SearchIcon, Loader2, X, Pencil, History, ChevronLeft, ChevronRight, Download, ChevronDown, Copy, Info, MoreHorizontal, PanelLeft, Save } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { apiGet, apiRequest, asRailcarList, railcarsQs } from "@/lib/queryClient";
import { carListSearchTokens, looksLikeCarToken, parseCarPasteListDetailed } from "@shared/programs";
import { classifyFleetQuery, summaryCarTypeKey } from "@shared/carTypeAliases";
import { displayLeaseNumber } from "@shared/residco-import";
import { formatCalendarDate, carLeaseEndDate } from "@shared/lease-authority";
import { FleetMembershipBadge, InactiveFleetBadge } from "@/components/InactiveFleetBadge";
import { FormerlyBadge } from "@/components/FormerlyBadge";
import { LeaseTypeBadge } from "@/components/LeaseTypeBadge";
import { RentalStatusCell } from "@/components/StatusFlags";
import { FLEET_STATUSES } from "@shared/fleet-status";
import { Button } from "@/components/ui/button";
import { CopyCarsButton } from "@/components/CopyCarsButton";
import { LastNoteCell } from "@/components/LastNoteCell";
import { lastNoteForRow, lastNoteSortKey } from "@shared/lineage-notes";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { historyPath } from "@/lib/browse-nav";
import { contactsDirectoryPath } from "@/lib/directory-nav";
import { navigateHash, useHashSearch } from "@/lib/hash-location";
import { clearSearchSession, readSearchSession, saveSearchSession, shouldRestoreSearchSession } from "@/lib/search-query";
import {
  createSearchSid,
  decodeHash,
  encodeHash,
  loadSearchState,
  pageSizeNumber,
  pasteFoundLabel,
  pasteShowsInactiveSeparately,
  resolveStoredSearch,
  saveSearchState,
  shouldRebootSearch,
  takeSearchRefresh,
  type SearchActive,
  type SearchHashState,
  type StoredSearchResults,
} from "@/lib/searchState";
import { RailcarDetailSheet } from "@/pages/FleetRegistry";
import { LeaseGlanceSheet } from "@/components/LeaseGlanceSheet";
import { glanceRiderFromCar, type LeaseGlanceRider } from "@/lib/glance-rider";
import { formatAmNoteSnippet } from "@/components/AmCommentThread";
import { downloadRailcarsCsv } from "@/lib/railcar-csv";
import { downloadSearchXlsx } from "@/lib/search-export";
import { useToast } from "@/hooks/use-toast";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { ColumnPicker } from "@/components/ColumnPicker";
import { columnLabel } from "@shared/column-dictionary";
import { colWidth, mergeColOrder, moveCol } from "@/lib/grid-columns";
import { GridColumnTh } from "@/components/GridColumnTh";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect, useMemo } from "react";
import { carBuildYear } from "@shared/build-year";
import {
  FOCUS_COLUMN_LABELS,
  SAVED_VIEWS_SCHEMA_MESSAGE,
  VIEWS_UNAVAILABLE_MESSAGE,
  comparePinnedOrder,
  emptyViewFilters,
  focusPresetLayout,
  isFocusColumn,
  layoutNeedsFocus,
  openedViewQuery,
  pasteMemberIds,
  pasteSearchBody,
  runViewCreate,
  stickyLeftOffsets,
  viewCountLabel,
  viewSavedToast,
  withFocusColumnsAfterIdentity,
  withLeadingIdentityColumns,
  type ViewFilters,
  type ViewKind,
  type ViewLayout,
  type ViewQuery,
} from "@shared/saved-views";
import { useCanEdit, useIsAdmin, useAuth } from "@/lib/AuthContext";
import { RAILCARS_HANDOFF_KEY } from "@/lib/searchState";
import {
  FilterPopover,
  PinnedViewStrip,
  SaveViewDialog,
  SelectionBar,
  ViewMeta,
  ViewsMenu,
  readViewsSidebarOpen,
  writeViewsSidebarOpen,
  type ViewSummary,
} from "@/components/search/SearchViewBar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import PhotoFinderPanel, { carsToPasteText } from "@/components/PhotoFinderPanel";
import { queryClient } from "@/lib/queryClient";
import { FLEET_STALE_MS, invalidateFleetQueries } from "@/lib/fleetQueryRefresh";

type SearchScope = { leases: boolean; cars: boolean; carData: boolean };

type DirectoryHit = {
  total_count?: number;
  company_id: number | null;
  company_name: string | null;
  contact_id: number | null;
  contact_name: string | null;
  title: string | null;
  email: string | null;
  lease_lessee?: string | null;
  lease_number?: string | null;
  rider_name?: string | null;
};

type DirectoryPage = { rows: DirectoryHit[]; total_count: number };

const DEFAULT_SCOPE: SearchScope = { leases: true, cars: true, carData: false };

type OptCol =
  | "nbv" | "oac" | "oec" | "capacity_cf" | "lining" | "build_year"
  | "description" | "mech_designation" | "equipment_type_code"
  | "monthly_rent_per_car" | "monthly_depr_per_car"
  | "commodity" | "commodity_family"
  | "dot_code" | "lease_expiry" | "lease_start_date" | "lease_end_date"
  | "data_source" | "active" | "comment_event_note" | "rider_external_id" | "account_manager_initials" | "am_note"
  | "open_stop_type" | "open_stop_since" | "open_stop_days" | "open_stop_expected" | "open_stop_reason" | "open_stop_note"
  | "program_name" | "program_status" | "program_milestone" | "program_note"
  | "scrapped_at" | "umler_status" | "latest_note" | "tags" | "view_note";

const OPT_COLS: { key: OptCol; label: string }[] = [
  { key: "nbv", label: "NBV" },
  { key: "oac", label: "OAC" },
  { key: "oec", label: "Net Equip. Cost" },
  { key: "monthly_rent_per_car", label: "Monthly Rent P/C" },
  { key: "monthly_depr_per_car", label: "Monthly Depr P/C" },
  { key: "build_year", label: "Build Year" },
  { key: "capacity_cf", label: "Capacity (cf)" },
  { key: "lining", label: "Lining" },
  { key: "description", label: "Description" },
  { key: "mech_designation", label: "Mech Desig." },
  { key: "equipment_type_code", label: "Equip. Type" },
  { key: "commodity", label: "Commodity" },
  { key: "commodity_family", label: "Commodity Family" },
  { key: "dot_code", label: "DOT Code" },
  { key: "lease_start_date", label: "Lease Start" },
  { key: "lease_end_date", label: "Lease End" },
  { key: "lease_expiry", label: "Lease Expiry" },
  { key: "data_source", label: "Data Source" },
  { key: "active", label: "Active" },
  { key: "rider_external_id", label: "Rider ID" },
  { key: "account_manager_initials", label: "Acct Mgr" },
  { key: "am_note", label: "Latest AM Note" },
  { key: "comment_event_note", label: "Comment / Event Note" },
  { key: "open_stop_type", label: FOCUS_COLUMN_LABELS.open_stop_type },
  { key: "open_stop_since", label: FOCUS_COLUMN_LABELS.open_stop_since },
  { key: "open_stop_days", label: FOCUS_COLUMN_LABELS.open_stop_days },
  { key: "open_stop_expected", label: FOCUS_COLUMN_LABELS.open_stop_expected },
  { key: "open_stop_reason", label: FOCUS_COLUMN_LABELS.open_stop_reason },
  { key: "open_stop_note", label: FOCUS_COLUMN_LABELS.open_stop_note },
  { key: "program_name", label: FOCUS_COLUMN_LABELS.program_name },
  { key: "program_status", label: FOCUS_COLUMN_LABELS.program_status },
  { key: "program_milestone", label: FOCUS_COLUMN_LABELS.program_milestone },
  { key: "program_note", label: FOCUS_COLUMN_LABELS.program_note },
  { key: "scrapped_at", label: FOCUS_COLUMN_LABELS.scrapped_at },
  { key: "umler_status", label: FOCUS_COLUMN_LABELS.umler_status },
  { key: "latest_note", label: FOCUS_COLUMN_LABELS.latest_note },
  { key: "tags", label: FOCUS_COLUMN_LABELS.tags },
  { key: "view_note", label: FOCUS_COLUMN_LABELS.view_note },
];

const SEARCH_DEFAULT_COLS = new Set<string>(["description", "mech_designation", "equipment_type_code"]);
const PINNED_START = ["marks", "car_number", "lease_type"] as const;
const PINNED_END = ["_actions"] as const;
const CORE_MOVABLE = ["entity", "type", "status", "lessee", "rider", "lease", "expires"] as const;
const LABELS: Record<string, string> = {
  entity: "Entity",
  marks: "Marks",
  car_number: "Car Number",
  lease_type: "Lease Type",
  type: "Type",
  status: "Rental Status",
  lessee: "Lessee",
  rider: "Rider",
  lease: "Lease",
  expires: "Expires",
};
const WIDTHS: Record<string, number> = {
  entity: 88,
  marks: 88,
  car_number: 140,
  lease_type: 130,
  type: 80,
  status: 150,
  lessee: 140,
  rider: 130,
  lease: 110,
  expires: 110,
  _actions: 72,
  open_stop_type: 110,
  open_stop_since: 110,
  open_stop_days: 90,
  open_stop_expected: 120,
  open_stop_reason: 160,
  open_stop_note: 180,
  program_name: 180,
  program_status: 180,
  program_milestone: 140,
  program_note: 180,
  scrapped_at: 110,
  umler_status: 120,
  latest_note: 200,
  tags: 140,
  view_note: 140,
  rider_external_id: 90,
};

const ENTITY_STYLES: Record<string, { label: string; cls: string }> = {
  "Rail Partners Select": { label: "RPS", cls: "bg-umler-steel/15 text-umler-steel border-umler-steel/30" },
  Main: { label: "MAIN", cls: "bg-umler-teal/15 text-umler-teal border-umler-teal/30" },
  Coal: { label: "COAL", cls: "bg-umler-faint/15 text-umler-faint border-umler-faint/30" },
  "Main-Coal": { label: "COAL", cls: "bg-umler-faint/15 text-umler-faint border-umler-faint/30" },
};

function EntityBadge({ entity }: { entity: string | null | undefined }) {
  if (!entity) return null;
  const style = ENTITY_STYLES[entity] ?? { label: entity, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn("text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border", style.cls)}>
      {style.label}
    </span>
  );
}

function fmtUsd(v: unknown, digits = 0) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function renderOptTd(key: string, r: any, compact = false) {
  const money = compact
    ? "px-3 py-1 font-mono-num text-muted-foreground whitespace-nowrap"
    : "px-4 py-3 font-mono-num text-muted-foreground whitespace-nowrap";
  const num = compact ? "px-3 py-1 font-mono-num text-muted-foreground" : "px-4 py-3 font-mono-num text-muted-foreground";
  const text = compact ? "px-3 py-1 text-muted-foreground" : "px-4 py-3 text-muted-foreground";
  switch (key) {
    case "nbv": return <td key={key} className={money}>{fmtUsd(r.nbv, 0)}</td>;
    case "oac": return <td key={key} className={money}>{fmtUsd(r.oac, 0)}</td>;
    case "oec": return <td key={key} className={money}>{fmtUsd(r.oec, 0)}</td>;
    case "monthly_rent_per_car": return <td key={key} className={money}>{fmtUsd(r.monthly_rent_per_car, 2)}</td>;
    case "monthly_depr_per_car": return <td key={key} className={money}>{fmtUsd(r.monthly_depr_per_car, 2)}</td>;
    case "capacity_cf": return <td key={key} className={num}>{r.capacity_cf != null ? Number(r.capacity_cf).toLocaleString() : "—"}</td>;
    case "lining": return <td key={key} className={text}>{r.lining_material || r.lining || r.coating || "—"}</td>;
    case "build_year": return <td key={key} className={num}>{carBuildYear(r) ?? "—"}</td>;
    case "description": return <td key={key} className={`${text} max-w-[180px] truncate`}>{r.general_description || r.description || "—"}</td>;
    case "mech_designation": return <td key={key} className={text}>{r.mechanical_designation || r.mech_designation || "—"}</td>;
    case "equipment_type_code": return <td key={key} className={text}>{r.equipment_type_code ?? "—"}</td>;
    case "commodity": return <td key={key} className={text}>{r.commodity ?? "—"}</td>;
    case "commodity_family": return <td key={key} className={text}>{r.commodity_family ?? "—"}</td>;
    case "dot_code": return <td key={key} className={num}>{r.dot_code || r.dot_specification || "—"}</td>;
    case "lease_start_date": return <td key={key} className={num}>{formatCalendarDate(r.lease_start_date)}</td>;
    case "lease_end_date": return <td key={key} className={num}>{formatCalendarDate(r.lease_end_date)}</td>;
    case "lease_expiry": return <td key={key} className={num}>{formatCalendarDate(r.lease_expiry)}</td>;
    case "data_source": return <td key={key} className={text}>{r.data_source ?? "—"}</td>;
    case "active":
      return (
        <td key={key} className={compact ? "px-3 py-1" : "px-4 py-3"}>
          {r.active === false ? <InactiveFleetBadge active={false} /> : <span className="text-muted-foreground text-xs">Active</span>}
        </td>
      );
    case "rider_external_id": return <td key={key} className={num}>{r.rider_external_id ?? "—"}</td>;
    case "account_manager_initials": return <td key={key} className={text}>{r.account_manager_initials || ""}</td>;
    case "am_note": {
      const snippet = formatAmNoteSnippet(r.am_note);
      return <td key={key} className={`${text} max-w-[240px] truncate`} title={snippet || ""}>{snippet || ""}</td>;
    }
    case "comment_event_note":
      return <td key={key} className={`${text} max-w-[220px] truncate`} title={r.comment_event_note ?? ""}>{r.comment_event_note ?? "—"}</td>;
    case "open_stop_reason":
      return <td key={key} className={`${text} max-w-[180px] truncate`} title={r.open_stop_note || ""}>{r.open_stop_reason || "—"}</td>;
    case "open_stop_days":
      return <td key={key} className={num}>{r.open_stop_days ?? "—"}</td>;
    case "program_name":
      return (
        <td key={key} className={text}>
          <span className="truncate">{r.program_name || "—"}</span>
          {r.program_extra > 0 ? <span className="ml-1 rounded bg-muted px-1 text-[10px]">+{r.program_extra}</span> : null}
        </td>
      );
    case "program_milestone":
      return <td key={key} className={`${text} max-w-[160px] truncate`}>{[r.program_milestone, r.program_milestone_at].filter(Boolean).join(" · ") || "—"}</td>;
    case "latest_note":
      return <LastNoteCell key={key} row={r} className={text} />;
    case "tags":
      return (
        <td key={key} className={text}>
          <span className="flex flex-wrap gap-1">
            {(Array.isArray(r.tags) ? r.tags : []).map((tag: string) => (
              <span key={tag} className="rounded-full border border-border px-1.5 py-0.5 text-[10px]">{tag}</span>
            ))}
          </span>
        </td>
      );
    case "view_note":
      return <td key={key} className={`${text} max-w-[160px] truncate`} title={r.active === false ? "Inactive" : ""}>{r.view_note || ""}</td>;
    case "open_stop_type":
    case "open_stop_since":
    case "open_stop_expected":
    case "open_stop_note":
    case "program_status":
    case "program_note":
    case "scrapped_at":
    case "umler_status":
      return <td key={key} className={`${text} max-w-[180px] truncate`}>{r[key] || "—"}</td>;
    default:
      return <td key={key} className={text}>—</td>;
  }
}

function ScopeBox({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} data-testid={id} />
      {label}
    </label>
  );
}

type Summary = {
  total: number;
  by_type: { key: string; count: number }[];
  by_entity: { key: string; count: number }[];
  by_status: { key: string; count: number }[];
};

type PasteMeta = {
  notFound: string[];
  inactive: { id: number; reporting_marks: string | null; car_number: string | null; status: string | null }[];
  ambiguous: { token: string; reason?: string; matches: { id: number; label: string; active?: boolean }[] }[];
  truncated: boolean;
  counts: { pasted: number; found: number; inactive: number; not_found: number; ambiguous: number };
};

type FleetMatch = { kind?: string; label?: string; ruleLabel?: string; activeCount?: number | null; textCount?: number | null } | null;

type Boot = {
  query: string;
  committed: string;
  scope: SearchScope;
  activeMode: SearchActive;
  page: number;
  ps: number | "all";
  type: string;
  mech: string;
  aar: string;
  entity: string;
  status: string;
  sort: string;
  dir: "asc" | "desc";
  exactFleet: boolean;
  viewId: number | null;
  openStop: string;
  program: string;
  tag: string;
  sid: string;
  fromCache: boolean;
  /** Put the page back at scrollY once the grid has rows. */
  restoreScroll: boolean;
  pasteRows: any[] | null;
  pasteMeta: PasteMeta | null;
  textRows: any[];
  textTotal: number;
  summary: Summary | null;
  match: FleetMatch;
  selection: number[];
  scrollY: number;
  draft: {
    viewId: number | null;
    dirty: boolean;
    density: "comfortable" | "compact";
    panelCollapsed: boolean;
    cols: string[];
    order: string[];
    widths: Record<string, number>;
  } | null;
};

type RailcarPage = { rows: any[]; total_count: number; page: number; pageSize: number; match?: FleetMatch };

const EXPORT_CAP = 20_000;

function blankBoot(): Boot {
  return {
    query: "",
    committed: "",
    scope: { ...DEFAULT_SCOPE },
    activeMode: "active",
    page: 1,
    ps: 75,
    type: "",
    mech: "",
    aar: "",
    entity: "",
    status: "",
    sort: "car_number",
    dir: "asc",
    exactFleet: true,
    viewId: null,
    openStop: "",
    program: "",
    tag: "",
    sid: "",
    fromCache: false,
    restoreScroll: false,
    pasteRows: null,
    pasteMeta: null,
    textRows: [],
    textTotal: 0,
    summary: null,
    match: null,
    selection: [],
    scrollY: 0,
    draft: null,
  };
}

function codeHit(value: unknown, pattern: string) {
  const v = String(value ?? "").trim().toUpperCase();
  const p = pattern.trim().toUpperCase();
  if (!p) return true;
  if (p.endsWith("*")) return v.startsWith(p.slice(0, -1));
  return v === p;
}

function bump(map: Map<string, number>, key: unknown) {
  const k = String(key ?? "").trim() || "—";
  map.set(k, (map.get(k) ?? 0) + 1);
}

function ranked(map: Map<string, number>) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function summarize(rows: any[]): Summary {
  const byType = new Map<string, number>();
  const byEntity = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const row of rows) {
    bump(byType, summaryCarTypeKey(row.car_type, row.equipment_type_code));
    bump(byEntity, row.entity);
    bump(byStatus, row.fleet_status);
  }
  return { total: rows.length, by_type: ranked(byType), by_entity: ranked(byEntity), by_status: ranked(byStatus) };
}

function scrollParent(): HTMLElement | null {
  const grid = document.querySelector("[data-search-grid]");
  if (grid instanceof HTMLElement) return grid;
  const el = document.querySelector("[data-app-scroll]");
  return el instanceof HTMLElement ? el : null;
}

type ViewDetail = ViewSummary & {
  query: ViewQuery;
  layout: ViewLayout;
  members?: { railcar_id: number; note: string | null; active: boolean | null }[];
};

function matchesSearchFilters(
  r: any,
  f: {
    type: string;
    mech: string;
    aar: string;
    entity: string;
    status: string;
    active: SearchActive;
    openStop: string;
    program: string;
    tag: string;
  },
): boolean {
  if (f.type && !codeHit(r.car_type, f.type) && !codeHit(r.equipment_type_code, f.type)) return false;
  if (f.mech && !codeHit(r.mechanical_designation, f.mech)) return false;
  if (f.aar && !codeHit(r.aar_designation, f.aar)) return false;
  if (f.entity && String(r.entity ?? "") !== f.entity) return false;
  if (f.status && String(r.fleet_status ?? "") !== f.status) return false;
  if (f.active === "active" && r.active === false) return false;
  if (f.active === "inactive" && r.active !== false) return false;
  const stop = String(r.open_stop_type ?? "");
  if (f.openStop === "none" && stop) return false;
  if (f.openStop === "any" && !stop) return false;
  if ((f.openStop === "Abatement" || f.openStop === "Off rent") && stop !== f.openStop) return false;
  if (f.program) {
    const hay = `${r.program_name ?? ""} ${r.program_status ?? ""}`.toLowerCase();
    if (!hay.includes(f.program.toLowerCase())) return false;
  }
  if (f.tag) {
    const tags = Array.isArray(r.tags) ? r.tags.map((tag: string) => String(tag).toLowerCase()) : [];
    if (!tags.includes(f.tag.toLowerCase())) return false;
  }
  return true;
}

function sortValue(row: any, key: string): string {
  if (key === "car_number") return String(row.car_number ?? "");
  if (key === "marks") return String(row.reporting_marks ?? "");
  if (key === "lessee") return String(row.assignment?.fleet_name ?? row.lessee_name ?? "");
  if (key === "rider") return String(row.assignment?.rider?.rider_name ?? row.rider_external_id ?? "");
  if (key === "lease") return String(row.assignment?.rider?.master_lease?.lease_number ?? "");
  if (key === "status") return String(row.fleet_status ?? "");
  if (key === "type") return String(row.car_type ?? "");
  if (key === "entity") return String(row.entity ?? "");
  if (key === "tags") return Array.isArray(row.tags) ? row.tags.join(", ") : "";
  if (key === "latest_note") return lastNoteSortKey(lastNoteForRow(row));
  if (key === "program_milestone") return [row.program_milestone, row.program_milestone_at].filter(Boolean).join(" ");
  const value = row[key];
  return value == null ? "" : String(value);
}

function sortRows(rows: any[], key: string, dir: "asc" | "desc"): any[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => sortValue(a, key).localeCompare(sortValue(b, key), undefined, { numeric: true }) * sign);
}

function ViewNoteCell({
  value,
  readOnly,
  compact,
  onSave,
}: {
  value: string;
  readOnly: boolean;
  compact: boolean;
  onSave: (note: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const pad = compact ? "px-3 py-1" : "px-4 py-3";
  if (readOnly) {
    return <td className={`${pad} max-w-[160px] truncate text-muted-foreground`} title={value ? "Inactive" : "Inactive"}>{value}</td>;
  }
  return (
    <td className={pad} onClick={(event) => event.stopPropagation()}>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== value) onSave(text);
        }}
        className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-xs hover:border-border focus:border-primary focus:outline-none"
        aria-label="View note"
      />
    </td>
  );
}

function readBoot(): Boot {
  const base = blankBoot();
  if (typeof window === "undefined") return base;
  const hash = decodeHash(window.location.hash);
  const refresh = takeSearchRefresh();
  const cached = hash.sid ? loadSearchState(hash.sid) : null;
  const resolved = resolveStoredSearch(cached);
  if (cached && resolved) {
    const h = resolved.hash;
    const results = cached.results!;
    const counts = results.counts ?? {};
    const useCache = resolved.useCache && !refresh;
    return {
      query: resolved.query,
      committed: resolved.query,
      scope: { leases: h.leases, cars: h.cars, carData: h.carData },
      activeMode: h.active,
      page: h.page,
      ps: h.ps,
      type: h.type,
      mech: h.mech,
      aar: h.aar,
      entity: h.entity,
      status: h.status,
      sort: h.sort,
      dir: h.dir,
      exactFleet: h.fleet !== false,
      viewId: Number(h.view) > 0 ? Number(h.view) : null,
      openStop: h.openStop,
      program: h.program,
      tag: h.tag,
      sid: cached.sid,
      fromCache: useCache,
      restoreScroll: true,
      pasteRows: useCache && results.mode === "paste" ? (results.rows as any[]) : null,
      pasteMeta: useCache && results.mode === "paste" ? {
        notFound: results.notFound ?? [],
        inactive: (results.inactiveMatches ?? []) as PasteMeta["inactive"],
        ambiguous: (results.ambiguous ?? []) as PasteMeta["ambiguous"],
        truncated: Boolean(results.truncated),
        counts: {
          pasted: Number(counts.pasted ?? 0),
          found: Number(counts.found ?? counts.railcars ?? results.rows.length),
          inactive: Number(counts.inactive ?? (results.inactiveMatches ?? []).length),
          not_found: Number(counts.not_found ?? (results.notFound ?? []).length),
          ambiguous: Number(counts.ambiguous ?? (results.ambiguous ?? []).length),
        },
      } : null,
      textRows: useCache && results.mode === "text" ? (results.rows as any[]) : [],
      textTotal: useCache && results.mode === "text" ? results.total : 0,
      summary: useCache ? ((results.summary as Summary) ?? null) : null,
      match: useCache ? ((results.match as FleetMatch) ?? null) : null,
      selection: resolved.selection,
      scrollY: resolved.scrollY,
      draft: cached.draft ?? null,
    };
  }
  const legacy = readSearchSession();
  const wantLegacy = shouldRestoreSearchSession() || Boolean(hash.q && legacy?.query === hash.q);
  if (legacy?.query && wantLegacy) {
    const f = legacy.filters as any;
    base.query = legacy.query;
    base.committed = legacy.query;
    base.sid = hash.sid;
    if (f?.active === "inactive" || f?.active === "all") base.activeMode = f.active;
    if (f && (typeof f.scopeLeases === "boolean" || typeof f.scopeCars === "boolean")) {
      base.scope = { leases: f.scopeLeases !== false, cars: f.scopeCars !== false, carData: Boolean(f.scopeCarData) };
    }
    const cars = (legacy.results as any)?.railcars;
    if (carListSearchTokens(legacy.query) && Array.isArray(cars)) {
      const missing = (legacy.results as any)?.not_found ?? [];
      base.pasteRows = cars;
      base.pasteMeta = {
        notFound: missing,
        inactive: [],
        ambiguous: [],
        truncated: false,
        counts: { pasted: cars.length, found: cars.length, inactive: 0, not_found: missing.length, ambiguous: 0 },
      };
      base.fromCache = true;
    }
    return base;
  }
  if (hash.q) {
    base.query = hash.q;
    base.committed = hash.q;
    base.scope = { leases: hash.leases, cars: hash.cars, carData: hash.carData };
    base.activeMode = hash.active;
    base.page = hash.page;
    base.ps = hash.ps;
    base.type = hash.type;
    base.mech = hash.mech;
    base.aar = hash.aar;
    base.entity = hash.entity;
    base.status = hash.status;
    base.sort = hash.sort;
    base.dir = hash.dir;
    base.exactFleet = hash.fleet;
    base.viewId = Number(hash.view) > 0 ? Number(hash.view) : null;
    base.openStop = hash.openStop;
    base.program = hash.program;
    base.tag = hash.tag;
    base.sid = hash.sid;
  } else if (hash.view || hash.openStop || hash.program || hash.tag) {
    base.viewId = Number(hash.view) > 0 ? Number(hash.view) : null;
    base.openStop = hash.openStop;
    base.program = hash.program;
    base.tag = hash.tag;
    base.sid = hash.sid;
    base.scope = { leases: hash.leases, cars: hash.cars, carData: hash.carData };
    base.activeMode = hash.active;
    base.page = hash.page;
    base.ps = hash.ps;
    base.type = hash.type;
    base.mech = hash.mech;
    base.aar = hash.aar;
    base.entity = hash.entity;
    base.status = hash.status;
    base.sort = hash.sort;
    base.dir = hash.dir;
    base.exactFleet = hash.fleet;
  }
  return base;
}

function FilterText({
  label,
  value,
  onCommit,
  testId,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft.trim()); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(draft.trim());
          }
        }}
        className="h-7 w-24 rounded border border-border bg-card px-2 text-xs text-foreground"
        data-testid={testId}
      />
    </label>
  );
}

function SummaryBits({
  summary,
  onType,
  onEntity,
  onStatus,
}: {
  summary: Summary;
  onType: (key: string) => void;
  onEntity: (key: string) => void;
  onStatus: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chip = "underline-offset-2 hover:underline";
  const take = (rows: { key: string; count: number }[]) => (open ? rows : rows.slice(0, 8));
  return (
    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="search-summary">
      <span className="text-foreground font-medium">{summary.total.toLocaleString()} cars</span>
      {summary.by_type.length > 0 && <span>· by type:</span>}
      {take(summary.by_type).map((row) => (
        <button key={`t-${row.key}`} type="button" className={chip} onClick={() => onType(row.key === "—" ? "" : row.key)}>
          {row.key} {row.count.toLocaleString()}
        </button>
      ))}
      {summary.by_entity.length > 0 && <span>· by owner:</span>}
      {take(summary.by_entity).map((row) => (
        <button key={`e-${row.key}`} type="button" className={chip} onClick={() => onEntity(row.key === "—" ? "" : row.key)}>
          {ENTITY_STYLES[row.key]?.label ?? row.key} {row.count.toLocaleString()}
        </button>
      ))}
      {summary.by_status.length > 0 && <span>· by status:</span>}
      {take(summary.by_status).map((row) => (
        <button key={`s-${row.key}`} type="button" className={chip} onClick={() => onStatus(row.key === "—" ? "" : row.key)}>
          {row.key} {row.count.toLocaleString()}
        </button>
      ))}
      {(summary.by_type.length > 8 || summary.by_entity.length > 8 || summary.by_status.length > 8) && (
        <button type="button" className={chip} onClick={() => setOpen((v) => !v)}>{open ? "Show fewer" : "Show all"}</button>
      )}
    </div>
  );
}

export default function SearchPage() {
  const bootRef = useRef<Boot | null>(null);
  if (!bootRef.current) bootRef.current = readBoot();
  const boot = bootRef.current;
  const [query, setQuery] = useState(boot.query);
  const [committed, setCommitted] = useState(boot.committed);
  const [scope, setScope] = useState<SearchScope>(boot.scope);
  const [activeMode, setActiveMode] = useState<SearchActive>(boot.activeMode);
  const [page, setPage] = useState(boot.page);
  const [ps, setPs] = useState<number | "all">(boot.ps);
  const [typeFilter, setTypeFilter] = useState(boot.type);
  const [mechFilter, setMechFilter] = useState(boot.mech);
  const [aarFilter, setAarFilter] = useState(boot.aar);
  const [entityFilter, setEntityFilter] = useState(boot.entity);
  const [statusFilter, setStatusFilter] = useState(boot.status);
  const [sort, setSort] = useState(boot.sort);
  const [dir, setDir] = useState<"asc" | "desc">(boot.dir);
  const [exactFleet, setExactFleet] = useState(boot.exactFleet);
  const [pasteRows, setPasteRows] = useState<any[] | null>(boot.pasteRows);
  const [pasteMeta, setPasteMeta] = useState<PasteMeta | null>(boot.pasteMeta);
  const [cachedTextRows, setCachedTextRows] = useState<any[]>(boot.textRows);
  const [cachedTextTotal, setCachedTextTotal] = useState(boot.textTotal);
  const [cachedSummary, setCachedSummary] = useState<Summary | null>(boot.summary);
  const [cachedMatch, setCachedMatch] = useState<FleetMatch>(boot.match);
  const [live, setLive] = useState(!boot.fromCache);
  const [scrollTick, setScrollTick] = useState(0);
  const [pasteLoading, setPasteLoading] = useState(
    () => !boot.fromCache && Boolean(boot.committed && carListSearchTokens(boot.committed)),
  );
  const [error, setError] = useState<string | null>(null);
  const [editCarId, setEditCarId] = useState<number | null>(null);
  const [leaseGlance, setLeaseGlance] = useState<LeaseGlanceRider | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(boot.selection));
  const [viewId, setViewId] = useState<number | null>(boot.viewId);
  const [openStop, setOpenStop] = useState(boot.openStop);
  const [programFilter, setProgramFilter] = useState(boot.program);
  const [tagFilter, setTagFilter] = useState(boot.tag);
  const [density, setDensity] = useState<"comfortable" | "compact">(
    boot.draft && boot.draft.viewId === boot.viewId ? boot.draft.density : "comfortable",
  );
  const [panelOpen, setPanelOpen] = useState(
    Boolean(boot.draft && boot.draft.viewId === boot.viewId && !boot.draft.panelCollapsed),
  );
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewSummary | null>(null);
  const [viewLayout, setViewLayout] = useState<ViewLayout | null>(null);
  const [viewDirty, setViewDirty] = useState(Boolean(boot.draft?.dirty && boot.draft.viewId === boot.viewId));
  const [sessionLayout, setSessionLayout] = useState<ViewLayout | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(readViewsSidebarOpen);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const canEdit = useCanEdit();
  const isAdmin = useIsAdmin();
  const { user } = useAuth();
  const sidRef = useRef(boot.sid);
  const scrollRef = useRef(boot.scrollY);
  const pendingScroll = useRef<number | null>(boot.restoreScroll ? boot.scrollY : null);
  const committedRef = useRef(boot.committed);
  const lastSeenHash = useRef(typeof window === "undefined" ? "" : window.location.hash);
  const hashBooted = useRef(false);
  const replaceFromView = useRef<number | null>(null);
  const savingLock = useRef(false);
  const pendingLayout = useRef<ViewLayout | null>(null);
  const appliedView = useRef<number | null>(null);
  const pasteFocusSeen = useRef(false);
  const suppressDirty = useRef(false);
  committedRef.current = committed;
  const { toast } = useToast();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const colPrefs = useColumnPrefs("search_results", SEARCH_DEFAULT_COLS);
  const { visibleCols: visibleColsRaw, colOrder, setColOrder, colWidths, setColWidth } = colPrefs;
  const visibleCols = visibleColsRaw as Set<OptCol>;

  const fixedMode = activeView?.kind === "fixed" && Boolean(viewId);
  const isPaste = Boolean(!fixedMode && committed && carListSearchTokens(committed));
  const pageSize = pageSizeNumber(ps);
  const listParams = {
    page,
    pageSize,
    search: committed || undefined,
    active: activeMode,
    search_cars: scope.cars ? 1 : 0,
    search_leases: scope.leases ? 1 : 0,
    search_car_data: scope.carData ? 1 : 0,
    sort: sort !== "car_number" && !isFocusColumn(sort) ? sort : undefined,
    dir: dir === "desc" ? "desc" : undefined,
    type: typeFilter || undefined,
    mech: mechFilter || undefined,
    aar: aarFilter || undefined,
    entity: entityFilter || undefined,
    status: statusFilter || undefined,
    fleet: exactFleet ? 1 : undefined,
    open_stop: openStop || undefined,
    program: programFilter || undefined,
    tag: tagFilter || undefined,
    view_id: viewId || undefined,
    focus: layoutNeedsFocus(viewLayout?.order?.length ? viewLayout.order : Array.from(visibleCols)) ? 1 : undefined,
  };

  const queryViewLive = activeView?.kind === "query" && Boolean(viewId);
  const textSearchLive = (Boolean(committed) || queryViewLive) && !isPaste && !fixedMode && live;
  const textQuery = useQuery<RailcarPage>({
    queryKey: ["/api/railcars", "search-page", listParams],
    queryFn: ({ signal }) => apiGet<RailcarPage>(railcarsQs(listParams), { timeoutMs: 20_000, signal }),
    enabled: textSearchLive,
    staleTime: FLEET_STALE_MS,
  });
  const summaryParams = { ...listParams, page: undefined, pageSize: undefined };
  const summaryQuery = useQuery<Summary & { match?: FleetMatch }>({
    queryKey: ["/api/railcars/summary", "search-page", summaryParams],
    queryFn: ({ signal }) => apiGet(railcarsQs(summaryParams).replace("/api/railcars", "/api/railcars/summary"), { timeoutMs: 20_000, signal }),
    enabled: textSearchLive,
    staleTime: FLEET_STALE_MS,
  });
  const peopleQuery = useQuery<DirectoryPage>({
    queryKey: ["/api/directory-search", "from-search", committed],
    queryFn: ({ signal }) =>
      apiGet<DirectoryPage>(`/api/directory-search?q=${encodeURIComponent(committed.trim())}&page=1&pageSize=8`, { timeoutMs: 20_000, signal }),
    enabled: Boolean(committed) && !isPaste && !fixedMode && live && committed.trim().length >= 2,
    staleTime: 30_000,
  });

  const viewsQuery = useQuery<{ schema_ready: boolean; message?: string; views: ViewSummary[] }>({
    queryKey: ["/api/views"],
    queryFn: ({ signal }) => apiGet("/api/views", { timeoutMs: 20_000, signal }),
    staleTime: 15_000,
  });
  const views = viewsQuery.data?.schema_ready ? viewsQuery.data.views : [];
  const pinIds = views.filter((view) => view.pinned).sort(comparePinnedOrder).map((view) => view.id).slice(0, 12);
  const countsQuery = useQuery<{ counts: Record<string, { count: number; active: number; inactive: number; ms: number } | null> }>({
    queryKey: ["/api/views/counts", pinIds.join(",")],
    queryFn: ({ signal }) => apiGet(`/api/views/counts?ids=${pinIds.join(",")}`, { timeoutMs: 20_000, signal }),
    enabled: pinIds.length > 0 && viewsQuery.data?.schema_ready === true,
    staleTime: 60_000,
  });
  const detailQuery = useQuery<ViewDetail>({
    queryKey: ["/api/views", viewId],
    queryFn: ({ signal }) => apiGet(`/api/views/${viewId}`, { timeoutMs: 20_000, signal }),
    enabled: Boolean(viewId) && viewsQuery.data?.schema_ready === true,
  });
  const fixedQuery = useQuery<any[] | { rows?: any[] }>({
    queryKey: ["/api/railcars", "view-fixed", viewId, listParams.focus],
    queryFn: ({ signal }) => apiGet(railcarsQs({ view_id: viewId, all: 1, active: "all", focus: listParams.focus }), { timeoutMs: 20_000, signal }),
    enabled: fixedMode && viewsQuery.data?.schema_ready === true,
  });

  const filterBag = {
    type: typeFilter,
    mech: mechFilter,
    aar: aarFilter,
    entity: entityFilter,
    status: statusFilter,
    active: activeMode,
    openStop,
    program: programFilter,
    tag: tagFilter,
  };
  const filteredPaste = useMemo(() => {
    return (pasteRows ?? []).filter((r) => matchesSearchFilters(r, { ...filterBag, active: "all", openStop: "", program: "", tag: "" }));
  }, [pasteRows, typeFilter, mechFilter, aarFilter, entityFilter, statusFilter]);
  const filteredFixed = useMemo(() => {
    return asRailcarList(fixedQuery.data).filter((r) => matchesSearchFilters(r, filterBag));
  }, [fixedQuery.data, typeFilter, mechFilter, aarFilter, entityFilter, statusFilter, activeMode, openStop, programFilter, tagFilter]);

  const unsortedRows = fixedMode
    ? filteredFixed
    : isPaste
      ? filteredPaste
      : live
        ? (textQuery.data?.rows ?? [])
        : cachedTextRows;
  const knownTotal = fixedMode
    ? filteredFixed.length
    : isPaste
      ? filteredPaste.length
      : (summaryQuery.data?.total ?? (live ? textQuery.data?.total_count : cachedTextTotal) ?? 0);
  const fullSetLoaded = fixedMode || isPaste || (knownTotal > 0 && knownTotal <= 2000 && unsortedRows.length >= knownTotal);
  const rows = (fixedMode || isPaste || (isFocusColumn(sort) && fullSetLoaded))
    ? sortRows(unsortedRows, sort, dir)
    : unsortedRows;
  const summary = fixedMode
    ? summarize(filteredFixed)
    : isPaste
      ? summarize(filteredPaste)
      : live
        ? (summaryQuery.data ?? null)
        : cachedSummary;
  const match: FleetMatch = fixedMode || isPaste ? null : live ? (textQuery.data?.match ?? summaryQuery.data?.match ?? null) : cachedMatch;
  // Summary counts every matching row. The list endpoint's total is an estimate, so the
  // breadcrumb, pager, and summary chips share the summary total once it has loaded.
  const totalCount = fixedMode
    ? filteredFixed.length
    : isPaste
      ? filteredPaste.length
      : (summary?.total ?? (live ? (textQuery.data?.total_count ?? 0) : cachedTextTotal));
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const loading = fixedMode
    ? fixedQuery.isFetching && !fixedQuery.data
    : isPaste
      ? pasteLoading
      : live && textQuery.isFetching && !textQuery.data;
  const pageRows = fixedMode || isPaste ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;
  const peopleRows = peopleQuery.data?.rows ?? [];
  const peopleTotal = peopleQuery.data?.total_count ?? 0;
  const alias = classifyFleetQuery(committed);
  const matchLabel = match?.label || (alias.kind === "alias" ? `Matched rule: ${alias.rule.label}` : "");

  function ensureSid() {
    if (!sidRef.current) sidRef.current = createSearchSid();
    return sidRef.current;
  }

  function hashState(): SearchHashState {
    return {
      q: committed,
      paste: false,
      cars: scope.cars,
      leases: scope.leases,
      carData: scope.carData,
      type: typeFilter,
      mech: mechFilter,
      aar: aarFilter,
      entity: entityFilter,
      status: statusFilter,
      active: activeMode,
    fleet: exactFleet,
    view: viewId ? String(viewId) : "",
    openStop,
    program: programFilter,
    tag: tagFilter,
    sort,
      dir,
      page,
      ps,
      sid: ensureSid(),
    };
  }

  function searchQueryString() {
    const hash = hashState();
    return `from=search&sid=${encodeURIComponent(hash.sid)}&return=${encodeURIComponent(encodeHash(hash))}`;
  }

  function withFrom(path: string) {
    const join = path.includes("?") ? "&" : "?";
    return `${path}${join}${searchQueryString()}`;
  }

  function rememberScroll() {
    const el = scrollParent();
    if (el) scrollRef.current = el.scrollTop;
  }

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (boot.fromCache) return;
    if (boot.committed && carListSearchTokens(boot.committed)) {
      void runPaste(boot.committed, boot.scope, boot.activeMode);
    }
    // Initial paste only. Text search is the react-query below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollParent();
    if (!el) return;
    if (pendingScroll.current != null && !loading && pageRows.length > 0) {
      const y = pendingScroll.current;
      pendingScroll.current = null;
      requestAnimationFrame(() => { el.scrollTop = y; });
    }
    let timer = 0;
    const onScroll = () => {
      scrollRef.current = el.scrollTop;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!committed || !sidRef.current) return;
        const existing = loadSearchState(sidRef.current);
        if (!existing) return;
        const { sid: _sid, timestamp: _timestamp, ...rest } = existing;
        saveSearchState(sidRef.current, { ...rest, scrollY: el.scrollTop });
      }, 200);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, [committed, loading, pageRows.length, scrollTick]);

  const draft = parseCarPasteListDetailed(query);
  const draftCount = draft.tokens.filter(looksLikeCarToken).length;

  useEffect(() => {
    if (!committed && !viewId) return;
    const external = decodeHash(window.location.hash);
    if (window.location.hash !== lastSeenHash.current && shouldRebootSearch({ q: committed, sid: sidRef.current, view: viewId ? String(viewId) : "" }, { ...external, view: external.view })) {
      return;
    }
    const hash = hashState();
    const path = encodeHash(hash);
    lastSeenHash.current = `#${path}`;
    if (window.location.hash !== `#${path}`) navigateHash(path, { replace: true });
    const ready = !live || (fixedMode ? Boolean(fixedQuery.data) || fixedQuery.isError : isPaste ? !pasteLoading : textQuery.isFetched || textQuery.isError);
    const results: StoredSearchResults = isPaste
      ? {
          mode: "paste",
          rows: pasteRows ?? [],
          total: pasteRows?.length ?? 0,
          summary,
          notFound: pasteMeta?.notFound ?? [],
          inactiveMatches: pasteMeta?.inactive ?? [],
          ambiguous: pasteMeta?.ambiguous ?? [],
          counts: pasteMeta?.counts ?? null,
          match: null,
          truncated: Boolean(pasteMeta?.truncated),
          rejectedRanges: draft.rejectedRanges,
          expandedFrom: draft.expandedFrom,
        }
      : {
          mode: "text",
          rows,
          total: totalCount,
          summary,
          notFound: [],
          inactiveMatches: [],
          ambiguous: [],
          counts: { railcars: totalCount },
          match,
          truncated: false,
          rejectedRanges: [],
          expandedFrom: [],
        };
    saveSearchState(hash.sid, {
      hash,
      pastedText: committed,
      ids: (fixedMode ? filteredFixed : isPaste ? pasteRows ?? [] : rows).map((r) => Number(r.id)).filter((n) => n > 0),
      selection: Array.from(selected),
      scrollY: scrollRef.current,
      results,
      ready,
      draft: viewId
        ? {
            viewId,
            dirty: viewDirty,
            density,
            panelCollapsed: !panelOpen,
            cols: viewLayout?.cols ?? [],
            order: viewLayout?.order ?? [],
            widths: viewLayout?.widths ?? {},
          }
        : null,
    });
    saveSearchSession({
      query: committed,
      results: {
        railcars: isPaste ? (pasteRows ?? []) : [],
        not_found: pasteMeta?.notFound ?? [],
        riders: [],
        leases: [],
        counts: { railcars: totalCount, riders: 0, leases: 0, total: totalCount },
      },
      filters: {
        active: activeMode,
        rental: "all",
        lessee: "all",
        ol: "all",
        showInactive: activeMode !== "active",
        scopeLeases: scope.leases,
        scopeCars: scope.cars,
        scopeCarData: scope.carData,
      } as any,
    });
    // hashState closes over the latest filters; listing them keeps the hash in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, viewId, openStop, programFilter, tagFilter, page, ps, activeMode, exactFleet, scope, typeFilter, mechFilter, aarFilter, entityFilter, statusFilter, sort, dir, pasteRows, pasteMeta, selected, live, pasteLoading, textQuery.data, textQuery.isFetched, summaryQuery.data, totalCount, viewDirty, density, panelOpen, viewLayout, fixedMode, filteredFixed]);

  function applyBoot(next: Boot) {
    sidRef.current = next.sid;
    scrollRef.current = next.scrollY;
    pendingScroll.current = next.restoreScroll ? next.scrollY : null;
    committedRef.current = next.committed;
    setQuery(next.query);
    setCommitted(next.committed);
    setScope(next.scope);
    setActiveMode(next.activeMode);
    setPage(next.page);
    setPs(next.ps);
    setTypeFilter(next.type);
    setMechFilter(next.mech);
    setAarFilter(next.aar);
    setEntityFilter(next.entity);
    setStatusFilter(next.status);
    setSort(next.sort);
    setDir(next.dir);
    setExactFleet(next.exactFleet);
    setViewId(next.viewId);
    setOpenStop(next.openStop);
    setProgramFilter(next.program);
    setTagFilter(next.tag);
    if (next.draft && next.draft.viewId === next.viewId) {
      setDensity(next.draft.density);
      setPanelOpen(!next.draft.panelCollapsed);
      setViewDirty(next.draft.dirty);
    } else {
      setViewDirty(false);
    }
    setPasteRows(next.pasteRows);
    setPasteMeta(next.pasteMeta);
    setCachedTextRows(next.textRows);
    setCachedTextTotal(next.textTotal);
    setCachedSummary(next.summary);
    setCachedMatch(next.match);
    setSelected(new Set(next.selection));
    setLive(!next.fromCache);
    setPasteLoading(false);
    setError(null);
    setScrollTick((n) => n + 1);
    if (!next.fromCache && next.committed && carListSearchTokens(next.committed)) {
      void runPaste(next.committed, next.scope, next.activeMode);
    }
  }

  const hashQs = useHashSearch();
  useEffect(() => {
    if (!hashBooted.current) {
      hashBooted.current = true;
      return;
    }
    if (window.location.hash === lastSeenHash.current) return;
    const hash = decodeHash(window.location.hash);
    lastSeenHash.current = window.location.hash;
    if (!shouldRebootSearch({ q: committedRef.current, sid: sidRef.current, view: viewId ? String(viewId) : "" }, { q: hash.q, sid: hash.sid, view: hash.view })) return;
    applyBoot(readBoot());
    // Re-read when the top bar or Back/Forward changes q or sid. Filter edits stay on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashQs]);

  useEffect(() => {
    if (viewsQuery.data?.schema_ready === false) setSchemaMessage(viewsQuery.data.message || SAVED_VIEWS_SCHEMA_MESSAGE);
    else if (viewsQuery.isError) setSchemaMessage(VIEWS_UNAVAILABLE_MESSAGE);
    else if (viewsQuery.data?.schema_ready) setSchemaMessage(null);
  }, [viewsQuery.data, viewsQuery.isError]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      event.preventDefault();
      setPanelOpen(true);
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const detail = detailQuery.data;
    if (!detail || !viewId || detail.id !== viewId) return;
    setActiveView({
      id: detail.id,
      name: detail.name,
      kind: detail.kind,
      description: detail.description,
      shared: detail.shared,
      pinned: detail.pinned,
      pin_order: detail.pin_order,
      owner: detail.owner,
      owner_name: detail.owner_name,
      updated_by_name: detail.updated_by_name,
      updated_at: detail.updated_at,
      updated_at_et: detail.updated_at_et,
      member_count: detail.member_count,
      query: detail.query,
      layout: detail.layout,
    });
    const opening = replaceFromView.current === detail.id;
    const stored = loadSearchState(sidRef.current)?.draft;
    const keepDraft = !opening && stored?.dirty && stored.viewId === detail.id;
    const install = opening || (!keepDraft && appliedView.current !== detail.id);
    if (install) {
      appliedView.current = detail.id;
      suppressDirty.current = true;
      const layout = pendingLayout.current ?? detail.layout;
      pendingLayout.current = null;
      applyLayout(layout, detail.kind === "query" ? detail.query : null);
      if (detail.kind === "fixed") {
        setCommitted("");
        setQuery(detail.query?.q ?? "");
        setPasteRows(null);
        setPasteMeta(null);
      } else {
        const q = openedViewQuery(detail.kind, detail.query);
        const already = committedRef.current === q;
        setQuery(q);
        setCommitted(q);
        if (!already) {
          setPasteRows(null);
          setPasteMeta(null);
          if (q && carListSearchTokens(q)) {
            void runPaste(q, detail.query?.scope ?? { cars: true, leases: true, carData: false }, layout.filters?.active || "active");
          }
        }
      }
      setViewDirty(false);
      replaceFromView.current = null;
      suppressDirty.current = false;
      return;
    }
    if (keepDraft && stored) {
      setViewLayout({
        ...detail.layout,
        cols: stored.cols.length ? stored.cols : detail.layout.cols,
        order: stored.order.length ? stored.order : detail.layout.order,
        widths: stored.widths,
        density: stored.density,
        panelCollapsed: stored.panelCollapsed,
      });
      setDensity(stored.density);
      setPanelOpen(!stored.panelCollapsed);
      setViewDirty(true);
    } else {
      setViewLayout(detail.layout);
      setDensity(detail.layout.density ?? "comfortable");
    }
    if (detail.kind === "query" && !committedRef.current && detail.query?.q) {
      setQuery(detail.query.q);
      setCommitted(detail.query.q);
      setExactFleet(detail.query.fleet !== false);
      if (detail.query.scope) setScope(detail.query.scope);
      setLive(true);
    }
  }, [detailQuery.data, viewId]);

  function markDirty() {
    if (suppressDirty.current || !viewId) return;
    setViewDirty(true);
  }

  function currentFilters(): ViewFilters {
    return {
      ...emptyViewFilters(activeMode),
      type: typeFilter,
      mech: mechFilter,
      aar: aarFilter,
      entity: entityFilter,
      status: statusFilter,
      active: activeMode,
      open_stop: (openStop || "") as ViewFilters["open_stop"],
      program: programFilter,
      tag: tagFilter,
    };
  }

  function layoutSnapshot(preset?: ViewLayout): ViewLayout {
    if (preset) return preset;
    const rawOrder = (viewId && viewLayout?.order.length ? viewLayout.order : displayKeys).filter((key) => key !== "_actions");
    const order = fixedMode ? withFocusColumnsAfterIdentity(rawOrder) : withLeadingIdentityColumns(rawOrder);
    const pageSizeValue = ps === "all" || ps === 500 ? 500 : ps === 200 ? 200 : 75;
    return {
      v: 1,
      cols: order,
      order,
      widths: { ...(viewLayout?.widths ?? {}), ...colWidths },
      sort: sort ? { key: sort, dir } : null,
      filters: currentFilters(),
      pageSize: pageSizeValue,
      showInactive: activeMode !== "active",
      panelCollapsed: !panelOpen,
      density,
    };
  }

  function applyLayout(layout: ViewLayout, query: ViewQuery | null) {
    suppressDirty.current = true;
    setViewLayout(layout);
    setDensity(layout.density ?? "comfortable");
    setPanelOpen(layout.panelCollapsed === false);
    const filters = layout.filters ?? emptyViewFilters();
    setTypeFilter(filters.type || "");
    setMechFilter(filters.mech || "");
    setAarFilter(filters.aar || "");
    setEntityFilter(filters.entity || "");
    setStatusFilter(filters.status || "");
    setActiveMode(filters.active || "active");
    setOpenStop(filters.open_stop || "");
    setProgramFilter(filters.program || "");
    setTagFilter(filters.tag || "");
    if (layout.sort?.key) {
      setSort(layout.sort.key);
      setDir(layout.sort.dir === "desc" ? "desc" : "asc");
    }
    setPs(layout.pageSize === 500 ? 500 : layout.pageSize === 200 ? 200 : 75);
    setPage(1);
    if (query) {
      setExactFleet(query.fleet !== false);
      setScope(query.scope ?? { ...DEFAULT_SCOPE });
    }
    setLive(true);
    suppressDirty.current = false;
  }

  function openView(id: number) {
    if (id === viewId) return;
    const summary = views.find((view) => view.id === id);
    replaceFromView.current = id;
    setViewId(id);
    setPage(1);
    setSelected(new Set());
    setLive(true);
    setError(null);
    ensureSid();
    if (summary) setActiveView(summary);
    if (summary?.layout) applyLayout(summary.layout, summary.kind === "query" ? summary.query ?? null : null);
    if (!summary) return;
    if (summary.kind === "fixed") {
      setCommitted("");
      setQuery(summary.query?.q ?? "");
      setPasteRows(null);
      setPasteMeta(null);
      return;
    }
    const q = openedViewQuery(summary.kind, summary.query);
    setQuery(q);
    setCommitted(q);
    setPasteRows(null);
    setPasteMeta(null);
    if (q && carListSearchTokens(q)) {
      void runPaste(q, summary.query?.scope ?? scope, summary.layout?.filters.active || activeMode);
    }
  }

  function focusLayoutKeys(): string[] {
    if (viewLayout?.order?.length) return viewLayout.order;
    if (sessionLayout?.order?.length) return sessionLayout.order;
    return Array.from(visibleCols);
  }

  async function runPaste(q: string, nextScope: SearchScope, nextActive: SearchActive) {
    setPasteLoading(true);
    setError(null);
    setLive(true);
    try {
      const res = await apiRequest("POST", "/api/search", pasteSearchBody({
        q,
        active: nextActive,
        scope: nextScope,
        layoutKeys: focusLayoutKeys(),
        viewId,
      }));
      const data = await res.json();
      const notFound = data.not_found ?? [];
      const inactive = data.inactive_matches ?? [];
      const ambiguous = data.ambiguous ?? [];
      setPasteRows(data.railcars ?? []);
      setPasteMeta({
        notFound,
        inactive,
        ambiguous,
        truncated: Boolean(data.truncated),
        counts: {
          pasted: data.counts?.pasted ?? carListSearchTokens(q)?.length ?? 0,
          found: data.counts?.railcars ?? (data.railcars?.length ?? 0),
          inactive: data.counts?.inactive ?? inactive.length,
          not_found: data.counts?.not_found ?? notFound.length,
          ambiguous: data.counts?.ambiguous ?? ambiguous.length,
        },
      });
      setCommitted(q);
    } catch (e: any) {
      setError(e.message ?? "Search failed");
    } finally {
      setPasteLoading(false);
    }
  }

  function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (activeView?.kind === "fixed") {
      setViewId(null);
      setActiveView(null);
      setViewLayout(null);
      setViewDirty(false);
    } else if (viewId) {
      markDirty();
    }
    setPage(1);
    setSelected(new Set());
    setError(null);
    setExactFleet(true);
    if (carListSearchTokens(trimmed)) void runPaste(trimmed, scope, activeMode);
    else {
      setPasteRows(null);
      setPasteMeta(null);
      setLive(true);
      setCommitted(trimmed);
    }
  }

  const pasteFocus = layoutNeedsFocus(focusLayoutKeys()) ? 1 : 0;
  useEffect(() => {
    if (!pasteFocusSeen.current) {
      pasteFocusSeen.current = true;
      return;
    }
    const q = committedRef.current;
    if (!q || !carListSearchTokens(q)) return;
    void runPaste(q, scope, activeMode);
    // Re-paste when a focus column is turned on. The first run is the boot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteFocus]);

  function clear() {
    sidRef.current = "";
    setQuery("");
    setCommitted("");
    setExactFleet(true);
    setPasteRows(null);
    setPasteMeta(null);
    setError(null);
    setPage(1);
    setSelected(new Set());
    setLive(true);
    setViewId(null);
    setActiveView(null);
    setViewLayout(null);
    setViewDirty(false);
    setOpenStop("");
    setProgramFilter("");
    setTagFilter("");
    setSessionLayout(null);
    clearSearchSession();
    navigateHash("/search", { replace: true });
    inputRef.current?.focus();
  }

  function touchFilters() {
    setPage(1);
    setLive(true);
    markDirty();
  }

  function setScopeFlag(key: keyof SearchScope, next: boolean) {
    if (!next && !Object.entries(scope).some(([k, v]) => k !== key && v)) return;
    const nextScope = { ...scope, [key]: next };
    setScope(nextScope);
    touchFilters();
    if (committed && carListSearchTokens(committed)) void runPaste(committed, nextScope, activeMode);
  }

  function changeActive(next: SearchActive) {
    setActiveMode(next);
    touchFilters();
    if (committed && carListSearchTokens(committed)) void runPaste(committed, scope, next);
  }

  function filterLabel() {
    return [
      `active=${activeMode}`,
      typeFilter && `type=${typeFilter}`,
      mechFilter && `mech=${mechFilter}`,
      aarFilter && `aar=${aarFilter}`,
      entityFilter && `entity=${entityFilter}`,
      statusFilter && `status=${statusFilter}`,
      scope.carData ? "car data on" : "",
    ].filter(Boolean).join(", ");
  }

  async function loadExportRows() {
    if (isPaste) {
      const ids = filteredPaste.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0).slice(0, EXPORT_CAP);
      if (!ids.length) return [];
      return asRailcarList(await apiGet<any[] | { rows?: any[] }>(railcarsQs({
        all: 1,
        ids: ids.join(","),
        active: "all",
        focus: layoutNeedsFocus(exportKeys) ? 1 : undefined,
        view_id: viewId || undefined,
      }), { timeoutMs: 60_000 }));
    }
    const all = asRailcarList(await apiGet<any[] | { rows?: any[] }>(railcarsQs({ ...listParams, page: undefined, pageSize: undefined, all: 1 }), { timeoutMs: 60_000 }));
    return all.slice(0, EXPORT_CAP);
  }

  async function loadAllSearchCars() {
    return asRailcarList(await apiGet<any[] | { rows?: any[] }>(
      railcarsQs({ ...listParams, page: undefined, pageSize: undefined, all: 1 }),
      { timeoutMs: 60_000 },
    ));
  }

  async function exportResults(kind: "xlsx" | "csv") {
    if (totalCount === 0) return;
    setExporting(true);
    try {
      const exported = await loadExportRows();
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "csv") {
        downloadRailcarsCsv(exported, `search_results_${stamp}.csv`, { keys: exportKeys });
        return;
      }
      await downloadSearchXlsx(exported, exportKeys, {
        query: committed,
        filters: filterLabel(),
        notFound: pasteMeta?.notFound ?? [],
        inactive: pasteMeta?.inactive ?? [],
        ambiguous: pasteMeta?.ambiguous ?? [],
        summary: summary ?? summarize(exported),
      }, `search_results_${stamp}.xlsx`);
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message ?? "Could not export search results", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  async function copyList(text: string, title: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  const displayKeys = useMemo(() => {
    const layoutOrder = (viewId ? viewLayout?.order : sessionLayout?.order) ?? [];
    if (layoutOrder.length) {
      const keys = layoutOrder.filter((key) => key !== "_actions" && key !== "_select");
      const order = fixedMode ? withFocusColumnsAfterIdentity(keys) : withLeadingIdentityColumns(keys);
      return [...order, ...PINNED_END];
    }
    const movable = [...CORE_MOVABLE, ...OPT_COLS.filter((c) => visibleCols.has(c.key)).map((c) => c.key)];
    return [...PINNED_START, ...mergeColOrder(movable, colOrder), ...PINNED_END];
  }, [viewId, viewLayout, sessionLayout, visibleCols, colOrder, fixedMode]);
  const exportKeys = displayKeys.filter((key) => key !== "_actions" && key !== "_select");
  const movableKeys = displayKeys.filter((k) => k !== "_actions" && (!(viewId || sessionLayout) ? !(PINNED_START as readonly string[]).includes(k) && !(PINNED_END as readonly string[]).includes(k) : true));
  const pasteCount = pasteMeta?.counts.pasted ?? (committed ? carListSearchTokens(committed)?.length ?? 0 : 0);
  const committedLabel = pasteCount > 1 ? `${pasteCount} cars` : `"${committed}"`;
  const crumbQuery = pasteCount > 1 ? `${pasteCount} cars` : committed.length > 48 ? `${committed.slice(0, 48)}…` : committed;
  const missing = pasteMeta?.notFound ?? [];
  const ambiguous = pasteMeta?.ambiguous ?? [];
  const hasResults = (Boolean(committed) || Boolean(viewId)) && (totalCount > 0 || missing.length > 0 || ambiguous.length > 0 || peopleRows.length > 0);
  const noResults = (Boolean(committed) || Boolean(viewId)) && !loading && !peopleQuery.isFetching && !peopleQuery.isError && totalCount === 0 && missing.length === 0 && ambiguous.length === 0 && peopleRows.length === 0;
  const loadError = fixedQuery.isError
    ? ((fixedQuery.error as Error)?.message || "Could not load this view")
    : !isPaste && textQuery.isError
      ? ((textQuery.error as Error)?.message || "Search failed")
      : error;
  const editRow = editCarId == null ? null : (rows.find((r) => r.id === editCarId) ?? (pasteRows ?? []).find((r) => r.id === editCarId) ?? null);

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cell(key: string, r: any) {
    const compact = density === "compact";
    const pad = compact ? "px-3 py-1" : "px-4 py-3";
    const shownByLayout = Boolean((viewId ? viewLayout : sessionLayout)?.order.includes(key));
    if (key === "view_note" && (shownByLayout || visibleCols.has("view_note"))) {
      return (
        <ViewNoteCell
          key={key}
          value={String(r.view_note ?? "")}
          compact={compact}
          readOnly={!canEdit || !fixedMode || r.active === false}
          onSave={(note) => { void saveMemberNote(Number(r.id), note); }}
        />
      );
    }
    if (OPT_COLS.some((c) => c.key === key) && (shownByLayout || visibleCols.has(key as OptCol))) return renderOptTd(key, r, compact);
    switch (key) {
      case "entity":
        return <td key={key} className={`${pad} font-mono-num text-muted-foreground`}><EntityBadge entity={r.entity} /></td>;
      case "marks":
        return <td key={key} className={cn(`${pad} font-mono-num text-muted-foreground hidden sm:table-cell`, stickyClass(key))} style={stickyStyle(key)}>{r.reporting_marks ?? "—"}</td>;
      case "car_number":
        return (
          <td key={key} className={cn(`${pad} font-mono-num font-medium`, stickyClass(key))} style={stickyStyle(key)}>
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={withFrom(`/cars/${r.id}`)}
                className="hover:text-primary hover:underline"
                onClick={(e) => { e.stopPropagation(); rememberScroll(); }}
              >
                {r.car_number}
              </Link>
              <FleetMembershipBadge active={r.active} />
              <FormerlyBadge formerly={r.formerly} />
            </div>
          </td>
        );
      case "lease_type":
        return (
          <td key={key} className={pad}>
            <LeaseTypeBadge carType={r.lease_type} mlaType={r.assignment?.rider?.master_lease?.lease_type} />
          </td>
        );
      case "type":
        return <td key={key} className={`${pad} text-muted-foreground hidden sm:table-cell`}>{r.car_type ?? "—"}</td>;
      case "status":
        return (
          <td key={key} className={pad}>
            <RentalStatusCell row={r} />
          </td>
        );
      case "lessee":
        return <td key={key} className="px-4 py-3">{r.assignment?.fleet_name ?? r.lessee_name ?? <span className="text-muted-foreground">Unassigned</span>}</td>;
      case "rider":
        return (
          <td key={key} className="px-4 py-3 text-muted-foreground">
            {r.assignment?.rider ? (
              <button
                type="button"
                className="text-left hover:text-primary hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  const glance = glanceRiderFromCar(r);
                  if (glance) setLeaseGlance(glance);
                }}
              >
                {r.assignment?.rider?.rider_name ?? r.rider_external_id ?? "—"}
              </button>
            ) : (r.rider_external_id ?? "—")}
          </td>
        );
      case "lease":
        return (
          <td key={key} className="px-4 py-3 font-mono-num text-muted-foreground">
            {r.assignment?.rider?.master_lease ? (
              <button
                type="button"
                className="text-left hover:text-primary hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  const glance = glanceRiderFromCar(r);
                  if (glance) setLeaseGlance(glance);
                }}
              >
                {displayLeaseNumber(r.assignment?.rider?.master_lease?.lease_number) || "—"}
              </button>
            ) : "—"}
          </td>
        );
      case "expires":
        return <td key={key} className="px-4 py-3 font-mono-num text-muted-foreground">{formatCalendarDate(carLeaseEndDate(r)) || "—"}</td>;
      case "_actions":
        return (
          <td key={key} className="px-4 py-3">
            <div className="flex items-center gap-1">
              {r.active !== false && (
                <button type="button" className="p-1 text-muted-foreground hover:text-foreground" title="Edit" onClick={(e) => { e.stopPropagation(); setEditCarId(r.id); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              <Link
                href={withFrom(historyPath([r.reporting_marks, r.car_number].filter(Boolean).join(" ")))}
                className="p-1 text-muted-foreground hover:text-foreground"
                title={`View lineage for ${[r.reporting_marks, r.car_number].filter(Boolean).join(" ")}`}
                aria-label={`View lineage for ${[r.reporting_marks, r.car_number].filter(Boolean).join(" ")}`}
                onClick={(e) => { e.stopPropagation(); rememberScroll(); }}
              >
                <History className="h-3.5 w-3.5" />
              </Link>
            </div>
          </td>
        );
      default:
        return renderOptTd(key, r);
    }
  }

  const viewCounts: Record<string, { count: number; active: number; inactive: number; ms: number } | null> = {
    ...(countsQuery.data?.counts ?? {}),
  };
  const crumbCount = viewId ? (viewCounts[String(viewId)]?.count ?? totalCount) : totalCount;
  const crumbFigures = viewId
    ? (viewCounts[String(viewId)] ? viewCountLabel(viewCounts[String(viewId)]) : crumbCount.toLocaleString())
    : `${crumbCount.toLocaleString()} cars`;
  const collapsed = (Boolean(committed) || Boolean(viewId)) && !panelOpen;
  const filterCount = [typeFilter, mechFilter, aarFilter, entityFilter, statusFilter, openStop, programFilter, tagFilter].filter(Boolean).length
    + (activeMode !== "active" ? 1 : 0);

  function refreshViews() {
    void queryClient.invalidateQueries({ queryKey: ["/api/views"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/views/counts"] });
    if (viewId) void queryClient.invalidateQueries({ queryKey: ["/api/views", viewId] });
  }

  async function refetchViewLists(): Promise<ViewSummary[]> {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["/api/views"] }),
      queryClient.refetchQueries({ queryKey: ["/api/views/counts"] }),
    ]);
    const listed = queryClient.getQueryData<{ views?: ViewSummary[] }>(["/api/views"]);
    return listed?.views ?? [];
  }

  async function saveMemberNote(railcarId: number, note: string) {
    if (!viewId) return;
    try {
      await apiRequest("PATCH", `/api/views/${viewId}/members/${railcarId}`, { note });
      void queryClient.invalidateQueries({ queryKey: ["/api/railcars", "view-fixed", viewId] });
      void invalidateFleetQueries(queryClient);
    } catch (e: any) {
      toast({ title: "Note not saved", description: e.message ?? "inactive – left alone", variant: "destructive" });
    }
  }

  function writableIds(ids: number[]): number[] {
    const inactive = new Set(rows.filter((row) => row.active === false).map((row) => Number(row.id)));
    return ids.filter((id) => !inactive.has(id));
  }

  async function refetchViewsAfterFailure() {
    try {
      await refetchViewLists();
    } catch {
      // The write error is the one to show. A failed refetch leaves the last list.
    }
  }

  async function patchView(id: number, body: Record<string, unknown>) {
    try {
      const res = await apiRequest("PATCH", `/api/views/${id}`, body);
      refreshViews();
      return res.json();
    } catch (error) {
      await refetchViewsAfterFailure();
      throw error;
    }
  }

  async function saveCurrentView() {
    if (!viewId || !activeView) {
      setSaveOpen(true);
      return;
    }
    if (savingLock.current) return;
    savingLock.current = true;
    setSavingView(true);
    try {
      const layout = layoutSnapshot();
      const body: Record<string, unknown> = { layout, expected_updated_at: activeView.updated_at };
      if (activeView.kind === "query") {
        body.query = { v: 1, q: committed, scope, fleet: exactFleet, filters: layout.filters };
      }
      const saved = await patchView(viewId, body);
      setViewDirty(false);
      setViewLayout(layout);
      setSaveError(null);
      if (saved?.updated_at) setActiveView((prev) => prev ? { ...prev, updated_at: saved.updated_at, updated_at_et: saved.updated_at_et } : prev);
      toast({ title: viewSavedToast(activeView.name, activeView.shared, activeView.pinned) });
    } catch (e: any) {
      const message = e.message ?? "Could not save view";
      setSaveError(message);
      toast({ title: "Could not save view", description: message, variant: "destructive" });
    } finally {
      savingLock.current = false;
      setSavingView(false);
    }
  }

  async function saveNewView(body: { name: string; kind: ViewKind; shared: boolean; pinned: boolean; description: string; preset: "current" | "focus" }) {
    if (savingLock.current) return;
    savingLock.current = true;
    setSavingView(true);
    try {
      const layout = body.preset === "focus" ? focusPresetLayout(currentFilters()) : layoutSnapshot();
      const payload: Record<string, unknown> = {
        name: body.name,
        kind: body.kind,
        shared: body.shared,
        pinned: body.pinned,
        description: body.description,
        layout,
      };
      if (body.kind === "query") {
        payload.query = { v: 1, q: committed || query, scope, fleet: exactFleet, filters: layout.filters };
      } else if (committed && carListSearchTokens(committed)) {
        const resolved = pasteMemberIds(
          (pasteRows ?? []).map((row) => Number(row.id)),
          (pasteMeta?.inactive ?? []).map((row) => Number(row.id)),
        );
        if (resolved.length) {
          payload.railcar_ids = resolved;
          payload.query = {
            v: 1,
            q: committed,
            source: "paste",
            unmatched: pasteMeta?.notFound ?? [],
            ambiguous: pasteMeta?.ambiguous ?? [],
            scope,
            fleet: exactFleet,
            filters: layout.filters,
          };
        } else {
          payload.text = committed;
        }
      } else if (fixedMode && viewId) {
        payload.railcar_ids = filteredFixed.map((row) => Number(row.id)).filter((id) => id > 0);
      } else {
        const data = await apiGet<{ ids: number[] }>(railcarsQs({ ...listParams, page: undefined, pageSize: undefined }).replace("/api/railcars?", "/api/railcars/ids?"), { timeoutMs: 20_000 });
        payload.railcar_ids = (data.ids ?? []).slice(0, 2000);
      }
      const outcome = await runViewCreate({
        post: async () => {
          const res = await apiRequest("POST", "/api/views", payload);
          const created = await res.json();
          const id = Number(created?.view?.id ?? created?.id);
          return { id, name: body.name };
        },
        refetch: refetchViewLists,
      });
      setSaveOpen(false);
      setSaveError(null);
      pendingLayout.current = layout;
      setViewLayout(layout);
      if (layout.sort?.key) {
        setSort(layout.sort.key);
        setDir(layout.sort.dir === "desc" ? "desc" : "asc");
      }
      const listed = queryClient.getQueryData<{ views?: ViewSummary[] }>(["/api/views"]);
      const summary = listed?.views?.find((view) => view.id === outcome.selected.id);
      setActiveView(summary ?? {
        id: outcome.selected.id,
        name: outcome.selected.name,
        kind: body.kind,
        shared: body.shared,
        pinned: body.pinned,
        pin_order: null,
      });
      if (outcome.selected.id > 0) openView(outcome.selected.id);
      setViewDirty(false);
      toast({ title: viewSavedToast(outcome.selected.name, body.shared, body.pinned) });
    } catch (e: any) {
      const message = e.message ?? "Could not save view";
      setSaveError(message);
      toast({ title: "Could not save view", description: message, variant: "destructive" });
    } finally {
      savingLock.current = false;
      setSavingView(false);
    }
  }

  async function reorderPins(ids: number[]) {
    const key = ["/api/views"] as const;
    const previous = queryClient.getQueryData<{ schema_ready?: boolean; views?: ViewSummary[] }>(key);
    if (previous?.views) {
      const order = new Map(ids.map((id, index) => [id, index]));
      queryClient.setQueryData(key, {
        ...previous,
        views: previous.views.map((view) => (
          order.has(view.id) ? { ...view, pinned: true, pin_order: order.get(view.id) ?? null } : view
        )),
      });
    }
    try {
      await apiRequest("PUT", "/api/views/pins", { order: ids });
      refreshViews();
    } catch (e: any) {
      if (previous) queryClient.setQueryData(key, previous);
      toast({ title: "Could not reorder pins", description: e.message, variant: "destructive" });
    }
  }

  async function togglePin(view: ViewSummary) {
    try {
      await patchView(view.id, { pinned: !view.pinned, expected_updated_at: view.updated_at });
    } catch (e: any) {
      toast({ title: "Could not pin view", description: e.message, variant: "destructive" });
    }
  }

  async function toggleShare(view: ViewSummary) {
    try {
      await patchView(view.id, { shared: !view.shared, expected_updated_at: view.updated_at });
    } catch (e: any) {
      toast({ title: "Could not update sharing", description: e.message, variant: "destructive" });
    }
  }

  async function renameView(view: ViewSummary) {
    const name = window.prompt("Rename view", view.name);
    if (!name || !name.trim() || name.trim() === view.name) return;
    try {
      await patchView(view.id, { name: name.trim(), expected_updated_at: view.updated_at });
    } catch (e: any) {
      toast({ title: "Could not rename", description: e.message, variant: "destructive" });
    }
  }

  async function duplicateView(view: ViewSummary) {
    try {
      const res = await apiRequest("POST", `/api/views/${view.id}/duplicate`, { name: `${view.name} copy`, shared: canEdit ? view.shared : false });
      const created = await res.json();
      refreshViews();
      const id = Number(created?.view?.id ?? created?.id);
      if (id > 0) openView(id);
    } catch (e: any) {
      toast({ title: "Could not duplicate", description: e.message, variant: "destructive" });
    }
  }

  async function deleteView(view: ViewSummary) {
    try {
      await apiRequest("DELETE", `/api/views/${view.id}`);
      refreshViews();
      if (view.id === viewId) {
        setViewId(null);
        setActiveView(null);
        setViewLayout(null);
        setViewDirty(false);
      }
      toast({ title: "View deleted" });
    } catch (e: any) {
      await refetchViewsAfterFailure();
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    }
  }

  async function copyViewLink(view: ViewSummary) {
    const hash = encodeHash({ ...hashState(), view: String(view.id), q: view.kind === "fixed" ? "" : committed });
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    await copyList(url, "Copied view link");
  }

  function resetView() {
    const detail = detailQuery.data;
    if (!detail) return;
    applyLayout(detail.layout, detail.kind === "query" ? detail.query : null);
    setViewDirty(false);
  }

  function toggleViewCol(key: string) {
    const base = (viewId ? viewLayout : sessionLayout) ?? layoutSnapshot();
    const order = base.order.includes(key) ? base.order.filter((item) => item !== key) : [...base.order, key];
    const next = { ...base, order, cols: order };
    if (viewId) {
      setViewLayout(next);
      markDirty();
    } else setSessionLayout(next);
  }

  function applyFocusPreset() {
    const layout = focusPresetLayout(currentFilters());
    if (viewId) {
      setViewLayout(layout);
      setSort(layout.sort?.key ?? "program_status");
      setDir(layout.sort?.dir ?? "asc");
      markDirty();
    } else setSessionLayout(layout);
  }

  function resizeColumn(key: string, width: number) {
    if (viewId) {
      setViewLayout((prev) => prev ? { ...prev, widths: { ...prev.widths, [key]: width } } : prev);
      markDirty();
      return;
    }
    if (sessionLayout) {
      setSessionLayout({ ...sessionLayout, widths: { ...sessionLayout.widths, [key]: width } });
      return;
    }
    setColWidth(key, width);
  }

  function moveColumn(from: string, to: string) {
    if (viewId && viewLayout) {
      const order = withLeadingIdentityColumns(moveCol(viewLayout.order.length ? viewLayout.order : displayKeys.filter((key) => key !== "_actions"), from, to));
      setViewLayout({ ...viewLayout, order, cols: order });
      markDirty();
      return;
    }
    if (sessionLayout) {
      const order = withLeadingIdentityColumns(moveCol(sessionLayout.order, from, to));
      setSessionLayout({ ...sessionLayout, order, cols: order });
      return;
    }
    setColOrder(moveCol(movableKeys, from, to));
  }

  function columnWidth(key: string) {
    const custom = (viewId ? viewLayout?.widths : sessionLayout?.widths)?.[key];
    if (custom) return custom;
    return colWidth(colWidths, key, WIDTHS[key] ?? 110);
  }

  const stickyOffsets = stickyLeftOffsets(displayKeys, columnWidth);
  function stickyClass(key: string): string {
    return stickyOffsets[key] == null ? "" : "sticky z-10 bg-card";
  }
  function stickyStyle(key: string): { left: number } | undefined {
    const left = stickyOffsets[key];
    return left == null ? undefined : { left };
  }

  function selectPage() {
    setSelected(new Set(pageRows.map((row) => Number(row.id)).filter((id) => id > 0)));
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      if (fixedMode || isPaste) {
        setSelected(new Set(rows.map((row) => Number(row.id)).filter((id) => id > 0)));
        return;
      }
      const data = await apiGet<{ ids: number[] }>(railcarsQs({ ...listParams, page: undefined, pageSize: undefined }).replace("/api/railcars?", "/api/railcars/ids?"), { timeoutMs: 20_000 });
      setSelected(new Set(data.ids ?? []));
    } catch (e: any) {
      toast({ title: "Could not select cars", description: e.message, variant: "destructive" });
    } finally {
      setSelectingAll(false);
    }
  }

  function openInRailcars() {
    const ids = Array.from(selected);
    const payload = {
      ids,
      label: activeView?.name || crumbQuery || "Search",
      from: "search",
      sid: ensureSid(),
      view_id: viewId,
      returnHash: encodeHash(hashState()),
    };
    sessionStorage.setItem(RAILCARS_HANDOFF_KEY, JSON.stringify(payload));
    navigateHash("/railcars?handoff=1");
  }

  async function exportSelected(kind: "xlsx" | "csv") {
    const picked = rows.filter((row) => selected.has(Number(row.id)));
    if (!picked.length) return;
    if (kind === "csv") {
      downloadRailcarsCsv(picked, "search_selected.csv", { keys: exportKeys });
      return;
    }
    await downloadSearchXlsx(picked, exportKeys, {
      query: activeView?.name || committed,
      filters: filterLabel(),
      notFound: [],
      inactive: [],
      ambiguous: [],
      summary: summarize(picked),
    }, "search_selected.xlsx");
  }

  async function addSelectionTo(view: ViewSummary) {
    const ids = writableIds(Array.from(selected));
    if (!ids.length) {
      toast({ title: "Inactive cars were left alone" });
      return;
    }
    try {
      await apiRequest("POST", `/api/views/${view.id}/members`, { ids });
      toast({ title: `Added to ${view.name}` });
      setAddOpen(false);
      refreshViews();
    } catch (e: any) {
      toast({ title: "Could not add cars", description: e.message, variant: "destructive" });
    }
  }

  async function removeSelection() {
    if (!viewId) return;
    const ids = writableIds(Array.from(selected));
    if (!ids.length) {
      toast({ title: "Inactive cars were left alone" });
      return;
    }
    try {
      await apiRequest("POST", `/api/views/${viewId}/members/remove`, { ids });
      setSelected(new Set());
      refreshViews();
      void queryClient.invalidateQueries({ queryKey: ["/api/railcars", "view-fixed", viewId] });
    } catch (e: any) {
      toast({ title: "Could not remove cars", description: e.message, variant: "destructive" });
    }
  }

  const selectCls = "h-7 rounded border border-border bg-card px-2 text-xs text-foreground";

  const filterControls = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ScopeBox id="search-scope-leases" label="Lease/OL info" checked={scope.leases} onChange={(v) => setScopeFlag("leases", v)} />
        <ScopeBox id="search-scope-cars" label="Car numbers" checked={scope.cars} onChange={(v) => setScopeFlag("cars", v)} />
        <ScopeBox id="search-scope-data" label="Car data" checked={scope.carData} onChange={(v) => setScopeFlag("carData", v)} />
        <ScopeBox id="search-show-inactive" label="Show inactive / historical" checked={activeMode !== "active"} onChange={(v) => changeActive(v ? "all" : "active")} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="search-filters">
        <FilterText label="Car type" value={typeFilter} onCommit={(v) => { setTypeFilter(v); touchFilters(); }} testId="filter-car-type" />
        <FilterText label="Mechanical" value={mechFilter} onCommit={(v) => { setMechFilter(v); touchFilters(); }} testId="filter-mech" />
        <FilterText label="AAR" value={aarFilter} onCommit={(v) => { setAarFilter(v); touchFilters(); }} testId="filter-aar" />
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Owner
          <select className={selectCls} value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); touchFilters(); }} data-testid="filter-entity">
            <option value="">All</option>
            <option value="Main">Main</option>
            <option value="Rail Partners Select">RPS</option>
            <option value="Coal">Coal</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Fleet status
          <select className={selectCls} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); touchFilters(); }} data-testid="filter-status">
            <option value="">All</option>
            {FLEET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Active
          <select className={selectCls} value={activeMode} onChange={(e) => changeActive(e.target.value as SearchActive)} data-testid="filter-active">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Rent stop
          <select className={selectCls} value={openStop} onChange={(e) => { setOpenStop(e.target.value); touchFilters(); }} data-testid="filter-open-stop">
            <option value="">Any stop</option>
            <option value="any">Open stop</option>
            <option value="Abatement">Abatement</option>
            <option value="Off rent">Off rent</option>
            <option value="none">No open stop</option>
          </select>
        </label>
        <FilterText label="Program" value={programFilter} onCommit={(v) => { setProgramFilter(v); touchFilters(); }} testId="filter-program" />
        <FilterText label="Tag" value={tagFilter} onCommit={(v) => { setTagFilter(v); touchFilters(); }} testId="filter-tag" />
      </div>
    </div>
  );

  const viewMenuProps = {
    views,
    counts: Object.fromEntries(Object.entries(viewCounts).map(([key, value]) => [key, value ?? undefined])),
    activeId: viewId,
    canEdit,
    isAdmin,
    userId: user?.id ?? "",
    schemaMessage,
    onOpen: openView,
    onPin: (view: ViewSummary) => { void togglePin(view); },
    onRename: (view: ViewSummary) => { void renameView(view); },
    onDuplicate: (view: ViewSummary) => { void duplicateView(view); },
    onDelete: (view: ViewSummary) => { void deleteView(view); },
    onCopy: (view: ViewSummary) => { void copyViewLink(view); },
    onShare: (view: ViewSummary) => { void toggleShare(view); },
  };

  const selectedInactive = rows.filter((row) => selected.has(Number(row.id)) && row.active === false).length;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      {sidebarOpen ? (
        <aside className="hidden xl:flex w-56 shrink-0 flex-col gap-2 overflow-auto border-r border-border px-2 py-3" data-testid="search-views-sidebar">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium">Views</span>
            <button type="button" className="text-muted-foreground" aria-label="Hide views" onClick={() => { setSidebarOpen(false); writeViewsSidebarOpen(false); }}>
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          </div>
          <ViewsMenu {...viewMenuProps} />
        </aside>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 px-4 pt-3 pb-2 sm:px-6">
        <PinnedViewStrip
          views={views}
          counts={Object.fromEntries(Object.entries(viewCounts).map(([key, value]) => [key, value ?? undefined]))}
          countsLoading={countsQuery.isFetching && !countsQuery.data}
          activeId={viewId}
          canPin={canEdit}
          onOpen={openView}
          onReorder={(ids) => { void reorderPins(ids); }}
          onCreate={() => setSaveOpen(true)}
        />
        <div className="flex flex-wrap items-center gap-2">
          {!sidebarOpen ? (
            <button type="button" className="hidden xl:inline-flex text-muted-foreground" aria-label="Show views" onClick={() => { setSidebarOpen(true); writeViewsSidebarOpen(true); }}>
              <PanelLeft className="h-4 w-4" />
            </button>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs xl:hidden">Views</Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <ViewsMenu {...viewMenuProps} />
            </PopoverContent>
          </Popover>
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm" data-testid="search-breadcrumb">
            <button type="button" className="font-medium text-foreground" onClick={() => { if (committed || viewId) clear(); }}>Search</button>
            {(viewId || committed) && (
              <>
                <span className="text-muted-foreground">›</span>
                <span className="truncate text-foreground">
                  {activeView?.name || crumbQuery} ({crumbFigures})
                  {viewDirty ? <span className="ml-1 text-amber-400" title="Unsaved changes">●</span> : null}
                </span>
              </>
            )}
          </nav>
          <ViewMeta view={activeView} />
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button type="button" size="sm" className="h-7 gap-1 text-xs" disabled={Boolean(schemaMessage) || savingView} aria-busy={savingView} title={!canEdit ? "Viewers can save a private copy" : undefined} data-testid="button-save-view" onClick={() => { if (savingView) return; if (viewId && canEdit && viewDirty) void saveCurrentView(); else setSaveOpen(true); }}>
              {savingView ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {savingView ? "Saving…" : viewId && canEdit && viewDirty ? "Save changes" : "Save view"}
            </Button>
            {viewId ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2" aria-label="View actions"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setSaveOpen(true)}>Save as new view…</DropdownMenuItem>
                  <DropdownMenuItem disabled={!canEdit} onClick={() => activeView && void renameView(activeView)}>Rename</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => activeView && void duplicateView(activeView)}>Duplicate</DropdownMenuItem>
                  <DropdownMenuItem disabled={!canEdit} onClick={() => activeView && void togglePin(activeView)}>{activeView?.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!canEdit} onClick={() => activeView && void toggleShare(activeView)}>{activeView?.shared ? "Make private" : "Share"}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!viewDirty} onClick={resetView}>Reset to saved</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => activeView && void copyViewLink(activeView)}>Copy link</DropdownMenuItem>
                  <DropdownMenuItem disabled={!(isAdmin || activeView?.owner === user?.id)} onClick={() => activeView && void deleteView(activeView)}>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        {schemaMessage ? <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200" data-testid="saved-views-schema-message">{schemaMessage}</div> : null}
        {saveError ? (
          <div className="flex items-start justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs" role="alert" data-testid="save-view-error">
            <span>{saveError}</span>
            <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss save error" onClick={() => setSaveError(null)}>✕</button>
          </div>
        ) : null}
        {collapsed ? (
          <div className="space-y-1.5">
            <button type="button" className="flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-left text-sm" onClick={() => { setPanelOpen(true); markDirty(); }} data-testid="search-collapsed-query">
              <SearchIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{fixedMode ? `${activeView?.member_count ?? filteredFixed.length} cars pasted` : (committed || query || "Edit search")}</span>
            </button>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {isPaste && pasteMeta ? (
                <span>
                  {pasteMeta.counts.pasted.toLocaleString()} pasted · {pasteFoundLabel(pasteMeta.counts.found, pasteMeta.counts.inactive, activeMode)}
                  {pasteShowsInactiveSeparately(activeMode) ? ` · ${pasteMeta.counts.inactive.toLocaleString()} inactive` : ""} · {pasteMeta.counts.not_found.toLocaleString()} not in RLMS
                </span>
              ) : null}
              {typeFilter ? <button type="button" className="rounded-full border px-2 py-0.5" onClick={() => { setTypeFilter(""); touchFilters(); }}>Type: {typeFilter} ✕</button> : null}
              {openStop ? <button type="button" className="rounded-full border px-2 py-0.5" onClick={() => { setOpenStop(""); touchFilters(); }}>Rent stop: {openStop} ✕</button> : null}
              {programFilter ? <button type="button" className="rounded-full border px-2 py-0.5" onClick={() => { setProgramFilter(""); touchFilters(); }}>Program: {programFilter} ✕</button> : null}
              {tagFilter ? <button type="button" className="rounded-full border px-2 py-0.5" onClick={() => { setTagFilter(""); touchFilters(); }}>Tag: {tagFilter} ✕</button> : null}
              <FilterPopover count={filterCount}>{filterControls}</FilterPopover>
              <span title="Defaults to active cars. Car type, mechanical designation, and description are searched automatically. Paste a column or a range such as TFOX 401-449. Press / to edit the search."><Info className="h-3.5 w-3.5" /></span>
            </div>
          </div>
        ) : null}
      </div>
      {!collapsed && (
      <div className="shrink-0 px-4 sm:px-6 pb-2 w-full">
        {!committed && !viewId ? <h1 className="font-serif text-2xl font-semibold tracking-tight">Search</h1> : null}
        <p className="text-sm text-muted-foreground">
          Defaults to active cars. Car type, mechanical designation, and description are searched automatically. Car data adds notes. Paste a column of cars, or a range such as TFOX 401-449.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <ScopeBox id="search-scope-leases" label="Lease/OL info" checked={scope.leases} onChange={(v) => setScopeFlag("leases", v)} />
          <ScopeBox id="search-scope-cars" label="Car numbers" checked={scope.cars} onChange={(v) => setScopeFlag("cars", v)} />
          <ScopeBox id="search-scope-data" label="Car data" checked={scope.carData} onChange={(v) => setScopeFlag("carData", v)} />
          <ScopeBox
            id="search-show-inactive"
            label="Show inactive / historical"
            checked={activeMode !== "active"}
            onChange={(v) => changeActive(v ? "all" : "active")}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="search-filters">
          <FilterText label="Car type" value={typeFilter} onCommit={(v) => { setTypeFilter(v); touchFilters(); }} testId="filter-car-type" />
          <FilterText label="Mechanical" value={mechFilter} onCommit={(v) => { setMechFilter(v); touchFilters(); }} testId="filter-mech" />
          <FilterText label="AAR" value={aarFilter} onCommit={(v) => { setAarFilter(v); touchFilters(); }} testId="filter-aar" />
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            Owner
            <select className={selectCls} value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); touchFilters(); }} data-testid="filter-entity">
              <option value="">All</option>
              <option value="Main">Main</option>
              <option value="Rail Partners Select">RPS</option>
              <option value="Coal">Coal</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            Fleet status
            <select className={selectCls} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); touchFilters(); }} data-testid="filter-status">
              <option value="">All</option>
              {FLEET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            Active
            <select className={selectCls} value={activeMode} onChange={(e) => changeActive(e.target.value as SearchActive)} data-testid="filter-active">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </label>
          {(typeFilter || mechFilter || aarFilter || entityFilter || statusFilter) && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => { setTypeFilter(""); setMechFilter(""); setAarFilter(""); setEntityFilter(""); setStatusFilter(""); touchFilters(); }}
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="relative mt-3 flex flex-wrap gap-2 items-start">
          <div className="relative flex-1 min-w-[16rem]">
            <SearchIcon className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <textarea
              ref={inputRef}
              value={query}
              rows={query.includes("\n") || query.length > 60 ? 6 : 2}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !query.includes("\n"))) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={"HWCX 10823\nHWCX 10841\nor a lessee / OL / J312 / covered hopper"}
              className="w-full min-h-[2.75rem] resize-y bg-card border border-border rounded-lg pl-10 pr-10 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
            />
            {query && (
              <button type="button" onClick={clear} className="absolute right-3 top-3.5 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button type="button" onClick={submit} className="shrink-0 h-[2.75rem]" data-testid="button-search-submit">
            Search
          </Button>
        </div>
        {(draftCount >= 2 || draft.expandedFrom.length > 0 || draft.rejectedRanges.length > 0) && (
          <div className="mt-2 text-xs text-muted-foreground">
            {draft.tokens.length} cars in this list
            {draft.expandedFrom.length > 0 ? ` (${draft.expandedFrom.map((r) => `range ${r.from}–${r.to} expanded`).join(", ")})` : ""}
            {query.includes("\n") ? " · Ctrl+Enter to search" : ""}
          </div>
        )}
        {draft.rejectedRanges.map((r) => (
          <div key={r.raw} className="mt-1 text-xs text-amber-500">{r.message}</div>
        ))}
        {(committed || viewId) ? (
          <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setPanelOpen(false)}>Collapse search</button>
        ) : null}
      </div>
      )}

      {!committed && !viewId && !loading && (
        <div className="px-4 sm:px-8 pb-8 max-w-[1400px] w-full mx-auto grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Paste a car list", example: "HWCX10823\nHWCX10841", sub: "Excel column, commas, or MARK + number" },
            { label: "Lessee / OL", example: "BNSF", sub: "lease and rider fields" },
            { label: "Car type", example: "J312", sub: "searched automatically" },
            { label: "Description", example: "covered hopper", sub: "shows the alias rule used" },
          ].map((tip) => (
            <button
              key={tip.example}
              type="button"
              onClick={() => {
                setQuery(tip.example);
                setPage(1);
                setLive(true);
                setExactFleet(true);
                setCommitted(tip.example);
              }}
              className="text-left p-3 rounded-lg border border-border bg-card hover:bg-card/80 hover:border-primary/30 transition-all group"
            >
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{tip.label}</div>
              <div className="text-sm font-mono font-medium text-foreground group-hover:text-primary transition-colors whitespace-pre-line">{tip.example}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{tip.sub}</div>
            </button>
          ))}
        </div>
      )}

      {(committed || viewId) && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-4 pb-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker
              columns={OPT_COLS}
              prefs={colPrefs}
              visible={(viewId || sessionLayout) ? new Set(displayKeys) : undefined}
              onToggle={(viewId || sessionLayout) ? toggleViewCol : undefined}
              onReorder={(viewId || sessionLayout) ? (order) => {
                const next = withLeadingIdentityColumns(order);
                if (viewId && viewLayout) {
                  setViewLayout({ ...viewLayout, order: next, cols: next });
                  markDirty();
                } else if (sessionLayout) setSessionLayout({ ...sessionLayout, order: next, cols: next });
              } : undefined}
              onApplyPreset={applyFocusPreset}
              onSaveToView={viewId ? () => { void saveCurrentView(); } : undefined}
            />
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Sort
              <select
                className={selectCls}
                value={`${sort}:${dir}`}
                onChange={(e) => {
                  const [nextSort, nextDir] = e.target.value.split(":");
                  setSort(nextSort || "car_number");
                  setDir(nextDir === "desc" ? "desc" : "asc");
                  touchFilters();
                }}
                data-testid="search-sort"
              >
                <option value="car_number:asc">Car number A–Z</option>
                <option value="car_number:desc">Car number Z–A</option>
                <option value="id:asc">Id</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Density
              <select className={selectCls} value={density} onChange={(e) => { setDensity(e.target.value === "compact" ? "compact" : "comfortable"); markDirty(); }} data-testid="search-density">
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Page size
              <select
                className={selectCls}
                value={ps === "all" ? "all" : String(ps)}
                onChange={(e) => {
                  const v = e.target.value;
                  setPs(v === "all" ? "all" : Number(v));
                  touchFilters();
                }}
                data-testid="search-page-size"
              >
                <option value="75">75</option>
                <option value="200">200</option>
                <option value="500">500</option>
                <option value="all">All (≤500)</option>
              </select>
            </label>
            <CopyCarsButton
              rows={fixedMode || isPaste ? rows : pageRows}
              selectedIds={selected}
              totalCount={totalCount}
              loadAll={fixedMode || isPaste ? undefined : loadAllSearchCars}
              disabled={loading || totalCount === 0}
            />
            {totalCount > 0 && (
              <div className="inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs rounded-r-none"
                  disabled={loading || exporting}
                  onClick={() => void exportResults("xlsx")}
                  data-testid="button-export-search"
                >
                  <Download className="h-3.5 w-3.5" />
                  {exporting ? "Exporting…" : "Export XLSX"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="px-2 rounded-l-none border-l-0" disabled={loading || exporting} aria-label="More export formats">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void exportResults("xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void exportResults("csv")} data-testid="button-export-search-csv">CSV</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {loading ? "Searching…" : isPaste && pasteMeta
                ? (
                  <>
                    {pasteMeta.counts.pasted.toLocaleString()} pasted
                    {" · "}
                    {pasteFoundLabel(pasteMeta.counts.found, pasteMeta.counts.inactive, activeMode)}
                    {pasteShowsInactiveSeparately(activeMode) && (
                      <>
                        {" · "}
                        {pasteMeta.counts.inactive.toLocaleString()} inactive
                        {pasteMeta.counts.inactive > 0 && (
                          <>
                            {" ("}
                            <button type="button" className="text-primary hover:underline" onClick={() => changeActive("all")}>Show</button>
                            {")"}
                          </>
                        )}
                      </>
                    )}
                    {" · "}
                    {pasteMeta.counts.not_found.toLocaleString()} not in RLMS
                    {" · "}
                    {pasteMeta.counts.ambiguous.toLocaleString()} ambiguous
                    {pasteMeta.truncated ? " · truncated at 500" : ""}
                  </>
                )
                : `${totalCount.toLocaleString()} car${totalCount !== 1 ? "s" : ""}`}
              {" for "}
              <span className="text-foreground font-medium">{committedLabel}</span>
              {activeMode === "active" ? " · active fleet" : activeMode === "inactive" ? " · inactive only" : " · including inactive"}
              {selected.size > 0 ? ` · ${selected.size} selected` : ""}
            </div>
          </div>

          {matchLabel && (
            <div className="text-sm text-foreground flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="search-match-rule">
              <span>{matchLabel}</span>
              {exactFleet && match?.textCount != null && match.textCount > 0 && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => { setExactFleet(false); setPage(1); setLive(true); }}
                  data-testid="button-search-as-text"
                >
                  Also search as text ({match.textCount.toLocaleString()})
                </button>
              )}
            </div>
          )}
          {summary && summary.total > 0 && (
            <SummaryBits
              summary={summary}
              onType={(key) => { setTypeFilter(!key || key === "—" ? "" : key); touchFilters(); }}
              onEntity={(key) => { setEntityFilter(key); touchFilters(); }}
              onStatus={(key) => { setStatusFilter(key); touchFilters(); }}
            />
          )}

          {loadError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm px-4 py-3">{loadError}</div>
          )}

          {!isPaste && committed.trim().length >= 2 && (
            <div className="flex flex-wrap items-center gap-2">
              {peopleRows.map((row, i) => (
                <Link
                  key={`${row.contact_id ?? "co"}-${row.company_id ?? i}`}
                  href={contactsDirectoryPath({
                    q: committed.trim(),
                    companyId: row.company_id,
                    contactId: row.contact_id,
                    people: Boolean(row.contact_id),
                    leaseTied: false,
                  })}
                  className="inline-flex max-w-full items-center rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-primary/40"
                >
                  <span className="truncate">{row.contact_name || row.company_name || "Directory match"}</span>
                </Link>
              ))}
              <Link
                href={contactsDirectoryPath({
                  q: committed.trim(),
                  companyId: null,
                  contactId: null,
                  people: true,
                  leaseTied: false,
                  addContact: peopleRows.length === 0 && !peopleQuery.isFetching && !peopleQuery.isError,
                })}
                className="text-xs text-primary hover:underline"
              >
                {peopleQuery.isFetching
                  ? "Open in Contacts"
                  : peopleTotal > peopleRows.length
                    ? `Open all ${peopleTotal.toLocaleString()} in Contacts`
                    : "Open in Contacts"}
              </Link>
              {peopleQuery.isError && (
                <span className="text-xs text-destructive">{(peopleQuery.error as Error)?.message || "Directory search failed."}</span>
              )}
            </div>
          )}

          {missing.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <div className="text-amber-400 font-medium">Not in RLMS</div>
                <button type="button" className="inline-flex items-center gap-1 text-xs text-foreground hover:underline" onClick={() => void copyList(missing.join("\n"), "Copied cars not in RLMS")}>
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
              <div className="font-mono text-xs text-foreground whitespace-pre-wrap">{missing.join(", ")}</div>
            </div>
          )}

          {ambiguous.length > 0 && (
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <div className="font-medium">Ambiguous</div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs hover:underline"
                  onClick={() => void copyList(ambiguous.map((a) => `${a.token}: ${a.matches.map((m) => m.label).join(", ")}`).join("\n"), "Copied ambiguous matches")}
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
              </div>
              <ul className="space-y-1 text-xs">
                {ambiguous.map((a) => (
                  <li key={a.token}>
                    <span className="font-mono">{a.token}</span>
                    {a.reason ? ` — ${a.reason} ` : " — "}
                    {a.matches.map((m, i) => (
                      <span key={m.id}>
                        {i > 0 ? ", " : ""}
                        <Link href={withFrom(`/cars/${m.id}`)} className="hover:underline" onClick={() => rememberScroll()}>
                          {m.label || m.id}
                          {m.active === false ? " (inactive)" : ""}
                        </Link>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(pasteMeta?.inactive.length ?? 0) > 0 && activeMode === "active" && (
            <div className="text-xs text-muted-foreground">
              Inactive and not in the grid: {pasteMeta!.inactive.map((c) => [c.reporting_marks, c.car_number].filter(Boolean).join(" ")).join(", ")}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          )}

          {noResults && !loading && (
            <div className="text-center text-muted-foreground text-sm py-10">
              No cars or directory matches for <span className="text-foreground font-medium">{committedLabel}</span>.
            </div>
          )}

          <SelectionBar
            selected={selected.size}
            inactive={selectedInactive}
            canEdit={canEdit && !schemaMessage}
            fixedView={Boolean(fixedMode)}
            onRailcars={openInRailcars}
            onAdd={() => setAddOpen(true)}
            onRemove={() => { void removeSelection(); }}
            onPhotos={() => setPhotoOpen(true)}
            onExport={(kind) => { void exportSelected(kind); }}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" className="text-primary hover:underline" onClick={selectPage}>Select page</button>
            <button type="button" className="text-primary hover:underline" disabled={selectingAll} onClick={() => { void selectAllMatching(); }}>
              {selectingAll ? "Selecting…" : `Select all ${totalCount.toLocaleString()} matching`}
            </button>
          </div>

          {hasResults && !loading && pageRows.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-card-border bg-card">
              <div className="min-h-0 flex-1 overflow-auto" data-search-grid="">
              <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 36 }} />
                  {displayKeys.map((k) => (
                    <col key={k} style={{ width: columnWidth(k) }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-30 bg-card text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
                  <tr className="text-left">
                    <th className="sticky left-0 z-40 bg-muted/40 px-2 py-2" />
                    {displayKeys.map((key) => {
                      const layoutPinned = key === "_actions";
                      const pinned = viewId || sessionLayout ? layoutPinned : (PINNED_START as readonly string[]).includes(key) || (PINNED_END as readonly string[]).includes(key);
                      const focusLocked = isFocusColumn(key) && !fullSetLoaded;
                      const headerSticky = stickyOffsets[key];
                      return (
                        <GridColumnTh
                          key={key}
                          listKey="search_results"
                          colKey={key}
                          width={columnWidth(key)}
                          pinned={pinned}
                          stickyLeft={headerSticky}
                          className={cn(
                            "px-3 py-2 font-medium text-[11px] uppercase tracking-wider bg-muted/40",
                            headerSticky != null && "sticky z-40 bg-muted/40",
                            key === "marks" && "hidden sm:table-cell",
                            key === "type" && "hidden sm:table-cell",
                          )}
                          onResize={resizeColumn}
                          onMove={moveColumn}
                          accessory={key === "car_number" ? (
                            <CopyCarsButton
                              appearance="header"
                              rows={fixedMode || isPaste ? rows : pageRows}
                              selectedIds={selected}
                              totalCount={totalCount}
                              loadAll={fixedMode || isPaste ? undefined : loadAllSearchCars}
                              disabled={loading || totalCount === 0}
                            />
                          ) : undefined}
                          onSort={(fullSetLoaded || key === "car_number" || key === "id") && !focusLocked ? (col) => {
                            setDir(sort === col && dir === "asc" ? "desc" : "asc");
                            setSort(col);
                            markDirty();
                          } : undefined}
                          sortDir={sort === key ? dir : null}
                        >
                          <span title={focusLocked ? "Narrow the search to sort by this" : undefined}>
                            {key === "_actions" ? null : columnLabel("search_results", key, LABELS[key] ?? OPT_COLS.find((c) => c.key === key)?.label ?? key)}
                          </span>
                        </GridColumnTh>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-t border-border hover-elevate",
                        r.active === false ? "bg-muted/60 text-muted-foreground" : "cursor-pointer",
                        selected.has(r.id) && "bg-primary/10",
                      )}
                      onClick={() => setEditCarId(r.id)}
                      data-testid={`row-search-car-${r.id}`}
                    >
                      <td className={cn("sticky left-0 z-10 bg-card px-2", density === "compact" ? "py-1" : "py-3")} onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={() => toggleSelected(r.id)}
                          aria-label={`Select ${r.reporting_marks ?? ""} ${r.car_number ?? ""}`}
                          data-testid={`checkbox-search-car-${r.id}`}
                        />
                      </td>
                      {displayKeys.map((k) => cell(k, r))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
                <span>
                  {totalCount.toLocaleString()} cars
                  {totalCount > 0 ? ` · page ${page} of ${totalPages}` : ""}
                  {ps === "all" && totalCount >= 500 ? " · showing up to 500" : ""}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => { setPage((p) => Math.max(1, p - 1)); setLive(true); }}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => { setPage((p) => p + 1); setLive(true); }}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <RailcarDetailSheet
        carId={editCarId}
        onClose={() => setEditCarId(null)}
        readOnly={editRow?.active === false}
        carPageHref={editCarId ? withFrom(`/cars/${editCarId}`) : undefined}
      />
      <LeaseGlanceSheet rider={leaseGlance} onClose={() => setLeaseGlance(null)} searchQuery={committed ? searchQueryString() : null} />
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        views={views}
        defaultName={activeView ? `${activeView.name} copy` : (isPaste ? "Pasted cars" : committed.slice(0, 48))}
        defaultKind={isPaste || fixedMode ? "fixed" : "query"}
        carCount={fixedMode ? (activeView?.member_count ?? filteredFixed.length) : isPaste ? pasteMemberIds((pasteRows ?? []).map((row) => Number(row.id)), (pasteMeta?.inactive ?? []).map((row) => Number(row.id))).length : totalCount}
        canShare={canEdit}
        busy={savingView}
        onSave={(body) => { void saveNewView(body); }}
      />
      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddOpen(false)}>
          <div className="w-80 rounded-lg border border-border bg-card p-3" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 text-sm font-medium">Add to a fixed view</div>
            <div className="max-h-64 space-y-1 overflow-auto">
              {views.filter((view) => view.kind === "fixed").map((view) => (
                <button key={view.id} type="button" className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted" onClick={() => { void addSelectionTo(view); }}>
                  {view.name}
                </button>
              ))}
              {views.every((view) => view.kind !== "fixed") ? <div className="text-xs text-muted-foreground">No fixed views yet.</div> : null}
            </div>
            <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => { setAddOpen(false); setSaveOpen(true); }}>New fixed view</Button>
          </div>
        </div>
      ) : null}
      {photoOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-6" onClick={() => setPhotoOpen(false)}>
          <div className="w-full max-w-3xl" onClick={(event) => event.stopPropagation()}>
            <PhotoFinderPanel initialText={carsToPasteText(rows.filter((row) => selected.has(Number(row.id))))} onClose={() => setPhotoOpen(false)} />
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
