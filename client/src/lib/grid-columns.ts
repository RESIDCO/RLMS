/** Helpers for resizable/reorderable data-grid columns. */

export const GRID_COL_MIN = 56;

export function mergeColOrder(defaultOrder: string[], saved?: string[]): string[] {
  if (!saved?.length) return defaultOrder;
  const allowed = new Set(defaultOrder);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of saved) {
    if (!allowed.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  for (const k of defaultOrder) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export function moveCol(order: string[], fromKey: string, toKey: string): string[] {
  if (fromKey === toKey) return order;
  const from = order.indexOf(fromKey);
  const to = order.indexOf(toKey);
  if (from < 0 || to < 0) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, fromKey);
  return next;
}

export function colWidth(
  widths: Record<string, number>,
  key: string,
  fallback = 110,
): number {
  const w = widths[key];
  return typeof w === "number" && Number.isFinite(w) && w >= GRID_COL_MIN ? w : fallback;
}

export function tableWidthFor(
  keys: string[],
  widths: Record<string, number>,
  fallbacks: Record<string, number> = {},
  defaultFallback = 110,
): number {
  return keys.reduce(
    (sum, k) => sum + colWidth(widths, k, fallbacks[k] ?? defaultFallback),
    0,
  );
}
