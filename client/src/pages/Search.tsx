import { Search as SearchIcon, Loader2, X, Pencil, History, Columns3, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiGet, apiRequest, railcarsQs } from "@/lib/queryClient";
import { carListSearchTokens } from "@shared/programs";
import { displayLeaseNumber } from "@shared/residco-import";
import { formatCalendarDate, carLeaseEndDate } from "@shared/lease-authority";
import { FleetMembershipBadge, FleetAwareStatusBadge, InactiveFleetBadge } from "@/components/InactiveFleetBadge";
import { LeaseTypeBadge } from "@/components/LeaseTypeBadge";
import { OpsFlagBadge } from "@/components/OpsFlagBadge";
import { displayStatusInputFromRailcar } from "@shared/fleet-status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { carPath, historyPath, openAppTab } from "@/lib/browse-nav";
import {
  persistSearchQuery,
  readInitialSearchQuery,
  readSearchSession,
  saveSearchSession,
  clearSearchSession,
  shouldRestoreSearchSession,
} from "@/lib/search-query";
import { RailcarDetailSheet } from "@/pages/FleetRegistry";
import { LeaseGlanceSheet, glanceRiderFromCar, type LeaseGlanceRider } from "@/components/LeaseGlanceSheet";
import { formatAmNoteSnippet } from "@/components/AmCommentThread";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { colWidth, mergeColOrder, moveCol, tableWidthFor } from "@/lib/grid-columns";
import { GridColumnTh } from "@/components/GridColumnTh";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { carBuildYear } from "@shared/build-year";

