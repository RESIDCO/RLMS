import { useHashLocation } from "wouter/use-hash-location";

/**
 * Hash paths like `#/search?q=BNSF` must route as `/search`.
 * Stock useHashLocation keeps `?q=` on the path, so Switch falls through to 404
 * on a fresh tab (header search). In-app replaceState hid this because it does
 * not rematch the router.
 */
export function useAppHashLocation(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const [loc, nav] = useHashLocation();
  const q = loc.indexOf("?");
  const path = (q >= 0 ? loc.slice(0, q) : loc) || "/";
  return [path, nav];
}

export function hashSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  const hash = window.location.hash;
  const i = hash.indexOf("?");
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : "");
}
