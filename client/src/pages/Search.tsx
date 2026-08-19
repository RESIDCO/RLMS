import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Search as SearchIcon, Train, FileText, BookOpen, Building2, Loader2, X, Pencil, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { carListSearchTokens } from "@shared/programs";
import { displayLeaseNumber } from "@shared/residco-import";
import { formatCalendarDate } from "@shared/lease-authority";
import { FleetMembershipBadge, FleetAwareStatusBadge } from "@/components/InactiveFleetBadge";
import { LeaseTypeBadge } from "@/components/LeaseTypeBadge";
import { asOne, resolveLeaseType } from "@shared/lease-type";
import { displayStatusInputFromRailcar } from "@shared/fleet-status";
import { Button } from "@/components/ui/button";
import { carPath, lesseePath, olPath, olKeyFromLabel, historyPath, openAppTab } from "@/lib/browse-nav";
import { persistSearchQuery, readInitialSearchQuery } from "@/lib/search-query";
import { RailcarDetailSheet } from "@/pages/FleetRegistry";

interface MasterLease {
  id: number;
  lease_number: string;
  agreement_number: string | null;
  lessor: string | null;
  lessee: string | null;
  lease_type: string | null;
  effective_date: string | null;
}

interface Rider {
  id: number;
  rider_name: string;
  schedule_number: string | null;
  expiration_date: string | null;
  car_count: number;
  master_lease: { id: number; lease_number: string; lessee: string | null; lease_type?: string | null } | null;
}

interface RailcarResult {
  id: number;
  car_number: string;
  reporting_marks: string | null;
  car_type: string | null;
  status: string | null;
  entity: string | null;
  active?: boolean | null;
  mechanical_designation: string | null;
  lessee_name?: string | null;
  rider_external_id?: string | null;
  lease_type?: string | null;
  assignment: {
    id: number;
    fleet_name: string | null;
    sub_lease_number: string | null;
    sublease_expiration_date: string | null;
    assigned_at: string | null;
    rider: {
      id: number;
      rider_name: string;
      schedule_number: string | null;
      expiration_date: string | null;
      master_lease: {
        id: number;
        lease_number: string;
        lessor: string | null;
        lessee: string | null;
        lease_type?: string | null;
      } | null;
    } | null;
  } | null;
}

interface SearchResults {
  query: string;
  terms: string[];
  railcars: RailcarResult[];
  riders: Rider[];
  leases: MasterLease[];
  not_found?: string[];
  counts: { railcars: number; riders: number; leases: number; total: number };
}

function fmt(date: string | null | undefined) {
  return formatCalendarDate(date);
}

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

