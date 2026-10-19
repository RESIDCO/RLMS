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
  /** False when the user asked to search the code as ordinary text. */
  fleet: boolean;
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
const FULL_ROW_SIDS = 5;
const HASH_Q_MAX = 1600;

/** True when a top-bar search or Back/Forward moved to a different search. */
export function shouldRebootSearch(current: { q: string; sid: string }, next: { q: string; sid: string }): boolean {
  return current.q !== next.q || (current.sid || "") !== (next.sid || "");
}

/** "found" stays the cars in the grid. When inactive cars are in that grid, say so instead of adding them again. */
export function pasteFoundLabel(found: number, inactive: number, active: SearchActive): string {
  const n = found.toLocaleString();
  if (active === "all" && inactive > 0) return `${n} found (incl. ${inactive.toLocaleString()} inactive)`;
  return `${n} found`;
}

export function pasteShowsInactiveSeparately(active: SearchActive): boolean {
  return active === "active";
}

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
    fleet: true,
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
  state.fleet = params.get("fleet") !== "0";
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
  if (!state.fleet) params.set("fleet", "0");
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

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  const code = (err as { code?: number }).code;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22;
}

function withoutRows(state: StoredSearch): StoredSearch {
  if (!state.results) return state;
  return { ...state, results: { ...state.results, rows: [] } };
}

function slimOlder(store: Storage, index: string[]) {
  const keepFull = new Set(index.slice(0, FULL_ROW_SIDS));
  for (const id of index) {
    if (keepFull.has(id)) continue;
    try {
      const raw = store.getItem(PREFIX + id);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as StoredSearch;
      const rows = parsed?.results?.rows;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      store.setItem(PREFIX + id, JSON.stringify(withoutRows(parsed)));
    } catch {
      /* the quota retry evicts this entry */
    }
  }
}

export function saveSearchState(sid: string, state: Omit<StoredSearch, "sid" | "timestamp"> & { timestamp?: number }): void {
  const store = storage();
  if (!store || !sid) return;
  let payload: StoredSearch = {
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
  const prior = readIndex(store);
  let index = [sid, ...prior.filter((id) => id !== sid)].slice(0, MAX_SIDS);
  for (const id of prior) {
    if (!index.includes(id)) store.removeItem(PREFIX + id);
  }
  slimOlder(store, index);

  const persist = () => {
    store.setItem(PREFIX + sid, JSON.stringify(payload));
    if (payload.pastedText) store.setItem(PASTE_KEY, payload.pastedText);
    store.setItem(INDEX_KEY, JSON.stringify(index));
  };

  for (let attempt = 0; attempt < MAX_SIDS + 2; attempt += 1) {
    try {
      persist();
      return;
    } catch (err) {
      if (!isQuotaError(err)) return;
      const oldest = index.length > 1 ? index[index.length - 1] : "";
      if (oldest && oldest !== sid) {
        index = index.slice(0, -1);
        store.removeItem(PREFIX + oldest);
        continue;
      }
      const rows = payload.results?.rows;
      if (Array.isArray(rows) && rows.length > 0) {
        payload = withoutRows(payload);
        continue;
      }
      return;
    }
  }
}

/** Rows were dropped to save space, but the count says the search had matches. */
export function isStaleSearchResults(results: StoredSearchResults | null | undefined): boolean {
  if (!results || !Array.isArray(results.rows)) return false;
  const total = Number(results.total);
  return results.rows.length === 0 && Number.isFinite(total) && total > 0;
}

export type ResolvedStoredSearch = {
  /** Saved pasted text, or the query stored on the entry. Never the global paste key. */
  query: string;
  hash: SearchHashState;
  /** False when the entry must be run again. A real zero-result search stays cached. */
  useCache: boolean;
  selection: SearchSelection;
  scrollY: number;
};

export function resolveStoredSearch(stored: StoredSearch | null): ResolvedStoredSearch | null {
  if (!stored || stored.ready === false || !stored.results || !stored.hash) return null;
  return {
    query: stored.pastedText || stored.hash.q || "",
    hash: stored.hash,
    useCache: !isStaleSearchResults(stored.results),
    selection: stored.selection ?? [],
    scrollY: stored.scrollY ?? 0,
  };
}

export function searchResultsPathForSid(sid: string): string | null {
  const stored = loadSearchState(sid);
  if (!stored) return null;
  return encodeHash(stored.hash);
}

export function pageSizeNumber(ps: number | "all"): number {
  return ps === "all" ? 500 : ps;
}
