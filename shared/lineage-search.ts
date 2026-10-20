/** Pause after typing before Lineage asks the server. One settled value, one request. */
export const LINEAGE_SEARCH_DEBOUNCE_MS = 350;

export function lineageSearchPath(q: string): string {
  const trimmed = String(q ?? "").trim();
  if (!trimmed) return "/history";
  return `/history?q=${encodeURIComponent(trimmed)}`;
}

/**
 * The URL query is the source of truth for Back and refresh.
 * A commit pushes only when the settled text differs from that query.
 */
export function lineageSearchCommit(draft: string, urlQuery: string): {
  settled: string;
  path: string;
  push: boolean;
} {
  const settled = String(draft ?? "").trim();
  const current = String(urlQuery ?? "").trim();
  return {
    settled,
    path: lineageSearchPath(settled),
    push: settled !== current,
  };
}

/**
 * A typing burst commits once, on the last draft. Intermediate keystrokes
 * do not each become a request.
 */
export function lineageSearchRequests(keystrokes: string[], urlQuery = ""): string[] {
  if (!keystrokes.length) return [];
  const committed = lineageSearchCommit(keystrokes[keystrokes.length - 1] ?? "", urlQuery);
  return committed.push ? [committed.settled] : [];
}
