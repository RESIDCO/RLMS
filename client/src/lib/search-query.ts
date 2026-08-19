import { hashSearchParams } from "@/lib/hash-location";

const SEARCH_PASTE_KEY = "rlms-search-paste";
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
