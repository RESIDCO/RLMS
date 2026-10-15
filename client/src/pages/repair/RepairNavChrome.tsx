/**
 * §G r2 — breadcrumbs + "← Back to <source>" via returnTo (fallback: history).
 * AA: labels slate-700, values slate-900 on light surfaces.
 */
import { Link } from "wouter";

export const shopAa = {
  page: "min-h-full bg-slate-50 text-slate-900",
  label: "text-sm font-medium text-slate-700",
  muted: "text-sm text-slate-700",
  value: "text-sm font-semibold text-slate-900",
  crumb: "text-sm text-slate-700 hover:underline",
  crumbCurrent: "text-sm font-semibold text-slate-900",
  /** White fills, near-black text, ≥4.5:1 placeholders — never dark/black input fills. */
  input:
    "border border-slate-400 bg-white text-slate-900 placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2 [color-scheme:light]",
  select:
    "mt-1 h-9 w-full rounded-md border border-slate-400 bg-white px-2 text-sm text-slate-900 [color-scheme:light] focus:outline-none focus:ring-2 focus:ring-slate-700",
  textarea:
    "border border-slate-400 bg-white text-slate-900 placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2 [color-scheme:light]",
} as const;

export type Crumb = { label: string; href?: string };

export function RepairBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-700">›</span>}
          {c.href && i < items.length - 1 ? (
            <Link href={c.href} className={shopAa.crumb}>
              {c.label}
            </Link>
          ) : (
            <span className={shopAa.crumbCurrent}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Parse returnTo from hash query (?returnTo=...) or search. */
export function readReturnTo(): { href: string; label: string } | null {
  try {
    const hash = window.location.hash || "";
    const q = hash.includes("?")
      ? hash.slice(hash.indexOf("?") + 1)
      : window.location.search.replace(/^\?/, "");
    const params = new URLSearchParams(q);
    const raw = params.get("returnTo");
    if (!raw) return null;
    const href = decodeURIComponent(raw);
    const label = params.get("returnLabel")
      ? decodeURIComponent(params.get("returnLabel")!)
      : guessLabel(href);
    return { href, label };
  } catch {
    return null;
  }
}

function guessLabel(href: string): string {
  if (href.includes("/repair/shop/estimates/")) return "Estimate";
  if (href.includes("/repair/shop/events/")) return "Bad Order";
  if (href.includes("/repair/shop")) return "Shop home";
  if (href.includes("/repair/estimates/")) return "Estimate Review";
  if (href.includes("/repair/bad-orders")) return "Bad Orders";
  if (href.includes("/repair/wreck/")) return "Wreck";
  return "previous page";
}

export function buildReturnToParam(
  href: string,
  label: string,
): string {
  return `returnTo=${encodeURIComponent(href)}&returnLabel=${encodeURIComponent(label)}`;
}

export function RepairBackLink({
  fallbackHref,
  fallbackLabel,
}: {
  fallbackHref: string;
  fallbackLabel: string;
}) {
  const ret = typeof window !== "undefined" ? readReturnTo() : null;
  const href = ret?.href || fallbackHref;
  const label = ret?.label || fallbackLabel;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={href}
        className="text-sm font-medium text-slate-900 underline underline-offset-2"
        onClick={(e) => {
          if (!ret && typeof window !== "undefined" && window.history.length > 1) {
            // Prefer browser history when no returnTo
            e.preventDefault();
            window.history.back();
          }
        }}
      >
        ← Back to {label}
      </Link>
    </div>
  );
}
