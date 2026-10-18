/**
 * Persists column visibility, order, and widths via /api/prefs/columns.
 * Named views, admin-published defaults, Reset to default.
 * Program car tables share list key `program_cars` (not per program).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useIsAdmin } from "@/lib/AuthContext";
import { coalesceViewName, normalizeListKey, parsePrefsPayload, type PrefsPayload, type PrefsSort } from "@shared/column-views";

const DEBOUNCE_MS = 800;

type Cached = {
  cols: Set<string>;
  order: string[];
  widths: Record<string, number>;
  sort: PrefsSort | null;
};

export type TableViewMeta = {
  view_name: string;
  is_default: boolean;
  is_shared: boolean;
  updated_at: string | null;
};

function parseStored(raw: unknown): Cached | null {
  const parsed = parsePrefsPayload(raw);
  if (!parsed) return null;
  return {
    cols: new Set(parsed.cols),
    order: parsed.order ?? [],
    widths: parsed.widths ?? {},
    sort: parsed.sort ?? null,
  };
}

function toPayload(next: Cached): PrefsPayload {
  return { cols: Array.from(next.cols), order: next.order, widths: next.widths, sort: next.sort ?? null };
}

const memCache = new Map<string, Cached>();

function cacheKey(userId: string, listKey: string, viewName: string) {
  return `${userId}:${listKey}:${viewName}`;
}

export function useColumnPrefs(page: string, defaultCols: Set<string>) {
  const { session } = useAuth();
  const isAdmin = useIsAdmin();
  const listKey = normalizeListKey(page);
  const defaultColsRef = useRef(defaultCols);
  defaultColsRef.current = defaultCols;
  const [visibleCols, setVisibleCols] = useState<Set<string>>(defaultCols);
  const [colOrder, setColOrderState] = useState<string[]>([]);
  const [colWidths, setColWidthsState] = useState<Record<string, number>>({});
  const [sort, setSortState] = useState<PrefsSort | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [viewName, setViewName] = useState("Default");
  const [views, setViews] = useState<TableViewMeta[]>([]);
  const [sharedDefault, setSharedDefault] = useState<Cached | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Cached>({ cols: defaultCols, order: [], widths: {}, sort: null });
  latest.current = { cols: visibleCols, order: colOrder, widths: colWidths, sort };
  const viewNameRef = useRef(viewName);
  viewNameRef.current = viewName;

  const applyCached = useCallback((parsed: Cached | null) => {
    const next = parsed ?? { cols: defaultColsRef.current, order: [] as string[], widths: {} as Record<string, number>, sort: null };
    setVisibleCols(next.cols);
    setColOrderState(next.order);
    setColWidthsState(next.widths);
    setSortState(next.sort ?? null);
    latest.current = next;
  }, []);

  const load = useCallback(
    async (wantedView?: string) => {
      if (!session?.access_token) {
        setPrefsLoaded(true);
        return;
      }
      const qs = new URLSearchParams({ list_key: listKey });
      if (wantedView) qs.set("view_name", wantedView);
      const r = await fetch(`/api/prefs/columns?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = r.ok ? await r.json() : null;
      const parsed = parseStored(data?.visible_cols);
      const name = coalesceViewName(data?.view_name);
      setViewName(name);
      setViews(Array.isArray(data?.views) ? data.views : []);
      setSharedDefault(parseStored(data?.shared_default?.visible_cols));
      if (parsed) {
        memCache.set(cacheKey(session.user.id, listKey, name), parsed);
        applyCached(parsed);
      } else {
        applyCached(parseStored(data?.shared_default?.visible_cols));
      }
      setPrefsLoaded(true);
    },
    [session?.access_token, session?.user?.id, listKey, applyCached],
  );

  useEffect(() => {
    load().catch(() => setPrefsLoaded(true));
  }, [load]);

  const persist = useCallback(
    (next: Cached, name = viewNameRef.current) => {
      if (!session?.access_token) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        memCache.set(cacheKey(session.user.id, listKey, name), next);
        fetch("/api/prefs/columns", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ list_key: listKey, page: listKey, view_name: name, visible_cols: toPayload(next) }),
        }).catch(() => {});
      }, DEBOUNCE_MS);
    },
    [session?.access_token, session?.user?.id, listKey],
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
    [persist],
  );

  const resetCols = useCallback(() => {
    const next = sharedDefault ?? { cols: defaultColsRef.current, order: [] as string[], widths: {} as Record<string, number>, sort: null };
    applyCached(next);
    persist(next);
  }, [sharedDefault, persist, applyCached]);

  const setColOrder = useCallback(
    (order: string[]) => {
      const next = { ...latest.current, order };
      setColOrderState(order);
      persist(next);
    },
    [persist],
  );

  const setColWidth = useCallback(
    (key: string, width: number) => {
      const widths = { ...latest.current.widths, [key]: width };
      const next = { ...latest.current, widths };
      setColWidthsState(widths);
      persist(next);
    },
    [persist],
  );

  const setSort = useCallback(
    (nextSort: PrefsSort | null) => {
      const next = { ...latest.current, sort: nextSort };
      setSortState(nextSort);
      persist(next);
    },
    [persist],
  );

  const authHeaders = useCallback(() => {
    if (!session?.access_token) return null;
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  }, [session?.access_token]);

  const selectView = useCallback(
    (name: string) => {
      load(name).catch(() => {});
    },
    [load],
  );

  const saveAs = useCallback(
    async (name: string) => {
      const headers = authHeaders();
      if (!headers) return;
      const next = latest.current;
      const r = await fetch("/api/prefs/columns/views", {
        method: "POST",
        headers,
        body: JSON.stringify({
          list_key: listKey,
          view_name: name,
          visible_cols: toPayload(next),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Could not save view");
      }
      setViewName(coalesceViewName(name));
      await load(name);
    },
    [authHeaders, listKey, load],
  );

  const renameView = useCallback(
    async (newName: string) => {
      const headers = authHeaders();
      if (!headers) return;
      const r = await fetch("/api/prefs/columns/views", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ list_key: listKey, view_name: viewNameRef.current, new_name: newName }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Could not rename view");
      }
      setViewName(newName);
      await load(newName);
    },
    [authHeaders, listKey, load],
  );

  const deleteView = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) return;
    const r = await fetch(
      `/api/prefs/columns/views?list_key=${encodeURIComponent(listKey)}&view_name=${encodeURIComponent(viewNameRef.current)}`,
      { method: "DELETE", headers },
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || "Could not delete view");
    }
    await load();
  }, [authHeaders, listKey, load]);

  const setDefault = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) return;
    const r = await fetch("/api/prefs/columns/default", {
      method: "POST",
      headers,
      body: JSON.stringify({ list_key: listKey, view_name: viewNameRef.current }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || "Could not set default");
    }
    await load(viewNameRef.current);
  }, [authHeaders, listKey, load]);

  const publish = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) return;
    const r = await fetch("/api/prefs/columns/publish", {
      method: "POST",
      headers,
      body: JSON.stringify({
        list_key: listKey,
        view_name: viewNameRef.current,
        visible_cols: toPayload(latest.current),
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || "Could not publish default");
    }
    await load(viewNameRef.current);
  }, [authHeaders, listKey, load]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  return {
    listKey,
    visibleCols,
    toggleCol,
    resetCols,
    prefsLoaded,
    colOrder,
    setColOrder,
    colWidths,
    setColWidth,
    sort,
    setSort,
    viewName,
    views,
    selectView,
    saveAs,
    renameView,
    deleteView,
    setDefault,
    publish,
    isAdmin,
  };
}

export const useTableView = useColumnPrefs;
