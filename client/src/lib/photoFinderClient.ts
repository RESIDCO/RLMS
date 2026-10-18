/**
 * Photo Search client.
 * Calls same-origin RLMS `/api/photo-search/*` only. The server proxies the portal.
 * Tiers come from the portal response. Missing `tier` stays "Unrated" — this file does not invent one.
 */

export const PHOTO_MAX_CARS = 500;
/** One car per request so a slow lookup cannot starve the rest of the list. */
export const PHOTO_BATCH_SIZE = 1;
/** Parallel requests. Kept low so the portal can stay polite to RRPA. */
export const PHOTO_CONCURRENCY = 3;
export const PHOTO_BATCH_TIMEOUT_MS = 45_000;

export const PHOTO_DISCLAIMER =
  "For internal professional research only. Respect photographer copyrights and site TOS.";

export const PHOTO_MANIFEST_COLUMNS = [
  "car",
  "tier",
  "confidence",
  "caption",
  "photo date",
  "location",
  "photographer",
  "source page",
  "UMLER type",
  "built year",
] as const;

export type PhotoTier = "verified" | "likely" | "unverified" | "conflict";
export type RatedTier = PhotoTier | "unrated";

export type TierToggles = {
  showLikely: boolean;
  showUnverified: boolean;
  showConflicts: boolean;
};

export const DEFAULT_TIER_TOGGLES: TierToggles = {
  showLikely: true,
  showUnverified: false,
  showConflicts: false,
};

export type PhotoImageMeta = {
  photo_date?: string | null;
  uploaded?: string | null;
  location?: string | null;
  photographer?: string | null;
  caption?: string | null;
  source_page?: string | null;
  album_url?: string | null;
  picture_id?: string | null;
};

export type PhotoImage = {
  title?: string;
  source?: string;
  image_url?: string;
  thumbnail_url?: string;
  storage_url?: string;
  proxy_url?: string;
  mark?: string;
  number?: string | number;
  tier?: string | null;
  confidence?: number | null;
  reasons?: string[];
  meta?: PhotoImageMeta | null;
  image_key?: string;
  picture_id?: string | null;
};

export type UmlerInfo = {
  found?: boolean;
  equipment_type_code?: string | null;
  type_family?: string | null;
  type_label?: string | null;
  built_year?: number | string | null;
  builder?: string | null;
  status_code?: string | null;
};

export type PhotoCarInput = {
  mark: string;
  number: string;
  number_raw?: string;
  m?: string;
  n?: string;
};

export type PhotoCarResult = PhotoCarInput & {
  display?: string;
  folder?: string;
  images?: PhotoImage[];
  image_count?: number;
  not_found?: boolean;
  image_error?: string;
  status?: string;
  counts?: {
    verified?: number;
    likely?: number;
    unverified?: number;
    conflict?: number;
    flagged_hidden?: number;
  };
  album?: Record<string, unknown> | null;
  umler?: UmlerInfo | null;
  links?: Record<string, unknown> | null;
  best_source?: {
    name?: string;
    url?: string;
    car_page?: string;
    roster_url?: string;
    suggestion?: string;
  } | null;
  error?: string;
  cache_hit?: boolean;
};

export type PhotoFindResponse = {
  job_id?: string;
  status?: string;
  mode?: string;
  source?: string;
  car_count?: number;
  image_count?: number;
  not_found_count?: number;
  cars?: PhotoCarResult[];
  error?: string;
  disclaimer?: string;
};

export type PhotoSearchPost = (
  body: Record<string, unknown>,
  init: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<PhotoFindResponse>;

export type ParsedPhotoList = {
  cars: PhotoCarInput[];
  skippedCodes: string[];
};

export type ResearchLink = { label: string; href: string };

export type NoPhotoRow = {
  car: PhotoCarResult;
  reason: string;
  links: ResearchLink[];
};

const STOP_MARKS = new Set([
  "HTTP", "HTTPS", "WWW", "COM", "NET", "ORG", "HTML", "JSON", "NULL", "TRUE", "FALSE",
]);

const INTERNAL_CODE_RE = /(^|[^A-Za-z0-9])((?:OL|FL|EA)\d+)(?=$|[^A-Za-z0-9])/gi;

export function formatEtaSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `~${h}h ${rm}m left`;
  }
  return s > 0 ? `~${m}m ${s}s left` : `~${m}m left`;
}

