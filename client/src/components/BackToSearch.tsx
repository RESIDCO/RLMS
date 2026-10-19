import { Link } from "wouter";
import { useHashSearch } from "@/lib/hash-location";
import { hasSearchSession, searchReturnPath } from "@/lib/search-query";
import { searchResultsPathForSid } from "@/lib/searchState";

/** Shown on pages opened from a search result. Browser Back hits the same hash. */
export function BackToSearch() {
  const qs = useHashSearch();
  const params = new URLSearchParams(qs.replace(/^\?/, ""));
  const fromSearch = params.get("from") === "search";
  const sid = params.get("sid") ?? "";
  const ret = params.get("return") ?? "";
  let href: string | null = null;
  if (fromSearch) {
    if (ret.startsWith("/search")) href = ret;
    else if (sid) href = searchResultsPathForSid(sid) ?? `/search?sid=${encodeURIComponent(sid)}`;
  }
  if (!href && hasSearchSession()) href = searchReturnPath();
  if (!href) return null;
  return (
    <div className="mb-3">
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
        data-testid="link-back-to-results"
      >
        ‹ Back to results
      </Link>
    </div>
  );
}
