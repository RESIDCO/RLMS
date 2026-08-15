// @ts-nocheck
/**
 * UMLER Photo Finder client — reused in RLMS.
 * Calls the live UMLER Vercel photo API (not same-origin; RLMS has no /api/find-photos).
 */

/** Live UMLER portal photo service (CORS *). */
export const PHOTO_API_ORIGIN = "https://railcarumlerportal.vercel.app";

export const FIND_PHOTOS_URL =
  "https://jtxyvjxmhuanvivmhimv.supabase.co/functions/v1/find-photos";

export const PHOTO_BUILD = "20260815-search-busy-v1";

export function getVercelFindPhotosUrl() {
  return `${PHOTO_API_ORIGIN}/api/find-photos`;
}

/** Max cars accepted from UI / detail views in one job (configurable override via opts). */
export const PHOTO_MAX_CARS = 500;
/**
 * Cars per API request. One car per invocation so album harvest + Bing
 * finish reliably under the 60s serverless limit (multi-car was starving later cars).
 */
export const PHOTO_BATCH_SIZE = 1;
/**
 * Parallel API requests (one car each). 20 keeps RRPA polite while cutting
 * wall-clock time ~10× vs the old concurrency of 2.
 */
export const PHOTO_CONCURRENCY = 20;
/** Lists this large auto-run in background (bell tracks progress). */
export const PHOTO_AUTO_BACKGROUND_MIN = 30;
/** Per-batch fetch timeout (ms). Faster fail → next car sooner. */
export const PHOTO_BATCH_TIMEOUT_MS = 45_000;

/** Format remaining seconds for progress UI. */
export function formatEtaSeconds(seconds) {
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

const SESSION_KEY = "ri_photo_session_id";
const LOCAL_CACHE_KEY = "ri_photo_car_cache_v1";
const LOCAL_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function localCacheKey(mark, number) {
  const num = String(number || "").replace(/^0+/, "") || "0";
  return `${String(mark || "").toUpperCase()}_${num}`;
}

function readLocalPhotoCache(mark, number) {
  if (typeof localStorage === "undefined") return null;
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_CACHE_KEY) || "{}");
    const row = all[localCacheKey(mark, number)];
    if (!row?.images?.length) return null;
    if (row.at && Date.now() - row.at > LOCAL_CACHE_TTL_MS) return null;
    return row;
  } catch {
    return null;
  }
}

function writeLocalPhotoCache(mark, number, { images, carPage } = {}) {
  if (typeof localStorage === "undefined" || !images?.length) return;
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_CACHE_KEY) || "{}");
    all[localCacheKey(mark, number)] = {
      images,
      carPage: carPage || null,
      at: Date.now(),
    };
    // Cap entries to avoid unbounded growth
    const keys = Object.keys(all);
    if (keys.length > 800) {
      keys
        .sort((a, b) => (all[a].at || 0) - (all[b].at || 0))
        .slice(0, keys.length - 600)
        .forEach((k) => delete all[k]);
    }
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(all));
  } catch {
    /* quota / private mode */
  }
}

export const PHOTO_DISCLAIMER =
  "For internal professional research only. Respect photographer copyrights and site TOS.";

