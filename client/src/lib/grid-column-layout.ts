/**
 * Per-grid column width and order stored in localStorage.
 * Price columns stay in the saved order when a viewer hides them.
 */

import { mergeColOrder, moveCol } from "@/lib/grid-columns";

export const GRID_LAYOUT_VERSION = 1;

export type GridColSpec = {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth?: number;
  wrap?: boolean;
  pinned?: boolean;
};

export type StoredGridLayout = {
  v: number;
  order: string[];
  widths: Record<string, number>;
};

/** Long text columns wrap and expose the full value on hover. */
export const WRAP_TEXT_KEYS = new Set([
  "lessee_desc",
  "lessee_rating",
  "equipment_desc",
  "commodity",
  "notes",
  "exclude_reason",
  "loss_reason",
]);

export function layoutStorageKey(gridId: string): string {
  return `rlms.grid.${gridId}`;
}

/** Wide enough for a text-xs header plus the resize handle. */
export function headerMinWidth(label: string): number {
  const chars = Array.from(label).length;
  return Math.max(72, chars * 8 + 36);
}

export function columnMinWidth(spec: GridColSpec): number {
  return Math.max(headerMinWidth(spec.label), spec.minWidth ?? 0);
}

export function cellTooltip(value: string): string | undefined {
  const text = value.replace(/\s+$/g, "");
  return text.length > 0 ? text : undefined;
}

export function defaultLayout(specs: readonly GridColSpec[]): StoredGridLayout {
  const widths: Record<string, number> = {};
  for (const spec of specs) {
    widths[spec.key] = Math.max(spec.defaultWidth, columnMinWidth(spec));
  }
  return {
    v: GRID_LAYOUT_VERSION,
    order: specs.map((spec) => spec.key),
    widths,
  };
}

export function parseStoredLayout(raw: string | null, specs: readonly GridColSpec[]): StoredGridLayout {
  const base = defaultLayout(specs);
  if (!raw) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object") return base;
  const record = parsed as { order?: unknown; widths?: unknown };
  const savedOrder = Array.isArray(record.order)
    ? record.order.filter((key): key is string => typeof key === "string")
    : [];
  const widths = { ...base.widths };
  if (record.widths && typeof record.widths === "object") {
    for (const spec of specs) {
      const width = (record.widths as Record<string, unknown>)[spec.key];
      if (typeof width === "number" && Number.isFinite(width)) {
        widths[spec.key] = Math.max(columnMinWidth(spec), Math.round(width));
      }
    }
  }
  return {
    v: GRID_LAYOUT_VERSION,
    order: mergeColOrder(base.order, savedOrder),
    widths,
  };
}

export function displayColumns(
  specs: readonly GridColSpec[],
  storedOrder: readonly string[],
  hidden: ReadonlySet<string> = new Set(),
): GridColSpec[] {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const movable = specs.filter((spec) => !spec.pinned && !hidden.has(spec.key)).map((spec) => spec.key);
  const ordered = mergeColOrder(movable, [...storedOrder]);
  const pinned = specs.filter((spec) => spec.pinned && !hidden.has(spec.key));
  return [...ordered.map((key) => byKey.get(key)).filter((spec): spec is GridColSpec => spec != null), ...pinned];
}

export function reorderGrid(specs: readonly GridColSpec[], storedOrder: readonly string[], fromKey: string, toKey: string): string[] {
  const pinned = new Set(specs.filter((spec) => spec.pinned).map((spec) => spec.key));
  if (pinned.has(fromKey) || pinned.has(toKey)) return [...storedOrder];
  const movable = specs.filter((spec) => !spec.pinned).map((spec) => spec.key);
  const current = mergeColOrder(movable, [...storedOrder]);
  const nextMovable = moveCol(current, fromKey, toKey);
  const pinnedKeys = specs.filter((spec) => spec.pinned).map((spec) => spec.key);
  return [...nextMovable, ...pinnedKeys];
}

export function resizeGrid(
  specs: readonly GridColSpec[],
  widths: Record<string, number>,
  key: string,
  width: number,
): Record<string, number> {
  const spec = specs.find((item) => item.key === key);
  if (!spec || !Number.isFinite(width)) return widths;
  return { ...widths, [key]: Math.max(columnMinWidth(spec), Math.round(width)) };
}
