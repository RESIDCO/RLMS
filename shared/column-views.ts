/** List keys and export-column whitelist for column picker v2. */

export const LIST_KEYS = [
  "programs",
  "program_cars",
  "kpi_cars",
  "fleet_registry",
  "browse_car_list",
  "search_results",
  "lease_rider_cars",
] as const;

export type ListKey = (typeof LIST_KEYS)[number];

export const DEFAULT_VIEW_NAME = "Default";

export function normalizeListKey(raw: string): string {
  const s = String(raw ?? "").trim();
  if (/^program_cars(_[0-9]+)?$/.test(s)) return "program_cars";
  return s;
}

export function coalesceViewName(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s || DEFAULT_VIEW_NAME;
}

export type PrefsPayload = {
  cols: string[];
  order?: string[];
  widths?: Record<string, number>;
};

export function parsePrefsPayload(raw: unknown): PrefsPayload | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return { cols: raw.filter((x): x is string => typeof x === "string"), order: [], widths: {} };
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const colsSrc = Array.isArray(o.cols)
    ? o.cols
    : Array.isArray(o.visible_cols)
      ? o.visible_cols
      : null;
  if (!colsSrc) return null;
  const cols = colsSrc.filter((x): x is string => typeof x === "string");
  const order = Array.isArray(o.order) ? o.order.filter((x): x is string => typeof x === "string") : [];
  const widths: Record<string, number> = {};
  if (o.widths && typeof o.widths === "object" && !Array.isArray(o.widths)) {
    for (const [k, v] of Object.entries(o.widths as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) widths[k] = v;
    }
  }
  return { cols, order, widths };
}

/** `cols=all` → full allow-list. Missing → fallback. Else intersection in requested order. */
export function whitelistExportCols(
  allowed: readonly string[],
  requested: unknown,
  fallback: readonly string[] = allowed,
): string[] {
  const allow = new Set(allowed);
  if (requested == null || requested === "") {
    return fallback.filter((k) => allow.has(k));
  }
  const raw = Array.isArray(requested)
    ? requested.map((x) => String(x))
    : String(requested).split(",");
  const tokens = raw.map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 1 && tokens[0].toLowerCase() === "all") {
    return [...allowed];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of tokens) {
    if (!allow.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.length ? out : fallback.filter((k) => allow.has(k));
}

export function colsQuery(keys: Iterable<string>, all = false): string {
  if (all) return "all";
  return Array.from(keys).join(",");
}
