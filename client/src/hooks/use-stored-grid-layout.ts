import { useCallback, useMemo, useState } from "react";
import {
  defaultLayout,
  displayColumns,
  layoutStorageKey,
  parseStoredLayout,
  reorderGrid,
  resizeGrid,
  type GridColSpec,
  type StoredGridLayout,
} from "@/lib/grid-column-layout";

const EMPTY_HIDDEN: ReadonlySet<string> = new Set();

function readLayout(storageKey: string, specs: readonly GridColSpec[]): StoredGridLayout {
  if (typeof localStorage === "undefined") return defaultLayout(specs);
  try {
    return parseStoredLayout(localStorage.getItem(storageKey), specs);
  } catch {
    return defaultLayout(specs);
  }
}

function writeLayout(storageKey: string, layout: StoredGridLayout): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    /* private mode or a full quota leaves the in-memory layout in place */
  }
}

export function useStoredGridLayout(gridId: string, specs: readonly GridColSpec[], hidden: ReadonlySet<string> = EMPTY_HIDDEN) {
  const storageKey = layoutStorageKey(gridId);
  const [layout, setLayout] = useState<StoredGridLayout>(() => readLayout(storageKey, specs));

  const commit = useCallback((next: StoredGridLayout) => {
    setLayout(next);
    writeLayout(storageKey, next);
  }, [storageKey]);

  const columns = useMemo(
    () => displayColumns(specs, layout.order, hidden),
    [specs, layout.order, hidden],
  );

  const onResize = useCallback((key: string, width: number) => {
    setLayout((current) => {
      const next = { ...current, widths: resizeGrid(specs, current.widths, key, width) };
      writeLayout(storageKey, next);
      return next;
    });
  }, [specs, storageKey]);

  const onMove = useCallback((fromKey: string, toKey: string) => {
    setLayout((current) => {
      const next = { ...current, order: reorderGrid(specs, current.order, fromKey, toKey) };
      writeLayout(storageKey, next);
      return next;
    });
  }, [specs, storageKey]);

  const reset = useCallback(() => {
    commit(defaultLayout(specs));
  }, [commit, specs]);

  const widthOf = useCallback((key: string) => {
    const spec = specs.find((item) => item.key === key);
    const fallback = spec ? Math.max(spec.defaultWidth, spec.minWidth ?? 0) : 110;
    return layout.widths[key] ?? fallback;
  }, [layout.widths, specs]);

  return { columns, onResize, onMove, reset, widthOf, layout };
}
