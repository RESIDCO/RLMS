/**
 * OWNER_UI §B part 3 — Shop map (Leaflet + OSM + NARN rail overlay).
 * Free tiles only; rail GeoJSON and places geocode are local/bundled.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiRequest } from "@/lib/queryClient";

export type CatalogItem = { id: string; code: string; display_name: string };

export type ShopMapPin = {
  id: string;
  name: string;
  shop_mark: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
  lat: number;
  lng: number;
  coord_source: "override" | "places";
  delivering_lines: Array<{ mark: string; name: string | null; label: string }>;
  capability_ids: string[];
  capability_labels: string[];
  car_type_ids: string[];
  car_type_labels: string[];
  primary_contact: {
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
  } | null;
};

type Props = {
  dark: boolean;
  activeOnly: boolean;
  capabilities: CatalogItem[];
  carTypes: CatalogItem[];
  panelClass: string;
  inputClass: string;
  /** When set, clicking a pin selects that shop (BO "Pick on map"). */
  onSelectShop?: (pin: ShopMapPin) => void;
  /** Compact height for modal pickers. */
  height?: string;
  hideFilters?: boolean;
};

function colorForMark(mark: string): string {
  let h = 0;
  const m = mark.toUpperCase();
  for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 40%)`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pinPopupHtml(p: ShopMapPin): string {
  const loc = [p.city, p.state].filter(Boolean).join(", ");
  const lines =
    p.delivering_lines.map((l) => escapeHtml(l.mark)).join(", ") || "—";
  const caps = p.capability_labels.map(escapeHtml).join(", ") || "—";
  const contact = p.primary_contact
    ? escapeHtml(
        [
          p.primary_contact.name,
          p.primary_contact.role,
          p.primary_contact.email,
          p.primary_contact.phone,
        ]
          .filter(Boolean)
          .join(" · "),
      )
    : "—";
  const mark = p.shop_mark ? ` (${escapeHtml(p.shop_mark)})` : "";
  return `<div style="min-width:200px;font:12px/1.4 system-ui,sans-serif">
    <div style="font-weight:700;margin-bottom:4px">${escapeHtml(p.name)}${mark}</div>
    <div>${escapeHtml(loc || "—")}</div>
    <div style="margin-top:4px"><b>Lines:</b> ${lines}</div>
    <div><b>Capabilities:</b> ${caps}</div>
    <div><b>Contact:</b> ${contact}</div>
    <div style="margin-top:6px"><a href="#/repair/shops/${escapeHtml(p.id)}">View shop</a></div>
  </div>`;
}

export default function ShopMap({
  dark,
  activeOnly,
  capabilities,
  carTypes,
  panelClass,
  inputClass,
  onSelectShop,
  height = "min(70vh, 640px)",
  hideFilters = false,
}: Props) {
  const onSelectRef = useRef(onSelectShop);
  onSelectRef.current = onSelectShop;
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const railLayerRef = useRef<L.GeoJSON | null>(null);
  const pinsLayerRef = useRef<L.LayerGroup | null>(null);
  const ormLayerRef = useRef<L.TileLayer | null>(null);
  const railDataRef = useRef<GeoJSON.FeatureCollection | null>(null);

  const [pins, setPins] = useState<ShopMapPin[]>([]);
  const [ungeocoded, setUngeocoded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [railLoading, setRailLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRails, setShowRails] = useState(true);
  const [showOrm, setShowOrm] = useState(false);
  const [railroad, setRailroad] = useState("");
  const [capabilityId, setCapabilityId] = useState("");
  const [carTypeId, setCarTypeId] = useState("");
  const [railroadOptions, setRailroadOptions] = useState<
    Array<{ mark: string; label: string }>
  >([]);

  const filterQs = useMemo(() => {
    const qs = new URLSearchParams({
      activeOnly: activeOnly ? "1" : "0",
    });
    if (railroad.trim()) qs.set("railroad", railroad.trim().toUpperCase());
    if (capabilityId) qs.set("capability", capabilityId);
    if (carTypeId) qs.set("carType", carTypeId);
    return qs.toString();
  }, [activeOnly, railroad, capabilityId, carTypeId]);

  const loadPins = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest("GET", `/api/repair/shops/map?${filterQs}`);
      const data = await res.json();
      setPins(data.pins ?? []);
      setUngeocoded(Number(data.ungeocoded ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load map pins");
    } finally {
      setLoading(false);
    }
  }, [filterQs]);

  useEffect(() => {
    void loadPins();
  }, [loadPins]);

  useEffect(() => {
    void apiRequest("GET", "/api/repair/railroads?limit=1000")
      .then((r) => r.json())
      .then((data) => {
        setRailroadOptions(
          (data.railroads ?? []).map(
            (r: { mark: string; name?: string | null; label?: string }) => ({
              mark: r.mark,
              label: r.label || (r.name ? `${r.mark} – ${r.name}` : r.mark),
            }),
          ),
        );
      })
      .catch(() => undefined);
  }, []);

  // Init map once
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, {
      center: [39.8, -98.5],
      zoom: 4,
      worldCopyJump: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const orm = L.tileLayer(
      "https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
        maxZoom: 19,
        opacity: 0.85,
      },
    );
    ormLayerRef.current = orm;

    pinsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      railLayerRef.current = null;
      pinsLayerRef.current = null;
      ormLayerRef.current = null;
    };
  }, []);

  // Load rail GeoJSON once
  useEffect(() => {
    let cancelled = false;
    setRailLoading(true);
    void fetch("/api/repair/map/rail-lines", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Rail overlay failed (${r.status})`);
        return r.json();
      })
      .then((fc: GeoJSON.FeatureCollection) => {
        if (cancelled) return;
        railDataRef.current = fc;
        setRailLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setRailLoading(false);
          setError(e instanceof Error ? e.message : "Rail overlay failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Paint / re-style rail layer
  useEffect(() => {
    const map = mapRef.current;
    const data = railDataRef.current;
    if (!map || !data) return;

    if (railLayerRef.current) {
      map.removeLayer(railLayerRef.current);
      railLayerRef.current = null;
    }
    if (!showRails) return;

    const highlight = railroad.trim().toUpperCase();
    const layer = L.geoJSON(data as GeoJSON.GeoJsonObject, {
      style: (feat) => {
        const mark = String(
          (feat?.properties as { mark?: string } | null)?.mark ?? "",
        ).toUpperCase();
        const isHit = highlight && mark === highlight;
        const dim = Boolean(highlight) && !isHit;
        return {
          color: colorForMark(mark || "XX"),
          weight: isHit ? 4 : dim ? 1 : 1.5,
          opacity: dim ? 0.15 : isHit ? 1 : 0.65,
        };
      },
      filter: (feat) => {
        // Always include all; dimming handled in style. Keep filter for future.
        void feat;
        return true;
      },
    });
    layer.addTo(map);
    railLayerRef.current = layer;
  }, [showRails, railroad, railLoading]);

  // ORM toggle
  useEffect(() => {
    const map = mapRef.current;
    const orm = ormLayerRef.current;
    if (!map || !orm) return;
    if (showOrm) {
      if (!map.hasLayer(orm)) orm.addTo(map);
    } else if (map.hasLayer(orm)) {
      map.removeLayer(orm);
    }
  }, [showOrm]);

  // Pins
  useEffect(() => {
    const map = mapRef.current;
    const group = pinsLayerRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    const pickMode = Boolean(onSelectRef.current);
    for (const p of pins) {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: pickMode ? 9 : 7,
        color: "#8B1E1E",
        fillColor: "#c43c3c",
        fillOpacity: 0.9,
        weight: 2,
      });
      if (pickMode) {
        marker.bindTooltip(
          `${p.name}${p.shop_mark ? ` (${p.shop_mark})` : ""} — click to select`,
          { direction: "top" },
        );
        marker.on("click", () => onSelectRef.current?.(p));
      } else {
        marker.bindPopup(pinPopupHtml(p));
      }
      marker.addTo(group);
      bounds.push([p.lat, p.lng]);
    }
    if (bounds.length === 1) {
      map.setView(bounds[0] as L.LatLngExpression, 8);
    } else if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds as L.LatLngTuple[]), {
        padding: [28, 28],
        maxZoom: 10,
      });
    }
  }, [pins]);

  const labelCls = dark
    ? "text-xs text-slate-100 font-semibold"
    : "text-xs text-slate-900 font-semibold";

  return (
    <div className="space-y-2" data-testid="shop-map">
      {!hideFilters && (
        <div className={`flex flex-wrap gap-3 items-end border p-2 ${panelClass}`}>
          <label className="space-y-1">
            <span className={labelCls}>Delivering railroad</span>
            <select
              className={`${inputClass} min-w-[12rem]`}
              value={railroad}
              onChange={(e) => setRailroad(e.target.value)}
              data-testid="map-filter-railroad"
            >
              <option value="">All</option>
              {railroadOptions.map((r) => (
                <option key={r.mark} value={r.mark}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Capability</span>
            <select
              className={`${inputClass} min-w-[10rem]`}
              value={capabilityId}
              onChange={(e) => setCapabilityId(e.target.value)}
              data-testid="map-filter-capability"
            >
              <option value="">All</option>
              {capabilities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelCls}>Car type</span>
            <select
              className={`${inputClass} min-w-[10rem]`}
              value={carTypeId}
              onChange={(e) => setCarTypeId(e.target.value)}
              data-testid="map-filter-car-type"
            >
              <option value="">All</option>
              {carTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={showRails}
              onChange={(e) => setShowRails(e.target.checked)}
            />
            NARN rail overlay
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={showOrm}
              onChange={(e) => setShowOrm(e.target.checked)}
            />
            OpenRailwayMap tiles
          </label>
          <button
            type="button"
            className="text-xs underline"
            onClick={() => void loadPins()}
          >
            Refresh pins
          </button>
        </div>
      )}

      {error ? (
        <div className="text-red-700 bg-red-50 border border-red-300 px-3 py-2 rounded text-xs">
          {error}
        </div>
      ) : null}

      {onSelectShop ? (
        <p className={`text-xs ${dark ? "text-slate-300" : "text-slate-700"}`}>
          Click a shop pin to select it for this Bad Order.
        </p>
      ) : null}

      <div
        className={`relative border ${panelClass}`}
        style={{ height }}
      >
        <div ref={mapEl} className="absolute inset-0 z-0" />
        {(loading || railLoading) && (
          <div className="absolute top-2 right-2 z-[500] text-xs bg-white/90 border px-2 py-1 rounded shadow">
            {loading ? "Loading shops…" : "Loading rail overlay…"}
          </div>
        )}
      </div>

      <p className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-600"}`}>
        {pins.length} pin{pins.length === 1 ? "" : "s"}
        {ungeocoded > 0
          ? ` · ${ungeocoded} shop${ungeocoded === 1 ? "" : "s"} missing coordinates (set City/ST or lat/long override)`
          : ""}
        {" · "}
        OSM + optional ORM tiles; NARN lines simplified locally (no paid map API).
      </p>
    </div>
  );
}
