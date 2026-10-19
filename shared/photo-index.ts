/**
 * Photo-index mapping for the RLMS screen.
 * Pure functions: no network, no storage, no image copies.
 * A failed lookup is `{ fallback: true }` so the screen can run the legacy search.
 */

export const PHOTO_INDEX_CHUNK = 500;
export const PHOTO_INDEX_TIMEOUT_MS = 8_000;
export const PHOTO_SEARCH_MODE_KEY = "rlms.photoSearchMode";

export const INDEX_CSV_COLUMNS = [
  "mark",
  "number",
  "picture_url",
  "image_url",
  "photographer",
  "photo_date",
] as const;

export type IndexCarKey = { mark: string; number: string };

export type IndexPhoto = {
  picture_id: string | null;
  thumb_url: string;
  image_url: string;
  picture_url: string;
  caption: string;
  photographer: string;
  photo_date: string;
  location: string;
  verified: boolean;
};

export type IndexAlbum = {
  album_url: string;
  title: string;
  photo_count: number | null;
};

export type IndexCarState = "photos" | "album_pending" | "no_photos" | "no_album" | "not_indexed" | "fallback";

export type IndexCar = IndexCarKey & {
  state: IndexCarState;
  albums: IndexAlbum[];
  photos: IndexPhoto[];
  indexed_at: string | null;
  needsDeepSearch: boolean;
};

export type IndexLookupSuccess = { fallback: false; cars: IndexCar[] };
export type IndexLookupFallback = { fallback: true };
export type IndexLookupView = IndexLookupSuccess | IndexLookupFallback;

export type IndexSearchPlan =
  | { kind: "index"; view: IndexLookupSuccess }
  | { kind: "legacy" };

const INDEX_STATES: readonly IndexCarState[] = [
  "photos",
  "album_pending",
  "no_photos",
  "no_album",
  "not_indexed",
  "fallback",
];

export function looseIndexNumber(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.replace(/^0+/, "") || (digits ? "0" : "");
}

export function indexCarKey(car: { mark?: unknown; number?: unknown }): string {
  return `${String(car.mark ?? "").toUpperCase().replace(/[^A-Z]/g, "")}_${looseIndexNumber(car.number)}`;
}

/** Legacy unless the build explicitly sets VITE_PHOTO_SEARCH=index. */
export function isLegacyPhotoSearchBuild(envValue: unknown): boolean {
  return String(envValue ?? "").trim().toLowerCase() !== "index";
}

/** localStorage `rlms.photoSearchMode` — "legacy" is the Classic photo search toggle. */
export function isClassicPhotoSearchStored(stored: unknown): boolean {
  const value = String(stored ?? "").trim().toLowerCase();
  return value === "legacy" || value === "classic";
}

export function effectivePhotoSearchMode(envValue: unknown, stored: unknown): "index" | "legacy" {
  if (isLegacyPhotoSearchBuild(envValue)) return "legacy";
  if (isClassicPhotoSearchStored(stored)) return "legacy";
  return "index";
}

export function isRrpaHttpsUrl(raw: unknown): boolean {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return url.hostname === "www.rrpicturearchives.net" || url.hostname === "rrpicturearchives.net";
}

export function photoCredit(photographer: unknown): string {
  const name = String(photographer ?? "").trim() || "RRPA contributor";
  return `Photo: ${name} · RRPA`;
}

export function pictureIdOf(photo: { picture_id?: unknown; picture_url?: unknown } | null | undefined): string | null {
  const direct = String(photo?.picture_id ?? "").trim();
  if (/^\d+$/.test(direct)) return direct;
  const url = String(photo?.picture_url ?? "");
  const query = /[?&]id=(\d+)/i.exec(url);
  if (query) return query[1];
  const path = /\/(?:pictures|showPicture\.aspx)\/(\d+)/i.exec(url);
  if (path) return path[1];
  return null;
}

export function indexPhotoKey(photo: { picture_id?: string | null; thumb_url?: string; picture_url?: string }): string {
  return pictureIdOf(photo) || String(photo.thumb_url || photo.picture_url || "");
}

