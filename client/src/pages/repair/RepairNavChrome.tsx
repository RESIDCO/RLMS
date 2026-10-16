/**
 * §G r2 — breadcrumbs + "← Back to <source>" via returnTo (fallback: history).
 * AA: shared repairUi / CSS variable tokens (light-only owner theme).
 */
import { Link } from "wouter";
import { repairUi } from "./repairTokens";

/** @deprecated Prefer repairUi — kept as alias for existing shop/invoice call sites. */
export const shopAa = {
  page: `${repairUi.page} min-h-full`,
  label: repairUi.label,
  muted: repairUi.muted,
  value: repairUi.value,
  crumb: repairUi.crumb,
  crumbCurrent: repairUi.crumbCurrent,
  input: repairUi.input,
  select: repairUi.select,
  textarea: repairUi.textarea,
} as const;

export type Crumb = { label: string; href?: string };

export function RepairBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className={repairUi.muted}>›</span>}
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
        className={`${repairUi.link} text-sm font-medium underline underline-offset-2`}
        onClick={(e) => {
          if (!ret && typeof window !== "undefined" && window.history.length > 1) {
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
