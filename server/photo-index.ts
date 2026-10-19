/**
 * Same-origin proxy for the portal photo index.
 * RLMS auth is the Bearer session used by the other /api routes.
 * The portal is called with x-photo-key. RRPA is never contacted from here.
 * A portal failure is `{ fallback: true }` so the screen can use the legacy search.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin, requireUser } from "./auth";
import { supabaseAdmin } from "./supabase";
import {
  PHOTO_INDEX_CHUNK,
  PHOTO_INDEX_TIMEOUT_MS,
  chunkIndexCars,
  indexCarKey,
  isActiveFleetCar,
  looseIndexNumber,
  mapIndexLookup,
  normalizeIndexCars,
  type IndexCarKey,
  type IndexLookupView,
} from "@shared/photo-index";

export { PHOTO_INDEX_CHUNK, PHOTO_INDEX_TIMEOUT_MS };

export type CarStatusRow = { status: string | null; active: boolean | null };

export type PhotoIndexDeps = {
  requireUser: (req: Request, res: Response) => Promise<string | null>;
  requireAdmin: (req: Request, res: Response) => Promise<string | null>;
  fetchImpl: typeof fetch;
  lookupStatuses: (cars: IndexCarKey[]) => Promise<Map<string, CarStatusRow>>;
  timeoutSignal: (ms: number) => AbortSignal;
};

let loggedMissingPhotoKey = false;

export function resetPhotoIndexWarningsForTests(): void {
  loggedMissingPhotoKey = false;
}

export function photoApiOrigin(): string {
  const raw = (process.env.PHOTO_API_ORIGIN || "https://railcarumlerportal.vercel.app").trim();
  return raw.replace(/\/$/, "");
}

export function photoKeyHeaders(): Record<string, string> {
  const key = process.env.PHOTO_API_KEY?.trim();
  if (!key) {
    if (!loggedMissingPhotoKey) {
      loggedMissingPhotoKey = true;
      console.warn("[photo-index] PHOTO_API_KEY is unset; forwarding without x-photo-key");
    }
    return {};
  }
  return { "x-photo-key": key };
}

function photoIndexUrl(action: "lookup" | "warm" | "report-broken"): string {
  return `${photoApiOrigin()}/api/photo-index?action=${action}`;
}

async function readJson(res: globalThis.Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function postIndex(
  deps: PhotoIndexDeps,
  action: "lookup" | "warm" | "report-broken",
  body: unknown,
): Promise<{ ok: true; payload: unknown } | { ok: false }> {
  try {
    const upstream = await deps.fetchImpl(photoIndexUrl(action), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "RESIDCO-RLMS-PhotoIndex/1.0",
        ...photoKeyHeaders(),
      },
      body: JSON.stringify(body),
      signal: deps.timeoutSignal(PHOTO_INDEX_TIMEOUT_MS),
    });
    if (!upstream.ok) return { ok: false };
    const payload = await readJson(upstream);
    if (payload == null) return { ok: false };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

function fallback(res: Response): void {
  res.status(200).json({ fallback: true });
}

async function defaultLookupStatuses(cars: IndexCarKey[]): Promise<Map<string, CarStatusRow>> {
  const found = new Map<string, CarStatusRow>();
  if (!cars.length) return found;
  const numbers: string[] = [];
  const seen = new Set<string>();
  for (const car of cars) {
    const loose = looseIndexNumber(car.number);
    const padded = loose.padStart(6, "0");
    for (const value of [loose, padded]) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      numbers.push(value);
    }
  }
  const rows: Array<{ reporting_marks?: string | null; car_number?: string | null; status?: string | null; active?: boolean | null }> = [];
  for (let i = 0; i < numbers.length; i += 100) {
    const slice = numbers.slice(i, i + 100);
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select("reporting_marks, car_number, status, active")
      .in("car_number", slice);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  for (const row of rows) {
    const key = indexCarKey({ mark: row.reporting_marks, number: row.car_number });
    if (!found.has(key)) {
      found.set(key, { status: row.status ?? null, active: row.active ?? null });
    }
  }
  return found;
}

export async function handlePhotoIndexLookup(req: Request, res: Response, deps: PhotoIndexDeps): Promise<void> {
  const userId = await deps.requireUser(req, res);
  if (!userId) return;
  const body = req.body && typeof req.body === "object" ? (req.body as { cars?: unknown }) : {};
  const cars = normalizeIndexCars(body.cars);
  if (!cars.length) {
    res.status(200).json({ cars: [] });
    return;
  }
  const merged: unknown[] = [];
  for (const chunk of chunkIndexCars(cars, PHOTO_INDEX_CHUNK)) {
    const upstream = await postIndex(deps, "lookup", { cars: chunk });
    if (!upstream.ok) {
      fallback(res);
      return;
    }
    const view = mapIndexLookup(upstream.payload, chunk);
    if (view.fallback) {
      fallback(res);
      return;
    }
    merged.push(...view.cars);
  }
  const view: IndexLookupView = mapIndexLookup({ cars: merged }, cars);
  if (view.fallback) {
    fallback(res);
    return;
  }
  res.status(200).json({ cars: view.cars });
}

export async function handlePhotoIndexWarm(req: Request, res: Response, deps: PhotoIndexDeps): Promise<void> {
  const adminId = await deps.requireAdmin(req, res);
  if (!adminId) return;
  const body = req.body && typeof req.body === "object" ? (req.body as { cars?: unknown }) : {};
  const requested = normalizeIndexCars(body.cars);
  let statuses: Map<string, CarStatusRow>;
  try {
    statuses = await deps.lookupStatuses(requested);
  } catch (err) {
    console.error("[photo-index] warm status lookup", err instanceof Error ? err.message : "failed");
    fallback(res);
    return;
  }
  const active = requested.filter((car) => {
    const row = statuses.get(indexCarKey(car));
    return Boolean(row && isActiveFleetCar(row));
  });
  const dropped = requested.length - active.length;
  if (!active.length) {
    res.status(200).json({ ok: true, sent: 0, dropped, chunks: 0 });
    return;
  }
  const chunks = chunkIndexCars(active, PHOTO_INDEX_CHUNK);
  for (const chunk of chunks) {
    const upstream = await postIndex(deps, "warm", { cars: chunk });
    if (!upstream.ok || (upstream.payload && typeof upstream.payload === "object" && (upstream.payload as { fallback?: unknown }).fallback === true)) {
      fallback(res);
      return;
    }
  }
  res.status(200).json({ ok: true, sent: active.length, dropped, chunks: chunks.length });
}

export async function handlePhotoReportBroken(req: Request, res: Response, deps: PhotoIndexDeps): Promise<void> {
  const userId = await deps.requireUser(req, res);
  if (!userId) return;
  const body = req.body && typeof req.body === "object" ? (req.body as { picture_id?: unknown }) : {};
  const pictureId = String(body.picture_id ?? "").trim();
  if (!/^\d+$/.test(pictureId)) {
    res.status(400).json({ message: "picture_id is required" });
    return;
  }
  const picture_id = Number.isSafeInteger(Number(pictureId)) ? Number(pictureId) : pictureId;
  const upstream = await postIndex(deps, "report-broken", { picture_id });
  res.status(200).json({ ok: upstream.ok });
}

function settle(res: Response, work: Promise<void>, fallbackOnError: boolean): void {
  work.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "Photo index failed";
    console.error("[photo-index]", message);
    if (res.headersSent) return;
    if (fallbackOnError) {
      res.status(200).json({ fallback: true });
      return;
    }
    res.status(500).json({ ok: false });
  });
}

export function registerPhotoIndexRoutes(app: Express, overrides: Partial<PhotoIndexDeps> = {}): void {
  const deps: PhotoIndexDeps = {
    requireUser: overrides.requireUser ?? requireUser,
    requireAdmin: overrides.requireAdmin ?? requireAdmin,
    fetchImpl: overrides.fetchImpl ?? fetch,
    lookupStatuses: overrides.lookupStatuses ?? defaultLookupStatuses,
    timeoutSignal: overrides.timeoutSignal ?? ((ms) => AbortSignal.timeout(ms)),
  };
  app.post("/api/photos/index-lookup", (req, res) => {
    settle(res, handlePhotoIndexLookup(req, res, deps), true);
  });
  app.post("/api/photos/index-warm", (req, res) => {
    settle(res, handlePhotoIndexWarm(req, res, deps), true);
  });
  app.post("/api/photos/report-broken", (req, res) => {
    settle(res, handlePhotoReportBroken(req, res, deps), false);
  });
}