export function selectionCapNote(selectedCount: number, cap = PHOTO_MAX_CARS): string {
  if (!Number.isFinite(selectedCount) || selectedCount <= cap) return "";
  return `First ${cap.toLocaleString("en-US")} of ${Math.trunc(selectedCount).toLocaleString("en-US")} selected`;
}

export function chunkCars<T>(cars: T[] | null | undefined, size = PHOTO_BATCH_SIZE): T[][] {
  const list = cars || [];
  const n = Math.max(1, size | 0);
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function chunkCarsByMark(cars: PhotoCarInput[] | null | undefined, size = PHOTO_BATCH_SIZE): PhotoCarInput[][] {
  const list = cars || [];
  const n = Math.max(1, size | 0);
  const byMark = new Map<string, PhotoCarInput[]>();
  for (const car of list) {
    const mark = car?.mark || "_";
    const group = byMark.get(mark);
    if (group) group.push(car);
    else byMark.set(mark, [car]);
  }
  const out: PhotoCarInput[][] = [];
  byMark.forEach((group) => {
    for (let i = 0; i < group.length; i += n) out.push(group.slice(i, i + n));
  });
  return out.length ? out : chunkCars(list, n);
}

export function looseNum(n: unknown): string {
  const digits = String(n ?? "").replace(/\D/g, "");
  return digits.replace(/^0+/, "") || (digits ? "0" : "");
}

export function normalizeCarNumber(raw: unknown): string {
  const digits = String(raw ?? "").trim().replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

export function carKey(car: { mark?: string; number?: string | number | null }): string {
  return `${String(car.mark || "").toUpperCase()}_${looseNum(car.number)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Exact mark + number evidence in a string. */
export function hasExactCarIdentity(car: { mark: string; number: string }, haystack: unknown): boolean {
  const hay = String(haystack || "");
  const mark = car.mark;
  const num = String(car.number || "");
  const numL = looseNum(num);
  const variants = numL !== num ? [num, numL] : [num];
  for (const n of variants) {
    const markRe = escapeRegExp(mark);
    const numRe = escapeRegExp(n);
    const pats = [
      new RegExp(`\\b${markRe}\\s+${numRe}\\b`, "i"),
      new RegExp(`\\b${markRe}\\s*[-_]\\s*${numRe}\\b`, "i"),
      new RegExp(`\\b${markRe}${numRe}\\b`, "i"),
      new RegExp(`\\b${numRe}\\s+${markRe}\\b`, "i"),
      new RegExp(`pictures\\s+of\\s+${numRe}\\s+${markRe}\\b`, "i"),
      new RegExp(`rollingstock\\/(?:${markRe}|${markRe.toLowerCase()})-${numRe}\\/`, "i"),
    ];
    if (pats.some((re) => re.test(hay))) return true;
  }
  return false;
}

export function tierOf(img: { tier?: string | null } | null | undefined): RatedTier {
  const raw = String(img?.tier ?? "").trim().toLowerCase();
  switch (raw) {
    case "verified":
    case "likely":
    case "unverified":
    case "conflict":
      return raw;
    default:
      return "unrated";
  }
}

export function tierLabel(tier: RatedTier): string {
  switch (tier) {
    case "verified":
      return "Verified";
    case "likely":
      return "Likely";
    case "unverified":
      return "Unverified";
    case "conflict":
      return "Conflict";
    case "unrated":
      return "Unrated";
    default: {
      const neverTier: never = tier;
      return neverTier;
    }
  }
}

export function isImageVisible(
  img: { tier?: string | null } | null | undefined,
  toggles: TierToggles = DEFAULT_TIER_TOGGLES,
): boolean {
  const tier = tierOf(img);
  switch (tier) {
    case "verified":
    case "unrated":
      return true;
    case "likely":
      return toggles.showLikely;
    case "unverified":
      return toggles.showUnverified;
    case "conflict":
      return toggles.showConflicts;
    default: {
      const neverTier: never = tier;
      return neverTier;
    }
  }
}

/** Verified and Likely are zipped. Unrated stays in so a pre-tier response can still download. */
export function imagesForZip(images: PhotoImage[] | null | undefined): PhotoImage[] {
  return (images || []).filter((img) => {
    const tier = tierOf(img);
    return tier === "verified" || tier === "likely" || tier === "unrated";
  });
}

export function carHasFoundPhoto(car: { images?: PhotoImage[] | null; status?: string | null }): boolean {
  const status = String(car.status || "").toLowerCase();
  if (status === "verified" || status === "likely_only") return true;
  return (car.images || []).some((img) => {
    const tier = tierOf(img);
    return tier === "verified" || tier === "likely" || tier === "unrated";
  });
}

/** Drop images that don't evidence this exact car. Tiered rows are already classified for this car. */
export function filterImagesForCar(
  car: { mark: string; number: string },
  images: PhotoImage[] | null | undefined,
): PhotoImage[] {
  const wantMark = car.mark.toUpperCase();
  const wantNum = looseNum(car.number);
  return (images || []).filter((img) => {
    const taggedMark = img?.mark != null ? String(img.mark).toUpperCase().replace(/[^A-Z]/g, "") : "";
    const taggedNum = img?.number != null && String(img.number) !== "" ? looseNum(img.number) : "";
    if (taggedMark && taggedNum) return taggedMark === wantMark && taggedNum === wantNum;
    if (tierOf(img) !== "unrated") return true;
    if (img?.mark && String(img.mark).toUpperCase() !== wantMark) return false;
    if (img?.number != null && String(img.number) !== "" && looseNum(img.number) !== wantNum) return false;
    const hay = `${img?.title || ""} ${img?.source || ""} ${img?.image_url || ""}`;
    return hasExactCarIdentity(car, hay);
  });
}

export type CarStatusKey = "verified" | "likely" | "unverified" | "conflict" | "none" | "error" | "unrated";

export function carStatus(car: PhotoCarResult): { key: CarStatusKey; label: string } {
  const status = String(car.status ?? "").toLowerCase();
  switch (status) {
    case "verified":
      return { key: "verified", label: "Verified" };
    case "likely_only":
      return { key: "likely", label: "Likely" };
    case "unverified_only":
      return { key: "unverified", label: "Unverified only" };
    case "conflict":
      return { key: "conflict", label: "Conflict" };
    case "none":
      return { key: "none", label: "None" };
    case "error":
      return { key: "error", label: "Error" };
    default:
      break;
  }
  const images = car.images || [];
  const tiers = images.map((img) => tierOf(img));
  if (tiers.includes("verified")) return { key: "verified", label: "Verified" };
  if (tiers.includes("likely")) return { key: "likely", label: "Likely" };
  if (tiers.includes("unrated")) return { key: "unrated", label: "Unrated" };
  if (tiers.includes("unverified") && !tiers.includes("conflict")) return { key: "unverified", label: "Unverified only" };
  if (tiers.includes("conflict")) return { key: "conflict", label: "Conflict" };
  if (car.image_error || car.error) return { key: "error", label: "Error" };
  return { key: "none", label: "None" };
}

export function formatPhotoDate(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!match) return s;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return s;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatPhotoMeta(meta: PhotoImageMeta | null | undefined): string {
  if (!meta) return "";
  return [formatPhotoDate(meta.photo_date), meta.location, meta.photographer].filter(Boolean).join(" · ");
}

export function formatUmlerLine(umler: UmlerInfo | null | undefined): string | null {
  if (!umler) return null;
  if (umler.found === false) return "Not in UMLER snapshot";
  const label = String(umler.type_label || umler.type_family || "").trim();
  const code = String(umler.equipment_type_code || "").trim();
  let type = label;
  if (!type && code) type = code;
  else if (type && code && !type.includes(code)) type = `${type} (${code})`;
  const bits = [
    type ? `UMLER: ${type}` : "UMLER",
    umler.built_year != null && umler.built_year !== "" ? `built ${umler.built_year}` : "",
    umler.builder || "",
  ].filter(Boolean);
  return bits.join(" · ");
}

export function umlerIndicator(car: PhotoCarResult): "match" | "conflict" | null {
  if (!car.umler || car.umler.found === false) return null;
  if (String(car.status || "") === "conflict") return "conflict";
  const reasons = (car.images || []).flatMap((img) => img.reasons || []);
  if (reasons.some((reason) => /before the|disagree|mismatch/i.test(reason))) return "conflict";
  if (String(car.status || "") === "verified" || reasons.some((reason) => /type matches umler/i.test(reason))) {
    return "match";
  }
  return null;
}

function linkString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstLink(links: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!links) return "";
  for (const key of keys) {
    const direct = linkString(links[key]);
    if (direct) return direct;
  }
  return "";
}

export function researchLinks(car: { mark: string; number: string; links?: Record<string, unknown> | null }): ResearchLink[] {
  const mark = car.mark;
  const number = car.number;
  const links = car.links || undefined;
  const rrpa = firstLink(links, ["rrpa_range", "rrpa", "RRPA range", "RRPA mark roster"])
    || `https://www.rrpicturearchives.net/rsList.aspx?id=${encodeURIComponent(mark)}`;
  const google = firstLink(links, ["google", "Google", "RR Picture Archives (best)"])
    || `https://www.google.com/search?q=${encodeURIComponent(`site:rrpicturearchives.net "${mark} ${number}"`)}`;
  const railcarPhotos = firstLink(links, ["railcarphotos", "RailcarPhotos", "RailcarPhotos Search"])
    || "https://www.railcarphotos.com/Search.php";
  return [
    { label: "RRPA range", href: rrpa },
    { label: "Google", href: google },
    { label: "RailcarPhotos", href: railcarPhotos },
  ];
}

export function noPhotoReason(car: PhotoCarResult): string | null {
  if (carHasFoundPhoto(car)) return null;
  const err = String(car.image_error || car.error || "").trim();
  const status = String(car.status || "").toLowerCase();
  if (status === "error" || err) {
    if (!err || /timeout|timed out|abort/i.test(err) || err === "timeout") return "error: timeout";
    if (err === "portal_unavailable" || /unavailable/i.test(err)) return "error: unavailable";
    const cleaned = err.replace(/^error:\s*/i, "");
    return `error: ${cleaned}`;
  }
  const images = car.images || [];
  if (status === "unverified_only" || images.some((img) => tierOf(img) === "unverified")) return "unverified only";
  if (status === "conflict" || images.some((img) => tierOf(img) === "conflict")) return "conflict";
  return "none";
}

export function splitPhotoOutcomes(cars: PhotoCarResult[] | null | undefined): { misses: NoPhotoRow[]; errors: NoPhotoRow[] } {
  const misses: NoPhotoRow[] = [];
  const errors: NoPhotoRow[] = [];
  for (const car of cars || []) {
    const reason = noPhotoReason(car);
    if (!reason) continue;
    const row = { car, reason, links: researchLinks(car) };
    if (reason.startsWith("error:")) errors.push(row);
    else misses.push(row);
  }
  return { misses, errors };
}

export function countTiers(cars: PhotoCarResult[] | null | undefined): Record<RatedTier, number> {
  const counts: Record<RatedTier, number> = {
    verified: 0,
    likely: 0,
    unverified: 0,
    conflict: 0,
    unrated: 0,
  };
  for (const car of cars || []) {
    for (const img of car.images || []) {
      counts[tierOf(img)] += 1;
    }
  }
  return counts;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function umlerTypeLabel(umler: UmlerInfo | null | undefined): string {
  if (!umler || umler.found === false) return "";
  return String(umler.type_label || umler.equipment_type_code || umler.type_family || "").trim();
}

export function buildPhotoManifestCsv(cars: PhotoCarResult[] | null | undefined): string {
  const lines = [PHOTO_MANIFEST_COLUMNS.join(",")];
  for (const car of cars || []) {
    const typeLabel = umlerTypeLabel(car.umler);
    const built = !car.umler || car.umler.found === false || car.umler.built_year == null ? "" : String(car.umler.built_year);
    for (const img of imagesForZip(car.images || [])) {
      const meta = img.meta || {};
      const tier = tierOf(img);
      lines.push([
        `${car.mark} ${car.number}`,
        tier === "unrated" ? "unrated" : tier,
        img.confidence ?? "",
        meta.caption || img.title || "",
        formatPhotoDate(meta.photo_date),
        meta.location || "",
        meta.photographer || "",
        meta.source_page || "",
        typeLabel,
        built,
      ].map(csvCell).join(","));
    }
  }
  return lines.join("\n");
}

export function bestImageUrl(img: PhotoImage | null | undefined): string {
  if (!img) return "";
  return String(img.proxy_url || img.storage_url || img.image_url || img.thumbnail_url || "").trim();
}

export function bestThumbUrl(img: PhotoImage | null | undefined): string {
  if (!img) return "";
  return String(img.thumbnail_url || img.proxy_url || img.image_url || img.storage_url || "").trim();
}

export function imageIdentityKey(img: PhotoImage | null | undefined): string {
  if (!img) return "";
  return String(img.image_key || img.picture_id || img.meta?.picture_id || img.proxy_url || img.image_url || "").trim();
}

export function sourcePageUrl(img: PhotoImage | null | undefined, car?: PhotoCarResult | null): string {
  return String(img?.meta?.source_page || img?.meta?.album_url || car?.best_source?.car_page || "").trim();
}

export async function fetchImageBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

type JsZipCtor = new () => {
  file: (name: string, data: Blob | string) => void;
  generateAsync: (opts: { type: "blob" }) => Promise<Blob>;
};

function loadJSZip(): Promise<JsZipCtor> {
  const existing = (globalThis as { JSZip?: JsZipCtor }).JSZip;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("JSZip failed to load"));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    script.async = true;
    script.onload = () => {
      const loaded = (globalThis as { JSZip?: JsZipCtor }).JSZip;
      if (loaded) resolve(loaded);
      else reject(new Error("JSZip failed to load"));
    };
    script.onerror = () => reject(new Error("Could not load JSZip"));
    document.head.appendChild(script);
  });
}

