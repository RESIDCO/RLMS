/**
 * Same-origin photo search proxy.
 * Forwards one car at a time to the portal. PHOTO_API_KEY is optional:
 * when it is unset the request still goes out, once per process, with a warning.
 * A missing portal (PR B not deployed, network error, 404) degrades to a per-car error.
 */
import type { Express, Request, Response } from "express";
import { requireUser } from "./auth";
import { supabaseAdmin } from "./supabase";

export const PHOTO_IDENTITY_CAP = 500;

const FLAG_REASONS = ["wrong_car", "wrong_type", "duplicate", "bad_image", "other"] as const;
export type PhotoFlagReason = (typeof FLAG_REASONS)[number];

export type PhotoUser = { id: string; email: string };

export type RailcarIdentity = {
  id: number;
  reporting_marks: string | null;
  car_number: string | null;
};

export type IdentityCar = { mark: string; number: string };

export type PhotoSearchDeps = {
  requireUser: (req: Request, res: Response) => Promise<PhotoUser | null>;
  fetchImpl: typeof fetch;
  lookupIdentities: (query: { ids: number[]; cars: IdentityCar[] }) => Promise<RailcarIdentity[]>;
};

let loggedMissingPhotoKey = false;

export function resetPhotoSearchWarningsForTests(): void {
  loggedMissingPhotoKey = false;
}

export function photoApiOrigin(): string {
  const raw = (process.env.PHOTO_API_ORIGIN || "https://railcarumlerportal.vercel.app").trim();
  return raw.replace(/\/$/, "");
}

/** Header for the portal. Logs once when the key is unset, then forwards anyway. */
export function photoKeyHeaders(): Record<string, string> {
  const key = process.env.PHOTO_API_KEY?.trim();
  if (!key) {
    if (!loggedMissingPhotoKey) {
      loggedMissingPhotoKey = true;
      console.warn("[photo-search] PHOTO_API_KEY is unset; forwarding without x-photo-key");
    }
    return {};
  }
  return { "x-photo-key": key };
}

