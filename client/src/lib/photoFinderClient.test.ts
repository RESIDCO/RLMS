/* eslint-disable no-console */
/**
 * Run: npx tsx client/src/lib/photoFinderClient.test.ts
 */
import {
  PHOTO_MANIFEST_COLUMNS,
  DEFAULT_TIER_TOGGLES,
  buildPhotoManifestCsv,
  carStatus,
  imagesForZip,
  isImageVisible,
  noPhotoReason,
  parsePhotoCarList,
  selectionCapNote,
  tierOf,
  type PhotoImage,
} from "./photoFinderClient";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const padded = parsePhotoCarList("SOO 0600612");
ok(padded.cars.length === 1, "padded line parses one car");
ok(padded.cars[0]?.mark === "SOO" && padded.cars[0]?.number === "600612", "leading zeros are stripped");
ok(padded.cars[0]?.number_raw === "0600612", "raw padded number is kept");
ok(parsePhotoCarList("SOO0600612").cars[0]?.number === "600612", "concat form strips padding");

const skips = parsePhotoCarList("OL1248\nFL99\nEA1001\nSOO 600612");
ok(skips.cars.length === 1 && skips.cars[0]?.mark === "SOO" && skips.cars[0]?.number === "600612", "real car survives code lines");
ok(skips.skippedCodes.length === 3, "three compact codes are skipped");
ok(skips.skippedCodes.join(",") === "OL1248,FL99,EA1001", "skipped codes keep OL/FL/EA form");

const sheet = [
  "Reporting Mark,Car Number,Location,Code",
  "SOO,0600612,Saint Paul,OL4412",
  "BNSF\t546045\tDenver\tFL12",
  "HLTX,6026,FBC,2005",
  "EA1001",
].join("\n");
const parsedSheet = parsePhotoCarList(sheet);
ok(parsedSheet.cars.map((car) => `${car.mark} ${car.number}`).join("|") === "SOO 600612|BNSF 546045|HLTX 6026", "seller sheet columns");
ok(parsedSheet.cars[0]?.number_raw === "0600612", "seller sheet keeps the padded number");
ok(!parsedSheet.cars.some((car) => car.mark === "FBC" || car.number === "2005"), "mech spec and year are not cars");
ok(parsedSheet.skippedCodes.includes("OL4412") && parsedSheet.skippedCodes.includes("FL12") && parsedSheet.skippedCodes.includes("EA1001"), "seller-sheet codes are skipped");

ok(selectionCapNote(2000) === "First 500 of 2,000 selected", "cap note names the first 500");
ok(selectionCapNote(12) === "", "short selections have no cap note");

const images: PhotoImage[] = [
  { tier: "verified", image_key: "v" },
  { tier: "likely", image_key: "l" },
  { tier: "unverified", image_key: "u" },
  { tier: "conflict", image_key: "c" },
  { title: "legacy" },
];
const defaults = images.filter((img) => isImageVisible(img, DEFAULT_TIER_TOGGLES)).map((img) => tierOf(img));
ok(defaults.join(",") === "verified,likely,unrated", "likely stays on; unverified and conflict stay off");
ok(!defaults.includes("unverified") && !defaults.includes("conflict"), "hidden tiers are not shown by default");
const unverifiedOn = images.filter((img) => isImageVisible(img, { ...DEFAULT_TIER_TOGGLES, showUnverified: true })).map((img) => tierOf(img));
ok(unverifiedOn.includes("unverified"), "unverified toggle reveals that tier");
const likelyOff = images.filter((img) => isImageVisible(img, { ...DEFAULT_TIER_TOGGLES, showLikely: false })).map((img) => tierOf(img));
ok(!likelyOff.includes("likely") && likelyOff.includes("verified"), "likely can be turned off without hiding verified");
const conflictsOn = images.filter((img) => isImageVisible(img, { ...DEFAULT_TIER_TOGGLES, showConflicts: true })).map((img) => tierOf(img));
ok(conflictsOn.includes("conflict"), "conflict toggle reveals that tier");

ok(tierOf({ title: "legacy" }) === "unrated", "missing tier is unrated");
ok(tierOf({}) === "unrated", "empty image is unrated");
ok(isImageVisible({ title: "legacy" }), "unrated images stay visible");
const legacy = carStatus({ mark: "SOO", number: "1", images: [{ title: "side" }] });
ok(legacy.key === "unrated" && legacy.label === "Unrated", "legacy result is labeled Unrated");
ok(legacy.key !== "verified", "legacy result is not called verified");

const zipTiers = imagesForZip(images).map((img) => tierOf(img));
ok(zipTiers.join(",") === "verified,likely,unrated", "zip keeps verified, likely, and unrated");

const csv = buildPhotoManifestCsv([
  {
    mark: "SOO",
    number: "600612",
    umler: { found: true, type_label: "Center-beam flat (FBC)", built_year: 2005 },
    images: [
      {
        tier: "verified",
        confidence: 95,
        meta: {
          caption: "eastbound",
          photo_date: "2016-04-23",
          location: "Saint Paul, MN",
          photographer: "Andrew Goblirsch",
          source_page: "https://www.rrpicturearchives.net/pictures/2841059",
        },
      },
      { tier: "unverified", confidence: 10, meta: { caption: "search hit" } },
      { tier: "conflict", confidence: 40 },
    ],
  },
]);
const csvLines = csv.split("\n");
ok(csvLines[0] === PHOTO_MANIFEST_COLUMNS.join(","), "manifest columns");
ok(csvLines.length === 2, "manifest includes verified only from this car");
ok(csvLines[1]?.startsWith("SOO 600612,verified,95,"), "manifest row starts with car, tier, confidence");
ok(csv.includes("Apr 23, 2016"), "manifest formats the photo date");
ok(csv.includes('"Saint Paul, MN"'), "manifest quotes a location that contains a comma");
ok(csv.includes("Andrew Goblirsch"), "manifest includes the photographer");
ok(csv.includes("Center-beam flat (FBC)"), "manifest includes the UMLER type");
ok(csv.includes(",2005"), "manifest includes the built year");
ok(!csv.includes("unverified") && !csv.includes("conflict") && !csv.includes("search hit"), "unverified and conflict stay out of the manifest");

ok(noPhotoReason({ mark: "SOO", number: "600611", status: "none", images: [] }) === "none", "empty car is none");
ok(noPhotoReason({ mark: "SOO", number: "600611", status: "unverified_only", images: [{ tier: "unverified" }] }) === "unverified only", "unverified-only reason");
ok(noPhotoReason({ mark: "BNSF", number: "1", status: "conflict", images: [{ tier: "conflict" }] }) === "conflict", "conflict reason");
ok(noPhotoReason({ mark: "SOO", number: "1", status: "error", image_error: "timeout", images: [] }) === "error: timeout", "timeout stays an error");
ok(noPhotoReason({ mark: "SOO", number: "600612", status: "verified", images: [{ tier: "verified" }] }) === null, "verified car is not a miss");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