export async function downloadImagesAsZip(
  items: Array<PhotoImage & { filename?: string }>,
  zipName: string,
  opts?: { manifestCsv?: string; fetchBlob?: (url: string) => Promise<Blob> },
): Promise<{ ok: number; errors: string[] }> {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const fetchBlob = opts?.fetchBlob ?? fetchImageBlob;
  let ok = 0;
  const errors: string[] = [];
  for (let i = 0; i < (items || []).length; i++) {
    const item = items[i];
    const url = bestImageUrl(item);
    if (!url) continue;
    const extMatch = String(url).match(/\.(jpe?g|png|gif|webp)(\?|$)/i);
    const ext = extMatch ? `.${extMatch[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
    const name = item.filename || `${String(i + 1).padStart(2, "0")}${ext}`;
    try {
      const blob = await fetchBlob(url);
      zip.file(name, blob);
      ok += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${message}`);
    }
  }
  if (opts?.manifestCsv) zip.file("manifest.csv", opts.manifestCsv);
  if (!ok && !opts?.manifestCsv) {
    throw new Error(errors[0] || "Could not download images (network or blocked photo URL).");
  }
  const out = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(out, zipName || "railcar_photos.zip");
  return { ok, errors };
}

export function collectPhotoZipItems(cars: PhotoCarResult[] | null | undefined): Array<PhotoImage & { filename: string }> {
  const items: Array<PhotoImage & { filename: string }> = [];
  for (const car of cars || []) {
    const images = imagesForZip(car.images || []);
    images.forEach((img, index) => {
      items.push({
        ...img,
        filename: `${car.mark}_${car.number}/${String(index + 1).padStart(2, "0")}.jpg`,
      });
    });
  }
  return items;
}

