import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { geoAlbersUsa, geoCentroid, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useCanEdit, useIsAdmin } from "@/lib/AuthContext";
import { accountListPath, readAccountMgmtListState } from "@/lib/account-mgmt-nav";
import { contactsDirectoryPath } from "@/lib/directory-nav";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";

type Owner = { initials: string; full_name: string; color_hex: string; is_active: boolean; sort_order: number };
type MapPayload = {
  owners: Owner[];
  counties: Record<string, string | null>;
  countyMeta: Record<string, { state: string; name: string }>;
  splitStates: string[];
  wholeStates: Record<string, string | null>;
  ownerStats: { initials: string; counties: number; states: number }[];
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

export default function TerritoryMapPage() {
  const [, navigate] = useLocation();
  const canEdit = useCanEdit();
  const isAdmin = useIsAdmin();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<"sales" | "contacts">(() => {
    try {
      return sessionStorage.getItem(VIEW_KEY) === "contacts" ? "contacts" : "sales";
    } catch {
      return "sales";
    }
  });
  const [geo, setGeo] = useState<FC | null>(null);
  const [editOn, setEditOn] = useState(false);
  const [tool, setTool] = useState<"state" | "county" | "split">("state");
  const [palette, setPalette] = useState<string>("BH");
  const [pending, setPending] = useState<Record<string, string | null>>({});
  const [note, setNote] = useState("");
  const [splitPts, setSplitPts] = useState<[number, number][]>([]);
  const [splitState, setSplitState] = useState<string | null>(null);
  const [splitOwners, setSplitOwners] = useState<[string, string]>(["BH", "FF"]);
  const [flip, setFlip] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
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
  }, [toast]);

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
  const colorOf = useMemo(() => {
    const m = new Map(owners.map((o) => [o.initials, o.color_hex]));
    return (ini: string | null | undefined) => (ini && m.get(ini)) || UNASSIGNED;
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

  function onCountyClick(fips: string, ev?: React.MouseEvent) {
    if (view === "contacts") {
      setPanel({ county: fips });
      return;
    }
    if (!editOn || !canEdit) return;
    const st = mapQ.data?.countyMeta[fips]?.state;
    if (tool === "split") {
      if (!st) return;
      const svg = (ev?.currentTarget as SVGElement | undefined)?.ownerSVGElement;
      if (!svg || !ev) return;
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const loc = pt.matrixTransform(ctm.inverse());
      const xy: [number, number] = [loc.x, loc.y];
      if (!splitState) {
        setSplitState(st);
        setSplitPts([xy]);
        const cur = mapQ.data?.wholeStates[st] || palette;
        const other = owners.find((o) => o.initials !== cur && o.is_active)?.initials || palette;
        setSplitOwners([cur || palette, other]);
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
    if (tool === "state" && st) {
      const next: Record<string, string | null> = { ...pending };
      for (const c of countiesInState(st)) next[c] = palette;
      setPending(next);
      return;
    }
    setPending((p) => ({ ...p, [fips]: palette }));
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

      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">
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
            <div className="flex flex-wrap gap-2 mb-3 items-center">
              {(["state", "county", "split"] as const).map((t) => (
                <Button key={t} size="sm" variant={tool === t ? "default" : "outline"} onClick={() => { setTool(t); setSplitPts([]); setSplitState(null); }}>
                  {t === "state" ? "Assign state" : t === "county" ? "Assign counties" : "Draw split line"}
                </Button>
              ))}
              <div className="flex gap-1">
                {owners.filter((o) => o.is_active).map((o) => (
                  <button
                    key={o.initials}
                    type="button"
                    title={o.full_name}
                    onClick={() => setPalette(o.initials)}
                    className={cn("h-7 px-2 rounded text-xs border", palette === o.initials ? "ring-2 ring-foreground" : "")}
                    style={{ background: o.color_hex }}
                  >
                    {o.initials}
                  </button>
                ))}
              </div>
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
              <Button size="sm" disabled={applyBusy} onClick={applyPending}>Apply</Button>
              <Button size="sm" variant="ghost" onClick={() => { setPending({}); setSplitPts([]); setSplitState(null); }}>Clear draft</Button>
            </div>
          )}

          <div className="rounded-xl border border-card-border bg-card overflow-hidden">
            {!geo || !pathGen || mapQ.isLoading ? (
              <Skeleton className="w-full h-[420px]" />
            ) : (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="United States territory map">
                <g>
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
                    return (
                      <path
                        key={fips}
                        d={d}
                        fill={fill}
                        stroke={split || editOn ? "rgba(15,23,42,0.35)" : "rgba(15,23,42,0.12)"}
                        strokeWidth={split ? 0.6 : 0.3}
                        onMouseEnter={() => setHover(fips)}
                        onMouseLeave={() => setHover((h) => (h === fips ? null : h))}
                        onClick={(e) => onCountyClick(fips, e)}
                        className="cursor-pointer hover:opacity-90"
                      />
                    );
                  })}
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

        <aside className="space-y-3">
          {view === "sales" && (
            <div className="rounded-xl border border-card-border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Legend</div>
              {(mapQ.data?.ownerStats ?? []).map((s) => {
                const o = owners.find((x) => x.initials === s.initials);
                if (!o) return null;
                return (
                  <div key={s.initials} className="flex items-center gap-2 text-sm py-1">
                    <span className="w-3.5 h-3.5 rounded-sm border" style={{ background: o.color_hex }} />
                    <span className="font-medium w-8">{o.initials}</span>
                    <span className="text-muted-foreground truncate">{o.full_name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{s.states} st · {s.counties} co</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 text-sm py-1 mt-1">
                <span className="w-3.5 h-3.5 rounded-sm border" style={{ background: UNASSIGNED }} />
                <span className="text-muted-foreground">Unassigned</span>
              </div>
            </div>
          )}

          {editOn && (
            <div className="rounded-xl border border-card-border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">History</div>
              <div className="space-y-2 max-h-64 overflow-auto">
                {(histQ.data?.change_sets ?? []).map((cs) => (
                  <div key={cs.change_set_id} className="text-xs border-b border-border pb-2">
                    <div className="text-foreground">{new Date(cs.changed_at).toLocaleString()} · {cs.counties} counties</div>
                    <div className="text-muted-foreground">{cs.changed_by}{cs.note ? ` · ${cs.note}` : ""}</div>
                    <Button size="sm" variant="outline" className="mt-1 h-7" onClick={() => revertSet(cs.change_set_id)}>Revert</Button>
                  </div>
                ))}
                {!histQ.data?.change_sets?.length && <p className="text-xs text-muted-foreground">No edits yet.</p>}
              </div>
            </div>
          )}

          {isAdmin && view === "sales" && (
            <AdminOwners owners={owners} onSaved={() => qc.invalidateQueries({ queryKey: ["/api/territories/map"] })} />
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

function AdminOwners({ owners, onSaved }: { owners: Owner[]; onSaved: () => void }) {
  const { toast } = useToast();
  const [initials, setInitials] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#888888");
  async function add() {
    try {
      await apiRequest("POST", "/api/territories/owners", { initials, full_name: name, color_hex: color });
      toast({ title: "Owner added" });
      setInitials(""); setName("");
      onSaved();
    } catch (e: any) {
      toast({ title: "Could not add owner", description: e.message, variant: "destructive" });
    }
  }
  async function patch(o: Owner, patch: Partial<Owner>) {
    try {
      await apiRequest("PATCH", `/api/territories/owners/${o.initials}`, patch);
      onSaved();
    } catch (e: any) {
      toast({ title: "Could not update owner", description: e.message, variant: "destructive" });
    }
  }
  return (
    <div className="rounded-xl border border-card-border bg-card p-3 space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Reps (admin)</div>
      {owners.map((o) => (
        <div key={o.initials} className="flex items-center gap-2 text-xs">
          <input type="color" value={o.color_hex} onChange={(e) => patch(o, { color_hex: e.target.value })} />
          <span className="w-8">{o.initials}</span>
          <button type="button" className="text-muted-foreground" onClick={() => patch(o, { is_active: !o.is_active })}>
            {o.is_active ? "Deactivate" : "Activate"}
          </button>
        </div>
      ))}
      <div className="grid grid-cols-3 gap-1">
        <Input className="h-7" placeholder="IN" value={initials} onChange={(e) => setInitials(e.target.value)} />
        <Input className="h-7" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="h-7" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </div>
      <Button size="sm" onClick={add}>Add rep</Button>
    </div>
  );
}
