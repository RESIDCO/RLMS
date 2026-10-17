import { useSyncExternalStore } from "react";
import { useHashLocation } from "wouter/use-hash-location";

/**
 * Hash paths like `#/search?q=BNSF` must route as `/search`.
 * Stock useHashLocation keeps `?q=` on the path, so Switch falls through to 404
 * on a fresh tab (header search).
 *
 * Also: stock wouter hash `navigate("/search?restore=1")` splits the query onto
 * `location.search` and leaves only `#/search` — producing `/?restore=1#/search`.
 * We keep the full path+query inside the hash: `#/search?restore=1`.
 */
export function navigateHash(to: string, { replace = false }: { replace?: boolean } = {}) {
  const oldURL = window.location.href;
  const raw = String(to ?? "");
  const withoutHash = raw.startsWith("#") ? raw.slice(1) : raw;
  const hashPath = withoutHash.startsWith("/") ? withoutHash : `/${withoutHash}`;
  const newURL = `${window.location.pathname}#${hashPath}`;
  if (replace) {
    window.history.replaceState(null, "", newURL);
  } else {
    window.history.pushState(null, "", newURL);
  }
  const event =
    typeof HashChangeEvent !== "undefined"
      ? new HashChangeEvent("hashchange", { oldURL, newURL })
      : new Event("hashchange");
  window.dispatchEvent(event);
}

export function useAppHashLocation(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const [loc] = useHashLocation();
  const q = loc.indexOf("?");
  const path = (q >= 0 ? loc.slice(0, q) : loc) || "/";
  return [path, navigateHash];
}

/** Make <Link href="/search?restore=1"> render as href="#/search?restore=1". */
useAppHashLocation.hrefs = (href: string) => {
  const raw = String(href ?? "");
  if (raw.startsWith("#")) return raw;
  return raw.startsWith("/") ? `#${raw}` : `#/${raw}`;
};

export function parseHashSearch(hash: string): URLSearchParams {
  const raw = String(hash ?? "");
  const withoutHash = raw.startsWith("#") ? raw.slice(1) : raw;
  const i = withoutHash.indexOf("?");
  return new URLSearchParams(i >= 0 ? withoutHash.slice(i + 1) : "");
}

/** Query string after `?` (no leading `?`) for a `from=` param. */
export function encodeHashFrom(query: string): string {
  const raw = String(query ?? "");
  const q = raw.startsWith("?") ? raw.slice(1) : raw;
  return encodeURIComponent(q);
}

/** Inverse of encodeHashFrom. URLSearchParams.get("from") already applies this once. */
export function decodeHashFrom(from: string | null | undefined): string {
  const raw = String(from ?? "");
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function programsPathFromQuery(from: string | null | undefined): string {
  const q = from ?? "";
  return q ? `/programs?${q}` : "/programs";
}

export function programPathWithFrom(id: number, listQuery: string): string {
  const encoded = encodeHashFrom(listQuery);
  return encoded ? `/programs/${id}?from=${encoded}` : `/programs/${id}`;
}

export function carPathFromProgram(carId: number, programId: number, programQuery: string): string {
  const parts = [`from_program=${encodeURIComponent(String(programId))}`];
  const encoded = encodeHashFrom(programQuery);
  if (encoded) parts.push(`from=${encoded}`);
  return `/cars/${carId}?${parts.join("&")}`;
}

export function hashSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return parseHashSearch(window.location.hash);
}

function hashSearchSnapshot(): string {
  const q = hashSearchParams().toString();
  return q ? `?${q}` : "";
}

function subscribeHashSearch(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("hashchange", onStoreChange);
  window.addEventListener("popstate", onStoreChange);
  return () => {
    window.removeEventListener("hashchange", onStoreChange);
    window.removeEventListener("popstate", onStoreChange);
  };
}

/** wouter useSearch() reads location.search and is empty under hash routing. */
export function useHashSearch(): string {
  return useSyncExternalStore(subscribeHashSearch, hashSearchSnapshot, () => "");
}

export { isDirectoryLeaseReviewTab } from "./directory-review-tab";