export function normalizeIdentityIds(raw: unknown): { ids: number[]; requested: number; cap: number } {
  const list = Array.isArray(raw) ? raw : [];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const item of list) {
    const n = typeof item === "number" ? item : Number(String(item ?? "").trim());
    if (!Number.isInteger(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    ids.push(n);
  }
  return { ids: ids.slice(0, PHOTO_IDENTITY_CAP), requested: ids.length, cap: PHOTO_IDENTITY_CAP };
}

function looseNumber(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.replace(/^0+/, "") || (digits ? "0" : "");
}

export function normalizeIdentityCars(raw: unknown): { cars: IdentityCar[]; requested: number; cap: number } {
  const list = Array.isArray(raw) ? raw : [];
  const cars: IdentityCar[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { mark?: unknown; reporting_marks?: unknown; number?: unknown; car_number?: unknown };
    const mark = String(row.mark ?? row.reporting_marks ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
    const number = looseNumber(row.number ?? row.car_number);
    if (mark.length < 2 || mark.length > 4 || !number) continue;
    const key = `${mark}_${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cars.push({ mark, number });
  }
  return { cars: cars.slice(0, PHOTO_IDENTITY_CAP), requested: cars.length, cap: PHOTO_IDENTITY_CAP };
}

export function isAllowedPhotoImageUrl(raw: string, origin = photoApiOrigin()): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (url.host === originUrl.host && url.pathname.startsWith("/api/proxy-image")) return true;
  if (url.host === "s3.amazonaws.com" && url.pathname.startsWith("/rrpa_photos/")) return true;
  if (
    (url.host === "www.rrpicturearchives.net" || url.host === "rrpicturearchives.net")
    && url.pathname.startsWith("/pictures/")
  ) {
    return true;
  }
  return false;
}

function isFlagReason(value: unknown): value is PhotoFlagReason {
  return typeof value === "string" && (FLAG_REASONS as readonly string[]).includes(value);
}

async function defaultRequireUser(req: Request, res: Response): Promise<PhotoUser | null> {
  const id = await requireUser(req, res);
  if (!id) return null;
  return { id, email: req.authUser?.email ?? "" };
}

async function lookupIds(ids: number[]): Promise<RailcarIdentity[]> {
  const rows: RailcarIdentity[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select("id, reporting_marks, car_number")
      .in("id", slice);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as RailcarIdentity[]));
  }
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return ids.map((id) => byId.get(id)).filter((row): row is RailcarIdentity => Boolean(row));
}

async function lookupCars(cars: IdentityCar[]): Promise<RailcarIdentity[]> {
  const numbers: string[] = [];
  const seenNumbers = new Set<string>();
  cars.forEach((car) => {
    const loose = looseNumber(car.number);
    const padded = loose.padStart(6, "0");
    if (!seenNumbers.has(loose)) {
      seenNumbers.add(loose);
      numbers.push(loose);
    }
    if (padded !== loose && !seenNumbers.has(padded)) {
      seenNumbers.add(padded);
      numbers.push(padded);
    }
  });
  const rows: RailcarIdentity[] = [];
  for (let i = 0; i < numbers.length; i += 100) {
    const slice = numbers.slice(i, i + 100);
    const { data, error } = await supabaseAdmin
      .from("railcars")
      .select("id, reporting_marks, car_number")
      .in("car_number", slice);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as RailcarIdentity[]));
  }
  const wanted = new Map(cars.map((car) => [`${car.mark}_${looseNumber(car.number)}`, car]));
  const found = new Map<string, RailcarIdentity>();
  for (const row of rows) {
    const key = `${String(row.reporting_marks || "").toUpperCase().replace(/[^A-Z]/g, "")}_${looseNumber(row.car_number)}`;
    if (wanted.has(key) && !found.has(key)) found.set(key, row);
  }
  return cars.map((car) => found.get(`${car.mark}_${looseNumber(car.number)}`)).filter((row): row is RailcarIdentity => Boolean(row));
}

async function defaultLookup(query: { ids: number[]; cars: IdentityCar[] }): Promise<RailcarIdentity[]> {
  if (query.ids.length) return lookupIds(query.ids);
  if (query.cars.length) return lookupCars(query.cars);
  return [];
}

function oneCar(body: unknown): Record<string, unknown> {
  const src = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const cars = Array.isArray(src.cars) ? src.cars.slice(0, 1) : [];
  const out: Record<string, unknown> = { cars };
  if (typeof src.fetch_images === "boolean") out.fetch_images = src.fetch_images;
  if (src.max_per_car != null) out.max_per_car = src.max_per_car;
  if (src.skip_cache != null) out.skip_cache = src.skip_cache;
  return out;
}

function degradedFind(body: Record<string, unknown>, error: string): Record<string, unknown> {
  const cars = Array.isArray(body.cars) ? body.cars : [];
  return {
    status: "error",
    error,
    cars: cars.map((item) => {
      const car = item && typeof item === "object" ? (item as { mark?: unknown; number?: unknown }) : {};
      const mark = String(car.mark ?? "");
      const number = String(car.number ?? "");
      return {
        mark,
        number,
        display: [mark, number].filter(Boolean).join(" "),
        images: [],
        status: "error",
        error,
        image_error: error,
      };
    }),
  };
}

async function readJson(res: globalThis.Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: "portal_unavailable", message: text.slice(0, 180) };
  }
}

export async function handlePhotoFind(req: Request, res: Response, deps: PhotoSearchDeps): Promise<void> {
  const user = await deps.requireUser(req, res);
  if (!user) return;
  const forwarded = oneCar(req.body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "RESIDCO-RLMS-PhotoSearch/1.0",
    ...photoKeyHeaders(),
  };
  const url = `${photoApiOrigin()}/api/find-photos`;
  try {
    const upstream = await deps.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(forwarded),
      signal: AbortSignal.timeout(50_000),
    });
    if (upstream.status === 404) {
      res.status(200).json(degradedFind(forwarded, "portal_unavailable"));
      return;
    }
    const payload = await readJson(upstream);
    res.status(upstream.status).json(payload);
  } catch (err) {
    const name = (err as { name?: string } | null)?.name || "";
    const message = err instanceof Error ? err.message : String(err);
    const error = name === "TimeoutError" || name === "AbortError" || /timeout/i.test(message)
      ? "timeout"
      : "portal_unavailable";
    res.status(200).json(degradedFind(forwarded, error));
  }
}

export async function handlePhotoFlag(req: Request, res: Response, deps: PhotoSearchDeps): Promise<void> {
  const user = await deps.requireUser(req, res);
  if (!user) return;
  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const mark = String(body.mark ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  const number = looseNumber(body.number);
  const imageKey = String(body.image_key ?? "").trim();
  const reason = body.reason;
  if (!mark || !number || !imageKey || !isFlagReason(reason)) {
    res.status(400).json({ message: "mark, number, image_key, and reason are required" });
    return;
  }
  const payload: Record<string, unknown> = {
    mark,
    number,
    image_key: imageKey,
    reason,
    flagged_by: user.email,
    source_app: "rlms",
  };
  if (body.picture_id != null && String(body.picture_id).trim()) payload.picture_id = String(body.picture_id).trim();
  if (typeof body.note === "string" && body.note.trim()) payload.note = body.note.trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "RESIDCO-RLMS-PhotoSearch/1.0",
    ...photoKeyHeaders(),
  };
  try {
    const upstream = await deps.fetchImpl(`${photoApiOrigin()}/api/photo-flags`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (upstream.status === 404) {
      res.status(503).json({ error: "flags_not_enabled" });
      return;
    }
    const upstreamBody = await readJson(upstream);
    res.status(upstream.status).json(upstreamBody);
  } catch {
    res.status(503).json({ error: "flags_not_enabled" });
  }
}

export async function handleRailcarIdentities(req: Request, res: Response, deps: PhotoSearchDeps): Promise<void> {
  const user = await deps.requireUser(req, res);
  if (!user) return;
  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const hasIds = Array.isArray(body.ids);
  const hasCars = Array.isArray(body.cars);
  if (!hasIds && !hasCars) {
    res.status(400).json({ message: "ids or cars is required" });
    return;
  }
  try {
    if (hasIds) {
      const capped = normalizeIdentityIds(body.ids);
      const cars = await deps.lookupIdentities({ ids: capped.ids, cars: [] });
      res.json({
        cars,
        requested: capped.requested,
        returned: cars.length,
        cap: capped.cap,
        truncated: capped.requested > capped.cap,
      });
      return;
    }
    const capped = normalizeIdentityCars(body.cars);
    const cars = await deps.lookupIdentities({ ids: [], cars: capped.cars });
    res.json({
      cars,
      requested: capped.requested,
      returned: cars.length,
      cap: capped.cap,
      truncated: capped.requested > capped.cap,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not look up cars";
    console.error("[photo-search] identities", message);
    res.status(500).json({ message: "Could not look up cars" });
  }
}

export async function handlePhotoImage(req: Request, res: Response, deps: PhotoSearchDeps): Promise<void> {
  const user = await deps.requireUser(req, res);
  if (!user) return;
  const raw = String(req.query.url ?? "").trim();
  if (!isAllowedPhotoImageUrl(raw)) {
    res.status(400).json({ message: "Image URL is not allowed" });
    return;
  }
  try {
    const upstream = await deps.fetchImpl(raw, { redirect: "follow" });
    if (!upstream.ok) {
      res.status(upstream.status).json({ message: `Image HTTP ${upstream.status}` });
      return;
    }
    const type = upstream.headers.get("content-type") || "";
    if (!type.startsWith("image/")) {
      res.status(415).json({ message: "Upstream did not return an image" });
      return;
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(bytes);
  } catch {
    res.status(502).json({ message: "Could not fetch image" });
  }
}

function settle(res: Response, work: Promise<void>): void {
  work.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "Photo search failed";
    console.error("[photo-search]", message);
    if (!res.headersSent) res.status(500).json({ message: "Photo search failed" });
  });
}

export function registerPhotoSearchRoutes(app: Express, overrides: Partial<PhotoSearchDeps> = {}): void {
  const deps: PhotoSearchDeps = {
    requireUser: overrides.requireUser ?? defaultRequireUser,
    fetchImpl: overrides.fetchImpl ?? fetch,
    lookupIdentities: overrides.lookupIdentities ?? defaultLookup,
  };
  app.post("/api/photo-search/find", (req, res) => {
    settle(res, handlePhotoFind(req, res, deps));
  });
  app.post("/api/photo-search/flag", (req, res) => {
    settle(res, handlePhotoFlag(req, res, deps));
  });
  app.get("/api/photo-search/image", (req, res) => {
    settle(res, handlePhotoImage(req, res, deps));
  });
  app.post("/api/railcars/identities", (req, res) => {
    settle(res, handleRailcarIdentities(req, res, deps));
  });
}
