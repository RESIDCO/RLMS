import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { geoAlbersUsa, geoCentroid, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { ArrowLeft, ChevronDown, Pencil } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { confirmAction } from "@/components/ConfirmActionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useCanEdit, useIsAdmin } from "@/lib/AuthContext";
import { accountListPath, readAccountMgmtListState } from "@/lib/account-mgmt-nav";
import { contactsDirectoryPath } from "@/lib/directory-nav";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";

type Owner = { initials: string; full_name: string; color_hex: string; is_active: boolean; sort_order: number };
type OwnerStat = { initials: string; counties: number; states: number };
type MapPayload = {
  owners: Owner[];
  counties: Record<string, string | null>;
  countyMeta: Record<string, { state: string; name: string }>;
  splitStates: string[];
  wholeStates: Record<string, string | null>;
  ownerStats: OwnerStat[];
};
type ContactAgg = {
  total: number;
  buckets: Record<string, number>;
  bucket_sum: number;
  counties: Record<string, number>;
  zips: { zip: string; lat: number; lng: number; count: number }[];
};
type ContactRow = {
  contact_id: number;
  company_id: number;
  contact_name: string | null;
  title: string | null;
  company_name: string | null;
  relationship_type: string | null;
  priority_tier: string | null;
  pipeline_status: string | null;
  account_manager: string | null;
  territory_owner: string | null;
  city: string | null;
  state_raw: string | null;
  zip5: string | null;
  has_ol_link: boolean;
  ol_numbers: string[];
};
type FC = { type: "FeatureCollection"; features: CountyFeat[] };
type CountyFeat = {
  type: "Feature";
  id: string;
  properties: { name: string; statefp: string };
  geometry: GeoPermissibleObjects;
};

const VIEW_KEY = "rlms-territory-map-view";
const UNASSIGNED = "#9CA3AF";
const W = 960;
const H = 580;
const COUNTY_ZOOM = 1.65;

/** Okabe–Ito + a few extras: distinct on a filled map, colorblind-safer than a free picker. */
const REP_PALETTE = [
  "#0072B2",
  "#D55E00",
  "#009E73",
  "#CC79A7",
  "#56B4E9",
  "#E69F00",
  "#882255",
  "#44AA99",
  "#332288",
  "#999933",
];

const BUCKETS: { id: string; label: string }[] = [
  { id: "mapped_county", label: "Mapped county" },
  { id: "state_only", label: "State only (no ZCTA)" },
  { id: "outside_us_canada", label: "Canada" },
  { id: "outside_us_other", label: "Other non-US" },
  { id: "no_location", label: "No location" },
  { id: "split_state_unresolved", label: "Split state, no zip" },
];

function sideOfLine(a: [number, number], b: [number, number], p: [number, number]) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

function normHex(h: string) {
  return h.trim().toUpperCase();
}

export default function TerritoryMapPage() {
  const [, navigate] = useLocation();
  const canEdit = useCanEdit();
  const isAdmin = useIsAdmin();
  const { toast } = useToast();
  const qc = useQueryClient();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<"sales" | "contacts">(() => {
    try {
      return sessionStorage.getItem(VIEW_KEY) === "contacts" ? "contacts" : "sales";
    } catch {
      return "sales";
    }
  });
  const [geo, setGeo] = useState<FC | null>(null);
  const [stateGeo, setStateGeo] = useState<FC | null>(null);
  const [editOn, setEditOn] = useState(false);
  const [tool, setTool] = useState<"state" | "county" | "split">("state");
  const [paintOwner, setPaintOwner] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string | null>>({});
  const [note, setNote] = useState("");
  const [splitPts, setSplitPts] = useState<[number, number][]>([]);
  const [splitState, setSplitState] = useState<string | null>(null);
  const [splitOwners, setSplitOwners] = useState<[string, string]>(["BH", "FF"]);
  const [flip, setFlip] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [mapScale, setMapScale] = useState(1);
  const [histOpen, setHistOpen] = useState(false);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [filters, setFilters] = useState({
    relationship_type: "",
    priority_tier: "",
    pipeline_status: "",
    owner: "",
    q: "",
    linked_to_ol: false,
    location_status: "",
  });
  const [panel, setPanel] = useState<{ county?: string; state?: string; location_status?: string } | null>(null);
  const [showChoropleth, setShowChoropleth] = useState(true);
  const [showPins, setShowPins] = useState(true);
  const [applyBusy, setApplyBusy] = useState(false);

  useEffect(() => {
    try { sessionStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  useEffect(() => {
    fetch("/geo/us-counties-2020.json")
      .then((r) => r.json())
      .then(setGeo)
      .catch(() => toast({ title: "Could not load county map", variant: "destructive" }));
    fetch("/geo/us-states.json")
      .then((r) => r.json())
      .then(setStateGeo)
      .catch(() => { /* state outlines are visual only */ });
  }, [toast]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.12;
      setMapScale((s) => Math.min(4, Math.max(1, Number((s * factor).toFixed(3)))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [geo]);

  const mapQ = useQuery<MapPayload>({
    queryKey: ["/api/territories/map"],
    queryFn: () => apiRequest("GET", "/api/territories/map").then((r) => r.json()),
  });
  const histQ = useQuery<{ change_sets: { change_set_id: string; changed_at: string; changed_by: string | null; note: string | null; counties: number }[] }>({
    queryKey: ["/api/territories/history"],
    queryFn: () => apiRequest("GET", "/api/territories/history?limit=30").then((r) => r.json()),
    enabled: editOn,
  });

  const contactQs = new URLSearchParams();
  if (filters.relationship_type) contactQs.set("relationship_type", filters.relationship_type);
  if (filters.priority_tier) contactQs.set("priority_tier", filters.priority_tier);
  if (filters.pipeline_status) contactQs.set("pipeline_status", filters.pipeline_status);
  if (filters.owner) contactQs.set("owner", filters.owner);
  if (filters.q) contactQs.set("q", filters.q);
  if (filters.linked_to_ol) contactQs.set("linked_to_ol", "1");
  if (filters.location_status) contactQs.set("location_status", filters.location_status);

  const contactsQ = useQuery<ContactAgg>({
    queryKey: ["/api/territories/contacts", contactQs.toString()],
    queryFn: () => apiRequest("GET", `/api/territories/contacts?${contactQs}`).then((r) => r.json()),
    enabled: view === "contacts",
  });

  const listQs = new URLSearchParams(contactQs);
  if (panel?.county) listQs.set("county", panel.county);
  if (panel?.state) listQs.set("state", panel.state);
  if (panel?.location_status) listQs.set("location_status", panel.location_status);
  const listQ = useQuery<{ total: number; rows: ContactRow[] }>({
    queryKey: ["/api/territories/contacts/list", listQs.toString()],
    queryFn: () => apiRequest("GET", `/api/territories/contacts/list?${listQs}&limit=120`).then((r) => r.json()),
    enabled: view === "contacts" && !!panel,
  });

  const owners = mapQ.data?.owners ?? [];
  const statsByIni = useMemo(() => {
    const m = new Map((mapQ.data?.ownerStats ?? []).map((s) => [s.initials, s]));
    return m;
  }, [mapQ.data?.ownerStats]);
  const colorOf = useMemo(() => {
    const m = new Map(owners.map((o) => [o.initials, o.color_hex]));
    return (ini: string | null | undefined) => (ini && m.get(ini)) || UNASSIGNED;
  }, [owners]);
  const usedByColor = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const o of owners) {
      if (!o.is_active) continue;
      const k = normHex(o.color_hex);
      const list = m.get(k) ?? [];
      list.push(o.initials);
      m.set(k, list);
    }
    return m;
  }, [owners]);

  const projection = useMemo(() => {
    if (!geo) return null;
    return geoAlbersUsa().fitExtent([[8, 8], [W - 8, H - 8]], geo as GeoPermissibleObjects);
  }, [geo]);
  const pathGen = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  const centroids = useMemo(() => {
    const m = new Map<string, [number, number]>();
    if (!geo || !projection) return m;
    for (const f of geo.features) {
      const c = geoCentroid(f as GeoPermissibleObjects);
      const p = projection(c as [number, number]);
      if (p) m.set(String(f.id), p as [number, number]);
    }
    return m;
  }, [geo, projection]);

  const splitPreview = useMemo(() => {
    const out = new Map<string, "a" | "b">();
    if (!splitState || splitPts.length < 2 || !mapQ.data) return out;
    const [p1, p2] = splitPts;
    for (const [fips, meta] of Object.entries(mapQ.data.countyMeta)) {
      if (meta.state !== splitState) continue;
      const c = centroids.get(fips);
      if (!c) continue;
      let side: "a" | "b" = sideOfLine(p1, p2, c) >= 0 ? "a" : "b";
      if (flip.has(fips)) side = side === "a" ? "b" : "a";
      out.set(fips, side);
    }
    return out;
  }, [splitState, splitPts, mapQ.data, centroids, flip]);

  function ownerOf(fips: string): string | null {
    if (pending[fips] !== undefined) return pending[fips];
    return mapQ.data?.counties[fips] ?? null;
  }

  function countiesInState(st: string) {
    return Object.entries(mapQ.data?.countyMeta ?? {})
      .filter(([, m]) => m.state === st)
      .map(([f]) => f);
  }

  const zoomedIn = mapScale >= COUNTY_ZOOM;
  const showAllCountyLines = view === "contacts" || zoomedIn || (editOn && (tool === "county" || tool === "split"));

  const pendingFips = Object.keys(pending);
  const pendingStates = useMemo(() => {
    const s = new Set<string>();
    for (const f of pendingFips) {
      const st = mapQ.data?.countyMeta[f]?.state;
      if (st) s.add(st);
    }
    return s.size;
  }, [pendingFips, mapQ.data?.countyMeta]);

  const hasDraft = pendingFips.length > 0 || (tool === "split" && splitPreview.size > 0 && splitPts.length >= 2);
  const canApply = !applyBusy && hasDraft && (tool === "split" || !!paintOwner);

  const statusLine = (() => {
    if (tool === "split") {
      if (!splitState) return "Split a state: click two points across a state, then click counties to flip sides.";
      if (splitPts.length < 2) return `Split ${splitState}: click the second point.`;
      return `Split ${splitState} — ${splitOwners[0]} / ${splitOwners[1]}`;
    }
    if (!paintOwner) return "Pick a rep, then click the map.";
    if (!pendingFips.length) return "Nothing selected yet";
    if (tool === "state") {
      const n = pendingStates;
      return `Painting ${paintOwner} — ${n} state${n === 1 ? "" : "s"} selected`;
    }
    const n = pendingFips.length;
    return `Painting ${paintOwner} — ${n} count${n === 1 ? "y" : "ies"} selected`;
  })();

  function onCountyClick(fips: string, ev?: React.MouseEvent) {
    if (view === "contacts") {
      setPanel({ county: fips });
      return;
    }
    if (!editOn || !canEdit) return;
    const st = mapQ.data?.countyMeta[fips]?.state;
    if (tool === "split") {
      if (!st) return;
      const node = ev?.currentTarget as SVGGraphicsElement | undefined;
      const svg = node?.ownerSVGElement;
      if (!svg || !ev || !node) return;
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const ctm = node.getScreenCTM();
      if (!ctm) return;
      const loc = pt.matrixTransform(ctm.inverse());
      const xy: [number, number] = [loc.x, loc.y];
      if (!splitState) {
        setSplitState(st);
        setSplitPts([xy]);
        const cur = mapQ.data?.wholeStates[st] || paintOwner;
        const other = owners.find((o) => o.initials !== cur && o.is_active)?.initials || paintOwner || "BH";
        setSplitOwners([cur || paintOwner || "BH", other]);
        setFlip(new Set());
        return;
      }
      if (splitPts.length === 1) {
        setSplitPts([splitPts[0], xy]);
        return;
      }
      setFlip((prev) => {
        const n = new Set(prev);
        if (n.has(fips)) n.delete(fips);
        else n.add(fips);
        return n;
      });
      return;
    }
    if (!paintOwner) {
      toast({ title: "Pick a rep, then click the map." });
      return;
    }
    if (tool === "state" && st) {
      const next: Record<string, string | null> = { ...pending };
      for (const c of countiesInState(st)) next[c] = paintOwner;
      setPending(next);
      return;
    }
    setPending((p) => ({ ...p, [fips]: paintOwner }));
  }

  async function applyPending() {
    const groups = new Map<string, string[]>();
    for (const [fips, owner] of Object.entries(pending)) {
      const k = owner ?? "";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(fips);
    }
    if (splitPreview.size && splitPts.length >= 2) {
      const a: string[] = [];
      const b: string[] = [];
      Array.from(splitPreview.entries()).forEach(([fips, side]) => (side === "a" ? a : b).push(fips));
      groups.clear();
      groups.set(splitOwners[0], a);
      groups.set(splitOwners[1], b);
    }
    const groupList = Array.from(groups.entries());
    if (!groupList.some(([, c]) => c.length)) {
      toast({ title: "Nothing to apply", variant: "destructive" });
      return;
    }
    setApplyBusy(true);
    try {
      const payload = {
        groups: groupList.map(([owner, counties]) => ({
          owner: owner || null,
          counties,
        })),
        note: note.trim() || undefined,
      };
      const res = await apiRequest("POST", "/api/territories/assign", payload);
      const body = await res.json();
      toast({ title: "Territories updated", description: `${body.updated ?? body.logged ?? ""} counties logged` });
      setPending({});
      setSplitPts([]);
      setSplitState(null);
      setNote("");
      await qc.invalidateQueries({ queryKey: ["/api/territories/map"] });
      await qc.invalidateQueries({ queryKey: ["/api/territories/history"] });
    } catch (e: any) {
      toast({ title: "Could not save territories", description: e.message, variant: "destructive" });
    } finally {
      setApplyBusy(false);
    }
  }

  async function revertSet(id: string) {
    try {
      await apiRequest("POST", "/api/territories/revert", { change_set_id: id });
      toast({ title: "Change set reverted" });
      await qc.invalidateQueries({ queryKey: ["/api/territories/map"] });
      await qc.invalidateQueries({ queryKey: ["/api/territories/history"] });
    } catch (e: any) {
      toast({ title: "Revert failed", description: e.message, variant: "destructive" });
    }
  }

  const maxCounty = Math.max(1, ...Object.values(contactsQ.data?.counties ?? { x: 1 }));
  const histCount = histQ.data?.change_sets?.length ?? 0;
  const withTerritory = owners.filter((o) => {
    const s = statsByIni.get(o.initials);
    return (s?.states ?? 0) > 0 || (s?.counties ?? 0) > 0;
  });
  const noTerritory = owners.filter((o) => {
    const s = statsByIni.get(o.initials);
    return (s?.states ?? 0) === 0 && (s?.counties ?? 0) === 0;
  });

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="Territory Map"
        subtitle="Sales territories by county · contact locations from the Contacts module"
        note="ZCTAs approximate USPS zips. Some PO-box and unique-org zips have no ZCTA and fall back to state-only."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              aria-label="Back to Account Management"
              title="Back to Account Management"
              onClick={() => navigate(accountListPath(readAccountMgmtListState()))}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(["sales", "contacts"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={cn(
                    "h-8 px-3 text-xs rounded-md",
                    view === v ? "bg-primary/15 text-foreground" : "text-muted-foreground",
                  )}
                  onClick={() => { setView(v); setPanel(null); setEditOn(false); }}
                >
                  {v === "sales" ? "Sales Territories" : "Contacts"}
                </button>
              ))}
            </div>
            {view === "sales" && canEdit && (
              <Button size="sm" variant={editOn ? "default" : "outline"} onClick={() => setEditOn((x) => !x)}>
                {editOn ? "Editing" : "Edit territories"}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="min-w-0">
          {view === "contacts" && (
            <div className="flex flex-wrap gap-2 mb-3 items-end">
              <FilterSelect label="Relationship" value={filters.relationship_type} onChange={(v) => setFilters((f) => ({ ...f, relationship_type: v }))} options={["", "customer", "prospect", "lessor", "railroad", "vendor", "unclassified", "other"]} />
              <FilterSelect label="Tier" value={filters.priority_tier} onChange={(v) => setFilters((f) => ({ ...f, priority_tier: v }))} options={["", "A", "B", "C", "D"]} />
              <FilterSelect label="Pipeline status" value={filters.pipeline_status} onChange={(v) => setFilters((f) => ({ ...f, pipeline_status: v }))} options={["", "target", "contacted", "in_discussion", "lost", "won"]} />
              <FilterSelect label="Territory owner" value={filters.owner} onChange={(v) => setFilters((f) => ({ ...f, owner: v }))} options={["", ...owners.map((o) => o.initials)]} />
              <div className="grid gap-1">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Search</Label>
                <Input className="h-8 w-40" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Company / contact" />
              </div>
              <label className="flex items-center gap-2 text-xs h-8">
                <input type="checkbox" checked={filters.linked_to_ol} onChange={(e) => setFilters((f) => ({ ...f, linked_to_ol: e.target.checked }))} />
                Has OL link
              </label>
              <label className="flex items-center gap-2 text-xs h-8">
                <input type="checkbox" checked={showChoropleth} onChange={(e) => setShowChoropleth(e.target.checked)} />
                County counts
              </label>
              <label className="flex items-center gap-2 text-xs h-8">
                <input type="checkbox" checked={showPins} onChange={(e) => setShowPins(e.target.checked)} />
                Zip pins
              </label>
            </div>
          )}
          {view === "contacts" && contactsQ.data && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {BUCKETS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={cn(
                    "text-[11px] px-2 py-1 rounded-full border",
                    filters.location_status === b.id ? "border-primary bg-primary/10" : "border-border text-muted-foreground",
                  )}
                  onClick={() => {
                    setFilters((f) => ({ ...f, location_status: f.location_status === b.id ? "" : b.id }));
                    setPanel({ location_status: b.id });
                  }}
                >
                  {b.label} · {contactsQ.data?.buckets[b.id] ?? 0}
                </button>
              ))}
              <span className="text-[11px] text-muted-foreground self-center ml-1">
                Total {contactsQ.data.total} · buckets {contactsQ.data.bucket_sum}
              </span>
            </div>
          )}
          {view === "contacts" && filters.relationship_type === "customer" && (contactsQ.data?.total ?? 0) < 20 && (
            <p className="text-xs text-muted-foreground mb-2">
              Customer contacts are thin on city/state/zip today. That is a Contacts data-entry gap, not a map bug.
            </p>
          )}

          {editOn && view === "sales" && (
            <div className="mb-3 space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Paint tool">
                  {([
                    { id: "state" as const, label: "Whole states" },
                    { id: "county" as const, label: "Counties" },
                    { id: "split" as const, label: "Split a state" },
                  ]).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={cn(
                        "h-8 px-3 text-xs rounded-md",
                        tool === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => { setTool(t.id); setSplitPts([]); setSplitState(null); }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {tool === "split" && (
                  <span className="text-[11px] text-muted-foreground max-w-xs">
                    Advanced: draw a line, then click counties to flip which rep they go to.
                  </span>
                )}
                {tool === "split" && splitPts.length >= 2 && (
                  <div className="flex items-center gap-2 text-xs">
                    Side A
                    <select className="h-7 border rounded bg-background" value={splitOwners[0]} onChange={(e) => setSplitOwners([e.target.value, splitOwners[1]])}>
                      {owners.filter((o) => o.is_active).map((o) => <option key={o.initials} value={o.initials}>{o.initials}</option>)}
                    </select>
                    Side B
                    <select className="h-7 border rounded bg-background" value={splitOwners[1]} onChange={(e) => setSplitOwners([splitOwners[0], e.target.value])}>
                      {owners.filter((o) => o.is_active).map((o) => <option key={o.initials} value={o.initials}>{o.initials}</option>)}
                    </select>
                  </div>
                )}
                <Input className="h-8 w-56" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" disabled={!canApply} onClick={applyPending}>Apply</Button>
                <Button size="sm" variant="ghost" onClick={() => { setPending({}); setSplitPts([]); setSplitState(null); }}>Clear draft</Button>
              </div>
              <div className="text-xs text-muted-foreground">{statusLine}</div>
            </div>
          )}

          {editOn && view === "sales" && (
            <div className="text-sm font-medium mb-1.5 min-h-[1.25rem]">
              {paintOwner ? `Painting with ${paintOwner}` : "Pick a rep, then click the map."}
            </div>
          )}
          <div className="rounded-xl border border-card-border bg-card overflow-hidden relative">
            <div className="absolute top-2 right-2 z-10 flex gap-1">
              <button type="button" className="h-7 w-7 rounded-md border bg-background/90 text-sm" title="Zoom in" onClick={() => setMapScale((s) => Math.min(4, Number((s * 1.25).toFixed(3))))}>+</button>
              <button type="button" className="h-7 w-7 rounded-md border bg-background/90 text-sm" title="Zoom out" onClick={() => setMapScale((s) => Math.max(1, Number((s / 1.25).toFixed(3))))}>−</button>
            </div>
            {!geo || !pathGen || mapQ.isLoading ? (
              <Skeleton className="w-full h-[420px]" />
            ) : (
              <svg
                ref={svgRef}
                viewBox={`0 0 ${W} ${H}`}
                className="w-full h-auto"
                role="img"
                aria-label="United States territory map"
              >
                <g transform={mapScale === 1 ? undefined : `translate(${W / 2} ${H / 2}) scale(${mapScale}) translate(${-W / 2} ${-H / 2})`}>
                  {geo.features.map((f) => {
                    const fips = String(f.id);
                    const st = mapQ.data?.countyMeta[fips]?.state;
                    const split = st ? mapQ.data?.splitStates.includes(st) : false;
                    let fill = colorOf(ownerOf(fips));
                    if (view === "contacts") {
                      fill = "#E5E7EB";
                      if (showChoropleth) {
                        const n = contactsQ.data?.counties[fips] ?? 0;
                        const t = n / maxCounty;
                        fill = n === 0 ? "#F3F4F6" : `rgba(37,99,235,${0.15 + 0.75 * t})`;
                      }
                    }
                    if (splitPreview.has(fips)) {
                      fill = splitPreview.get(fips) === "a" ? colorOf(splitOwners[0]) : colorOf(splitOwners[1]);
                    }
                    const d = pathGen(f as GeoPermissibleObjects) || "";
                    const countyStroke = showAllCountyLines || split;
                    return (
                      <path
                        key={fips}
                        d={d}
                        fill={fill}
                        stroke={countyStroke ? "rgba(15,23,42,0.35)" : "none"}
                        strokeWidth={countyStroke ? (split ? 0.6 : 0.3) : 0}
                        onMouseEnter={() => setHover(fips)}
                        onMouseLeave={() => setHover((h) => (h === fips ? null : h))}
                        onClick={(e) => onCountyClick(fips, e)}
                        className="cursor-pointer hover:opacity-90"
                      />
                    );
                  })}
                  {stateGeo && pathGen && view === "sales" && stateGeo.features.map((f, i) => (
                    <path
                      key={`st-${f.id ?? i}`}
                      d={pathGen(f as GeoPermissibleObjects) || ""}
                      fill="none"
                      stroke="rgba(15,23,42,0.55)"
                      strokeWidth={0.9}
                      pointerEvents="none"
                    />
                  ))}
                  {view === "contacts" && showPins && projection && (contactsQ.data?.zips ?? []).map((z) => {
                    const p = projection([z.lng, z.lat]);
                    if (!p) return null;
                    return (
                      <circle key={z.zip} cx={p[0]} cy={p[1]} r={Math.min(5, 1.6 + Math.sqrt(z.count))} fill="#1d4ed8" fillOpacity={0.7} stroke="#fff" strokeWidth={0.4} />
                    );
                  })}
                  {splitPts.length >= 1 && (
                    <g>
                      {splitPts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="#111827" />)}
                      {splitPts.length >= 2 && (
                        <line x1={splitPts[0][0]} y1={splitPts[0][1]} x2={splitPts[1][0]} y2={splitPts[1][1]} stroke="#111827" strokeWidth={1.5} strokeDasharray="4 3" />
                      )}
                    </g>
                  )}
                </g>
              </svg>
            )}
            {hover && mapQ.data?.countyMeta[hover] && (
              <div className="px-3 py-2 text-xs border-t border-border text-muted-foreground">
                {mapQ.data.countyMeta[hover].name}, {mapQ.data.countyMeta[hover].state}
                {view === "sales" ? ` · ${ownerOf(hover) ?? "unassigned"}` : ` · ${contactsQ.data?.counties[hover] ?? 0} contacts`}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-3 min-w-0">
          {view === "sales" && (
            <div className="rounded-xl border border-card-border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Sales reps</div>
              {withTerritory.map((o) => (
                <RepRow
                  key={o.initials}
                  owner={o}
                  stat={statsByIni.get(o.initials)}
                  editOn={editOn}
                  selected={paintOwner === o.initials}
                  canRecolor={isAdmin}
                  usedByColor={usedByColor}
                  onSelect={() => { if (o.is_active) setPaintOwner(o.initials); }}
                  onColor={(hex) => patchOwnerColor(o, hex, toast, () => qc.invalidateQueries({ queryKey: ["/api/territories/map"] }))}
                />
              ))}
              {noTerritory.length > 0 && (
                <div className="mt-1">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground py-1"
                    onClick={() => setEmptyOpen((x) => !x)}
                  >
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", emptyOpen ? "rotate-0" : "-rotate-90")} />
                    No territory yet ({noTerritory.length})
                  </button>
                  {emptyOpen && noTerritory.map((o) => (
                    <RepRow
                      key={o.initials}
                      owner={o}
                      stat={statsByIni.get(o.initials)}
                      editOn={editOn}
                      selected={paintOwner === o.initials}
                      canRecolor={isAdmin}
                      usedByColor={usedByColor}
                      onSelect={() => { if (o.is_active) setPaintOwner(o.initials); }}
                      onColor={(hex) => patchOwnerColor(o, hex, toast, () => qc.invalidateQueries({ queryKey: ["/api/territories/map"] }))}
                    />
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm py-1 mt-1">
                <span className="w-3.5 h-3.5 rounded-full border shrink-0" style={{ background: UNASSIGNED }} />
                <span className="text-muted-foreground">Unassigned</span>
              </div>

              {isAdmin && (
                <div className="mt-2 pt-2 border-t border-border">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setManageOpen((x) => !x)}
                  >
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", manageOpen ? "rotate-0" : "-rotate-90")} />
                    Manage reps
                  </button>
                  {manageOpen && (
                    <ManageReps
                      owners={owners}
                      usedByColor={usedByColor}
                      onSaved={() => qc.invalidateQueries({ queryKey: ["/api/territories/map"] })}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {editOn && (
            <div className="rounded-xl border border-card-border bg-card p-3">
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground w-full"
                onClick={() => setHistOpen((x) => !x)}
              >
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", histOpen ? "rotate-0" : "-rotate-90")} />
                History ({histCount})
              </button>
              {histOpen && (
                <div className="space-y-2 max-h-64 overflow-auto mt-2">
                  {(histQ.data?.change_sets ?? []).map((cs) => (
                    <div key={cs.change_set_id} className="text-xs border-b border-border pb-2">
                      <div className="text-foreground">{new Date(cs.changed_at).toLocaleString()} · {cs.counties} counties</div>
                      <div className="text-muted-foreground">{cs.changed_by}{cs.note ? ` · ${cs.note}` : ""}</div>
                      <Button size="sm" variant="outline" className="mt-1 h-7" onClick={() => revertSet(cs.change_set_id)}>Revert</Button>
                    </div>
                  ))}
                  {!histQ.data?.change_sets?.length && <p className="text-xs text-muted-foreground">No edits yet.</p>}
                </div>
              )}
            </div>
          )}

          {view === "contacts" && panel && (
            <div className="rounded-xl border border-card-border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Contacts</div>
                <button type="button" className="text-xs text-muted-foreground" onClick={() => setPanel(null)}>Close</button>
              </div>
              {listQ.isLoading ? <Skeleton className="h-24" /> : (
                <div className="space-y-3 max-h-[480px] overflow-auto">
                  <p className="text-xs text-muted-foreground">{listQ.data?.total ?? 0} in this selection</p>
                  {Object.entries(groupByCompany(listQ.data?.rows ?? [])).map(([co, people]) => (
                    <div key={co}>
                      <Link className="text-sm font-medium hover:underline" href={contactsDirectoryPath({ q: "", companyId: people[0].company_id, contactId: null, people: true, leaseTied: false })}>
                        {co}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">
                        {people[0].relationship_type}{people[0].priority_tier ? ` · tier ${people[0].priority_tier}` : ""}
                        {people[0].pipeline_status ? ` · ${people[0].pipeline_status}` : ""}
                      </div>
                      {people.map((p) => (
                        <div key={p.contact_id} className="text-xs mt-1 pl-2 border-l">
                          {p.contact_name || "—"}{p.title ? ` · ${p.title}` : ""}
                          <div className="text-muted-foreground">
                            Territory {p.territory_owner ?? "—"}
                            {p.relationship_type === "customer" ? ` · AM ${p.account_manager ?? "—"}` : ""}
                            {p.ol_numbers?.length ? ` · OL ${p.ol_numbers.join(", ")}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

async function patchOwnerColor(
  o: Owner,
  hex: string,
  toast: ReturnType<typeof useToast>["toast"],
  onSaved: () => void,
) {
  try {
    await apiRequest("PATCH", `/api/territories/owners/${o.initials}`, { color_hex: hex });
    onSaved();
  } catch (e: any) {
    toast({ title: "Could not update color", description: e.message, variant: "destructive" });
  }
}

function RepRow({
  owner,
  stat,
  editOn,
  selected,
  canRecolor,
  usedByColor,
  onSelect,
  onColor,
}: {
  owner: Owner;
  stat?: OwnerStat;
  editOn: boolean;
  selected: boolean;
  canRecolor: boolean;
  usedByColor: Map<string, string[]>;
  onSelect: () => void;
  onColor: (hex: string) => void;
}) {
  const states = stat?.states ?? 0;
  const counties = stat?.counties ?? 0;
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm py-1 rounded-md px-1 -mx-1",
        editOn && "cursor-pointer",
        selected && editOn && "ring-2 ring-foreground/70 bg-muted/40",
        !owner.is_active && "opacity-60",
      )}
      onClick={() => { if (editOn) onSelect(); }}
    >
      <ColorDot
        color={owner.color_hex}
        canRecolor={canRecolor}
        usedByColor={usedByColor}
        currentInitials={owner.initials}
        onPick={onColor}
      />
      <span className="font-medium w-8 shrink-0">{owner.initials}</span>
      <span className="text-muted-foreground truncate min-w-0">{owner.full_name}</span>
      <span
        className="ml-auto text-xs text-muted-foreground shrink-0"
        title={`${states} states · ${counties.toLocaleString()} counties`}
      >
        {states} state{states === 1 ? "" : "s"}
        <span className="text-[10px] text-muted-foreground/80"> · {counties.toLocaleString()} co</span>
      </span>
    </div>
  );
}

function ColorDot({
  color,
  canRecolor,
  usedByColor,
  currentInitials,
  onPick,
}: {
  color: string;
  canRecolor: boolean;
  usedByColor: Map<string, string[]>;
  currentInitials?: string;
  onPick: (hex: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!canRecolor) {
    return <span className="w-3.5 h-3.5 rounded-full border shrink-0" style={{ background: color }} />;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Change color"
          className="relative w-3.5 h-3.5 rounded-full border shrink-0 group"
          style={{ background: color }}
          onClick={(e) => e.stopPropagation()}
        >
          <Pencil className="h-2 w-2 absolute -right-1.5 -bottom-1.5 text-foreground opacity-0 group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="text-[11px] text-muted-foreground mb-2">Choose a color</div>
        <div className="grid grid-cols-5 gap-1.5">
          {REP_PALETTE.map((hex) => {
            const users = (usedByColor.get(normHex(hex)) ?? []).filter((i) => i !== currentInitials);
            return (
              <button
                key={hex}
                type="button"
                className="relative h-7 w-7 rounded-md border"
                style={{ background: hex }}
                title={users.length ? `Also used by ${users.join(", ")}` : hex}
                onClick={() => { onPick(hex); setOpen(false); }}
              >
                {users.length ? (
                  <span className="absolute -bottom-1 -right-1 text-[8px] leading-none bg-background border rounded px-0.5">
                    {users[0]}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ManageReps({
  owners,
  usedByColor,
  onSaved,
}: {
  owners: Owner[];
  usedByColor: Map<string, string[]>;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [initials, setInitials] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(REP_PALETTE[0]);
  async function add() {
    const ini = initials.trim().toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(ini)) {
      toast({ title: "Initials must be 2–4 letters", variant: "destructive" });
      return;
    }
    if (owners.some((o) => o.initials.toUpperCase() === ini)) {
      toast({ title: "Those initials are already in use", variant: "destructive" });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Full name is required", variant: "destructive" });
      return;
    }
    try {
      await apiRequest("POST", "/api/territories/owners", { initials: ini, full_name: name.trim(), color_hex: color });
      toast({ title: "Owner added" });
      setInitials(""); setName("");
      onSaved();
    } catch (e: any) {
      toast({ title: "Could not add owner", description: e.message, variant: "destructive" });
    }
  }
  async function toggleActive(o: Owner) {
    const next = !o.is_active;
    if (o.is_active) {
      const ok = await confirmAction({
        title: `Deactivate ${o.initials}?`,
        description: "Their territories stay assigned. They will no longer appear as a choice for new edits.",
        confirmLabel: "Deactivate",
        variant: "destructive",
      });
      if (!ok) return;
    }
    try {
      await apiRequest("PATCH", `/api/territories/owners/${o.initials}`, { is_active: next });
      onSaved();
    } catch (e: any) {
      toast({ title: "Could not update owner", description: e.message, variant: "destructive" });
    }
  }
  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-1">
        {owners.map((o) => (
          <div key={o.initials} className="flex items-center gap-2 text-xs">
            <span className="w-8 font-medium">{o.initials}</span>
            <span className="truncate text-muted-foreground flex-1">{o.full_name}</span>
            <button type="button" className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => toggleActive(o)}>
              {o.is_active ? "Deactivate" : "Activate"}
            </button>
          </div>
        ))}
      </div>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label className="text-[11px]">Initials (2-4 letters)</Label>
          <Input className="h-8" value={initials} onChange={(e) => setInitials(e.target.value)} maxLength={4} />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px]">Full name</Label>
          <Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px]">Color</Label>
          <div className="flex items-center gap-2">
            <ColorDot color={color} canRecolor usedByColor={usedByColor} onPick={setColor} />
            <span className="text-xs text-muted-foreground">{color}</span>
          </div>
        </div>
        <Button size="sm" onClick={add}>Add rep</Button>
      </div>
    </div>
  );
}

function groupByCompany(rows: ContactRow[]) {
  const m: Record<string, ContactRow[]> = {};
  for (const r of rows) {
    const k = r.company_name || `Company ${r.company_id}`;
    (m[k] ??= []).push(r);
  }
  return m;
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <select className="h-8 border rounded-md bg-background text-sm px-2" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o || "(any)"} value={o}>{o || "Any"}</option>)}
      </select>
    </div>
  );
}
