import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Loader2, ExternalLink, Download, X, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  PHOTO_MAX_CARS,
  PHOTO_DISCLAIMER,
  DEFAULT_TIER_TOGGLES,
  parsePhotoCarList,
  extractCarsFromRows,
  formatEtaSeconds,
  bestThumbUrl,
  bestImageUrl,
  downloadImagesAsZip,
  collectPhotoZipItems,
  buildPhotoManifestCsv,
  carKey,
  carStatus,
  countTiers,
  formatPhotoMeta,
  formatUmlerLine,
  imageIdentityKey,
  isImageVisible,
  sourcePageUrl,
  splitPhotoOutcomes,
  tierLabel,
  tierOf,
  umlerIndicator,
  type PhotoCarInput,
  type PhotoCarResult,
  type PhotoFindResponse,
  type PhotoImage,
  type RatedTier,
  type TierToggles,
} from "@/lib/photoFinderClient";
import {
  abortPhotoJob,
  clearPhotoResults,
  hasRunningPhotoJob,
  currentPhotoJob,
  startPhotoJob,
  subscribePhotoJobs,
  summarizePhotoResult,
  type PhotoJob,
} from "@/lib/photoJobStore";

type PhotoCar = PhotoCarInput;

const FLAG_REASONS = [
  { id: "wrong_car", label: "Wrong car" },
  { id: "wrong_type", label: "Wrong type" },
  { id: "duplicate", label: "Duplicate" },
  { id: "bad_image", label: "Bad image" },
] as const;

type FlagReasonId = (typeof FLAG_REASONS)[number]["id"];

export function carsToPasteText(rows: unknown[]): string {
  const cars = extractCarsFromRows(rows, { max: PHOTO_MAX_CARS });
  return cars.map((car) => `${car.mark} ${car.number}`).join("\n");
}

function carsToText(cars: Array<{ mark: string; number: string }> | undefined): string {
  return (cars || []).map((car) => `${car.mark} ${car.number}`).join("\n");
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
  result?: PhotoFindResponse;
};

function statusFromJob(job: PhotoJob | null): RunStatus | null {
  if (!job) return null;
  if (job.status === "running") {
    const progress = job.progress;
    const total = progress?.carTotal ?? job.carTotal ?? 0;
    const done = progress?.carsDone ?? 0;
    const eta = formatEtaSeconds(progress?.etaSeconds);
    return {
      kind: "running",
      carsDone: done,
      carTotal: total,
      carsWithImages: progress?.carsWithImages,
      etaSeconds: progress?.etaSeconds,
      message: total
        ? `Finding photos… ${done} of ${total} cars${eta ? ` · ${eta}` : ""}`
        : "Searching…",
    };
  }
  if (job.status === "error") {
    return { kind: "error", message: "Search failed — try again", detail: job.error || "" };
  }
  if (job.status === "done" && job.result) {
    const summary = summarizePhotoResult(job.result);
    return {
      kind: "done",
      carTotal: summary.carTotal,
      carsWithImages: summary.carsWithImages,
      notFoundCount: summary.notFoundCount || 0,
      result: job.result,
      message: `Found photos for ${summary.carsWithImages} of ${summary.carTotal} cars`,
    };
  }
  return null;
}

function tierBadgeClass(tier: RatedTier): string {
  switch (tier) {
    case "verified":
      return "border-emerald-500/50 bg-emerald-500/10 text-emerald-300";
    case "likely":
      return "border-amber-500/50 bg-amber-500/10 text-amber-200";
    case "unverified":
      return "border-dashed border-muted-foreground/60 text-muted-foreground";
    case "conflict":
      return "border-destructive/50 bg-destructive/10 text-destructive";
    case "unrated":
      return "border-border text-muted-foreground";
    default: {
      const neverTier: never = tier;
      return neverTier;
    }
  }
}

function statusBadgeClass(key: ReturnType<typeof carStatus>["key"]): string {
  switch (key) {
    case "verified":
      return "border-emerald-500/50 bg-emerald-500/10 text-emerald-300";
    case "likely":
      return "border-amber-500/50 bg-amber-500/10 text-amber-200";
    case "unverified":
      return "border-dashed border-muted-foreground/60 text-muted-foreground";
    case "conflict":
      return "border-destructive/50 bg-destructive/10 text-destructive";
    case "error":
      return "border-destructive/40 text-destructive";
    case "none":
    case "unrated":
      return "border-border text-muted-foreground";
    default: {
      const neverKey: never = key;
      return neverKey;
    }
  }
}