/** Extract { mark, number } — strips leading zeros for search. */
export function extractCarIdentity(row: unknown): PhotoCarInput | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  let mark = String(
    record.reporting_marks ?? record.reporting_mark ?? record.mark ?? record.car_initial ?? record.m ?? "",
  )
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  let rawNumber = String(record.car_number ?? record.number ?? record.n ?? "").trim();
  if (mark && rawNumber.toUpperCase().startsWith(mark)) rawNumber = rawNumber.slice(mark.length);
  if (!mark) {
    const concat = String(record.car_number ?? "").match(/^([A-Za-z]{2,4})(\d+)/);
    if (concat) {
      mark = concat[1].toUpperCase();
      rawNumber = concat[2];
    }
  }
  const digits = String(rawNumber).replace(/[^\d]/g, "");
  const number = normalizeCarNumber(digits);
  if (mark.length < 2 || mark.length > 4 || !number) return null;
  if (STOP_MARKS.has(mark)) return null;
  const out: PhotoCarInput = { mark, number };
  if (digits && digits !== number) out.number_raw = digits;
  return out;
}

export function extractCarsFromRows(rows: unknown[] | null | undefined, { max = PHOTO_MAX_CARS } = {}): PhotoCarInput[] {
  const out: PhotoCarInput[] = [];
  const seen = new Set<string>();
  for (const row of rows || []) {
    const car = extractCarIdentity(row);
    if (!car) continue;
    const key = `${car.mark}_${car.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(car);
    if (out.length >= max) break;
  }
  return out;
}

function stripInternalCodes(line: string, skipped: string[]): string {
  return line.replace(INTERNAL_CODE_RE, (_full, boundary: string, code: string) => {
    skipped.push(String(code).toUpperCase());
    return boundary || " ";
  });
}

/**
 * Paste-first parser for seller spreadsheets.
 * Compact OL / FL / EA tokens (OL123, FL9, EA1001) are internal codes, not cars.
 */
export function parsePhotoCarList(text: string, max = PHOTO_MAX_CARS): ParsedPhotoList {
  const cars: PhotoCarInput[] = [];
  const seen = new Set<string>();
  const skippedCodes: string[] = [];

  const push = (markRaw: string, numRaw: string) => {
    if (cars.length >= max) return;
    const mark = String(markRaw || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
    const rawNumber = String(numRaw || "").replace(/[^\d]/g, "");
    const number = normalizeCarNumber(rawNumber);
    if (mark.length < 2 || mark.length > 4 || !number) return;
    if (STOP_MARKS.has(mark)) return;
    if (/^(?:OL|FL|EA)\d+$/i.test(`${mark}${rawNumber}`)) {
      skippedCodes.push(`${mark}${rawNumber}`.toUpperCase());
      return;
    }
    const key = `${mark}_${number}`;
    if (seen.has(key)) return;
    seen.add(key);
    const row: PhotoCarInput = { mark, number, m: mark, n: number };
    if (rawNumber && rawNumber !== number) row.number_raw = rawNumber;
    cars.push(row);
  };

  const parseLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    if (/^reporting[_\s-]?marks?/i.test(trimmed) && /car[_\s-]?numbers?/i.test(trimmed)) return;
    if (/^marks?\b/i.test(trimmed) && /\bnumbers?\b/i.test(trimmed) && !/\d/.test(trimmed.replace(/^(?:OL|FL|EA)\d+/i, ""))) return;

    const start = trimmed.match(/^([A-Za-z]{2,4})[\s,.\-_]+(\d{1,10})(?!\d)/);
    if (start) {
      push(start[1], start[2]);
      return;
    }
    const concat = trimmed.match(/^([A-Za-z]{2,4})(\d{3,10})(?!\d)/);
    if (concat) {
      push(concat[1], concat[2]);
      return;
    }

    const carRe = /(?:^|[^A-Za-z0-9])([A-Za-z]{2,4})[\s,.\-_]+(\d{1,10})(?!\d)/g;
    let match: RegExpExecArray | null;
    while ((match = carRe.exec(trimmed))) push(match[1], match[2]);
    const concatRe = /(?:^|[^A-Za-z0-9])([A-Za-z]{2,4})(\d{3,10})(?!\d)/g;
    while ((match = concatRe.exec(trimmed))) push(match[1], match[2]);
  };

  for (const line of String(text || "").split(/\r?\n/)) {
    parseLine(stripInternalCodes(line, skippedCodes));
  }

  return { cars: cars.slice(0, max), skippedCodes };
}

function buildSearchLinks(car: PhotoCarInput): Record<string, string> {
  const links = researchLinks(car);
  return {
    "RR Picture Archives (best)": links[1]?.href || "",
    "RRPA mark roster": links[0]?.href || "",
    "RailcarPhotos Search": links[2]?.href || "",
  };
}

function linksOnlyCar(car: PhotoCarInput, imageError?: string): PhotoCarResult {
  const links = buildSearchLinks(car);
  return {
    mark: car.mark,
    number: car.number,
    display: `${car.mark} ${car.number}`,
    folder: `${car.mark}_${car.number}`,
    links,
    images: [],
    image_count: 0,
    not_found: true,
    status: imageError ? "error" : "none",
    image_error: imageError,
    error: imageError,
    best_source: {
      name: "RR Picture Archives",
      url: links["RR Picture Archives (best)"],
      suggestion: `Search RRPA for "${car.mark} ${car.number}" (exact).`,
    },
  };
}

function isUserAbort(err: unknown, signal?: AbortSignal): boolean {
  if (!signal?.aborted) return false;
  return err instanceof DOMException
    ? err.name === "AbortError"
    : (err as { name?: string } | null)?.name === "AbortError";
}

function timeoutMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name || "";
  const message = err instanceof Error ? err.message : String(err || "");
  if (name === "AbortError" || /timed out|timeout/i.test(message)) return "timeout";
  return message || "unavailable";
}

export async function findPhotos(
  cars: PhotoCarInput[],
  opts?: {
    post?: PhotoSearchPost;
    fetchImages?: boolean;
    maxPerCar?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<PhotoFindResponse> {
  const { post, fetchImages = true, maxPerCar = 6, signal, timeoutMs = PHOTO_BATCH_TIMEOUT_MS } = opts || {};
  if (!cars?.length) throw new Error("No cars selected.");
  const batchCars = cars.slice(0, PHOTO_BATCH_SIZE);
  if (!post) {
    return {
      status: "error",
      error: "portal_unavailable",
      cars: batchCars.map((car) => linksOnlyCar(car, "portal_unavailable")),
      car_count: batchCars.length,
      image_count: 0,
      disclaimer: PHOTO_DISCLAIMER,
    };
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const payload = await post(
      {
        cars: batchCars.map((car) => ({ mark: car.mark, number: car.number })),
        fetch_images: fetchImages,
        max_per_car: maxPerCar,
      },
      { signal: controller.signal, timeoutMs },
    );
    if (payload && Array.isArray(payload.cars)) return payload;
    return {
      status: "error",
      error: "portal_unavailable",
      cars: batchCars.map((car) => linksOnlyCar(car, "portal_unavailable")),
      car_count: batchCars.length,
      image_count: 0,
      disclaimer: PHOTO_DISCLAIMER,
    };
  } catch (err) {
    if (isUserAbort(err, signal)) throw err;
    const reason = timeoutMessage(err);
    return {
      status: "error",
      error: reason,
      cars: batchCars.map((car) => linksOnlyCar(car, reason)),
      car_count: batchCars.length,
      image_count: 0,
      disclaimer: PHOTO_DISCLAIMER,
    };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function mergePhotoResults(parts: Array<PhotoFindResponse | null | undefined>, allCars: PhotoCarInput[]): PhotoFindResponse {
  const cars: PhotoCarResult[] = [];
  const seen = new Set<string>();
  let imageCount = 0;

  for (const part of parts) {
    if (!part) continue;
    for (const car of part.cars || []) {
      const key = `${car.mark}_${looseNum(car.number)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const images = filterImagesForCar(
        { mark: String(car.mark || "").toUpperCase(), number: looseNum(car.number) },
        car.images || [],
      );
      const next: PhotoCarResult = {
        ...car,
        mark: String(car.mark || "").toUpperCase(),
        number: looseNum(car.number),
        images,
        image_count: images.length,
        not_found: !carHasFoundPhoto({ ...car, images }),
      };
      if (!next.links) next.links = buildSearchLinks(next);
      cars.push(next);
      imageCount += imagesForZip(images).length;
    }
  }

  for (const car of allCars || []) {
    const key = `${car.mark}_${car.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cars.push(linksOnlyCar(car, "timeout"));
  }

  const order = new Map(allCars.map((car, index) => [`${car.mark}_${car.number}`, index]));
  cars.sort((a, b) => (order.get(`${a.mark}_${a.number}`) ?? 1e9) - (order.get(`${b.mark}_${b.number}`) ?? 1e9));

  const found = cars.filter((car) => carHasFoundPhoto(car)).length;
  return {
    job_id: parts.find((part) => part?.job_id)?.job_id || `batch_${Date.now()}`,
    status: "completed",
    mode: imageCount ? "images_and_links" : "links_only",
    car_count: allCars.length || cars.length,
    image_count: imageCount,
    not_found_count: cars.length - found,
    cars,
    disclaimer: PHOTO_DISCLAIMER,
  };
}

export type PhotoProgress = {
  batch: number;
  batchTotal: number;
  batchesDone: number;
  carsDone: number;
  carTotal: number;
  etaSeconds?: number | null;
  partial?: PhotoFindResponse;
  carsWithImages?: number;
  imageCount?: number;
  message: string;
};

export async function findPhotosBatched(
  cars: PhotoCarInput[],
  opts?: {
    post?: PhotoSearchPost;
    fetchImages?: boolean;
    maxPerCar?: number;
    batchSize?: number;
    concurrency?: number;
    maxCars?: number;
    signal?: AbortSignal;
    onProgress?: (info: PhotoProgress) => void;
  },
): Promise<PhotoFindResponse> {
  const {
    post,
    fetchImages = true,
    maxPerCar = 6,
    batchSize = PHOTO_BATCH_SIZE,
    concurrency = PHOTO_CONCURRENCY,
    maxCars = PHOTO_MAX_CARS,
    signal,
    onProgress,
  } = opts || {};
  if (!cars?.length) throw new Error("No cars selected.");

  const list = cars.slice(0, Math.max(1, maxCars | 0));
  const batches = chunkCarsByMark(list, batchSize);
  const parts: Array<PhotoFindResponse | null> = new Array(batches.length);
  const pool = Math.max(1, Math.min(concurrency | 0, batches.length));
  const startedAt = Date.now();
  let nextIdx = 0;
  let batchesDone = 0;
  let carsDone = 0;

  const emit = (extra: Partial<PhotoProgress> = {}) => {
    const elapsed = Math.max(1, Date.now() - startedAt);
    const rate = carsDone / elapsed;
    const remaining = list.length - carsDone;
    const etaSeconds = carsDone > 0 && remaining > 0
      ? Math.round(remaining / rate / 1000)
      : carsDone >= list.length
        ? 0
        : null;
    const etaLabel = formatEtaSeconds(etaSeconds);
    const hitCars = extra.carsWithImages;
    const hitPart = typeof hitCars === "number" ? ` · ${hitCars} with photos` : "";
    onProgress?.({
      batch: Math.min(batchesDone + 1, batches.length),
      batchTotal: batches.length,
      batchesDone,
      carsDone,
      carTotal: list.length,
      etaSeconds,
      message: carsDone >= list.length
        ? `Finished ${list.length} car${list.length === 1 ? "" : "s"}${hitPart}`
        : `Processing ${carsDone}/${list.length} cars…${etaLabel ? ` · ${etaLabel}` : ""}${hitPart}`,
      ...extra,
    });
  };

  emit();

  async function runBatch(index: number) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const batch = batches[index];
    let part: PhotoFindResponse;
    try {
      part = await findPhotos(batch, {
        post,
        fetchImages,
        maxPerCar: list.length > 40 ? Math.min(maxPerCar, 4) : maxPerCar,
        signal,
        timeoutMs: PHOTO_BATCH_TIMEOUT_MS,
      });
    } catch (err) {
      if (isUserAbort(err, signal)) throw err;
      const reason = timeoutMessage(err);
      part = {
        status: "error",
        error: reason,
        cars: batch.map((car) => linksOnlyCar(car, reason)),
      };
    }
    if (!part?.cars?.length) {
      part = { status: "error", error: "timeout", cars: batch.map((car) => linksOnlyCar(car, "timeout")) };
    }
    parts[index] = part;
    batchesDone += 1;
    carsDone += batch.length;
    const partial = mergePhotoResults(parts.filter(Boolean), list);
    const hitCars = (partial.cars || []).filter((car) => carHasFoundPhoto(car)).length;
    emit({
      partial,
      carsWithImages: hitCars,
      imageCount: partial.image_count,
    });
  }

  async function worker() {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const index = nextIdx;
      nextIdx += 1;
      if (index >= batches.length) return;
      await runBatch(index);
    }
  }

  await Promise.all(Array.from({ length: pool }, () => worker()));
  return mergePhotoResults(parts.filter(Boolean), list);
}