type SearchScope = { leases: boolean; cars: boolean; carData: boolean };

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
  { key: "oec", label: "OEC" },
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

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [scope, setScope] = useState<SearchScope>(DEFAULT_SCOPE);
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [pasteRows, setPasteRows] = useState<any[] | null>(null);
  const [pasteMissing, setPasteMissing] = useState<string[]>([]);
  const [pasteLoading, setPasteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editCarId, setEditCarId] = useState<number | null>(null);
  const [leaseGlance, setLeaseGlance] = useState<LeaseGlanceRider | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pageSize = 75;

  const {
    visibleCols: visibleColsRaw,
    toggleCol,
    resetCols,
    prefsLoaded,
    colOrder,
    setColOrder,
    colWidths,
    setColWidth,
  } = useColumnPrefs("search_results", SEARCH_DEFAULT_COLS);
  const visibleCols = visibleColsRaw as Set<OptCol>;

  const isPaste = Boolean(committed && carListSearchTokens(committed));
  const listParams = {
    page,
    pageSize,
    search: committed || undefined,
    active: showInactive ? "all" : "active",
    search_cars: scope.cars ? 1 : 0,
    search_leases: scope.leases ? 1 : 0,
    search_car_data: scope.carData ? 1 : 0,
  };

  type RailcarPage = { rows: any[]; total_count: number; page: number; pageSize: number };
  const textQuery = useQuery<RailcarPage>({
    queryKey: ["/api/railcars", "search-page", listParams],
    queryFn: ({ signal }) => apiGet<RailcarPage>(railcarsQs(listParams), { timeoutMs: 20_000, signal }),
    enabled: Boolean(committed) && !isPaste,
    staleTime: 30_000,
  });

  const rows = isPaste ? (pasteRows ?? []) : (textQuery.data?.rows ?? []);
  const totalCount = isPaste ? (pasteRows?.length ?? 0) : (textQuery.data?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const loading = isPaste ? pasteLoading : textQuery.isLoading;
  const pageRows = isPaste
    ? rows.slice((page - 1) * pageSize, page * pageSize)
    : rows;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = readInitialSearchQuery();
    const session = readSearchSession();
    const wantRestore = shouldRestoreSearchSession();
    if (session?.query && (wantRestore || (q && session.query === q))) {
      setQuery(session.query);
      setCommitted(session.query);
      const f = session.filters as any;
      if (f) {
        setShowInactive(f.active === "all" || f.showInactive === true);
        if (typeof f.scopeLeases === "boolean" || typeof f.scopeCars === "boolean") {
          setScope({
            leases: f.scopeLeases !== false,
            cars: f.scopeCars !== false,
            carData: Boolean(f.scopeCarData),
          });
        }
      }
      persistSearchQuery(session.query);
      if (carListSearchTokens(session.query) && Array.isArray((session.results as any)?.railcars)) {
        setPasteRows((session.results as any).railcars);
        setPasteMissing((session.results as any).not_found ?? []);
      }
      return;
    }
    if (q) {
      setQuery(q);
      void runSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!committed) return;
    saveSearchSession({
      query: committed,
      results: isPaste ? { railcars: pasteRows ?? [], not_found: pasteMissing, riders: [], leases: [], counts: { railcars: totalCount, riders: 0, leases: 0, total: totalCount } } : { railcars: [], riders: [], leases: [], not_found: [], counts: { railcars: totalCount, riders: 0, leases: 0, total: totalCount } },
      filters: {
        active: showInactive ? "all" : "active",
        rental: "all",
        lessee: "all",
        ol: "all",
        showInactive,
        scopeLeases: scope.leases,
        scopeCars: scope.cars,
        scopeCarData: scope.carData,
      } as any,
    });
  }, [committed, pasteRows, pasteMissing, isPaste, showInactive, scope, totalCount]);

  async function runSearch(q: string, nextScope = scope, nextInactive = showInactive) {
    const trimmed = q.trim();
    if (!trimmed) {
      setPasteRows(null);
      setPasteMissing([]);
      setCommitted("");
      clearSearchSession();
      return;
    }
    setError(null);
    setPage(1);
    persistSearchQuery(trimmed);
    const paste = carListSearchTokens(trimmed);
    if (paste) {
      setPasteLoading(true);
      try {
        const res = await apiRequest("POST", "/api/search", {
          q: trimmed,
          active: nextInactive ? "all" : "active",
          search_cars: nextScope.cars ? 1 : 0,
          search_leases: nextScope.leases ? 1 : 0,
          search_car_data: nextScope.carData ? 1 : 0,
        });
        const data = await res.json();
        setPasteRows(data.railcars ?? []);
        setPasteMissing(data.not_found ?? []);
        setCommitted(trimmed);
      } catch (e: any) {
        setError(e.message ?? "Search failed");
      } finally {
        setPasteLoading(false);
      }
      return;
    }
    setPasteRows(null);
    setPasteMissing([]);
    setCommitted(trimmed);
  }

  function submit() {
    if (!query.trim()) return;
    void runSearch(query);
  }

  function clear() {
    setQuery("");
    setCommitted("");
    setPasteRows(null);
    setPasteMissing([]);
    setError(null);
    setPage(1);
    clearSearchSession();
    inputRef.current?.focus();
  }

  function setScopeFlag(key: keyof SearchScope, next: boolean) {
    if (!next && !Object.entries(scope).some(([k, v]) => k !== key && v)) return;
    const nextScope = { ...scope, [key]: next };
    setScope(nextScope);
    if (committed) void runSearch(committed, nextScope, showInactive);
  }

  const parsedCars = carListSearchTokens(query);
  const displayKeys = useMemo(() => {
    const movable = [...CORE_MOVABLE, ...OPT_COLS.filter((c) => visibleCols.has(c.key)).map((c) => c.key)];
    return [...PINNED_START, ...mergeColOrder(movable, colOrder), ...PINNED_END];
  }, [visibleCols, colOrder]);
  const movableKeys = displayKeys.filter(
    (k) => !(PINNED_START as readonly string[]).includes(k) && !(PINNED_END as readonly string[]).includes(k),
  );
  const tableW = tableWidthFor(displayKeys, colWidths, WIDTHS, 110);
  const missing = pasteMissing;
  const pasteCount = committed ? carListSearchTokens(committed)?.length ?? 0 : 0;
  const committedLabel = pasteCount > 1 ? `${pasteCount} cars` : `"${committed}"`;
  const hasResults = Boolean(committed) && (totalCount > 0 || missing.length > 0);
  const noResults = Boolean(committed) && !loading && totalCount === 0 && missing.length === 0;
  const loadError = !isPaste && textQuery.isError ? ((textQuery.error as Error)?.message || "Search failed") : error;

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
              <button type="button" className="hover:text-primary hover:underline" onClick={() => openAppTab(carPath(r.id))}>
                {r.car_number}
              </button>
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
                onClick={() => {
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
                onClick={() => {
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
              <button type="button" className="p-1 text-muted-foreground hover:text-foreground" title="Edit" onClick={() => setEditCarId(r.id)}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="p-1 text-muted-foreground hover:text-foreground"
                title="History"
                onClick={() => openAppTab(historyPath([r.reporting_marks, r.car_number].filter(Boolean).join(" ")))}
              >
                <History className="h-3.5 w-3.5" />
              </button>
            </div>
          </td>
        );
      default:
        return renderOptTd(key, r);
    }
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 sm:px-8 pt-6 pb-4 max-w-[1400px] w-full mx-auto">
        <div className="font-eyebrow mb-1.5">RLMS</div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Defaults to active cars. Check Car data to match type/description (e.g. J311 or gon). Paste a column of cars from Excel when needed.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <ScopeBox id="search-scope-leases" label="Lease/OL info" checked={scope.leases} onChange={(v) => setScopeFlag("leases", v)} />
          <ScopeBox id="search-scope-cars" label="Car numbers" checked={scope.cars} onChange={(v) => setScopeFlag("cars", v)} />
          <ScopeBox id="search-scope-data" label="Car data" checked={scope.carData} onChange={(v) => setScopeFlag("carData", v)} />
          <ScopeBox
            id="search-show-inactive"
            label="Show inactive / historical"
            checked={showInactive}
            onChange={(v) => {
              setShowInactive(v);
              if (committed) void runSearch(committed, scope, v);
            }}
          />
        </div>

        <div className="relative mt-3 flex gap-2 items-start">
          <div className="relative flex-1">
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
              placeholder={"HWCX 10823\nHWCX 10841\nor a lessee / OL / J311 / gon"}
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
        {parsedCars && (
          <div className="mt-2 text-xs text-muted-foreground">
            {parsedCars.length} cars in this list
            {query.includes("\n") ? " · Ctrl+Enter to search" : ""}
          </div>
        )}
      </div>

      {!committed && !loading && (
        <div className="px-4 sm:px-8 pb-8 max-w-[1400px] w-full mx-auto grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Paste a car list", example: "HWCX10823\nHWCX10841", sub: "Excel column, commas, or MARK + number" },
            { label: "Lessee / OL", example: "BNSF", sub: "lease and rider fields" },
            { label: "AAR type (car data)", example: "J311", sub: "check Car data first" },
            { label: "Description (car data)", example: "gon", sub: "matches Gondola, Mill Gondola, …" },
          ].map((tip) => (
            <button
              key={tip.example}
              type="button"
              onClick={() => {
                const nextScope = tip.example === "J311" || tip.example === "gon" ? { ...scope, carData: true } : scope;
                setScope(nextScope);
                setQuery(tip.example);
                persistSearchQuery(tip.example);
                void runSearch(tip.example, nextScope, showInactive);
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
        <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-8 pb-4 max-w-[1400px] w-full mx-auto gap-3">
          <div className="shrink-0 flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Columns3 className="h-3.5 w-3.5" />
                  Columns
                  {!prefsLoaded ? (
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
                  <DropdownMenuCheckboxItem key={key} checked={visibleCols.has(key)} onCheckedChange={() => toggleCol(key)}>
                    {label}
                  </DropdownMenuCheckboxItem>
                ))}
                {visibleCols.size > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-xs text-muted-foreground" onClick={() => resetCols()}>
                      Reset to default
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="text-xs text-muted-foreground">
              {loading ? "Searching…" : `${totalCount.toLocaleString()} car${totalCount !== 1 ? "s" : ""}`}
              {missing.length > 0 ? ` · ${missing.length} not in fleet` : ""}
              {" for "}
              <span className="text-foreground font-medium">{committedLabel}</span>
              {!showInactive ? " · active fleet" : " · including inactive"}
            </div>
          </div>

          {loadError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm px-4 py-3">{loadError}</div>
          )}

          {missing.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <div className="text-amber-400 font-medium mb-1">Not in fleet</div>
              <div className="font-mono text-xs text-foreground whitespace-pre-wrap">{missing.join(", ")}</div>
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
              No results for <span className="text-foreground font-medium">{committedLabel}</span>
              {!scope.carData ? ". Turn on Car data to match type or description." : "."}
            </div>
          )}

          {hasResults && !loading && pageRows.length > 0 && (
            <div className="flex-1 min-h-[240px] rounded-lg border border-card-border bg-card overflow-hidden flex flex-col">
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="text-sm" style={{ tableLayout: "fixed", width: Math.max(700, tableW) }}>
                  <colgroup>
                    {displayKeys.map((k) => (
                      <col key={k} style={{ width: colWidth(colWidths, k, WIDTHS[k] ?? 110) }} />
                    ))}
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))]">
                    <tr className="text-left">
                      {displayKeys.map((key) => {
                        const pinned =
                          (PINNED_START as readonly string[]).includes(key) ||
                          (PINNED_END as readonly string[]).includes(key);
                        return (
                          <GridColumnTh
                            key={key}
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
                            {key === "_actions" ? null : LABELS[key] ?? OPT_COLS.find((c) => c.key === key)?.label ?? key}
                          </GridColumnTh>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-border hover-elevate cursor-pointer"
                        onClick={() => setEditCarId(r.id)}
                        data-testid={`row-search-car-${r.id}`}
                      >
                        {displayKeys.map((k) => cell(k, r))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground bg-card">
                <span>
                  {totalCount.toLocaleString()} cars
                  {totalCount > 0 ? ` · page ${page} of ${totalPages}` : ""}
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
          )}
        </div>
      )}

      <RailcarDetailSheet carId={editCarId} onClose={() => setEditCarId(null)} />
      <LeaseGlanceSheet rider={leaseGlance} onClose={() => setLeaseGlance(null)} />
    </div>
  );
}
