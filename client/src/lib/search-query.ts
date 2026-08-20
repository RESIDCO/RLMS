import { hashSearchParams } from "@/lib/hash-location";

const SEARCH_PASTE_KEY = "rlms-search-paste";
const SEARCH_SESSION_KEY = "rlms-search-session";
const HASH_Q_MAX = 1600;

export function searchPagePath(q: string): string {
  const encoded = encodeURIComponent(q);
  if (encoded.length > HASH_Q_MAX || /[\n\r]/.test(q)) {
    try {
      sessionStorage.setItem(SEARCH_PASTE_KEY, q);
    } catch {
      /* private mode */
    }
    return "/search?paste=1";
  }
  try {
    sessionStorage.removeItem(SEARCH_PASTE_KEY);
  } catch {
    /* ignore */
  }
  return `/search?q=${encoded}`;
}

export function readInitialSearchQuery(): string {
  const params = hashSearchParams();
  const q = params.get("q");
  if (q) return q;
  if (params.get("paste")) {
    try {
      return sessionStorage.getItem(SEARCH_PASTE_KEY) ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

export function persistSearchQuery(q: string) {
  const path = searchPagePath(q);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#${path}`,
  );
}

/** Cached Search page state so car click-through can return without re-running the API. */
export type SearchSessionFilters = {
  active: "active" | "inactive" | "all";
  rental: string;
  lessee: string;
  ol: string;
};

export type SearchSession = {
  query: string;
  results: unknown;
  filters: SearchSessionFilters;
  savedAt: number;
};

export function saveSearchSession(session: Omit<SearchSession, "savedAt">) {
  try {
    const payload: SearchSession = { ...session, savedAt: Date.now() };
    sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify(payload));
    if (session.query) {
      try {
        sessionStorage.setItem(SEARCH_PASTE_KEY, session.query);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* quota / private mode — return-to-search still works via URL + re-fetch */
  }
}

export function readSearchSession(): SearchSession | null {
  try {
    const raw = sessionStorage.getItem(SEARCH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SearchSession;
    if (!parsed || typeof parsed.query !== "string" || !parsed.results) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSearchSession() {
  try {
    sessionStorage.removeItem(SEARCH_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** True when Search has a cached result set the user can return to. */
export function hasSearchSession(): boolean {
  const s = readSearchSession();
  return Boolean(s?.query && s.results);
}

export function searchReturnPath(): string | null {
  const s = readSearchSession();
  if (!s?.query) return null;
  return searchPagePath(s.query);
}