export default function PhotoFinderPanel({
  initialText = "",
  selectionNote = "",
  onClose,
}: {
  initialText?: string;
  selectionNote?: string;
  onClose?: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState(() => initialText || carsToText(currentPhotoJob()?.cars));
  const [isSearching, setIsSearching] = useState(() => hasRunningPhotoJob());
  const [runStatus, setRunStatus] = useState<RunStatus | null>(() => statusFromJob(currentPhotoJob()));
  const [activeIdx, setActiveIdx] = useState(0);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlNote, setDlNote] = useState("");
  const [toggles, setToggles] = useState<TierToggles>(DEFAULT_TIER_TOGGLES);
  const [openReasons, setOpenReasons] = useState<string | null>(null);
  const [flagFor, setFlagFor] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [fleetKeys, setFleetKeys] = useState<Set<string>>(() => new Set());
  const [hideSelectionNote, setHideSelectionNote] = useState(false);
  const searchingRef = useRef(hasRunningPhotoJob());
  const trackedJobIdRef = useRef<string | null>(null);
  const clearedRef = useRef(false);

  useEffect(() => {
    if (initialText) setText(initialText);
  }, [initialText]);

  useEffect(() => {
    return subscribePhotoJobs((snap) => {
      const running = snap.jobs.filter((job) => job.status === "running");
      if (running.length) {
        clearedRef.current = false;
        searchingRef.current = true;
        trackedJobIdRef.current = running[0].id;
        setIsSearching(true);
        setRunStatus(statusFromJob(running[0]));
        return;
      }
      searchingRef.current = false;
      setIsSearching(false);
      if (clearedRef.current) return;
      const finished = [...snap.jobs]
        .filter((job) => job.status === "done" || job.status === "error")
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0];
      if (!finished) return;
      trackedJobIdRef.current = finished.id;
      setRunStatus(statusFromJob(finished));
      if (finished.status === "done") setActiveIdx(0);
    });
  }, []);

  const resultId = runStatus?.kind === "done" ? runStatus.result?.job_id || runStatus.message : "";
  useEffect(() => {
    if (runStatus?.kind !== "done") return;
    const cars = (runStatus.result?.cars || []).map((car) => ({ mark: car.mark, number: car.number }));
    if (!cars.length) return;
    let cancel = false;
    apiRequest("POST", "/api/railcars/identities", { cars })
      .then((res) => res.json())
      .then((data: { cars?: Array<{ reporting_marks?: string; car_number?: string }> }) => {
        if (cancel) return;
        const keys = new Set<string>();
        for (const row of data.cars || []) {
          const ident = extractCarsFromRows([row], { max: 1 })[0];
          if (ident) keys.add(carKey(ident));
        }
        setFleetKeys(keys);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [resultId, runStatus]);

  const parsed = useMemo(() => parsePhotoCarList(text, PHOTO_MAX_CARS + 1), [text]);
  const rows = parsed.cars.slice(0, PHOTO_MAX_CARS);
  const truncated = parsed.cars.length > PHOTO_MAX_CARS;

  function handleSearch() {
    if (searchingRef.current || isSearching) return;
    if (!rows.length) return;
    clearedRef.current = false;
    searchingRef.current = true;
    setIsSearching(true);
    setHiddenKeys(new Set());
    setFleetKeys(new Set());
    setRunStatus({
      kind: "running",
      carsDone: 0,
      carTotal: rows.length,
      message: `Searching ${rows.length} car${rows.length === 1 ? "" : "s"} for photos…`,
    });
    const job = startPhotoJob({
      cars: rows,
      title: `Photo Search · ${rows.length} car${rows.length === 1 ? "" : "s"}`,
    });
    trackedJobIdRef.current = job.id;
  }

  function handleClear() {
    clearedRef.current = true;
    if (searchingRef.current && trackedJobIdRef.current) abortPhotoJob(trackedJobIdRef.current);
    clearPhotoResults();
    searchingRef.current = false;
    trackedJobIdRef.current = null;
    setIsSearching(false);
    setText("");
    setRunStatus(null);
    setActiveIdx(0);
    setDlBusy(false);
    setDlNote("");
    setHiddenKeys(new Set());
    setFleetKeys(new Set());
    setFlagFor(null);
    setOpenReasons(null);
    setHideSelectionNote(true);
  }

  const resultCars = runStatus?.result?.cars || [];
  const toggledCars = useMemo(() => {
    return resultCars
      .map((car) => ({
        ...car,
        images: (car.images || []).filter((img) => isImageVisible(img, toggles) && !hiddenKeys.has(imageIdentityKey(img) || `idx:${car.mark}:${car.number}`)),
      }))
      .filter((car) => (car.images || []).length > 0);
  }, [resultCars, toggles, hiddenKeys]);

  const outcomes = useMemo(() => splitPhotoOutcomes(resultCars), [resultCars]);
  const tierCounts = useMemo(() => countTiers(resultCars), [resultCars]);
  const zipItems = useMemo(() => {
    const hidden = hiddenKeys;
    return collectPhotoZipItems(resultCars).filter((img) => !hidden.has(imageIdentityKey(img)));
  }, [resultCars, hiddenKeys]);

  async function downloadAllPhotos() {
    if (!zipItems.length || dlBusy) return;
    setDlBusy(true);
    setDlNote("");
    try {
      const manifestCsv = buildPhotoManifestCsv(resultCars.map((car) => ({
        ...car,
        images: (car.images || []).filter((img) => !hiddenKeys.has(imageIdentityKey(img))),
      })));
      const { ok, errors } = await downloadImagesAsZip(zipItems, "railcar_photos.zip", {
        manifestCsv,
        fetchBlob: fetchPhotoBlob,
      });
      setDlNote(
        errors?.length
          ? `Downloaded ${ok} photo${ok === 1 ? "" : "s"}; ${errors.length} failed.`
          : `Downloaded ${ok} photo${ok === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setDlNote(err instanceof Error ? err.message : "Download failed — try again.");
    } finally {
      setDlBusy(false);
    }
  }

  async function copyMissList() {
    const lines = [...outcomes.misses, ...outcomes.errors].map((row) => {
      const links = row.links.map((link) => link.href).join(" ");
      return `${row.car.mark} ${row.car.number} — ${row.reason}${links ? `\n${links}` : ""}`;
    });
    const body = lines.join("\n");
    try {
      await navigator.clipboard.writeText(body);
      toast({ title: "Copied" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }

  function hideKey(key: string) {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  function showKey(key: string) {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  async function flagPhoto(car: PhotoCarResult, img: PhotoImage, reason: FlagReasonId) {
    const key = imageIdentityKey(img);
    if (!key) {
      toast({ title: "This photo can't be flagged yet" });
      return;
    }
    hideKey(key);
    setFlagFor(null);
    try {
      await apiRequest("POST", "/api/photo-search/flag", {
        mark: car.mark,
        number: car.number,
        image_key: key,
        picture_id: img.picture_id || img.meta?.picture_id || undefined,
        reason,
      });
      toast({ title: "Hidden for everyone." });
    } catch (err) {
      showKey(key);
      if (err instanceof ApiError && (err.status === 503 || err.body?.error === "flags_not_enabled")) {
        toast({ title: "Flagging isn't switched on yet" });
        return;
      }
      toast({
        title: "Could not flag photo",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    }
  }

  const selectedIdx = toggledCars.length ? Math.min(activeIdx, toggledCars.length - 1) : 0;
  const active = toggledCars[selectedIdx] || null;
  const pct = runStatus?.kind === "running" && (runStatus.carTotal || 0) > 0
    ? Math.min(100, Math.round((100 * (runStatus.carsDone || 0)) / (runStatus.carTotal || 1)))
    : null;
  const skipped = parsed.skippedCodes.length;

  return (
    <div className="flex flex-col gap-4 min-h-0 min-w-0 max-w-full">
      <div className="min-w-0">
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
            : `${rows.length} car${rows.length === 1 ? "" : "s"} ready${truncated ? ` (capped at ${PHOTO_MAX_CARS})` : ""}`}
          {!hideSelectionNote && selectionNote ? ` ${selectionNote}` : ""}
          {skipped > 0 ? ` Skipped ${skipped} non-car code${skipped === 1 ? "" : "s"}.` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
          disabled={!isSearching && !text && !runStatus}
          onClick={handleClear}
          data-testid="button-photo-search-clear"
        >
          <X className="h-4 w-4" />
          New search
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

      <div role="status" aria-live="polite" aria-atomic="true" aria-busy={isSearching || undefined}>
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
                <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}
        {runStatus?.kind === "done" && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{runStatus.message}</div>
                {dlNote && <div className="text-xs text-muted-foreground mt-1">{dlNote}</div>}
              </div>
              {zipItems.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={dlBusy}
                  onClick={downloadAllPhotos}
                  data-testid="button-download-all-photos"
                >
                  {dlBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {dlBusy ? "Downloading…" : `Download all photos (${zipItems.length})`}
                </Button>
              )}
            </div>
          </div>
        )}
        {runStatus?.kind === "error" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3">
            <div className="text-sm font-medium">Search failed — try again</div>
            {runStatus.detail && <div className="text-xs text-muted-foreground mt-1">{runStatus.detail}</div>}
          </div>
        )}
      </div>

      {runStatus?.kind === "done" && (tierCounts.verified + tierCounts.likely + tierCounts.unverified + tierCounts.conflict) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <ToggleChip
            pressed={toggles.showLikely}
            onClick={() => setToggles((prev) => ({ ...prev, showLikely: !prev.showLikely }))}
            testId="button-show-likely"
          >
            Show likely
          </ToggleChip>
          <ToggleChip
            pressed={toggles.showUnverified}
            onClick={() => setToggles((prev) => ({ ...prev, showUnverified: !prev.showUnverified }))}
            testId="button-show-unverified"
          >
            {`Show unverified (${tierCounts.unverified})`}
          </ToggleChip>
          <ToggleChip
            pressed={toggles.showConflicts}
            onClick={() => setToggles((prev) => ({ ...prev, showConflicts: !prev.showConflicts }))}
            testId="button-show-conflicts"
          >
            {`Show conflicts (${tierCounts.conflict})`}
          </ToggleChip>
        </div>
      )}

      {runStatus?.kind === "done" && toggledCars.length > 0 && (
        <div className="grid gap-3 min-h-0 min-w-0">
          <div className="flex flex-wrap gap-1.5" data-testid="photo-car-chips">
            {toggledCars.map((car, index) => (
              <button
                key={`${car.mark}_${car.number}`}
                type="button"
                onClick={() => setActiveIdx(index)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-mono whitespace-nowrap",
                  index === selectedIdx
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {car.mark} {car.number}
                <span className="ml-1 text-muted-foreground">({(car.images || []).length})</span>
              </button>
            ))}
          </div>
          {active && (
            <CarPhotos
              car={active}
              inFleet={fleetKeys.has(carKey(active))}
              openReasons={openReasons}
              flagFor={flagFor}
              onToggleReasons={(key) => setOpenReasons((prev) => (prev === key ? null : key))}
              onToggleFlag={(key) => setFlagFor((prev) => (prev === key ? null : key))}
              onFlag={(img, reason) => { void flagPhoto(active, img, reason); }}
            />
          )}
        </div>
      )}

      {runStatus?.kind === "done" && toggledCars.length === 0 && outcomes.misses.length === 0 && outcomes.errors.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No verified photos for this list. Try RR Picture Archives with the exact mark and number.
        </p>
      )}

      {runStatus?.kind === "done" && outcomes.misses.length > 0 && (
        <MissList
          title={`No verified photo (${outcomes.misses.length})`}
          rows={outcomes.misses}
          onCopy={copyMissList}
          testId="list-no-verified-photo"
        />
      )}
      {runStatus?.kind === "done" && outcomes.errors.length > 0 && (
        <MissList
          title={`Errors (${outcomes.errors.length})`}
          rows={outcomes.errors}
          onCopy={outcomes.misses.length === 0 ? copyMissList : undefined}
          testId="list-photo-errors"
        />
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">{PHOTO_DISCLAIMER}</p>
    </div>
  );
}

function ToggleChip({
  pressed,
  onClick,
  testId,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  testId: string;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs",
        pressed ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function CarPhotos({
  car,
  inFleet,
  openReasons,
  flagFor,
  onToggleReasons,
  onToggleFlag,
  onFlag,
}: {
  car: PhotoCarResult;
  inFleet: boolean;
  openReasons: string | null;
  flagFor: string | null;
  onToggleReasons: (key: string) => void;
  onToggleFlag: (key: string) => void;
  onFlag: (img: PhotoImage, reason: FlagReasonId) => void;
}) {
  const status = carStatus(car);
  const umler = formatUmlerLine(car.umler);
  const umlerMark = umlerIndicator(car);
  const page = car.best_source?.car_page || sourcePageUrl(car.images?.[0], car);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <div className="font-mono text-sm font-semibold">{car.mark} {car.number}</div>
        <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-medium", statusBadgeClass(status.key))}>
          {status.label}
        </span>
        {inFleet && (
          <span className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
            In RLMS fleet
          </span>
        )}
        {page && (
          <a
            href={page}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            RRPA <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {umler && (
        <p className="text-xs text-muted-foreground mb-2">
          {umlerMark === "match" ? "✓ " : ""}
          {umlerMark === "conflict" ? "⚠ " : ""}
          {umler}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(car.images || []).map((img, index) => {
          const key = imageIdentityKey(img) || `${car.mark}_${car.number}_${index}`;
          const tier = tierOf(img);
          const src = bestThumbUrl(img) || bestImageUrl(img);
          const href = bestImageUrl(img) || src;
          const meta = formatPhotoMeta(img.meta);
          const source = sourcePageUrl(img, car);
          return (
            <div
              key={key}
              className={cn(
                "rounded-md border bg-muted/20 overflow-hidden min-w-0",
                tier === "unverified" ? "border-dashed" : "border-border",
              )}
            >
              <a href={href || source || "#"} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] bg-muted/30">
                {src ? (
                  <img src={src} alt={`${car.mark} ${car.number} photo ${index + 1}`} className="w-full h-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-muted-foreground">No preview</span>
                )}
              </a>
              <div className="p-2 flex flex-col gap-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={cn("rounded-md border px-2 py-0.5 text-[11px] font-medium", tierBadgeClass(tier))}
                    onClick={() => onToggleReasons(key)}
                    data-testid="badge-photo-tier"
                  >
                    {tierLabel(tier)}
                  </button>
                  {source && (
                    <a href={source} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground">
                      Source
                    </a>
                  )}
                </div>
                {tier === "unverified" && (
                  <p className="text-[11px] text-muted-foreground">Unverified (search-engine match)</p>
                )}
                {meta && <p className="text-[11px] text-muted-foreground break-words">{meta}</p>}
                {openReasons === key && (
                  <ul className="text-[11px] text-muted-foreground list-disc pl-4">
                    {(img.reasons || []).length
                      ? (img.reasons || []).map((reason) => <li key={reason}>{reason}</li>)
                      : <li>No details.</li>}
                  </ul>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => onToggleFlag(key)}
                    data-testid="button-wrong-photo"
                  >
                    Wrong photo
                  </button>
                </div>
                {flagFor === key && (
                  <div className="flex flex-wrap gap-1.5">
                    {FLAG_REASONS.map((reason) => (
                      <button
                        key={reason.id}
                        type="button"
                        className="rounded-md border border-border px-2 py-0.5 text-[11px]"
                        onClick={() => onFlag(img, reason.id)}
                      >
                        {reason.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MissList({
  title,
  rows,
  onCopy,
  testId,
}: {
  title: string;
  rows: ReturnType<typeof splitPhotoOutcomes>["misses"];
  onCopy?: () => void;
  testId: string;
}) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {onCopy && (
          <Button type="button" size="sm" variant="outline" onClick={onCopy} data-testid="button-copy-no-photo">
            <Copy className="h-3.5 w-3.5" />
            Copy list
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={`${row.car.mark}_${row.car.number}_${row.reason}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
            <span className="font-mono">{row.car.mark} {row.car.number}</span>
            <span className="text-muted-foreground">{row.reason}</span>
            {row.links.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                {link.label}
              </a>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function fetchPhotoBlob(url: string): Promise<Blob> {
  try {
    const direct = await fetch(url);
    if (direct.ok) return direct.blob();
  } catch {
    /* The portal may not allow the browser to read the image. Retry through RLMS. */
  }
  const res = await apiRequest("GET", `/api/photo-search/image?url=${encodeURIComponent(url)}`);
  return res.blob();
}
