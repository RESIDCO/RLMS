/**
 * useColumnPrefs
 *
 * Persists a user's optional-column visibility, plus optional reorder/resize
 * layout, to /api/prefs/columns.
 *
 * Usage:
 *   const { visibleCols, toggleCol, resetCols, prefsLoaded, colOrder, setColOrder, colWidths, setColWidth } =
 *     useColumnPrefs("fleet_registry", DEFAULT_COLS);
 *
 * `visible_cols` in the database is jsonb. Older rows are a string array of
 * visible keys. Newer rows are `{ cols, order, widths }`. Both are accepted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";

const DEBOUNCE_MS = 800;

type Cached = {
  cols: Set<string>;
  order: string[];
  widths: Record<string, number>;
};

type PrefsObject = {
  cols: string[];
  order?: string[];
  widths?: Record<string, number>;
};

const memCache = new Map<string, Cached>();

function parseStored(raw: unknown): Cached | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return {
      cols: new Set(raw.filter((x): x is string => typeof x === "string")),
      order: [],
      widths: {},
    };
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const colsSrc = Array.isArray(o.cols)
    ? o.cols
    : Array.isArray(o.visible_cols)
      ? o.visible_cols
      : null;
  if (!colsSrc) return null;
  const cols = new Set(colsSrc.filter((x): x is string => typeof x === "string"));
  const order = Array.isArray(o.order)
    ? o.order.filter((x): x is string => typeof x === "string")
    : [];
  const widths: Record<string, number> = {};
  if (o.widths && typeof o.widths === "object" && !Array.isArray(o.widths)) {
    for (const [k, v] of Object.entries(o.widths as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) widths[k] = v;
    }
  }
  return { cols, order, widths };
}

export function useColumnPrefs(page: string, defaultCols: Set<string>) {
  const { session } = useAuth();
  const [visibleCols, setVisibleCols] = useState<Set<string>>(defaultCols);
  const [colOrder, setColOrderState] = useState<string[]>([]);
  const [colWidths, setColWidthsState] = useState<Record<string, number>>({});
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedRef = useRef(false);
  const latest = useRef<Cached>({ cols: defaultCols, order: [], widths: {} });
  latest.current = { cols: visibleCols, order: colOrder, widths: colWidths };

  useEffect(() => {
    if (!session?.access_token || fetchedRef.current) {
      setPrefsLoaded(true);
      return;
    }

    const cacheKey = `${session.user.id}:${page}`;
    if (memCache.has(cacheKey)) {
      const cached = memCache.get(cacheKey)!;
      setVisibleCols(cached.cols);
      setColOrderState(cached.order);
      setColWidthsState(cached.widths);
      setPrefsLoaded(true);
      fetchedRef.current = true;
      return;
    }

    fetchedRef.current = true;

    fetch(`/api/prefs/columns?page=${encodeURIComponent(page)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const parsed = parseStored(data?.visible_cols);
        if (parsed) {
          memCache.set(cacheKey, parsed);
          setVisibleCols(parsed.cols);
          setColOrderState(parsed.order);
          setColWidthsState(parsed.widths);
        }
      })
      .catch(() => {
        // Silently fall back to defaults if API is unreachable
      })
      .finally(() => {
        setPrefsLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const persist = useCallback(
    (next: Cached) => {
      if (!session?.access_token) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const cacheKey = `${session.user.id}:${page}`;
        memCache.set(cacheKey, next);
        const body: PrefsObject = {
          cols: Array.from(next.cols),
          order: next.order,
          widths: next.widths,
        };
        fetch("/api/prefs/columns", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ page, visible_cols: body }),
        }).catch(() => {
          // Silently ignore save failures — local state is still correct
        });
      }, DEBOUNCE_MS);
    },
    [session?.access_token, page]
  );

  const toggleCol = useCallback(
    (key: string) => {
      const nextCols = new Set(latest.current.cols);
      if (nextCols.has(key)) nextCols.delete(key);
      else nextCols.add(key);
      const next = { ...latest.current, cols: nextCols };
      setVisibleCols(nextCols);
      persist(next);
    },
    [persist]
  );

  const resetCols = useCallback(() => {
    const next = { cols: defaultCols, order: [] as string[], widths: {} as Record<string, number> };
    setVisibleCols(defaultCols);
    setColOrderState([]);
    setColWidthsState({});
    persist(next);
  }, [defaultCols, persist]);

  const setColOrder = useCallback(
    (order: string[]) => {
      const next = { ...latest.current, order };
      setColOrderState(order);
      persist(next);
    },
    [persist]
  );

  const setColWidth = useCallback(
    (key: string, width: number) => {
      const widths = { ...latest.current.widths, [key]: width };
      const next = { ...latest.current, widths };
      setColWidthsState(widths);
      persist(next);
    },
    [persist]
  );

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  return {
    visibleCols,
    toggleCol,
    resetCols,
    prefsLoaded,
    colOrder,
    setColOrder,
    colWidths,
    setColWidth,
  };
}
