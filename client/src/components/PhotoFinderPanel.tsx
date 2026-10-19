import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Loader2, ExternalLink, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useIsAdmin } from "@/lib/AuthContext";
import { apiGet, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import PhotoIndexResults from "@/components/PhotoIndexResults";
import {
  PHOTO_MAX_CARS,
  PHOTO_DISCLAIMER,
  parsePhotoCarList,
  extractCarsFromRows,
  formatEtaSeconds,
  bestThumbUrl,
  bestImageUrl,
  downloadImagesAsZip,
  collectPhotoZipItems,
} from "@/lib/photoFinderClient";
import {
  startPhotoJob,
  subscribePhotoJobs,
  summarizePhotoResult,
  hasRunningPhotoJob,
  abortPhotoJob,
} from "@/lib/photoJobStore";
import {
  PHOTO_INDEX_CHUNK,
  PHOTO_SEARCH_MODE_KEY,
  effectivePhotoSearchMode,
  isLegacyPhotoSearchBuild,
  planWarmRequests,
  resolveIndexSearch,
  type IndexCar,
  type IndexLookupSuccess,
} from "@shared/photo-index";

type PhotoCar = { mark: string; number: string };

const TOOLBAR = "flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 [&_button]:h-auto [&_button]:max-w-full [&_button]:whitespace-normal";

function photoSearchEnv(): string {
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  const value = env.VITE_PHOTO_SEARCH;
  return typeof value === "string" ? value : "";
}

function readStoredPhotoMode(): string | null {
  try {
    return localStorage.getItem(PHOTO_SEARCH_MODE_KEY);
  } catch {
    return null;
  }
}

function writeStoredPhotoMode(classic: boolean): void {
  try {
    if (classic) localStorage.setItem(PHOTO_SEARCH_MODE_KEY, "legacy");
    else localStorage.removeItem(PHOTO_SEARCH_MODE_KEY);
  } catch {
    /* private mode */
  }
}

export function carsToPasteText(rows: unknown[]): string {
  const cars = extractCarsFromRows(rows, { max: PHOTO_MAX_CARS }) as PhotoCar[];
  return cars.map((c) => `${c.mark} ${c.number}`).join("\n");
}

type RunStatus = {
  kind: "running" | "done" | "error";
  message: string;
  carsDone?: number;
  carTotal?: number;
  carsWithImages?: number;
  notFoundCount?: number;
  etaSeconds?: number | null;
  detail?: string;
  result?: any;
};

export default function PhotoFinderPanel({
  initialText = "",
  onClose,
}: {
  initialText?: string;
  onClose?: () => void;
}) {
  const { toast } = useToast();
  const isAdmin = useIsAdmin();
  const legacyBuild = isLegacyPhotoSearchBuild(photoSearchEnv());
  const [classicOn, setClassicOn] = useState(() => effectivePhotoSearchMode(photoSearchEnv(), readStoredPhotoMode()) === "legacy" && !isLegacyPhotoSearchBuild(photoSearchEnv()));
  const legacyMode = legacyBuild || classicOn;
  const legacyModeRef = useRef(legacyMode);
  legacyModeRef.current = legacyMode;
  const [text, setText] = useState(initialText);
  const [aliasNote, setAliasNote] = useState("");
  const [isSearching, setIsSearching] = useState(() => hasRunningPhotoJob());
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [indexView, setIndexView] = useState<IndexLookupSuccess | null>(null);
  const [warmBusy, setWarmBusy] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlNote, setDlNote] = useState("");
  const searchingRef = useRef(hasRunningPhotoJob());
  const seenRunningRef = useRef(hasRunningPhotoJob());
  const trackedJobIdRef = useRef<string | null>(null);
  const indexReq = useRef(0);
  const indexInFlightRef = useRef(false);

  useEffect(() => {
    if (initialText) setText(initialText);
  }, [initialText]);

  const parsed = useMemo(() => parsePhotoCarList(text, PHOTO_MAX_CARS + 1) as PhotoCar[], [text]);
  const rows = parsed.slice(0, PHOTO_MAX_CARS);
  const truncated = parsed.length > PHOTO_MAX_CARS;

  useEffect(() => {
    return subscribePhotoJobs((snap: any) => {
      const list = snap.jobs || [];
      const running = list.filter((j: any) => j.status === "running");
      if (indexInFlightRef.current && !running.length) return;
      if (running.length) {
        seenRunningRef.current = true;
        searchingRef.current = true;
        trackedJobIdRef.current = running[0].id;
        setIsSearching(true);
        const job = running[0];
        const p = job.progress || {};
        const total = p.carTotal ?? job.carTotal ?? 0;
        const done = p.carsDone ?? 0;
        const eta = formatEtaSeconds(p.etaSeconds);
        setRunStatus({
          kind: "running",
          carsDone: done,
          carTotal: total,
          carsWithImages: p.carsWithImages,
          etaSeconds: p.etaSeconds,
          message: total
            ? `Finding photos… ${done} of ${total} cars${eta ? ` · ${eta}` : ""}`
            : "Searching…",
        });
        return;
      }

      searchingRef.current = false;
      setIsSearching(false);
      if (!seenRunningRef.current) return;
      seenRunningRef.current = false;

      const finished = trackedJobIdRef.current
        ? list.find((j: any) => j.id === trackedJobIdRef.current)
        : list
            .filter((j: any) => j.status === "done" || j.status === "error")
            .sort((a: any, b: any) => (b.completedAt || 0) - (a.completedAt || 0))[0];
      trackedJobIdRef.current = null;

      if (!finished || finished.status === "aborted") {
        setRunStatus((prev) => (prev?.kind === "running" ? null : prev));
        return;
      }
      if (finished.status === "error") {
        setRunStatus({
          kind: "error",
          message: "Search failed — try again",
          detail: finished.error || "",
        });
        return;
      }
      const s = summarizePhotoResult(finished.result);
      setRunStatus({
        kind: "done",
        carTotal: s.carTotal,
        carsWithImages: s.carsWithImages,
        notFoundCount: s.notFoundCount || 0,
        result: finished.result,
        message: `Found photos for ${s.carsWithImages} of ${s.carTotal} cars`,
      });
      setActiveIdx(0);
    });
  }, []);

  function startLegacy(cars: PhotoCar[], title?: string) {
    if (!cars.length) return;
    indexInFlightRef.current = false;
    if (trackedJobIdRef.current) abortPhotoJob(trackedJobIdRef.current);
    searchingRef.current = true;
    seenRunningRef.current = true;
    setIsSearching(true);
    setRunStatus({
      kind: "running",
      carsDone: 0,
      carTotal: cars.length,
      message: `Searching ${cars.length} car${cars.length === 1 ? "" : "s"} for photos…`,
    });
    const job = startPhotoJob({
      cars,
      title: title || `Photo Search · ${cars.length} car${cars.length === 1 ? "" : "s"}`,
    });
    trackedJobIdRef.current = job.id;
  }

  async function runIndex(cars: PhotoCar[]) {
    const requestId = ++indexReq.current;
    indexInFlightRef.current = true;
    searchingRef.current = true;
    setIsSearching(true);
    setIndexView(null);
    setRunStatus({
      kind: "running",
      carsDone: 0,
      carTotal: cars.length,
      message: `Checking the photo index for ${cars.length} car${cars.length === 1 ? "" : "s"}…`,
    });
    const plan = await resolveIndexSearch(cars, async (list) => {
      const timeoutMs = Math.max(1, Math.ceil(list.length / PHOTO_INDEX_CHUNK)) * 12_000;
      const res = await apiRequest("POST", "/api/photos/index-lookup", { cars: list }, undefined, { timeoutMs });
      return res.json();
    });
    if (indexReq.current !== requestId) return;
    if (plan.kind === "legacy" || legacyModeRef.current) {
      indexInFlightRef.current = false;
      startLegacy(cars);
      return;
    }
    indexInFlightRef.current = false;
    searchingRef.current = false;
    setIsSearching(false);
    setIndexView(plan.view);
    setRunStatus(null);
  }

  async function handleSearch() {
    if (searchingRef.current || isSearching) return;
    if (!rows.length) return;
    searchingRef.current = true;
    setIsSearching(true);
    if (legacyModeRef.current) seenRunningRef.current = true;
    else indexInFlightRef.current = true;
    let cars: PhotoCar[] = rows;
    try {
      const res = await apiRequest("POST", "/api/railcars/resolve-prior-marks", {
        cars: rows.map((car) => ({ mark: car.mark, number: car.number })),
      });
      const data = (await res.json()) as { cars?: Array<{ mark: string; number: string; formerly: string | null }> };
      if (data.cars?.length) {
        const notes = data.cars
          .filter((car) => car.formerly)
          .map((car) => `${car.formerly} is now ${car.mark} ${car.number}`);
        setAliasNote(notes.slice(0, 8).join("; "));
        cars = data.cars.map((car) => ({ mark: car.mark, number: car.number }));
      }
    } catch {
      cars = rows;
    }
    if (!cars.length) {
      searchingRef.current = false;
      seenRunningRef.current = false;
      indexInFlightRef.current = false;
      setIsSearching(false);
      return;
    }
    if (legacyModeRef.current) {
      startLegacy(cars);
      return;
    }
    void runIndex(cars);
  }

  function handleClear() {
    indexReq.current += 1;
    indexInFlightRef.current = false;
    if (isSearching && trackedJobIdRef.current) {
      abortPhotoJob(trackedJobIdRef.current);
    }
    searchingRef.current = false;
    seenRunningRef.current = false;
    trackedJobIdRef.current = null;
    setIsSearching(false);
    setText("");
    setAliasNote("");
    setRunStatus(null);
    setIndexView(null);
    setActiveIdx(0);
    setDlBusy(false);
    setDlNote("");
  }

  function setClassic(on: boolean) {
    setClassicOn(on);
    writeStoredPhotoMode(on);
  }

  async function warmActiveFleet() {
    if (warmBusy) return;
    setWarmBusy(true);
    try {
      const data = await apiGet<unknown>("/api/railcars?active=active&all=1", { timeoutMs: 60_000 });
      const rowsForWarm = Array.isArray(data) ? data : [];
      const plan = planWarmRequests(rowsForWarm);
      if (!plan.send.length) {
        toast({ title: "No active cars to warm" });
        return;
      }
      let sent = 0;
      for (const chunk of plan.chunks) {
        const res = await apiRequest("POST", "/api/photos/index-warm", { cars: chunk }, undefined, { timeoutMs: 12_000 });
        const body = await res.json() as { fallback?: boolean; sent?: number };
        if (body?.fallback) throw new Error("warm failed");
        sent += typeof body?.sent === "number" ? body.sent : chunk.length;
      }
      toast({ title: `Queued ${sent.toLocaleString("en-US")} active cars` });
    } catch {
      toast({ title: "Could not warm the photo index", variant: "destructive" });
    } finally {
      setWarmBusy(false);
    }
  }

  const hitCars = useMemo(() => {
    const cars = runStatus?.result?.cars || [];
    return cars.filter((c: any) => (c.images || []).length > 0);
  }, [runStatus]);
  const allPhotoCount = useMemo(
    () => hitCars.reduce((n: number, c: any) => n + (c.images || []).length, 0),
    [hitCars],
  );

  async function downloadAllPhotos() {
    if (!hitCars.length || dlBusy) return;
    setDlBusy(true);
    setDlNote("");
    try {
      const items = collectPhotoZipItems(hitCars);
      const { ok, errors } = await downloadImagesAsZip(items, "railcar_photos.zip");
      setDlNote(
        errors?.length
          ? `Downloaded ${ok} photo${ok === 1 ? "" : "s"}; ${errors.length} failed.`
          : `Downloaded ${ok} photo${ok === 1 ? "" : "s"}.`,
      );
    } catch (e: any) {
      setDlNote(e?.message || "Download failed — try again.");
    } finally {
      setDlBusy(false);
    }
  }
  const active = hitCars[activeIdx] || null;
  const images = active?.images || [];
  const pct =
    runStatus?.kind === "running" && (runStatus.carTotal || 0) > 0
      ? Math.min(100, Math.round((100 * (runStatus.carsDone || 0)) / (runStatus.carTotal || 1)))
      : null;

  const showIndex = !legacyMode && indexView != null;

  return (
    <div className="flex min-h-0 min-w-0 max-w-full flex-col gap-4">
      <div>
        <label htmlFor="rlms-photo-car-list" className="font-eyebrow block mb-1.5">
          Cars (one per line or comma-separated)
        </label>
        <Textarea
          id="rlms-photo-car-list"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={"NDYX 360129\nCNW 350471\nHWCX 10601"}
          className="font-mono text-sm min-h-[160px]"
          data-testid="input-photo-car-list"
        />
        <p className="text-xs text-muted-foreground mt-1.5">
          {rows.length === 0
            ? "No cars parsed yet — paste MARK + NUMBER."
            : `${rows.length} car${rows.length === 1 ? "" : "s"} ready${
                truncated ? ` (capped at ${PHOTO_MAX_CARS})` : ""
              }${aliasNote ? `. ${aliasNote}` : ""}`}
        </p>
      </div>

      <div className={TOOLBAR}>
        <Button
          type="button"
          disabled={!rows.length || isSearching}
          aria-disabled={!rows.length || isSearching}
          onClick={handleSearch}
          data-testid="button-find-photos-search"
        >
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
          {isSearching ? "Searching…" : rows.length ? `Find Photos (${rows.length})` : "Find Photos"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!isSearching && !text && !runStatus && !indexView}
          onClick={handleClear}
          data-testid="button-photo-search-clear"
        >
          <X className="h-4 w-4" />
          New search
        </Button>
        {isSearching && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              indexReq.current += 1;
              indexInFlightRef.current = false;
              const id = trackedJobIdRef.current;
              if (id) abortPhotoJob(id);
              searchingRef.current = false;
              seenRunningRef.current = false;
              setIsSearching(false);
              setRunStatus((prev) => (prev?.kind === "running" ? null : prev));
            }}
          >
            Cancel
          </Button>
        )}
        {!legacyBuild && (
          <label className="inline-flex max-w-full items-center gap-2 text-sm">
            <Switch
              checked={classicOn}
              onCheckedChange={setClassic}
              aria-label="Classic photo search"
              data-testid="switch-classic-photo-search"
            />
            Classic photo search
          </label>
        )}
        {isAdmin && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={warmBusy}
            onClick={() => { void warmActiveFleet(); }}
            data-testid="button-warm-photo-index"
          >
            {warmBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {warmBusy ? "Warming…" : "Warm photo index (active fleet)"}
          </Button>
        )}
        {onClose && (
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={isSearching || undefined}
      >
        {runStatus?.kind === "running" && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
            <div className="text-sm font-medium">{runStatus.message}</div>
            {typeof runStatus.carsWithImages === "number" && (
              <div className="text-xs text-muted-foreground mt-1">
                {runStatus.carsWithImages} car{runStatus.carsWithImages === 1 ? "" : "s"} with photos so far
              </div>
            )}
            {pct != null && (
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        )}
        {runStatus?.kind === "done" && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
            {showIndex && <div className="text-xs font-medium text-muted-foreground mb-1">Deep search</div>}
            <div className="flex w-full min-w-0 flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{runStatus.message}</div>
                {(runStatus.notFoundCount || 0) > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {runStatus.notFoundCount} car{runStatus.notFoundCount === 1 ? "" : "s"} with none
                  </div>
                )}
                {dlNote && (
                  <div className="text-xs text-muted-foreground mt-1">{dlNote}</div>
                )}
              </div>
              {allPhotoCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={dlBusy}
                  onClick={downloadAllPhotos}
                  data-testid="button-download-all-photos"
                >
                  {dlBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {dlBusy ? "Downloading…" : `Download all photos (${allPhotoCount})`}
                </Button>
              )}
            </div>
          </div>
        )}
        {runStatus?.kind === "error" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3">
            <div className="text-sm font-medium">Search failed — try again</div>
            {runStatus.detail && (
              <div className="text-xs text-muted-foreground mt-1">{runStatus.detail}</div>
            )}
          </div>
        )}
      </div>

      {showIndex && indexView && (
        <PhotoIndexResults
          cars={indexView.cars as IndexCar[]}
          onDeepSearch={(cars) => {
            const title = cars.length === 1
              ? `Deep search · ${cars[0]?.mark ?? ""} ${cars[0]?.number ?? ""}`.trim()
              : `Deep search · ${cars.length} cars`;
            startLegacy(cars, title);
          }}
        />
      )}

      {runStatus?.kind === "done" && hitCars.length > 0 && (
        <div className="grid min-h-0 min-w-0 gap-3">
          <div className="flex flex-wrap gap-1.5">
            {hitCars.map((c: any, i: number) => (
              <button
                key={`${c.mark}_${c.number}`}
                type="button"
                onClick={() => setActiveIdx(i)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-mono",
                  i === activeIdx
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {c.mark} {c.number}
                <span className="ml-1 text-muted-foreground">({(c.images || []).length})</span>
              </button>
            ))}
          </div>
          {active && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="font-mono text-sm font-semibold">
                  {active.mark} {active.number}
                </div>
                {active.best_source?.car_page && (
                  <a
                    href={active.best_source.car_page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    RRPA <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {images.map((img: any, i: number) => {
                  const src = bestThumbUrl(img) || bestImageUrl(img);
                  const href = bestImageUrl(img) || src;
                  return (
                    <a
                      key={`${href}-${i}`}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-md overflow-hidden border border-border bg-muted/20 aspect-[4/3]"
                    >
                      <img
                        src={src}
                        alt={`${active.mark} ${active.number} photo ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {runStatus?.kind === "done" && hitCars.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No verified photos for this list. Try RR Picture Archives with the exact mark and number.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">{PHOTO_DISCLAIMER}</p>
    </div>
  );
}
