import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "./supabase";

// VITE_API_BASE is set at build time for the Render-hosted backend.
// Falls back to __PORT_5000__ (replaced by deploy_website for proxy routing),
// then to "" (same-origin, used in local dev).
const RENDER_API = import.meta.env.VITE_API_BASE as string | undefined;
const PROXY_API = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
const API_BASE = RENDER_API || PROXY_API;

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function parseErrorPayload(status: number, text: string): { message: string; body: Record<string, unknown> } {
  const raw = (text || "").trim();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : raw || `Request failed (${status})`;
    return { message, body: parsed };
  } catch {
    return { message: raw || `Request failed (${status})`, body: {} };
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    const parsed = parseErrorPayload(res.status, text);
    if (res.status === 413) {
      throw new ApiError(
        res.status,
        parsed.message || "This file is too large to send as JSON (HTTP 413). Drop the Excel/CSV so the server can parse it.",
        parsed.body,
      );
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new ApiError(
        res.status,
        parsed.message ||
          `preview failed: the server stopped while reading the file (HTTP ${res.status}). Often out of memory or a request timeout — retry after the slimmer parser is live.`,
        parsed.body,
      );
    }
    throw new ApiError(res.status, parsed.message, parsed.body);
  }
}

/** POST multipart (do not set Content-Type — the browser sets the boundary). */
export async function apiUpload(
  url: string,
  form: FormData,
  init?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<Response> {
  const headers: Record<string, string> = {};
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const timeoutMs = init?.timeoutMs;
  const outer = init?.signal;
  const ctrl = timeoutMs || outer ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (ctrl && timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
  }
  const onOuterAbort = () => ctrl?.abort();
  outer?.addEventListener("abort", onOuterAbort);

  try {
    const res = await fetch(`${API_BASE}${url}`, {
      method: "POST",
      headers,
      body: form,
      signal: ctrl?.signal,
    });
    await throwIfResNotOk(res);
    return res;
  } catch (err) {
    if (ctrl?.signal.aborted && !outer?.aborted) {
      throw new Error("Request timed out");
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

/** Download an Excel attachment. Throws with the server message if the request failed. */
export async function downloadXlsx(url: string, fallbackName: string) {
  const res = await apiRequest("GET", url);
  const blob = await res.blob();
  const disp = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disp);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] ?? fallbackName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function apiGet<T>(
  url: string,
  init?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  const res = await apiRequest("GET", url, undefined, undefined, init);
  return res.json();
}

export function railcarsQs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `/api/railcars?${qs}` : "/api/railcars";
}

/** `/api/railcars` is an array when `all=1`, otherwise `{ rows, total_count, page, pageSize }`. */
export function asRailcarList<T>(data: T[] | { rows?: T[] } | null | undefined): T[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.rows)) return data.rows;
  return [];
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  extraHeaders?: Record<string, string>,
  init?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<Response> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (data) headers["Content-Type"] = "application/json";
  // Attach Supabase session token if available
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const timeoutMs = init?.timeoutMs;
  const outer = init?.signal;
  const ctrl = timeoutMs || outer ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (ctrl && timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
  }
  const onOuterAbort = () => ctrl?.abort();
  outer?.addEventListener("abort", onOuterAbort);

  try {
    const res = await fetch(`${API_BASE}${url}`, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      signal: ctrl?.signal,
    });
    await throwIfResNotOk(res);
    // Dynamic import avoids a queryClient ↔ undo cycle.
    if (method.toUpperCase() !== "GET" && !url.includes("/api/undo") && !url.includes("/preview")) {
      const clone = res.clone();
      void clone.json().then((body) => {
        void import("@/lib/undo").then((m) => m.offerUndoToast(body)).catch(() => {});
      }).catch(() => {});
    }
    return res;
  } catch (err) {
    if (ctrl?.signal.aborted && !outer?.aborted) {
      throw new Error("Request timed out");
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers: Record<string, string> = {};
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { headers });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 45_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
