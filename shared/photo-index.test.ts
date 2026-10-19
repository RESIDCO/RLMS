/* eslint-disable no-console */
/**
 * Run: npx tsx shared/photo-index.test.ts
 */
import {
  INDEX_CSV_COLUMNS,
  PHOTO_INDEX_CHUNK,
  PHOTO_SEARCH_MODE_KEY,
  buildIndexLinksCsv,
  carsNeedingDeepSearch,
  effectivePhotoSearchMode,
  isActiveFleetCar,
  mapIndexLookup,
  photoCredit,
  planWarmRequests,
  resolveIndexSearch,
  type IndexCarKey,
} from "./photo-index";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const requested: IndexCarKey[] = [
  { mark: "SOO", number: "600612" },
  { mark: "BNSF", number: "546059" },
  { mark: "HLTX", number: "6026" },
  { mark: "NDYX", number: "360129" },
  { mark: "GATX", number: "62487" },
  { mark: "NS", number: "148098" },
];

const lookup = {
  cars: [
    {
      mark: "soo",
      number: "0600612",
      state: "photos",
      indexed_at: "2026-10-18T00:00:00Z",
      albums: [{ album_url: "https://www.rrpicturearchives.net/rsPicture.aspx?id=1", title: "SOO 600612", photo_count: 2 }],
      photos: [
        {
          picture_id: 2841059,
          thumb_url: "https://www.rrpicturearchives.net/picturefiles/12/thumbnails/a.jpg",
          image_url: "https://www.rrpicturearchives.net/picturefiles/12/a.jpg",
          picture_url: "https://www.rrpicturearchives.net/showPicture.aspx?id=2841059",
          caption: "eastbound",
          photographer: "Andrew Goblirsch",
          photo_date: "2016-04-23",
          location: "Saint Paul, MN",
          verified: true,
        },
        {
          thumb_url: "https://www.rrpicturearchives.net/picturefiles/12/thumbnails/b.jpg",
          image_url: "https://www.rrpicturearchives.net/picturefiles/12/b.jpg",
          picture_url: "https://www.rrpicturearchives.net/showPicture.aspx?id=2841060",
          photographer: "  ",
          photo_date: "2017-01-02",
        },
        {
          thumb_url: "https://evil.example/a.jpg",
          image_url: "https://evil.example/a.jpg",
          picture_url: "https://evil.example/a",
          photographer: "Nope",
        },
      ],
    },
    {
      mark: "BNSF",
      number: "546059",
      state: "album_pending",
      albums: [{ album_url: "https://www.rrpicturearchives.net/rsPicture.aspx?id=2", title: "BNSF 546059", photo_count: 4 }],
      photos: [],
    },
    { mark: "HLTX", number: "6026", state: "no_album", albums: [], photos: [] },
    { mark: "NDYX", number: "360129", state: "not_indexed", albums: [], photos: [] },
    { mark: "GATX", number: "62487", state: "fallback", albums: [], photos: [] },
  ],
};

const view = mapIndexLookup(lookup, requested);
ok(view.fallback === false, "successful lookup is not a fallback");
if (!view.fallback) {
  const [soo, bnsf, hltx, ndyx, gatx, ns] = view.cars;
  ok(soo?.mark === "SOO" && soo.number === "600612", "leading zeros are stripped");
  ok(soo?.state === "photos" && soo.needsDeepSearch === false, "cars with photos do not need deep search");
  ok(soo?.photos.length === 2, "unsafe image hosts are dropped");
  ok(soo?.photos[0]?.picture_id === "2841059", "picture id is kept");
  ok(soo?.photos[1]?.picture_id === "2841060", "picture id is read from the RRPA url");
  ok(photoCredit(soo?.photos[0]?.photographer) === "Photo: Andrew Goblirsch · RRPA", "credit uses the photographer");
  ok(photoCredit(soo?.photos[1]?.photographer) === "Photo: RRPA contributor · RRPA", "blank photographer uses the contributor credit");
  ok(soo?.photos[0]?.thumb_url.includes("/thumbnails/"), "thumb url is passed through");
  ok(bnsf?.state === "album_pending" && bnsf.needsDeepSearch === false, "album_pending is still indexing");
  ok(bnsf?.albums[0]?.album_url.startsWith("https://www.rrpicturearchives.net/"), "album link is kept");
  ok(hltx?.state === "no_album" && hltx.needsDeepSearch, "no_album offers deep search");
  ok(ndyx?.state === "not_indexed" && ndyx.needsDeepSearch, "not_indexed offers deep search");
  ok(gatx?.state === "fallback" && gatx.needsDeepSearch, "per-car fallback offers deep search");
  ok(ns?.state === "not_indexed" && ns.needsDeepSearch, "a car missing from the index is not_indexed");
  ok(carsNeedingDeepSearch(view.cars).map((car) => car.mark).join(",") === "HLTX,NDYX,GATX,NS", "deep search misses");

  const csv = buildIndexLinksCsv(view.cars);
  const lines = csv.split("\n");
  ok(lines[0] === INDEX_CSV_COLUMNS.join(","), "csv columns");
  ok(lines.length === 3, "csv has one row per index photo");
  ok(lines[1] === "SOO,600612,https://www.rrpicturearchives.net/showPicture.aspx?id=2841059,https://www.rrpicturearchives.net/picturefiles/12/a.jpg,Andrew Goblirsch,2016-04-23", "csv row");
  ok(!csv.includes("evil.example"), "csv omits rejected hosts");
  ok(!csv.includes("zip"), "csv is links only");
}

