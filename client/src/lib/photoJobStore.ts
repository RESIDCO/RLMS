/**
 * Photo-search jobs live at module scope so a closed dialog does not cancel them.
 * The last finished job is also kept in sessionStorage for the next mount.
 */

import { apiRequest } from "./queryClient";
import {
  carHasFoundPhoto,
  findPhotosBatched,
  PHOTO_CONCURRENCY,
  type PhotoCarInput,
  type PhotoFindResponse,
  type PhotoProgress,
  type PhotoSearchPost,
} from "./photoFinderClient";

const STORAGE_KEY = "rlms_photo_last_job_v1";

export type PhotoJobStatus = "running" | "done" | "error" | "aborted";

export type PhotoJob = {
  id: string;
  title: string;
  status: PhotoJobStatus;
  carTotal: number;
  cars: PhotoCarInput[];
  progress: PhotoProgress | null;
  result: PhotoFindResponse | null;
  error: string | null;
  completedAt: number | null;
  abort: () => void;
};

export type StoredPhotoJob = {
  result: PhotoFindResponse;
  finishedAt: number;
  cars: PhotoCarInput[];
  title?: string;
};

export type PhotoJobSnapshot = {
  jobs: PhotoJob[];
};

const listeners = new Set<(snap: PhotoJobSnapshot) => void>();
const jobs = new Map<string, PhotoJob>();

function browserSession(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function readStoredPhotoJob(): StoredPhotoJob | null {
  const store = browserSession();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPhotoJob;
    if (!parsed?.result || typeof parsed.finishedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredPhotoJob(row: StoredPhotoJob): void {
  const store = browserSession();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(row));
  } catch {
    /* private mode or quota */
  }
}

function jobList(): PhotoJob[] {
  const out: PhotoJob[] = [];
  jobs.forEach((job) => out.push(job));
  return out;
}

function emit(): void {
  const snap: PhotoJobSnapshot = { jobs: jobList() };
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* ignore subscriber errors */
    }
  });
}

function hydrateStoredJob(): void {
  const stored = readStoredPhotoJob();
  if (!stored) return;
  jobs.set("stored", {
    id: "stored",
    title: stored.title || "Photo Search",
    status: "done",
    carTotal: stored.cars?.length || stored.result.car_count || 0,
    cars: stored.cars || [],
    progress: null,
    result: stored.result,
    error: null,
    completedAt: stored.finishedAt,
    abort: () => {},
  });
}

hydrateStoredJob();

export function subscribePhotoJobs(fn: (snap: PhotoJobSnapshot) => void): () => void {
  listeners.add(fn);
  fn({ jobs: jobList() });
  return () => {
    listeners.delete(fn);
  };
}

export function carsWithImages(cars: PhotoFindResponse["cars"]): NonNullable<PhotoFindResponse["cars"]> {
  return (cars || []).filter((car) => carHasFoundPhoto(car));
}

export function summarizePhotoResult(result: PhotoFindResponse | null | undefined): {
  carTotal: number;
  carsWithImages: number;
  imageCount: number;
  notFoundCount: number;
  hitCars: NonNullable<PhotoFindResponse["cars"]>;
} {
  const all = result?.cars || [];
  const hits = carsWithImages(all);
  const imageCount = hits.reduce((sum, car) => sum + (car.images || []).length, 0);
  return {
    carTotal: result?.car_count ?? all.length,
    carsWithImages: hits.length,
    imageCount: result?.image_count ?? imageCount,
    notFoundCount: result?.not_found_count ?? all.length - hits.length,
    hitCars: hits,
  };
}

const postPhotoFind: PhotoSearchPost = async (body, init) => {
  const res = await apiRequest("POST", "/api/photo-search/find", body, undefined, init);
  return (await res.json()) as PhotoFindResponse;
};

function rememberFinished(job: PhotoJob): void {
  if (!job.result) return;
  writeStoredPhotoJob({
    result: job.result,
    finishedAt: job.completedAt || Date.now(),
    cars: job.cars,
    title: job.title,
  });
}

/**
 * Start a photo search. If one is already running, that job is returned.
 */
export function startPhotoJob({ cars, title }: { cars: PhotoCarInput[]; title?: string }): PhotoJob {
  const existing = jobList().find((job) => job.status === "running");
  if (existing) return existing;

  const id = (typeof crypto !== "undefined" && crypto.randomUUID?.())
    || `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const job: PhotoJob = {
    id,
    title: title || "Photo Search",
    status: "running",
    carTotal: cars?.length || 0,
    cars: cars || [],
    progress: null,
    result: null,
    error: null,
    completedAt: null,
    abort: () => controller.abort(),
  };
  jobs.set(id, job);
  emit();

  findPhotosBatched(cars, {
    post: postPhotoFind,
    fetchImages: true,
    maxPerCar: 6,
    concurrency: PHOTO_CONCURRENCY,
    signal: controller.signal,
    onProgress: (info) => {
      const cur = jobs.get(id);
      if (!cur || cur.status !== "running") return;
      cur.progress = info;
      emit();
    },
  })
    .then((result) => {
      const cur = jobs.get(id);
      if (!cur || cur.status !== "running") return;
      cur.status = "done";
      cur.result = result;
      cur.progress = null;
      cur.completedAt = Date.now();
      rememberFinished(cur);
      emit();
    })
    .catch((err: unknown) => {
      const cur = jobs.get(id);
      if (!cur || cur.status !== "running") return;
      if ((err as { name?: string } | null)?.name === "AbortError") {
        cur.status = "aborted";
        emit();
        return;
      }
      cur.status = "error";
      cur.error = err instanceof Error ? err.message : String(err);
      cur.completedAt = Date.now();
      emit();
    });

  return job;
}

export function abortPhotoJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return;
  job.abort();
  job.status = "aborted";
  emit();
}

/** Drop finished results, including the session copy. A running search is left alone. */
export function clearPhotoResults(): void {
  const finishedIds: string[] = [];
  jobs.forEach((job, id) => {
    if (job.status !== "running") finishedIds.push(id);
  });
  finishedIds.forEach((id) => jobs.delete(id));
  try {
    browserSession()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function hasRunningPhotoJob(): boolean {
  return jobList().some((job) => job.status === "running");
}

export function currentPhotoJob(): PhotoJob | null {
  const running = jobList().find((job) => job.status === "running");
  if (running) return running;
  return latestFinishedPhotoJob();
}

export function latestFinishedPhotoJob(): PhotoJob | null {
  const finished = jobList().filter((job) => job.status === "done" || job.status === "error");
  finished.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  return finished[0] || null;
}