export function chunkIndexCars<T>(cars: readonly T[] | null | undefined, size = PHOTO_INDEX_CHUNK): T[][] {
  const list = cars ? [...cars] : [];
  const n = Math.max(1, size | 0);
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function normalizeIndexCars(raw: unknown, cap = PHOTO_INDEX_CHUNK * 20): IndexCarKey[] {
  const list = Array.isArray(raw) ? raw : [];
  const cars: IndexCarKey[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { mark?: unknown; reporting_marks?: unknown; number?: unknown; car_number?: unknown };
    const mark = String(row.mark ?? row.reporting_marks ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
    const number = looseIndexNumber(row.number ?? row.car_number);
    if (mark.length < 2 || mark.length > 4 || !number) continue;
    const key = `${mark}_${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cars.push({ mark, number });
    if (cars.length >= cap) break;
  }
  return cars;
}

/**
 * Active fleet for the warm button: Car Status is exactly Active/In-Service.
 * Off-Lease, Inactive, and inactive membership never qualify.
 */
export function isActiveFleetCar(row: { status?: unknown; active?: unknown } | null | undefined): boolean {
  if (!row) return false;
  if (row.active === false || row.active === "false" || row.active === 0 || row.active === "0") return false;
  const status = String(row.status ?? "").trim();
  if (status === "Off-Lease" || status === "Inactive") return false;
  return status === "Active/In-Service";
}

export function planWarmRequests(rows: unknown[] | null | undefined, chunkSize = PHOTO_INDEX_CHUNK): {
  send: IndexCarKey[];
  dropped: number;
  chunks: IndexCarKey[][];
} {
  const send: IndexCarKey[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const row of rows || []) {
    if (!row || typeof row !== "object") {
      dropped += 1;
      continue;
    }
    const record = row as {
      reporting_marks?: unknown;
      mark?: unknown;
      car_number?: unknown;
      number?: unknown;
      status?: unknown;
      active?: unknown;
    };
    const mark = String(record.reporting_marks ?? record.mark ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
    const number = looseIndexNumber(record.car_number ?? record.number);
    if (mark.length < 2 || mark.length > 4 || !number || !isActiveFleetCar(record)) {
      dropped += 1;
      continue;
    }
    const key = `${mark}_${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    send.push({ mark, number });
  }
  return { send, dropped, chunks: chunkIndexCars(send, chunkSize) };
}

function isIndexState(value: string): value is IndexCarState {
  return (INDEX_STATES as readonly string[]).includes(value);
}

export function needsDeepSearch(state: IndexCarState): boolean {
  switch (state) {
    case "photos":
      return false;
    case "album_pending":
    case "no_photos":
    case "no_album":
    case "not_indexed":
    case "fallback":
      return true;
    default: {
      const neverState: never = state;
      return neverState;
    }
  }
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function mapAlbum(raw: unknown): IndexAlbum | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { album_url?: unknown; url?: unknown; title?: unknown; photo_count?: unknown };
  const albumUrl = text(row.album_url ?? row.url);
  if (!isRrpaHttpsUrl(albumUrl)) return null;
  const count = Number(row.photo_count);
  return {
    album_url: albumUrl,
    title: text(row.title),
    photo_count: Number.isFinite(count) ? count : null,
  };
}

function mapPhoto(raw: unknown): IndexPhoto | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const thumb = text(row.thumb_url ?? row.thumbnail_url);
  const image = text(row.image_url);
  const picture = text(row.picture_url);
  if (!isRrpaHttpsUrl(thumb)) return null;
  const photo: IndexPhoto = {
    picture_id: pictureIdOf({ picture_id: row.picture_id, picture_url: picture }),
    thumb_url: thumb,
    image_url: isRrpaHttpsUrl(image) ? image : "",
    picture_url: isRrpaHttpsUrl(picture) ? picture : "",
    caption: text(row.caption),
    photographer: text(row.photographer),
    photo_date: text(row.photo_date),
    location: text(row.location),
    verified: row.verified === true,
  };
  return photo;
}

function resolveState(raw: unknown, photos: IndexPhoto[], albums: IndexAlbum[]): IndexCarState {
  const stated = text(raw).toLowerCase();
  if (isIndexState(stated)) {
    if (stated === "photos" && photos.length === 0) {
      return albums.length ? "album_pending" : "no_album";
    }
    return stated;
  }
  if (photos.length) return "photos";
  if (albums.length) return "album_pending";
  return "not_indexed";
}

function mapOneCar(raw: unknown): IndexCar | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const mark = text(row.mark ?? row.reporting_marks).toUpperCase().replace(/[^A-Z]/g, "");
  const number = looseIndexNumber(row.number ?? row.car_number);
  if (mark.length < 2 || mark.length > 4 || !number) return null;
  const photos = (Array.isArray(row.photos) ? row.photos : []).map(mapPhoto).filter((photo): photo is IndexPhoto => Boolean(photo));
  const albums = (Array.isArray(row.albums) ? row.albums : []).map(mapAlbum).filter((album): album is IndexAlbum => Boolean(album));
  const state = resolveState(row.state, photos, albums);
  return {
    mark,
    number,
    state,
    albums,
    photos: state === "photos" ? photos : photos,
    indexed_at: text(row.indexed_at) || null,
    needsDeepSearch: needsDeepSearch(state),
  };
}

function rawCarList(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (row.fallback === true) return null;
  if (Array.isArray(row.cars)) return row.cars;
  if (Array.isArray(row.results)) return row.results;
  return null;
}

/**
 * Map a portal lookup body onto the cars the screen asked for.
 * `{ fallback: true }`, a non-object, or a body with no car list means the legacy search.
 * A car missing from a successful list is `not_indexed` (Deep search for that car).
 */
export function mapIndexLookup(payload: unknown, requested: readonly IndexCarKey[] | null | undefined): IndexLookupView {
  if (payload && typeof payload === "object" && (payload as { fallback?: unknown }).fallback === true) {
    return { fallback: true };
  }
  const list = rawCarList(payload);
  if (!list) return { fallback: true };
  const byKey = new Map<string, IndexCar>();
  for (const item of list) {
    const car = mapOneCar(item);
    if (!car) continue;
    const key = indexCarKey(car);
    if (!byKey.has(key)) byKey.set(key, car);
  }
  const wanted = normalizeIndexCars(requested);
  const cars = wanted.map((car) => {
    const found = byKey.get(indexCarKey(car));
    if (found) return found;
    return {
      mark: car.mark,
      number: car.number,
      state: "not_indexed" as const,
      albums: [],
      photos: [],
      indexed_at: null,
      needsDeepSearch: true,
    };
  });
  return { fallback: false, cars };
}

export function planIndexSearch(payload: unknown, requested: readonly IndexCarKey[]): IndexSearchPlan {
  const view = mapIndexLookup(payload, requested);
  if (view.fallback) return { kind: "legacy" };
  return { kind: "index", view };
}

/** Lookup throws, times out, or returns fallback → legacy deep search. */
export async function resolveIndexSearch(
  cars: readonly IndexCarKey[],
  lookup: (cars: IndexCarKey[]) => Promise<unknown>,
): Promise<IndexSearchPlan> {
  try {
    const payload = await lookup([...cars]);
    return planIndexSearch(payload, [...cars]);
  } catch {
    return { kind: "legacy" };
  }
}

function csvCell(value: unknown): string {
  const cell = value == null ? "" : String(value);
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export function buildIndexLinksCsv(cars: readonly IndexCar[] | null | undefined): string {
  const lines = [INDEX_CSV_COLUMNS.join(",")];
  for (const car of cars || []) {
    for (const photo of car.photos || []) {
      lines.push([
        car.mark,
        car.number,
        photo.picture_url,
        photo.image_url,
        photo.photographer,
        photo.photo_date,
      ].map(csvCell).join(","));
    }
  }
  return lines.join("\n");
}

export function carsNeedingDeepSearch(cars: readonly IndexCar[] | null | undefined): IndexCar[] {
  return (cars || []).filter((car) => car.needsDeepSearch);
}