export function chunkCars(cars, size = PHOTO_BATCH_SIZE) {
  const list = cars || [];
  const n = Math.max(1, size | 0);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * Prefer same-mark cars in a batch so server mark-cache (rsRange) hits more often.
 */
export function chunkCarsByMark(cars, size = PHOTO_BATCH_SIZE) {
  const list = cars || [];
  const n = Math.max(1, size | 0);
  const byMark = new Map();
  for (const car of list) {
    const mark = car?.mark || "_";
    if (!byMark.has(mark)) byMark.set(mark, []);
    byMark.get(mark).push(car);
  }
  const out = [];
  for (const group of byMark.values()) {
    for (let i = 0; i < group.length; i += n) out.push(group.slice(i, i + n));
  }
  return out.length ? out : chunkCars(list, n);
}

/** Cars that have at least one image matching this car's mark+number. */
export function filterCarsWithImages(cars) {
  return (cars || [])
    .map((c) => {
      const images = filterImagesForCar(c, c.images || []);
      return { ...c, images };
    })
    .filter((c) => (c.images || []).length > 0);
}

function looseNum(n) {
  return String(n || "").replace(/^0+/, "") || "0";
}

/** Exact mark + number evidence in a string. */
export function hasExactCarIdentity(car, haystack) {
  const hay = String(haystack || "");
  const mark = car.mark;
  const variants = (() => {
    const num = String(car.number || "");
    const numL = looseNum(num);
    return numL !== num ? [num, numL] : [num];
  })();
  for (const n of variants) {
    const pats = [
      new RegExp(`\\b${mark}\\s+${n}\\b`, "i"),
      new RegExp(`\\b${mark}\\s*[-_]\\s*${n}\\b`, "i"),
      new RegExp(`\\b${mark}${n}\\b`, "i"),
      new RegExp(`\\b${n}\\s+${mark}\\b`, "i"),
      new RegExp(`pictures\\s+of\\s+${n}\\s+${mark}\\b`, "i"),
      new RegExp(`rollingstock\\/(?:${mark}|${mark.toLowerCase()})-${n}\\/`, "i"),
    ];
    if (pats.some((re) => re.test(hay))) return true;
  }
  return false;
}

/** Drop images that don't evidence this exact car (client-side safety net). */
export function filterImagesForCar(car, images) {
  return (images || []).filter((img) => {
    // Trust server-tagged exact identity (RRPA JPG paths rarely include mark+number)
    const taggedMark = img?.mark != null ? String(img.mark).toUpperCase().replace(/[^A-Z]/g, "") : "";
    const taggedNum = img?.number != null ? looseNum(img.number) : "";
    if (taggedMark && taggedNum) {
      return taggedMark === car.mark && taggedNum === looseNum(car.number);
    }
    if (img?.mark && String(img.mark).toUpperCase() !== car.mark) return false;
    if (img?.number != null && String(img.number) !== "" && looseNum(img.number) !== looseNum(car.number)) {
      return false;
    }
    const hay = `${img?.title || ""} ${img?.source || ""} ${img?.image_url || ""}`;
    return hasExactCarIdentity(car, hay);
  });
}

/** Rewrite RRPA www /pictures → S3 so proxy/thumbnails work from the portal. */
export function toDeliverableRrpaUrl(url) {
  const raw = String(url || "").trim().replace("/thumbnails/", "/");
  if (!raw) return "";
  const m = raw.match(
    /(?:rrpicturearchives\.net\/pictures|s3\.amazonaws\.com\/rrpa_photos|rrpa_photos)\/(\d+)\/([^?#]+)/i,
  );
  if (!m) return raw.replace(/^http:\/\//i, "https://");
  let file = m[2];
  for (let i = 0; i < 4; i++) {
    try {
      const decoded = decodeURIComponent(file);
      if (decoded === file) break;
      file = decoded;
    } catch {
      break;
    }
  }
  return `https://s3.amazonaws.com/rrpa_photos/${m[1]}/${encodeURIComponent(file)}`;
}

export function proxiedImageUrl(url) {
  const deliverable = toDeliverableRrpaUrl(url);
  if (!deliverable) return "";
  if (deliverable.includes("/api/proxy-image")) {
    if (deliverable.startsWith("http")) return deliverable;
    return `${PHOTO_API_ORIGIN}${deliverable.startsWith("/") ? deliverable : `/${deliverable}`}`;
  }
  if (/rrpa_photos|rrpicturearchives|s3\.amazonaws\.com\/rrpa/i.test(deliverable)) {
    return `${PHOTO_API_ORIGIN}/api/proxy-image?url=${encodeURIComponent(deliverable)}`;
  }
  return deliverable;
}

export function getPhotoSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`)
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 64);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "portal";
  }
}

/**
 * Strip UMLER-style leading zeros from a car number.
 * "00360129" → "360129", "000773" → "773", "0" → "0"
 */
export function normalizeCarNumber(raw) {
  const digits = String(raw ?? "").trim().replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

/** Extract { mark, number } — strips UMLER leading zeros for search. */
export function extractCarIdentity(row) {
  if (!row || typeof row !== "object") return null;
  let mark = String(
    row.reporting_marks ??
      row.reporting_mark ??
      row.mark ??
      row.car_initial ??
      row.m ??
      row.Reporting_Mark ??
      "",
  )
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  let rawNumber = String(
    row.car_number ?? row.number ?? row.n ?? row.Car_Number ?? "",
  ).trim();
  if (mark && rawNumber.toUpperCase().startsWith(mark)) {
    rawNumber = rawNumber.slice(mark.length);
  }
  if (!mark) {
    const concat = String(row.car_number ?? "").match(/^([A-Za-z]{2,4})(\d+)/);
    if (concat) {
      mark = concat[1].toUpperCase();
      rawNumber = concat[2];
    }
  }
  const digits = String(rawNumber).replace(/[^\d]/g, "");
  const number = normalizeCarNumber(digits);
  if (mark.length < 2 || mark.length > 4 || !number) return null;
  const out = { mark, number };
  if (digits && digits !== number) out.number_raw = digits;
  return out;
}

export function extractCarsFromRows(rows, { max = PHOTO_MAX_CARS } = {}) {
  const out = [];
  const seen = new Set();
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

function buildSearchLinks(car) {
  const phrase = `"${car.mark} ${car.number}"`;
  const enc = encodeURIComponent;
  const siteQ = `site:rrpicturearchives.net ${phrase}`;
  return {
    "RR Picture Archives (best)": `https://www.google.com/search?q=${enc(siteQ)}`,
    "RRPA mark roster": `https://www.rrpicturearchives.net/rsList.aspx?id=${enc(car.mark)}`,
    "RRPA keyword search": "https://www.rrpicturearchives.net/search.aspx",
    "RailcarPhotos.com": "https://www.railcarphotos.com/CountReportingMarks.php",
    "RailcarPhotos Search": "https://www.railcarphotos.com/Search.php",
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildLocalReport(cars, jobId) {
  const cards = cars
    .map((c) => {
      const thumbs = (c.images || [])
        .map((img) => {
          const href = img.storage_url || img.image_url;
          const src = img.thumbnail_url || img.image_url;
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener"><img src="${escapeHtml(src)}" alt=""/></a>`;
        })
        .join("");
      const linkHtml = Object.entries(c.links || {})
        .map(
          ([name, url]) =>
            `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`,
        )
        .join(" ");
      return `<article><h2>${escapeHtml(c.display)}</h2><div class="thumbs">${thumbs}</div><div>${linkHtml}</div></article>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Photo Research ${escapeHtml(jobId)}</title>
<style>body{font-family:system-ui;background:#0B0E12;color:#E9EEF3;padding:24px}a{color:#7A96AB;margin-right:10px}article{margin:16px 0;padding:14px;border:1px solid #2A313C;border-radius:10px}.legal{background:#2a2114;border:1px solid #5c4a1e;padding:10px;border-radius:8px;color:#e8d4a8;margin-bottom:16px}.thumbs{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.thumbs img{width:96px;height:72px;object-fit:cover;border-radius:6px}</style>
</head><body>
<div class="legal"><strong>${escapeHtml(PHOTO_DISCLAIMER)}</strong></div>
<h1>Railcar Photo Research</h1>
<p>${cars.length} car(s) · job ${escapeHtml(jobId)}</p>
${cards}
</body></html>`;
}

/** Local links-only fallback (browser cannot call DDG due to CORS). */
export function findPhotosLocal(cars) {
  const jobId = crypto.randomUUID?.() || `local_${Date.now()}`;
  const enriched = (cars || []).map((car) => {
    const links = buildSearchLinks(car);
    return {
      mark: car.mark,
      number: car.number,
      display: `${car.mark} ${car.number}`,
      folder: `${car.mark}_${car.number}`,
      links,
      images: [],
      best_source: {
        name: "RR Picture Archives",
        url: links["RR Picture Archives (best)"],
        roster_url: links["RRPA mark roster"],
        keyword_url: links["RRPA keyword search"],
        suggestion: `Search RRPA for "${car.mark} ${car.number}" (exact), or RailcarPhotos after free login.`,
      },
      notes: {
        railcarphotos: `Free login → Search → ${car.mark} → ${car.number}.`,
        rrpicturearchives: `Primary: paste "${car.mark} ${car.number}" into RRPA Keywords, or open the mark roster.`,
      },
    };
  });
  return {
    job_id: jobId,
    status: "completed",
    mode: "links_only_local",
    session_id: getPhotoSessionId(),
    car_count: enriched.length,
    image_count: 0,
    truncated: false,
    invalid_count: 0,
    cars: enriched,
    report_html: buildLocalReport(enriched, jobId),
    report_url: null,
    persist_error:
      "Edge Function unavailable. Use RRPA links above, or run: python railcar_photo_finder/railcar_photo_finder.py --list cars.txt --download",
    cli_hint:
      "python railcar_photo_finder/railcar_photo_finder.py --list cars.txt --download --max-per-car 6 --workers 6",
    disclaimer: PHOTO_DISCLAIMER,
  };
}

/**
 * Single batch request. Tries Vercel /api/find-photos first, then Supabase Edge.
 * @param {Array<{mark:string,number:string}>} cars
 * @param {{ agentToken: string, persist?: boolean, fetchImages?: boolean, maxPerCar?: number, delayMs?: number, signal?: AbortSignal, timeoutMs?: number }} opts
 */
export async function findPhotos(cars, opts) {
  const {
    agentToken,
    persist = true,
    fetchImages = true,
    maxPerCar = 6,
    delayMs = 500,
    signal,
    timeoutMs = PHOTO_BATCH_TIMEOUT_MS,
  } = opts || {};
  if (!cars?.length) throw new Error("No cars selected.");

  const batchCars = cars.slice(0, PHOTO_BATCH_SIZE);

  // Instant path: browser cache of previously verified hits for this car
  if (fetchImages && batchCars.length === 1) {
    const car = batchCars[0];
    const cached = readLocalPhotoCache(car.mark, car.number);
    if (cached?.images?.length) {
      const images = cached.images.slice(0, maxPerCar);
      return {
        job_id: `cache_${Date.now().toString(36)}`,
        status: "completed",
        mode: "images_and_links",
        source: "local_cache",
        architecture: "dual_scraper_rrpa_railcarphotos",
        photo_build: PHOTO_BUILD,
        car_count: 1,
        image_count: images.length,
        not_found_count: 0,
        cache_hits: 1,
        cars: [
          {
            mark: car.mark,
            number: car.number,
            display: `${car.mark} ${car.number}`,
            folder: `${car.mark}_${car.number}`,
            images,
            image_count: images.length,
            cache_hit: true,
            links: {},
            best_source: {
              name: "RR Picture Archives",
              url: cached.carPage || "",
              car_page: cached.carPage || "",
            },
          },
        ],
        disclaimer: PHOTO_DISCLAIMER,
      };
    }
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort);
  const timer =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  const body = {
    cars: batchCars,
    session_id: getPhotoSessionId(),
    persist: false,
    fetch_images: fetchImages,
    persist_images: false,
    max_cars: Math.min(PHOTO_BATCH_SIZE, batchCars.length),
    max_per_car: maxPerCar,
    delay_ms: delayMs,
  };

  async function post(url, headers = {}) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    return { res, payload };
  }

  function rememberHits(payload) {
    for (const c of payload?.cars || []) {
      if (c?.images?.length && (c.best_source?.car_page || c.images.length >= 2)) {
        writeLocalPhotoCache(c.mark, c.number, {
          images: c.images,
          carPage: c.best_source?.car_page || c.rrpa_car_page || null,
        });
      }
    }
    return payload;
  }

  try {
    // 1) Same-origin Vercel API (RRPA roster + proxy URLs)
    try {
      const { res, payload } = await post(getVercelFindPhotosUrl());
      if (res.ok && payload?.cars) return rememberHits(payload);
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      /* try Edge next */
    }

    // 2) Supabase Edge (if deployed)
    try {
      const { res, payload } = await post(FIND_PHOTOS_URL, {
        "x-agent-token": agentToken,
      });
      if (res.ok && payload?.cars) return rememberHits(payload);
    } catch (e) {
      if (e?.name === "AbortError") throw e;
    }

    return findPhotosLocal(batchCars);
  } catch (err) {
    if (err?.name === "AbortError") {
      if (signal?.aborted) throw err;
      return findPhotosLocal(batchCars);
    }
    return findPhotosLocal(batchCars);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

function mergePhotoResults(parts, allCars) {
  const cars = [];
  const seen = new Set();
  let imageCount = 0;
  let anyLocal = false;
  let anyPersistError = null;
  const jobIds = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.job_id) jobIds.push(part.job_id);
    if (part.mode === "links_only_local") anyLocal = true;
    if (part.persist_error) anyPersistError = part.persist_error;
    for (const c of part.cars || []) {
      const key = `${c.mark}_${c.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const images = filterImagesForCar(c, c.images || []);
      cars.push({
        ...c,
        images,
        image_count: images.length,
        not_found: images.length === 0,
      });
      imageCount += images.length;
    }
  }

  // Always include every requested car (failed/timeout batches must not vanish)
  for (const car of allCars || []) {
    const key = `${car.mark}_${car.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const links = buildSearchLinks(car);
    cars.push({
      mark: car.mark,
      number: car.number,
      display: `${car.mark} ${car.number}`,
      folder: `${car.mark}_${car.number}`,
      links,
      images: [],
      image_count: 0,
      not_found: true,
      image_error: `No result returned for ${car.mark} ${car.number} (timeout or error).`,
      best_source: {
        name: "RR Picture Archives",
        url: links["RR Picture Archives (best)"],
        roster_url: links["RRPA mark roster"],
        keyword_url: links["RRPA keyword search"],
        suggestion: `Search RRPA for "${car.mark} ${car.number}" (exact).`,
      },
      notes: {
        rrpicturearchives: `Primary: "${car.mark} ${car.number}" on RRPA.`,
        railcarphotos: `Secondary: free login → Search → ${car.mark} → ${car.number}.`,
      },
    });
  }

  // Preserve input order
  const order = new Map((allCars || []).map((c, i) => [`${c.mark}_${c.number}`, i]));
  cars.sort((a, b) => {
    const ia = order.has(`${a.mark}_${a.number}`) ? order.get(`${a.mark}_${a.number}`) : 1e9;
    const ib = order.has(`${b.mark}_${b.number}`) ? order.get(`${b.mark}_${b.number}`) : 1e9;
    return ia - ib;
  });

  const jobId = jobIds[0] || crypto.randomUUID?.() || `batch_${Date.now()}`;
  const requested = (allCars || []).length;
  return {
    job_id: jobId,
    job_ids: jobIds,
    status: "completed",
    mode: anyLocal
      ? imageCount
        ? "mixed_batched"
        : "links_only_local"
      : imageCount
        ? "images_and_links"
        : "links_only_no_hits",
    session_id: getPhotoSessionId(),
    photo_build: PHOTO_BUILD,
    architecture: "dual_scraper_rrpa_railcarphotos",
    car_count: requested || cars.length,
    image_count: imageCount,
    not_found_count: cars.filter((c) => !c.images?.length).length,
    truncated: false,
    invalid_count: 0,
    batch_count: parts.length,
    cars,
    report_html: buildLocalReport(cars, jobId),
    report_url: null,
    persist_error: anyPersistError,
    cli_hint:
      "python railcar_photo_finder/railcar_photo_finder.py --list cars.txt --download --max-per-car 6 --workers 6",
    disclaimer: PHOTO_DISCLAIMER,
  };
}

/**
 * Process up to PHOTO_MAX_CARS cars in parallel batches with progress + ETA.
 * @param {Array<{mark:string,number:string}>} cars
 * @param {{
 *   agentToken: string,
 *   persist?: boolean,
 *   fetchImages?: boolean,
 *   maxPerCar?: number,
 *   batchSize?: number,
 *   concurrency?: number,
 *   maxCars?: number,
 *   signal?: AbortSignal,
 *   onProgress?: (info: {
 *     batch: number,
 *     batchTotal: number,
 *     batchesDone: number,
 *     carsDone: number,
 *     carTotal: number,
 *     etaSeconds?: number | null,
 *     partial?: object,
 *     message: string,
 *   }) => void,
 * }} opts
 */
export async function findPhotosBatched(cars, opts) {
  const {
    agentToken,
    persist = true,
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
  const parts = new Array(batches.length);
  const pool = Math.max(1, Math.min(concurrency | 0, batches.length));
  const startedAt = Date.now();
  let nextIdx = 0;
  let batchesDone = 0;
  let carsDone = 0;

  const emit = (extra = {}) => {
    const elapsed = Math.max(1, Date.now() - startedAt);
    const rate = carsDone / elapsed; // cars per ms
    const remaining = list.length - carsDone;
    const etaSeconds =
      carsDone > 0 && remaining > 0 ? Math.round(remaining / rate / 1000) : carsDone >= list.length ? 0 : null;
    const etaLabel = formatEtaSeconds(etaSeconds);
    const hitCars = extra.carsWithImages;
    const hitPart =
      typeof hitCars === "number" ? ` · ${hitCars} with photos` : "";
    onProgress?.({
      batch: Math.min(batchesDone + 1, batches.length),
      batchTotal: batches.length,
      batchesDone,
      carsDone,
      carTotal: list.length,
      etaSeconds,
      message:
        carsDone >= list.length
          ? `Finished ${list.length} car${list.length === 1 ? "" : "s"}${hitPart}`
          : `Processing ${carsDone}/${list.length} cars…${etaLabel ? ` · ${etaLabel}` : ""}${hitPart}`,
      ...extra,
    });
  };

  emit();

  async function runBatch(i) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const batch = batches[i];
    let part;
    try {
      part = await findPhotos(batch, {
        agentToken,
        persist: persist && batches.length === 1,
        fetchImages,
        maxPerCar: list.length > 40 ? Math.min(maxPerCar, 4) : maxPerCar,
        delayMs: list.length > 1 ? 80 : 150,
        signal,
        timeoutMs: PHOTO_BATCH_TIMEOUT_MS,
      });
    } catch (e) {
      if (e?.name === "AbortError" && signal?.aborted) throw e;
      // Keep the job alive — one car failure must not stop the rest of the list
      part = findPhotosLocal(batch);
      if (part?.cars?.[0]) {
        part.cars[0].image_error = e?.message || "Search failed for this car";
        part.cars[0].not_found = true;
      }
    }
    if (!part?.cars?.length) {
      part = findPhotosLocal(batch);
    }
    parts[i] = part;
    batchesDone += 1;
    carsDone += batch.length;
    const filled = parts.filter(Boolean);
    const partial = mergePhotoResults(filled, list);
    const hitCars = (partial?.cars || []).filter((c) => (c.images || []).length > 0).length;
    const hitImages = (partial?.cars || []).reduce((n, c) => n + (c.images || []).length, 0);
    emit({
      partial,
      carsWithImages: hitCars,
      imageCount: hitImages,
    });
  }

  async function worker() {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const i = nextIdx++;
      if (i >= batches.length) return;
      await runBatch(i);
      // Tiny stagger so parallel waves don't stampede Bing/RRPA
      if (nextIdx < batches.length) {
        await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 35)));
      }
    }
  }

  await Promise.all(Array.from({ length: pool }, () => worker()));
  return mergePhotoResults(parts.filter(Boolean), list);
}

export function bestImageUrl(img) {
  const raw =
    img?.storage_url || img?.proxy_url || img?.image_url || img?.thumbnail_url || "";
  if (raw.includes("/api/proxy-image")) {
    try {
      const u = new URL(raw, typeof window !== "undefined" ? window.location.origin : "https://local");
      const inner = u.searchParams.get("url");
      if (inner) return proxiedImageUrl(toDeliverableRrpaUrl(inner));
    } catch {
      return raw;
    }
  }
  return proxiedImageUrl(raw) || raw;
}

export function bestThumbUrl(img) {
  const thumb = img?.thumbnail_url || "";
  if (thumb.includes("/api/proxy-image")) {
    try {
      const u = new URL(thumb, typeof window !== "undefined" ? window.location.origin : "https://local");
      const inner = u.searchParams.get("url");
      if (inner) return proxiedImageUrl(toDeliverableRrpaUrl(inner));
    } catch {
      /* fall through */
    }
  }
  const raw = img?.image_url || img?.proxy_url || img?.storage_url || thumb;
  return proxiedImageUrl(raw) || bestImageUrl(img);
}

/**
 * Fetch an image as a Blob. Prefer proxied / Storage URLs to avoid hotlink CORS.
 */
export async function fetchImageBlob(url) {
  let fetchUrl = url;
  try {
    if (typeof window !== "undefined" && url && !url.includes("/api/proxy-image")) {
      fetchUrl = proxiedImageUrl(url) || url;
    }
  } catch {
    /* use original */
  }
  const res = await fetch(fetchUrl, { mode: "cors" });
  if (!res.ok) {
    // Retry via S3 rewrite if www RRPA failed
    const alt = proxiedImageUrl(toDeliverableRrpaUrl(url));
    if (alt && alt !== fetchUrl) {
      const res2 = await fetch(alt, { mode: "cors" });
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      return res2.blob();
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.blob();
}

export function triggerBlobDownload(blob, filename) {
  const a = document.createElement("a");
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

export async function downloadImagesAsZip() {
  throw new Error("Zip download is not available in RLMS. Open or save images individually.");
}

const STOP_MARKS = new Set([
  "HTTP", "HTTPS", "WWW", "COM", "NET", "ORG", "HTML", "JSON", "NULL", "TRUE", "FALSE",
]);

/** Parse pasted MARK + NUMBER lists (same rules as the UMLER Photo Finder). */
export function parsePhotoCarList(text, max = PHOTO_MAX_CARS) {
  const out = [];
  const seen = new Set();

  const push = (markRaw, numRaw) => {
    const mark = String(markRaw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    const rawNumber = String(numRaw || "").replace(/[^\d]/g, "");
    const number = normalizeCarNumber(rawNumber);
    if (mark.length < 2 || mark.length > 4 || !number) return;
    if (STOP_MARKS.has(mark)) return;
    const key = `${mark}_${number}`;
    if (seen.has(key)) return;
    seen.add(key);
    const row = { mark, number, m: mark, n: number };
    if (rawNumber && rawNumber !== number) row.number_raw = rawNumber;
    out.push(row);
  };

  const blob = String(text || "");
  const lines = blob.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^reporting[_\s]?mark/i.test(trimmed) && /car[_\s]?number/i.test(trimmed)) continue;

    const lineHit = trimmed.match(
      /^([A-Za-z]{2,4})[\s,.\-_]+(\d{1,10})(?:\b|[^\d]|$)/,
    );
    if (lineHit) {
      push(lineHit[1], lineHit[2]);
      if (out.length >= max) break;
      continue;
    }

    const concat = trimmed.match(/^([A-Za-z]{2,4})(\d{3,10})\b/);
    if (concat) {
      push(concat[1], concat[2]);
      if (out.length >= max) break;
      continue;
    }

    const cols = trimmed.split(/[\t,;]+/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length >= 2 && /^[A-Za-z]{2,4}$/.test(cols[0]) && /^\d{1,10}$/.test(cols[1])) {
      push(cols[0], cols[1]);
      if (out.length >= max) break;
      continue;
    }

    const carRe =
      /(?:^|[^A-Za-z0-9])([A-Za-z]{2,4})[\s,.\-_]+(\d{1,10})(?![A-Za-z0-9])/g;
    let m;
    while ((m = carRe.exec(trimmed)) !== null) {
      push(m[1], m[2]);
      if (out.length >= max) break;
    }
    if (out.length >= max) break;

    const concatRe = /(?:^|[^A-Za-z0-9])([A-Za-z]{2,4})(\d{3,10})(?![A-Za-z0-9])/g;
    while ((m = concatRe.exec(trimmed)) !== null) {
      push(m[1], m[2]);
      if (out.length >= max) break;
    }
    if (out.length >= max) break;
  }

  if (out.length < max && /,/.test(blob) && !/\n/.test(blob.trim())) {
    const carRe =
      /(?:^|[^A-Za-z0-9])([A-Za-z]{2,4})[\s,.\-_]+(\d{1,10})(?![A-Za-z0-9])/g;
    let m;
    while ((m = carRe.exec(blob)) !== null) {
      push(m[1], m[2]);
      if (out.length >= max) break;
    }
  }

  return out.slice(0, max);
}

