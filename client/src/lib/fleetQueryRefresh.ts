import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Screens that show railcar or lease data. Matching is by the first query-key
 * segment, so `/api/railcars/summary` and `/api/kpi/cars` are included.
 */
export const FLEET_QUERY_PREFIXES = [
  "/api/railcars",
  "/api/leases",
  "/api/riders",
  "/api/lineage",
  "/api/history",
  "/api/activity",
  "/api/search",
  "/api/programs",
  "/api/kpi",
  "/api/dashboard",
  "/api/lease-mgmt",
  "/api/commitments",
  "/api/returns",
  "/api/rent-start",
  "/api/rent-stops",
  "/api/rent-events",
  "/api/car-status-history",
  "/api/views",
] as const;

/** Replaces the 45s cache window. Long enough to collapse duplicate focus/save refetches. */
export const FLEET_STALE_MS = 10_000;

const CHANNEL_NAME = "rlms-fleet-queries";
const INVALIDATE_MESSAGE = "invalidate";

export type FleetSync = {
  post: (message: string) => void;
  subscribe: (onMessage: (message: string) => void) => () => void;
};

type InvalidateOptions = {
  /** When false, this tab updates its cache and does not notify other tabs. */
  broadcast?: boolean;
  sync?: FleetSync | null;
};

let activeSync: FleetSync | null = null;

export function isFleetQueryKey(queryKey: QueryKey): boolean {
  const head = queryKey[0];
  if (typeof head !== "string") return false;
  return FLEET_QUERY_PREFIXES.some((prefix) => head === prefix || head.startsWith(`${prefix}/`));
}

export function shouldRefreshOnVisible(lastAt: number, now: number, staleMs = FLEET_STALE_MS): boolean {
  return now - lastAt >= staleMs;
}

export function createMemoryFleetSync(): FleetSync {
  const listeners = new Set<(message: string) => void>();
  return {
    post(message: string) {
      listeners.forEach((listener) => listener(message));
    },
    subscribe(onMessage) {
      listeners.add(onMessage);
      return () => {
        listeners.delete(onMessage);
      };
    },
  };
}

export function createBroadcastFleetSync(name = CHANNEL_NAME): FleetSync | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(name);
  return {
    post(message: string) {
      channel.postMessage(message);
    },
    subscribe(onMessage) {
      const handler = (event: MessageEvent) => {
        if (typeof event.data === "string") onMessage(event.data);
      };
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
  };
}

/** Invalidate every mounted or cached car/lease screen, then tell other tabs. */
export async function invalidateFleetQueries(client: QueryClient, options?: InvalidateOptions): Promise<void> {
  await client.invalidateQueries({
    predicate: (query: Query) => isFleetQueryKey(query.queryKey),
  });
  if (options?.broadcast === false) return;
  const sync = options && "sync" in options ? options.sync : activeSync;
  sync?.post(INVALIDATE_MESSAGE);
}

/** Refetch active fleet queries that are already stale. Returns whether a refetch was issued. */
export async function refreshVisibleFleetQueries(client: QueryClient): Promise<void> {
  await client.refetchQueries({
    type: "active",
    stale: true,
    predicate: (query: Query) => isFleetQueryKey(query.queryKey),
  });
}

/**
 * Focus and visibility refresh for car/lease screens, plus cross-tab sync.
 * React Query's focus manager also listens to `visibilitychange` when
 * `refetchOnWindowFocus` is on; this deduped listener covers fleet keys even
 * when that default is left off for other modules.
 */
export function installFleetQueryRefresh(
  client: QueryClient,
  options?: {
    sync?: FleetSync | null;
    now?: () => number;
    staleMs?: number;
    subscribeVisibility?: (onVisible: () => void) => () => void;
  },
): () => void {
  const sync = options && "sync" in options ? (options.sync ?? null) : createBroadcastFleetSync();
  const previous = activeSync;
  activeSync = sync;
  const now = options?.now ?? (() => Date.now());
  const staleMs = options?.staleMs ?? FLEET_STALE_MS;
  let lastVisibleAt = Number.NEGATIVE_INFINITY;

  const unsubSync = sync
    ? sync.subscribe((message) => {
        if (message !== INVALIDATE_MESSAGE) return;
        void invalidateFleetQueries(client, { broadcast: false, sync });
      })
    : () => {};

  const onVisible = () => {
    const at = now();
    if (!shouldRefreshOnVisible(lastVisibleAt, at, staleMs)) return;
    lastVisibleAt = at;
    void refreshVisibleFleetQueries(client);
  };

  const unsubVis = (options?.subscribeVisibility ?? subscribeDocumentVisible)(onVisible);

  return () => {
    unsubSync();
    unsubVis();
    if (activeSync === sync) activeSync = previous;
  };
}

function subscribeDocumentVisible(onVisible: () => void): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};
  const onVisibility = () => {
    if (document.visibilityState === "visible") onVisible();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onVisible);
  };
}
