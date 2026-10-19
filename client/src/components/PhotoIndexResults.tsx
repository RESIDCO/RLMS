import { useMemo, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import {
  buildIndexLinksCsv,
  indexPhotoKey,
  needsDeepSearch,
  photoCredit,
  type IndexCar,
  type IndexCarState,
  type IndexPhoto,
} from "@shared/photo-index";

type HiddenKey = string;

function triggerCsvDownload(csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a");
  const href = URL.createObjectURL(blob);
  anchor.href = href;
  anchor.download = "railcar_photo_links.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

function carStillNeedsDeepSearch(car: IndexCar, hidden: ReadonlySet<HiddenKey>): boolean {
  if (car.state === "album_pending") return false;
  const visible = car.photos.filter((photo) => !hidden.has(indexPhotoKey(photo)));
  if (car.state === "photos" && visible.length > 0) return false;
  if (visible.length > 0 && !needsDeepSearch(car.state)) return false;
  return car.needsDeepSearch || visible.length === 0;
}

export default function PhotoIndexResults({
  cars,
  onDeepSearch,
}: {
  cars: IndexCar[];
  onDeepSearch: (cars: Array<{ mark: string; number: string }>) => void;
}) {
  const [hidden, setHidden] = useState<Set<HiddenKey>>(() => new Set());
  const [lightbox, setLightbox] = useState<{ car: IndexCar; photo: IndexPhoto } | null>(null);

  const visibleCars = useMemo(() => {
    return cars.map((car) => ({
      ...car,
      photos: car.photos.filter((photo) => !hidden.has(indexPhotoKey(photo))),
    }));
  }, [cars, hidden]);

  const misses = visibleCars.filter((car) => carStillNeedsDeepSearch(car, hidden));

  function hidePhoto(photo: IndexPhoto) {
    const key = indexPhotoKey(photo);
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setLightbox((current) => (current && indexPhotoKey(current.photo) === key ? null : current));
    if (photo.picture_id) {
      void apiRequest("POST", "/api/photos/report-broken", { picture_id: photo.picture_id }).catch(() => {});
    }
  }

  function downloadCsv() {
    triggerCsvDownload(buildIndexLinksCsv(visibleCars));
  }

  const photoCount = visibleCars.reduce((sum, car) => sum + car.photos.length, 0);

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-3" data-testid="photo-index-results">
      <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 [&_button]:h-auto [&_button]:max-w-full [&_button]:whitespace-normal">
        <p className="text-sm font-medium">
          Index photos for {visibleCars.filter((car) => car.photos.length > 0).length} of {visibleCars.length} cars
        </p>
        {photoCount > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={downloadCsv} data-testid="button-download-photo-links">
            <Download className="h-4 w-4" />
            Download links (CSV)
          </Button>
        )}
        {misses.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onDeepSearch(misses.map((car) => ({ mark: car.mark, number: car.number })))}
            data-testid="button-deep-search-all"
          >
            {`Deep search all misses (${misses.length})`}
          </Button>
        )}
      </div>

      {visibleCars.map((car) => (
        <IndexCarBlock
          key={`${car.mark}_${car.number}`}
          car={car}
          needsSearch={carStillNeedsDeepSearch(car, hidden)}
          onDeepSearch={() => onDeepSearch([{ mark: car.mark, number: car.number }])}
          onOpen={(photo) => setLightbox({ car, photo })}
          onBroken={hidePhoto}
        />
      ))}

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${lightbox.car.mark} ${lightbox.car.number}`}
          onClick={() => setLightbox(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-3xl min-w-0 flex-col gap-3 overflow-auto rounded-lg bg-card p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={lightbox.photo.image_url || lightbox.photo.thumb_url}
              alt={lightbox.photo.caption || `${lightbox.car.mark} ${lightbox.car.number}`}
              referrerPolicy="no-referrer"
              className="max-h-[70vh] w-full bg-muted/30 object-contain"
              onError={(event) => {
                const img = event.currentTarget;
                if (img.dataset.fallback === "1" || !lightbox.photo.thumb_url) {
                  hidePhoto(lightbox.photo);
                  return;
                }
                img.dataset.fallback = "1";
                img.src = lightbox.photo.thumb_url;
              }}
            />
            <p className="text-sm">{photoCredit(lightbox.photo.photographer)}</p>
            {lightbox.photo.picture_url && (
              <a
                href={lightbox.photo.picture_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                View on RRPA ↗
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setLightbox(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IndexCarBlock({
  car,
  needsSearch,
  onDeepSearch,
  onOpen,
  onBroken,
}: {
  car: IndexCar;
  needsSearch: boolean;
  onDeepSearch: () => void;
  onOpen: (photo: IndexPhoto) => void;
  onBroken: (photo: IndexPhoto) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex w-full min-w-0 flex-wrap items-center gap-2">
        <h3 className="font-mono text-sm font-semibold">{car.mark} {car.number}</h3>
        <StateNote state={car.state} />
        {needsSearch && (
          <Button type="button" size="sm" variant="outline" onClick={onDeepSearch} data-testid={`button-deep-search-${car.mark}-${car.number}`}>
            Deep search
          </Button>
        )}
      </div>
      <CarBody car={car} onOpen={onOpen} onBroken={onBroken} />
    </section>
  );
}

function StateNote({ state }: { state: IndexCarState }) {
  switch (state) {
    case "photos":
      return null;
    case "album_pending":
      return <span className="text-xs text-muted-foreground">Indexing on RRPA…</span>;
    case "no_album":
    case "not_indexed":
    case "fallback":
      return null;
    default: {
      const neverState: never = state;
      return neverState;
    }
  }
}

function CarBody({
  car,
  onOpen,
  onBroken,
}: {
  car: IndexCar;
  onOpen: (photo: IndexPhoto) => void;
  onBroken: (photo: IndexPhoto) => void;
}) {
  switch (car.state) {
    case "album_pending":
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {car.albums.map((album) => (
            <a
              key={album.album_url}
              href={album.album_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              Photos on RRPA ↗
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ))}
        </div>
      );
    case "photos":
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {car.photos.map((photo) => (
            <PhotoTile key={indexPhotoKey(photo)} car={car} photo={photo} onOpen={onOpen} onBroken={onBroken} />
          ))}
        </div>
      );
    case "no_album":
    case "not_indexed":
    case "fallback":
      return null;
    default: {
      const neverState: never = car.state;
      return neverState;
    }
  }
}

function PhotoTile({
  car,
  photo,
  onOpen,
  onBroken,
}: {
  car: IndexCar;
  photo: IndexPhoto;
  onOpen: (photo: IndexPhoto) => void;
  onBroken: (photo: IndexPhoto) => void;
}) {
  const label = `${car.mark} ${car.number}`;
  return (
    <figure className="min-w-0 overflow-hidden rounded-md border border-border bg-muted/20" data-testid="photo-index-tile">
      <div className="relative aspect-[4/3] bg-muted/30">
        {photo.picture_url ? (
          <a href={photo.picture_url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
            <TileImage carLabel={label} photo={photo} onBroken={onBroken} />
          </a>
        ) : (
          <TileImage carLabel={label} photo={photo} onBroken={onBroken} />
        )}
        <button
          type="button"
          className="absolute bottom-1.5 right-1.5 z-10 rounded-md border border-border bg-card/90 px-2 py-0.5 text-[11px]"
          onClick={() => onOpen(photo)}
        >
          Enlarge
        </button>
      </div>
      <figcaption className="px-2 py-1.5 text-[11px] text-muted-foreground break-words">
        {photo.picture_url ? (
          <a href={photo.picture_url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
            {photoCredit(photo.photographer)}
          </a>
        ) : (
          photoCredit(photo.photographer)
        )}
      </figcaption>
    </figure>
  );
}

function TileImage({
  carLabel,
  photo,
  onBroken,
}: {
  carLabel: string;
  photo: IndexPhoto;
  onBroken: (photo: IndexPhoto) => void;
}) {
  return (
    <img
      src={photo.thumb_url}
      alt={photo.caption || carLabel}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="h-full w-full object-cover"
      onError={() => onBroken(photo)}
    />
  );
}
