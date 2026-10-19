import { Search as SearchIcon, Loader2, X, Pencil, History, ChevronLeft, ChevronRight, Download, ChevronDown, Copy } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { apiGet, apiRequest, asRailcarList, railcarsQs } from "@/lib/queryClient";
import { carListSearchTokens, looksLikeCarToken, parseCarPasteListDetailed } from "@shared/programs";
import { classifyFleetQuery, summaryCarTypeKey } from "@shared/carTypeAliases";
import { displayLeaseNumber } from "@shared/residco-import";
import { formatCalendarDate, carLeaseEndDate } from "@shared/lease-authority";
import { FleetMembershipBadge, FleetAwareStatusBadge, InactiveFleetBadge } from "@/components/InactiveFleetBadge";
import { LeaseTypeBadge } from "@/components/LeaseTypeBadge";
import { OpsFlagBadge } from "@/components/OpsFlagBadge";
import { displayStatusInputFromRailcar, FLEET_STATUSES } from "@shared/fleet-status";
import { Button } from "@/components/ui/button";
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
  saveSearchState,
  shouldRebootSearch,
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
  | "data_source" | "active" | "comment_event_note" | "rider_external_id" | "account_manager_initials" | "am_note";

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

function renderOptTd(key: string, r: any) {
  const money = "px-4 py-3 font-mono-num text-muted-foreground whitespace-nowrap";
  const num = "px-4 py-3 font-mono-num text-muted-foreground";
  const text = "px-4 py-3 text-muted-foreground";
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
        <td key={key} className="px-4 py-3">
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
  ambiguous: { token: string; matches: { id: number; label: string }[] }[];
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
  sid: string;
  fromCache: boolean;
  pasteRows: any[] | null;
  pasteMeta: PasteMeta | null;
  textRows: any[];
  textTotal: number;
  summary: Summary | null;
  match: FleetMatch;
  selection: number[];
  scrollY: number;
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
    sid: "",
    fromCache: false,
    pasteRows: null,
    pasteMeta: null,
    textRows: [],
    textTotal: 0,
    summary: null,
    match: null,
    selection: [],
    scrollY: 0,
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
  const el = document.querySelector("[data-app-scroll]");
  return el instanceof HTMLElement ? el : null;
}

