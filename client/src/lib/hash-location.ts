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

export function hashSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  const hash = window.location.hash;
  const i = hash.indexOf("?");
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : "");
}
