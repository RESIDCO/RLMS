/**
 * Search state split:
 * - URL hash carries the short, shareable part (query, scope, filters, sort, page, page size, sid).
 * - sessionStorage `rlms-search:<sid>` carries the heavy part (pasted text, ids, selection,
 *   scroll, cached results) so Back can paint without another API call.
 * The last 20 sids are kept.
 */

export type SearchActive = "active" | "inactive" | "all";

export type SearchHashState = {
  q: string;
  /** True when the hash used paste=1 because the query is too big for the URL. */
  paste: boolean;
  cars: boolean;
  leases: boolean;
  carData: boolean;
  type: string;
  mech: string;
  aar: string;
  entity: string;
  status: string;
  active: SearchActive;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  /** 75, 200, or "all" (capped at 500 on the server). */
  ps: number | "all";
  sid: string;
};

export type SearchSelection = number[];

export type StoredSearchResults = {
  mode: "text" | "paste";
  rows: unknown[];
  total: number;
  summary: unknown;
  notFound: string[];
  inactiveMatches: unknown[];
  ambiguous: unknown[];
  counts: Record<string, number> | null;
  match: unknown;
  truncated: boolean;
  rejectedRanges: { raw: string; message: string }[];
  expandedFrom: { raw: string; count: number; from: string; to: string }[];
};

export type StoredSearch = {
  sid: string;
  hash: SearchHashState;
  pastedText: string;
  ids: number[];
  selection: SearchSelection;
  scrollY: number;
  results: StoredSearchResults | null;
  /** False while a refetch is in flight so a remount does not paint an empty cache. */
  ready?: boolean;
  timestamp: number;
};

const PREFIX = "rlms-search:";
const INDEX_KEY = "rlms-search-index";
const PASTE_KEY = "rlms-search-paste";
const MAX_SIDS = 20;
const HASH_Q_MAX = 1600;

export function createSearchSid(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return `${rand}${time}`;
}

export function emptySearchHash(sid = ""): SearchHashState {
  return {
    q: "",
    paste: false,
    cars: true,
    leases: true,
    carData: false,
    type: "",
    mech: "",
    aar: "",
    entity: "",
    status: "",
    active: "active",
    sort: "car_number",
    dir: "asc",
    page: 1,
    ps: 75,
    sid,
  };
}

function flag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const v = params.get(key);
  if (v == null || v === "") return fallback;
  if (v === "0" || v === "false") return false;
  if (v === "1" || v === "true") return true;
  return fallback;
}

function pageSize(raw: string | null): number | "all" {
  if (!raw || raw === "75") return 75;
  if (raw === "all") return "all";
  const n = Number(raw);
  if (n === 200) return 200;
  if (n === 500) return "all";
  if (Number.isFinite(n) && n > 0) return Math.min(500, Math.floor(n));
  return 75;
}

export function decodeHash(hash: string): SearchHashState {
  const raw = String(hash ?? "");
  const without = raw.startsWith("#") ? raw.slice(1) : raw;
  const qIndex = without.indexOf("?");
  const params = new URLSearchParams(qIndex >= 0 ? without.slice(qIndex + 1) : "");
  const activeRaw = params.get("active");
  const active: SearchActive =
    activeRaw === "inactive" || activeRaw === "all" ? activeRaw : "active";
  const state = emptySearchHash(params.get("sid") ?? "");
  state.q = params.get("q") ?? "";
  state.paste = params.get("paste") === "1" || params.get("restore") === "1";
  state.cars = flag(params, "cars", flag(params, "search_cars", true));
  state.leases = flag(params, "leases", flag(params, "search_leases", true));
  state.carData = flag(params, "carData", flag(params, "search_car_data", false));
  state.type = params.get("type") ?? "";
  state.mech = params.get("mech") ?? "";
  state.aar = params.get("aar") ?? "";
  state.entity = params.get("entity") ?? "";
  state.status = params.get("status") ?? "";
  state.active = active;
  state.sort = params.get("sort") || "car_number";
  state.dir = params.get("dir") === "desc" ? "desc" : "asc";
  const page = Number(params.get("page"));
  state.page = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  state.ps = pageSize(params.get("ps"));
  if (!state.q && state.paste) {
    try {
      state.q = sessionStorage.getItem(PASTE_KEY) ?? "";
    } catch {
      state.q = "";
    }
  }
  return state;
}

export function encodeHash(state: SearchHashState): string {
  const params = new URLSearchParams();
  const q = state.q ?? "";
  const encoded = encodeURIComponent(q);
  const tooBig = encoded.length > HASH_Q_MAX || /[\n\r]/.test(q);
  if (q && !tooBig) params.set("q", q);
  if (q && tooBig) {
    params.set("paste", "1");
    try {
      sessionStorage.setItem(PASTE_KEY, q);
    } catch {
      /* private mode */
    }
  } else if (state.paste && !q) params.set("paste", "1");
  if (!state.cars) params.set("cars", "0");
  if (!state.leases) params.set("leases", "0");
  if (state.carData) params.set("carData", "1");
  if (state.type) params.set("type", state.type);
  if (state.mech) params.set("mech", state.mech);
  if (state.aar) params.set("aar", state.aar);
  if (state.entity) params.set("entity", state.entity);
  if (state.status) params.set("status", state.status);
  if (state.active !== "active") params.set("active", state.active);
  if (state.sort && state.sort !== "car_number") params.set("sort", state.sort);
  if (state.dir === "desc") params.set("dir", "desc");
  if (state.page > 1) params.set("page", String(state.page));
  if (state.ps === "all") params.set("ps", "all");
  else if (state.ps !== 75) params.set("ps", String(state.ps));
  if (state.sid) params.set("sid", state.sid);
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function readIndex(store: Storage): string[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string" && s) : [];
  } catch {
    return [];
  }
}

export function loadSearchState(sid: string): StoredSearch | null {
  const store = storage();
  if (!store || !sid) return null;
  try {
    const raw = store.getItem(PREFIX + sid);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSearch;
    if (!parsed || parsed.sid !== sid || !parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSearchState(sid: string, state: Omit<StoredSearch, "sid" | "timestamp"> & { timestamp?: number }): void {
  const store = storage();
  if (!store || !sid) return;
  const payload: StoredSearch = {
    sid,
    hash: state.hash,
    pastedText: state.pastedText ?? "",
    ids: state.ids ?? [],
    selection: state.selection ?? [],
    scrollY: state.scrollY ?? 0,
    results: state.results ?? null,
    ready: state.ready !== false,
    timestamp: state.timestamp ?? Date.now(),
  };
  try {
    store.setItem(PREFIX + sid, JSON.stringify(payload));
    if (payload.pastedText) store.setItem(PASTE_KEY, payload.pastedText);
    const index = [sid, ...readIndex(store).filter((id) => id !== sid)].slice(0, MAX_SIDS);
    const dropped = readIndex(store).filter((id) => !index.includes(id));
    for (const id of dropped) store.removeItem(PREFIX + id);
    store.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* quota / private mode */
  }
}

export function searchResultsPathForSid(sid: string): string | null {
  const stored = loadSearchState(sid);
  if (!stored) return null;
  return encodeHash(stored.hash);
}

export function pageSizeNumber(ps: number | "all"): number {
  return ps === "all" ? 500 : ps;
}