function SectionHeader({ icon: Icon, label, count }: { icon: any; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">{label}</h2>
      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
        {count} result{count !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

function carLabel(car: RailcarResult) {
  return [car.reporting_marks, car.car_number].filter(Boolean).join(" ");
}

function RailcarRow({
  car,
  onOpen,
  onEdit,
  onHistory,
}: {
  car: RailcarResult;
  onOpen: () => void;
  onEdit: () => void;
  onHistory: () => void;
}) {
  const rider = asOne(car.assignment?.rider);
  const lease = asOne(rider?.master_lease);
  const leaseType = resolveLeaseType(car.lease_type, lease?.lease_type);
  const label = carLabel(car);
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/40 last:border-0 hover:bg-muted/30">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 flex items-start gap-4 text-left"
      >
        <div className="min-w-[140px]">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <EntityBadge entity={car.entity} />
            <FleetMembershipBadge active={car.active} />
            <LeaseTypeBadge carType={car.lease_type} mlaType={lease?.lease_type} />
          </div>
          <div className="font-mono text-sm font-semibold text-foreground">
            {label}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {car.car_type ?? "—"}
            {car.mechanical_designation ? ` · ${car.mechanical_designation}` : ""}
          </div>
        </div>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground mb-0.5">Fleet / Lessee</div>
            <div className="text-foreground font-medium">
              {car.assignment?.fleet_name ?? car.lessee_name ?? <span className="text-muted-foreground italic">Unassigned</span>}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-0.5">Rider</div>
            <div className="text-foreground">{rider?.rider_name ?? car.rider_external_id ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground mb-0.5">Master Lease</div>
            <div className="text-foreground">{displayLeaseNumber(lease?.lease_number) || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground mb-0.5">Lease Type</div>
            <div className="text-foreground">{leaseType ?? "—"}</div>
          </div>
        </div>
        <div className="shrink-0">
          <FleetAwareStatusBadge car={displayStatusInputFromRailcar(car as any)} />
        </div>
      </button>
      <div className="shrink-0 flex items-center gap-0.5 pt-0.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={`Edit ${label}`}
          data-testid={`button-search-edit-${car.id}`}
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={`View history for ${label}`}
          data-testid={`button-search-history-${car.id}`}
          onClick={onHistory}
        >
          <History className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function RiderRow({ rider, onOpen }: { rider: Rider; onOpen: () => void }) {
  const expired = rider.expiration_date && new Date(rider.expiration_date) < new Date();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-4 py-3 border-b border-border/40 last:border-0 text-xs text-left hover:bg-muted/30"
    >
      <div className="min-w-[120px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="text-sm font-semibold text-foreground">{rider.rider_name}</div>
          <LeaseTypeBadge mlaType={asOne(rider.master_lease)?.lease_type} />
        </div>
        {rider.schedule_number && <div className="text-muted-foreground mt-0.5">Sch {rider.schedule_number}</div>}
      </div>
      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <div className="text-muted-foreground mb-0.5">Master Lease</div>
          <div className="text-foreground">{displayLeaseNumber(rider.master_lease?.lease_number) || "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Lessee</div>
          <div className="text-foreground">{rider.master_lease?.lessee ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Lease Type</div>
          <div className="text-foreground">{asOne(rider.master_lease)?.lease_type ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Expiration</div>
          <div className={cn("font-medium", expired ? "text-red-400" : "text-foreground")}>{fmt(rider.expiration_date)}</div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-muted-foreground text-[11px]">Cars</div>
        <div className="font-semibold text-foreground">{rider.car_count}</div>
      </div>
    </button>
  );
}

function LeaseRow({ lease, onOpen }: { lease: MasterLease; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-4 py-3 border-b border-border/40 last:border-0 text-xs text-left hover:bg-muted/30"
    >
      <div className="min-w-[120px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="text-sm font-semibold text-foreground">{displayLeaseNumber(lease.lease_number)}</div>
          <LeaseTypeBadge mlaType={lease.lease_type} />
        </div>
        {lease.agreement_number && <div className="text-muted-foreground mt-0.5">Agmt {lease.agreement_number}</div>}
      </div>
      <div className="flex-1 grid grid-cols-3 gap-3">
        <div>
          <div className="text-muted-foreground mb-0.5">Lessor</div>
          <div className="text-foreground">{lease.lessor ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Lessee</div>
          <div className="text-foreground">{lease.lessee ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Type</div>
          <div className="text-foreground capitalize">{lease.lease_type ?? "—"}</div>
        </div>
      </div>
      <div className="shrink-0">
        <div className="text-muted-foreground text-[11px]">Effective</div>
        <div className="text-foreground">{fmt(lease.effective_date)}</div>
      </div>
    </button>
  );
}

export default function SearchPage() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editCarId, setEditCarId] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = readInitialSearchQuery();
    if (q) {
      setQuery(q);
      runSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults(null);
      setCommitted("");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const usePost = trimmed.length > 1400 || /[\n\r]/.test(trimmed) || Boolean(carListSearchTokens(trimmed));
      const res = usePost
        ? await apiRequest("POST", "/api/search", { q: trimmed })
        : await apiRequest("GET", `/api/search?q=${encodeURIComponent(trimmed)}`);
      const data: SearchResults = await res.json();
      setResults(data);
      setCommitted(trimmed);
    } catch (e: any) {
      setError(e.message ?? "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    persistSearchQuery(trimmed);
    runSearch(trimmed);
  }

  function clear() {
    setQuery("");
    setResults(null);
    setCommitted("");
    setError(null);
    inputRef.current?.focus();
  }

  const parsedCars = carListSearchTokens(query);
  const lesseeNames: string[] = [];
  const seenLessee: Record<string, true> = {};
  const addLessee = (name: string | null | undefined) => {
    const n = String(name ?? "").trim();
    if (!n || seenLessee[n]) return;
    seenLessee[n] = true;
    lesseeNames.push(n);
  };
  for (const l of results?.leases ?? []) addLessee(l.lessee);
  for (const c of results?.railcars ?? []) {
    addLessee(c.lessee_name || c.assignment?.fleet_name || c.assignment?.rider?.master_lease?.lessee);
  }

  const missing = results?.not_found ?? [];
  const pasteCount = committed ? carListSearchTokens(committed)?.length ?? 0 : 0;
  const committedLabel = pasteCount > 1 ? `${pasteCount} cars` : `"${committed}"`;
  const hasResults = results && (results.counts.total > 0 || missing.length > 0);
  const noResults = results && results.counts.total === 0 && missing.length === 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="font-eyebrow mb-1.5">RLMS</div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Press Enter or Search. Paste a column of cars from Excel — one per line, commas, or MARK + number.
        </p>
      </div>

      <div className="relative mb-6 flex gap-2 items-start">
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
            placeholder={"HWCX 10823\nHWCX 10841\nor a lessee / OL"}
            className="w-full min-h-[2.75rem] resize-y bg-card border border-border rounded-lg pl-10 pr-10 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={clear}
              className="absolute right-3 top-3.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button type="button" onClick={submit} className="shrink-0 h-[2.75rem]" data-testid="button-search-submit">
          Search
        </Button>
      </div>
      {parsedCars && (
        <div className="-mt-4 mb-4 text-xs text-muted-foreground">
          {parsedCars.length} cars in this list
          {query.includes("\n") ? " · Ctrl+Enter to search" : ""}
        </div>
      )}

      {!results && !loading && (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Paste a car list", example: "HWCX10823\nHWCX10841", sub: "Excel column, commas, or MARK + number" },
            { label: "Lessee name", example: "BNSF", sub: "opens lessee → OL list" },
            { label: "Rider / OL", example: "OL2341", sub: "or schedule number" },
            { label: "Lease number", example: "H07-099", sub: "or agreement number" },
          ].map((tip) => (
            <button
              key={tip.example}
              type="button"
              onClick={() => {
                setQuery(tip.example);
                persistSearchQuery(tip.example);
                runSearch(tip.example);
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

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching…
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">{error}</div>
      )}

      {noResults && !loading && (
        <div className="mt-8 text-center text-muted-foreground text-sm">
          No results for <span className="text-foreground font-medium">{committedLabel}</span>.
        </div>
      )}

      {hasResults && !loading && (
        <div className="mt-6 space-y-8">
          <div className="text-xs text-muted-foreground">
            {results.railcars.length} car{results.railcars.length !== 1 ? "s" : ""}
            {missing.length > 0 ? ` · ${missing.length} not in fleet` : ""}
            {" for "}
            <span className="text-foreground font-medium">{committedLabel}</span>
          </div>

          {missing.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <div className="text-amber-400 font-medium mb-1">Not in fleet</div>
              <div className="font-mono text-xs text-foreground whitespace-pre-wrap">{missing.join(", ")}</div>
            </div>
          )}

          {results.railcars.length > 0 && (
            <section>
              <SectionHeader icon={Train} label="Railcars" count={results.railcars.length} />
              <div className="rounded-lg border border-border bg-card px-4">
                {results.railcars.map((car) => (
                  <RailcarRow
                    key={car.id}
                    car={car}
                    onOpen={() => navigate(carPath(car.id))}
                    onEdit={() => setEditCarId(car.id)}
                    onHistory={() => openAppTab(historyPath(carLabel(car)))}
                  />
                ))}
              </div>
            </section>
          )}

          {lesseeNames.length > 0 && (
            <section>
              <SectionHeader icon={Building2} label="Lessees" count={lesseeNames.length} />
              <div className="rounded-lg border border-border bg-card px-4">
                {lesseeNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => navigate(lesseePath(name))}
                    className="w-full text-left py-3 border-b border-border/40 last:border-0 text-sm font-medium hover:text-primary"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {results.riders.length > 0 && (
            <section>
              <SectionHeader icon={FileText} label="Riders / Schedules" count={results.riders.length} />
              <div className="rounded-lg border border-border bg-card px-4">
                {results.riders.map((rider) => (
                  <RiderRow
                    key={rider.id}
                    rider={rider}
                    onOpen={() => navigate(olPath(olKeyFromLabel(rider.rider_name) ?? rider.rider_name))}
                  />
                ))}
              </div>
            </section>
          )}

          {results.leases.length > 0 && (
            <section>
              <SectionHeader icon={BookOpen} label="Master Leases" count={results.leases.length} />
              <div className="rounded-lg border border-border bg-card px-4">
                {results.leases.map((lease) => (
                  <LeaseRow
                    key={lease.id}
                    lease={lease}
                    onOpen={() => {
                      if (lease.lessee) navigate(lesseePath(lease.lessee));
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <RailcarDetailSheet carId={editCarId} onClose={() => setEditCarId(null)} />
    </div>
  );
}
