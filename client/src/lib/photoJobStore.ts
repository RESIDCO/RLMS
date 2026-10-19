// @ts-nocheck
/**
 * Module-level photo-search jobs so searches can outlive a closed dialog.
 */

import { findPhotosBatched, PHOTO_CONCURRENCY } from "./photoFinderClient";

const listeners = new Set();
/** @type {Map<string, object>} */
const jobs = new Map();
/** @type {Array<object>} */
let toasts = [];
/** Pending result to open in a viewer modal (set by toast click). */
let pendingView = null;

function emit() {
  const snap = {
    jobs: [...jobs.values()],
    toasts: [...toasts],
    pendingView,
  };
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function subscribePhotoJobs(fn) {
  listeners.add(fn);
  fn({ jobs: [...jobs.values()], toasts: [...toasts], pendingView });
  return () => {
    listeners.delete(fn);
  };
}

export function carsWithImages(cars) {
  return (cars || []).filter((c) => (c?.images || []).length > 0);
}

export function summarizePhotoResult(result) {
  const all = result?.cars || [];
  const hits = carsWithImages(all);
  const imageCount = hits.reduce((n, c) => n + (c.images || []).length, 0);
  return {
    carTotal: result?.car_count ?? all.length,
    carsWithImages: hits.length,
    imageCount: result?.image_count ?? imageCount,
    notFoundCount: result?.not_found_count ?? all.length - hits.length,
    hitCars: hits,
  };
}

/**
 * Start a photo search job. Returns the job object (id, abort, …).
 * Concurrent-run guard: if a search is already in flight, return that job
 * instead of launching a duplicate scrape.
 */
export function startPhotoJob({ cars, agentToken, title } = {}) {
  const existing = [...jobs.values()].find((j) => j.status === "running");
  if (existing) return existing;

  const id =
    (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
    `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const job = {
    id,
    title: title || "Photo Search",
    status: "running",
    background: false,
    carTotal: cars?.length || 0,
    progress: null,
    result: null,
    error: null,
    unread: false,
    dismissed: false,
    completedAt: null,
    abort: () => controller.abort(),
  };
  jobs.set(id, job);
  emit();

  findPhotosBatched(cars, {
    agentToken,
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
      if (!cur) return;
      if (controller.signal.aborted && !cur.background) {
        cur.status = "aborted";
        emit();
        return;
      }
      cur.status = "done";
      cur.result = result;
      cur.progress = null;
      cur.unread = true;
      cur.dismissed = false;
      cur.completedAt = Date.now();
      const s = summarizePhotoResult(result);
      // Toast when backgrounded (user left the modal); bell always tracks unread
      if (cur.background) {
        pushToast({
          id: `toast_${id}`,
          jobId: id,
          kind: s.carsWithImages ? "success" : "empty",
          title: cur.title,
          message: s.carsWithImages
            ? `Photo search complete — ${s.carsWithImages} of ${s.carTotal} cars had photos. Click to view.`
            : `Photo search complete — no photos found for ${s.carTotal} cars. Click for RRPA links.`,
          result,
          summary: s,
        });
      }
      emit();
    })
    .catch((err) => {
      const cur = jobs.get(id);
      if (!cur) return;
      if (err?.name === "AbortError") {
        cur.status = "aborted";
        emit();
        return;
      }
      cur.status = "error";
      cur.error = err?.message || String(err);
      cur.unread = true;
      cur.dismissed = false;
      cur.completedAt = Date.now();
      if (cur.background) {
        pushToast({
          id: `toast_${id}`,
          jobId: id,
          kind: "error",
          title: cur.title,
          message: `Photo search failed: ${cur.error}`,
          result: null,
        });
      }
      emit();
    });

  return job;
}

export function markJobBackground(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return;
  job.background = true;
  emit();
}

export function abortPhotoJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.abort?.();
  if (job.status === "running" && !job.background) {
    job.status = "aborted";
    emit();
  }
}

function pushToast(toast) {
  toasts = [toast, ...toasts.filter((t) => t.id !== toast.id)].slice(0, 5);
  emit();
}

export function dismissToast(toastId) {
  toasts = toasts.filter((t) => t.id !== toastId);
  emit();
}

/** Mark a completed job as seen (clears bell badge for that job). */
export function markPhotoJobRead(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.unread = false;
  emit();
}

/** Hide a job from the notification panel. */
export function dismissPhotoJobNotification(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.unread = false;
  job.dismissed = true;
  toasts = toasts.filter((t) => t.jobId !== jobId);
  emit();
}

/** Clear all completed-job badges / panel entries (running jobs stay). */
export function clearPhotoNotifications() {
  for (const job of jobs.values()) {
    if (job.status === "running") continue;
    job.unread = false;
    job.dismissed = true;
  }
  toasts = [];
  emit();
}

/** Open a completed result in the global viewer (used by toast / bell). */
export function requestPhotoResultView(payload) {
  pendingView = payload
    ? {
        result: payload.result,
        title: payload.title || "Photo Search",
        toastId: payload.toastId || null,
        jobId: payload.jobId || null,
      }
    : null;
  if (payload?.toastId) {
    toasts = toasts.filter((t) => t.id !== payload.toastId);
  }
  if (payload?.jobId) {
    const job = jobs.get(payload.jobId);
    if (job) job.unread = false;
  }
  emit();
}

export function clearPendingPhotoView() {
  pendingView = null;
  emit();
}

export function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/** True while any photo-search job is in flight (used to block duplicate submits). */
export function hasRunningPhotoJob() {
  for (const job of jobs.values()) {
    if (job.status === "running") return true;
  }
  return false;
}

export function getRunningPhotoJobs() {
  return [...jobs.values()].filter((j) => j.status === "running");
}