const quoted = buildIndexLinksCsv([
  {
    mark: "SOO",
    number: "1",
    state: "photos",
    albums: [],
    indexed_at: null,
    needsDeepSearch: false,
    photos: [{
      picture_id: "1",
      thumb_url: "https://www.rrpicturearchives.net/picturefiles/1/thumbnails/a.jpg",
      image_url: "https://www.rrpicturearchives.net/picturefiles/1/a.jpg",
      picture_url: "https://www.rrpicturearchives.net/pictures/1",
      caption: "",
      photographer: "Gob, Andy",
      photo_date: "2016-04-23",
      location: "",
      verified: false,
    }],
  },
]);
ok(quoted.includes('"Gob, Andy"'), "csv quotes a photographer that contains a comma");

ok(mapIndexLookup({ fallback: true }, requested).fallback === true, "fallback flag uses the legacy search");
ok(mapIndexLookup(null, requested).fallback === true, "empty body uses the legacy search");
ok(mapIndexLookup({ error: "down" }, requested).fallback === true, "a body with no car list uses the legacy search");

const planned = await resolveIndexSearch(requested, async () => lookup);
ok(planned.kind === "index" && planned.kind === "index" && planned.view.cars[0]?.photos.length === 2, "mocked lookup maps to index photos");
const legacyPlan = await resolveIndexSearch(requested, async () => ({ fallback: true }));
ok(legacyPlan.kind === "legacy", "fallback response plans the legacy search");
const thrown = await resolveIndexSearch(requested, async () => {
  throw new Error("timeout");
});
ok(thrown.kind === "legacy", "a thrown lookup plans the legacy search");

ok(PHOTO_SEARCH_MODE_KEY === "rlms.photoSearchMode", "classic toggle storage key");
ok(effectivePhotoSearchMode(undefined, null) === "index", "index is the default");
ok(effectivePhotoSearchMode("index", null) === "index", "explicit index stays index");
ok(effectivePhotoSearchMode("legacy", null) === "legacy", "build flag legacy wins");
ok(effectivePhotoSearchMode("index", "legacy") === "legacy", "classic toggle selects legacy");
ok(effectivePhotoSearchMode("legacy", "index") === "legacy", "build flag beats a stored index value");

ok(isActiveFleetCar({ status: "Active/In-Service", active: true }), "active in service is warmable");
ok(!isActiveFleetCar({ status: "Off-Lease", active: true }), "off-lease is not warmable");
ok(!isActiveFleetCar({ status: "Inactive", active: false }), "inactive is not warmable");
ok(!isActiveFleetCar({ status: "Active/In-Service", active: false }), "inactive membership is not warmable");
ok(!isActiveFleetCar({ status: "Storage", active: true }), "storage is not the active fleet");

const warmRows = [
  { reporting_marks: "SOO", car_number: "0600612", status: "Active/In-Service", active: true },
  { reporting_marks: "BNSF", car_number: "546059", status: "Off-Lease", active: false },
  { reporting_marks: "NDYX", car_number: "360129", status: "Inactive", active: false },
  { reporting_marks: "HLTX", car_number: "6025", status: "Storage", active: true },
  { reporting_marks: "NS", car_number: "148098", status: "Active/In-Service", active: true },
  ...Array.from({ length: 500 }, (_, i) => ({
    reporting_marks: "GATX",
    car_number: String(1000 + i),
    status: "Active/In-Service",
    active: true,
  })),
];
const warm = planWarmRequests(warmRows);
ok(warm.send[0]?.mark === "SOO" && warm.send[0]?.number === "600612", "warm list normalizes the active car");
ok(!warm.send.some((car) => car.mark === "BNSF" || car.mark === "NDYX" || car.mark === "HLTX"), "warm list drops off-lease, inactive, and other statuses");
ok(warm.chunks.length === 2 && warm.chunks[0]?.length === PHOTO_INDEX_CHUNK && warm.chunks[1]?.length === 2, "warm list is chunked at 500");
ok(warm.dropped === 3, "three non-active rows are dropped");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