function readBoot(): Boot {
  const base = blankBoot();
  if (typeof window === "undefined") return base;
  const hash = decodeHash(window.location.hash);
  const cached = hash.sid ? loadSearchState(hash.sid) : null;
  if (cached && cached.ready !== false && cached.results && cached.hash) {
    const h = cached.hash;
    const results = cached.results;
    const counts = results.counts ?? {};
    return {
      query: cached.pastedText || h.q,
      committed: cached.pastedText || h.q,
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
      sid: cached.sid,
      fromCache: true,
      pasteRows: results.mode === "paste" ? (results.rows as any[]) : null,
      pasteMeta: results.mode === "paste" ? {
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
      textRows: results.mode === "text" ? (results.rows as any[]) : [],
      textTotal: results.mode === "text" ? results.total : 0,
      summary: (results.summary as Summary) ?? null,
      match: (results.match as FleetMatch) ?? null,
      selection: cached.selection ?? [],
      scrollY: cached.scrollY ?? 0,
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
    base.sid = hash.sid;
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
  const [pasteLoading, setPasteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editCarId, setEditCarId] = useState<number | null>(null);
  const [leaseGlance, setLeaseGlance] = useState<LeaseGlanceRider | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(boot.selection));
  const sidRef = useRef(boot.sid);
  const scrollRef = useRef(boot.scrollY);
  const pendingScroll = useRef<number | null>(boot.fromCache ? boot.scrollY : null);
  const committedRef = useRef(boot.committed);
  const lastSeenHash = useRef(typeof window === "undefined" ? "" : window.location.hash);
  const hashBooted = useRef(false);
  committedRef.current = committed;
  const { toast } = useToast();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const colPrefs = useColumnPrefs("search_results", SEARCH_DEFAULT_COLS);
  const { visibleCols: visibleColsRaw, colOrder, setColOrder, colWidths, setColWidth } = colPrefs;
  const visibleCols = visibleColsRaw as Set<OptCol>;

  const isPaste = Boolean(committed && carListSearchTokens(committed));
  const pageSize = pageSizeNumber(ps);
  const listParams = {
    page,
    pageSize,
    search: committed || undefined,
    active: activeMode,
    search_cars: scope.cars ? 1 : 0,
    search_leases: scope.leases ? 1 : 0,
    search_car_data: scope.carData ? 1 : 0,
    sort: sort !== "car_number" ? sort : undefined,
    dir: dir === "desc" ? "desc" : undefined,
    type: typeFilter || undefined,
    mech: mechFilter || undefined,
    aar: aarFilter || undefined,
    entity: entityFilter || undefined,
    status: statusFilter || undefined,
    fleet: exactFleet ? 1 : undefined,
  };

  const textQuery = useQuery<RailcarPage>({
    queryKey: ["/api/railcars", "search-page", listParams],
    queryFn: ({ signal }) => apiGet<RailcarPage>(railcarsQs(listParams), { timeoutMs: 20_000, signal }),
    enabled: Boolean(committed) && !isPaste && live,
    staleTime: 30_000,
  });
  const summaryParams = { ...listParams, page: undefined, pageSize: undefined };
  const summaryQuery = useQuery<Summary & { match?: FleetMatch }>({
    queryKey: ["/api/railcars/summary", "search-page", summaryParams],
    queryFn: ({ signal }) => apiGet(railcarsQs(summaryParams).replace("/api/railcars", "/api/railcars/summary"), { timeoutMs: 20_000, signal }),
    enabled: Boolean(committed) && !isPaste && live,
    staleTime: 30_000,
  });
  const peopleQuery = useQuery<DirectoryPage>({
    queryKey: ["/api/directory-search", "from-search", committed],
    queryFn: ({ signal }) =>
      apiGet<DirectoryPage>(`/api/directory-search?q=${encodeURIComponent(committed.trim())}&page=1&pageSize=8`, { timeoutMs: 20_000, signal }),
    enabled: Boolean(committed) && !isPaste && live && committed.trim().length >= 2,
    staleTime: 30_000,
  });

  const filteredPaste = useMemo(() => {
    const rows = pasteRows ?? [];
    return rows.filter((r) => {
      if (typeFilter && !codeHit(r.car_type, typeFilter) && !codeHit(r.equipment_type_code, typeFilter)) return false;
      if (mechFilter && !codeHit(r.mechanical_designation, mechFilter)) return false;
      if (aarFilter && !codeHit(r.aar_designation, aarFilter)) return false;
      if (entityFilter && String(r.entity ?? "") !== entityFilter) return false;
      if (statusFilter && String(r.fleet_status ?? "") !== statusFilter) return false;
      return true;
    });
  }, [pasteRows, typeFilter, mechFilter, aarFilter, entityFilter, statusFilter]);

  const rows = isPaste ? filteredPaste : live ? (textQuery.data?.rows ?? []) : cachedTextRows;
  const summary = isPaste ? summarize(filteredPaste) : live ? (summaryQuery.data ?? null) : cachedSummary;
  const match: FleetMatch = isPaste ? null : live ? (textQuery.data?.match ?? summaryQuery.data?.match ?? null) : cachedMatch;
  // Summary counts every matching row. The list endpoint's total is an estimate, so the
  // breadcrumb, pager, and summary chips share the summary total once it has loaded.
  const totalCount = isPaste
    ? filteredPaste.length
    : (summary?.total ?? (live ? (textQuery.data?.total_count ?? 0) : cachedTextTotal));
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const loading = isPaste ? pasteLoading : live && textQuery.isFetching && !textQuery.data;
  const pageRows = isPaste ? filteredPaste.slice((page - 1) * pageSize, page * pageSize) : rows;
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
    if (pendingScroll.current != null && !loading) {
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
    if (!committed) return;
    const external = decodeHash(window.location.hash);
    if (window.location.hash !== lastSeenHash.current && shouldRebootSearch({ q: committed, sid: sidRef.current }, external)) {
      return;
    }
    const hash = hashState();
    const path = encodeHash(hash);
    lastSeenHash.current = `#${path}`;
    if (window.location.hash !== `#${path}`) navigateHash(path, { replace: true });
    const ready = !live || (isPaste ? !pasteLoading : textQuery.isFetched || textQuery.isError);
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
      ids: (isPaste ? pasteRows ?? [] : rows).map((r) => Number(r.id)).filter((n) => n > 0),
      selection: Array.from(selected),
      scrollY: scrollRef.current,
      results,
      ready,
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
  }, [committed, page, ps, activeMode, exactFleet, scope, typeFilter, mechFilter, aarFilter, entityFilter, statusFilter, sort, dir, pasteRows, pasteMeta, selected, live, pasteLoading, textQuery.data, textQuery.isFetched, summaryQuery.data, totalCount]);

  function applyBoot(next: Boot) {
    sidRef.current = next.sid;
    scrollRef.current = next.scrollY;
    pendingScroll.current = next.fromCache ? next.scrollY : null;
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
    if (!shouldRebootSearch({ q: committedRef.current, sid: sidRef.current }, { q: hash.q, sid: hash.sid })) return;
    applyBoot(readBoot());
    // Re-read when the top bar or Back/Forward changes q or sid. Filter edits stay on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashQs]);

  async function runPaste(q: string, nextScope: SearchScope, nextActive: SearchActive) {
    setPasteLoading(true);
    setError(null);
    setLive(true);
    try {
      const res = await apiRequest("POST", "/api/search", {
        q,
        active: nextActive,
        search_cars: nextScope.cars ? 1 : 0,
        search_leases: nextScope.leases ? 1 : 0,
        search_car_data: nextScope.carData ? 1 : 0,
      });
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
    clearSearchSession();
    navigateHash("/search", { replace: true });
    inputRef.current?.focus();
  }

  function touchFilters() {
    setPage(1);
    setLive(true);
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

  const exportKeys = [...PINNED_START, ...CORE_MOVABLE, ...OPT_COLS.filter((c) => visibleCols.has(c.key)).map((c) => c.key)];

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
      return asRailcarList(await apiGet<any[] | { rows?: any[] }>(railcarsQs({ all: 1, ids: ids.join(","), active: "all" }), { timeoutMs: 60_000 }));
    }
    const all = asRailcarList(await apiGet<any[] | { rows?: any[] }>(railcarsQs({ ...listParams, page: undefined, pageSize: undefined, all: 1 }), { timeoutMs: 60_000 }));
    return all.slice(0, EXPORT_CAP);
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
    const movable = [...CORE_MOVABLE, ...OPT_COLS.filter((c) => visibleCols.has(c.key)).map((c) => c.key)];
    return [...PINNED_START, ...mergeColOrder(movable, colOrder), ...PINNED_END];
  }, [visibleCols, colOrder]);
  const movableKeys = displayKeys.filter((k) => !(PINNED_START as readonly string[]).includes(k) && !(PINNED_END as readonly string[]).includes(k));
  const pasteCount = pasteMeta?.counts.pasted ?? (committed ? carListSearchTokens(committed)?.length ?? 0 : 0);
  const committedLabel = pasteCount > 1 ? `${pasteCount} cars` : `"${committed}"`;
  const crumbQuery = pasteCount > 1 ? `${pasteCount} cars` : committed.length > 48 ? `${committed.slice(0, 48)}…` : committed;
  const missing = pasteMeta?.notFound ?? [];
  const ambiguous = pasteMeta?.ambiguous ?? [];
  const hasResults = Boolean(committed) && (totalCount > 0 || missing.length > 0 || ambiguous.length > 0 || peopleRows.length > 0);
  const noResults = Boolean(committed) && !loading && !peopleQuery.isFetching && !peopleQuery.isError && totalCount === 0 && missing.length === 0 && ambiguous.length === 0 && peopleRows.length === 0;
  const loadError = !isPaste && textQuery.isError ? ((textQuery.error as Error)?.message || "Search failed") : error;
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
    if (OPT_COLS.some((c) => c.key === key) && visibleCols.has(key as OptCol)) return renderOptTd(key, r);
    switch (key) {
      case "entity":
        return <td key={key} className="px-4 py-3"><EntityBadge entity={r.entity} /></td>;
      case "marks":
        return <td key={key} className="px-4 py-3 font-mono-num text-muted-foreground hidden sm:table-cell">{r.reporting_marks ?? "—"}</td>;
      case "car_number":
        return (
          <td key={key} className="px-4 py-3 font-mono-num font-medium">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={withFrom(`/cars/${r.id}`)}
                className="hover:text-primary hover:underline"
                onClick={(e) => { e.stopPropagation(); rememberScroll(); }}
              >
                {r.car_number}
              </Link>
              <FleetMembershipBadge active={r.active} />
            </div>
          </td>
        );
      case "lease_type":
        return (
          <td key={key} className="px-4 py-3">
            <LeaseTypeBadge carType={r.lease_type} mlaType={r.assignment?.rider?.master_lease?.lease_type} />
          </td>
        );
      case "type":
        return <td key={key} className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{r.car_type ?? "—"}</td>;
      case "status":
        return (
          <td key={key} className="px-4 py-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <FleetAwareStatusBadge car={displayStatusInputFromRailcar(r)} />
              {r.ops_flag ? <OpsFlagBadge flag={r.ops_flag} /> : null}
            </div>
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

  const selectCls = "h-7 rounded border border-border bg-card px-2 text-xs text-foreground";

  return (
    <div className="w-full min-w-0 overflow-x-hidden">
      <div className="px-4 sm:px-8 pt-6 pb-4 max-w-[1400px] w-full mx-auto">
        <div className="font-eyebrow mb-1.5">RLMS</div>
        <nav aria-label="Breadcrumb" className="text-sm mb-1 flex flex-wrap items-center gap-1.5" data-testid="search-breadcrumb">
          <span className="font-medium text-foreground">Search</span>
          {committed && (
            <>
              <span className="text-muted-foreground">›</span>
              <span className="text-foreground">"{crumbQuery}" ({totalCount.toLocaleString()} cars)</span>
            </>
          )}
        </nav>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
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
      </div>

      {!committed && !loading && (
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

      {committed && (
        <div className="px-4 sm:px-8 pb-8 max-w-[1400px] w-full mx-auto flex flex-col gap-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker columns={OPT_COLS} prefs={colPrefs} />
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
                <option value="all">All (≤500)</option>
              </select>
            </label>
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
                    {" — "}
                    {a.matches.map((m, i) => (
                      <span key={m.id}>
                        {i > 0 ? ", " : ""}
                        <Link href={withFrom(`/cars/${m.id}`)} className="hover:underline" onClick={() => rememberScroll()}>{m.label || m.id}</Link>
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

          {hasResults && !loading && pageRows.length > 0 && (
            <div className="rounded-lg border border-card-border bg-card min-w-0">
              <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 36 }} />
                  {displayKeys.map((k) => (
                    <col key={k} style={{ width: colWidth(colWidths, k, WIDTHS[k] ?? 110) }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
                  <tr className="text-left">
                    <th className="px-2 py-3 bg-muted/40" />
                    {displayKeys.map((key) => {
                      const pinned = (PINNED_START as readonly string[]).includes(key) || (PINNED_END as readonly string[]).includes(key);
                      return (
                        <GridColumnTh
                          key={key}
                          listKey="search_results"
                          colKey={key}
                          width={colWidth(colWidths, key, WIDTHS[key] ?? 110)}
                          pinned={pinned}
                          className={cn(
                            "px-4 py-3 font-medium text-[11px] uppercase tracking-wider bg-muted/40",
                            key === "marks" && "hidden sm:table-cell",
                            key === "type" && "hidden sm:table-cell",
                          )}
                          onResize={setColWidth}
                          onMove={(from, to) => setColOrder(moveCol(movableKeys, from, to))}
                        >
                          {key === "_actions" ? null : columnLabel("search_results", key, LABELS[key] ?? OPT_COLS.find((c) => c.key === key)?.label ?? key)}
                        </GridColumnTh>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr
                      key={r.id}
                      className={cn("border-t border-border hover-elevate cursor-pointer", selected.has(r.id) && "bg-primary/10")}
                      onClick={() => setEditCarId(r.id)}
                      data-testid={`row-search-car-${r.id}`}
                    >
                      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
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
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border text-xs text-muted-foreground">
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
    </div>
  );
}
