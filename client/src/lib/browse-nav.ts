/** Hash-router paths for Dashboard / search drill-downs. First hop opens a new tab. */

export const ENTITY_SLUGS: Record<string, { db: string; label: string }> = {
  rps: { db: "Rail Partners Select", label: "RPS" },
  main: { db: "Main", label: "RESIDCO Fleet" },
  coal: { db: "Coal", label: "Coal" },
};

export function entitySlugFromDb(entity: string | null | undefined): string | null {
  const v = String(entity ?? "").trim();
  if (v === "Rail Partners Select") return "rps";
  if (v === "Main") return "main";
  if (v === "Coal") return "coal";
  return v ? v.toLowerCase() : null;
}

export function lesseePath(lessee: string) {
  return `/browse/lessee/${encodeURIComponent(lessee)}`;
}
export function lesseeOlPath(lessee: string, ol: string) {
  return `${lesseePath(lessee)}/ol/${encodeURIComponent(ol)}`;
}
export function lesseeOlCarPath(lessee: string, ol: string, id: number) {
  return `${lesseeOlPath(lessee, ol)}/car/${id}`;
}
export function entityPath(slug: string) {
  return `/browse/entity/${encodeURIComponent(slug.toLowerCase())}`;
}
export function entityOlPath(slug: string, ol: string) {
  return `${entityPath(slug)}/ol/${encodeURIComponent(ol)}`;
}
export function entityOlCarPath(slug: string, ol: string, id: number) {
  return `${entityOlPath(slug, ol)}/car/${id}`;
}
export function olPath(ol: string) {
  return `/browse/ol/${encodeURIComponent(ol)}`;
}
export function olCarPath(ol: string, id: number) {
  return `${olPath(ol)}/car/${id}`;
}
export function turning50Path(year: number) {
  return `/browse/turning50/${year}`;
}
export function turning50OlPath(year: number, ol: string) {
  return `${turning50Path(year)}/ol/${encodeURIComponent(ol)}`;
}
export function turning50OlCarPath(year: number, ol: string, id: number) {
  return `${turning50OlPath(year, ol)}/car/${id}`;
}
export function turning50CarPath(year: number, id: number) {
  return `${turning50Path(year)}/car/${id}`;
}
export function carPath(id: number) {
  return `/cars/${id}`;
}
export function programPath(id: number) {
  return `/programs/${id}`;
}
export function accountPath(id: number) {
  return `/accounts/${id}`;
}
export function historyPath(carQuery: string) {
  return `/history?q=${encodeURIComponent(carQuery)}`;
}

export function hashAppUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${window.location.origin}${window.location.pathname}${window.location.search}#${p}`;
}

/** Open a drill-down in a new browser tab (Dashboard / search first hop). */
export function openAppTab(path: string) {
  window.open(hashAppUrl(path), "_blank", "noopener,noreferrer");
}

export function olKeyFromLabel(raw: string | null | undefined): string | null {
  const n = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!n || n === "SOLD") return null;
  const m = n.match(/^(OL\d+)/);
  return m ? m[1] : n;
}
