import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  PHOTO_MAX_CARS,
  PHOTO_DISCLAIMER,
  parsePhotoCarList,
  extractCarsFromRows,
  formatEtaSeconds,
  bestThumbUrl,
  bestImageUrl,
} from "@/lib/photoFinderClient";
import {
  startPhotoJob,
  subscribePhotoJobs,
  summarizePhotoResult,
  hasRunningPhotoJob,
  abortPhotoJob,
} from "@/lib/photoJobStore";

type PhotoCar = { mark: string; number: string };

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
  const [text, setText] = useState(initialText);
  const [isSearching, setIsSearching] = useState(() => hasRunningPhotoJob());
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const searchingRef = useRef(hasRunningPhotoJob());
  const seenRunningRef = useRef(hasRunningPhotoJob());
  const trackedJobIdRef = useRef<string | null>(null);

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

  function handleSearch() {
    if (searchingRef.current || isSearching) return;
    if (!rows.length) return;
    searchingRef.current = true;
    seenRunningRef.current = true;
    setIsSearching(true);
    setRunStatus({
      kind: "running",
      carsDone: 0,
      carTotal: rows.length,
      message: `Searching ${rows.length} car${rows.length === 1 ? "" : "s"} for photos…`,
    });
    startPhotoJob({
      cars: rows,
      title: `Photo Search · ${rows.length} car${rows.length === 1 ? "" : "s"}`,
    });
  }

  const hitCars = useMemo(() => {
    const cars = runStatus?.result?.cars || [];
    return cars.filter((c: any) => (c.images || []).length > 0);
  }, [runStatus]);
  const active = hitCars[activeIdx] || null;
  const images = active?.images || [];
  const pct =
    runStatus?.kind === "running" && (runStatus.carTotal || 0) > 0
      ? Math.min(100, Math.round((100 * (runStatus.carsDone || 0)) / (runStatus.carTotal || 1)))
      : null;

  return (
    <div className="flex flex-col gap-4 min-h-0">
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
              }`}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
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
        {isSearching && trackedJobIdRef.current && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const id = trackedJobIdRef.current;
              if (id) abortPhotoJob(id);
            }}
          >
            Cancel
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
            <div className="text-sm font-medium">{runStatus.message}</div>
            {(runStatus.notFoundCount || 0) > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                {runStatus.notFoundCount} car{runStatus.notFoundCount === 1 ? "" : "s"} with none
              </div>
            )}
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

      {runStatus?.kind === "done" && hitCars.length > 0 && (
        <div className="grid gap-3 min-h-0">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {hitCars.map((c: any, i: number) => (
              <button
                key={`${c.mark}_${c.number}`}
                type="button"
                onClick={() => setActiveIdx(i)}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 text-xs font-mono",
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
