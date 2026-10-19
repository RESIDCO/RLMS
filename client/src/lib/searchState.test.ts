/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/searchState.test.ts */

import {
  createSearchSid,
  decodeHash,
  emptySearchHash,
  encodeHash,
  loadSearchState,
  saveSearchState,
  type SearchHashState,
} from "./searchState";

const mem = new Map<string, string>();
const memoryStorage: Storage = {
  get length() {
    return mem.size;
  },
  clear() {
    mem.clear();
  },
  getItem(key: string) {
    return mem.has(key) ? mem.get(key)! : null;
  },
  key(index: number) {
    return [...mem.keys()][index] ?? null;
  },
  removeItem(key: string) {
    mem.delete(key);
  },
  setItem(key: string, value: string) {
    mem.set(key, value);
  },
};
(globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage;

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function roundTrip(state: SearchHashState) {
  const encoded = encodeHash(state);
  const decoded = decodeHash("#" + encoded);
  return { encoded, decoded };
}

const full = emptySearchHash("sid1");
full.q = "J312";
full.cars = false;
full.leases = true;
full.carData = true;
full.type = "J312";
full.mech = "LO";
full.aar = "HTS";
full.entity = "Main";
full.status = "Leased";
full.active = "all";
full.sort = "id";
full.dir = "desc";
full.page = 2;
full.ps = "all";

const trip = roundTrip(full);
ok(trip.encoded.startsWith("/search?"), "hash path is /search");
ok(trip.decoded.q === "J312", "q round-trips");
ok(trip.decoded.cars === false && trip.decoded.leases === true && trip.decoded.carData === true, "scope flags round-trip");
ok(trip.decoded.type === "J312" && trip.decoded.mech === "LO" && trip.decoded.aar === "HTS", "filters round-trip");
ok(trip.decoded.entity === "Main" && trip.decoded.status === "Leased" && trip.decoded.active === "all", "entity status active round-trip");
ok(trip.decoded.sort === "id" && trip.decoded.dir === "desc", "sort round-trips");
ok(trip.decoded.page === 2 && trip.decoded.ps === "all", "page and page size round-trip");
ok(trip.decoded.sid === "sid1", "sid round-trips");

const legacy = decodeHash("#/search?q=graymont");
ok(legacy.q === "graymont" && legacy.page === 1 && legacy.ps === 75 && legacy.active === "active", "old #/search?q= links still decode");
ok(legacy.cars && legacy.leases && !legacy.carData, "old links keep the default scope");

const defaults = roundTrip(emptySearchHash("abc"));
ok(defaults.encoded === "/search?sid=abc", "defaults stay out of the hash except sid");
ok(decodeHash(defaults.encoded).sort === "car_number" && decodeHash(defaults.encoded).dir === "asc", "default sort decodes");

const pasted = emptySearchHash("paste");
pasted.q = "TFOX 401\nTFOX 402";
const pasteHash = encodeHash(pasted);
ok(pasteHash.includes("paste=1") && !pasteHash.includes("TFOX"), "multiline paste stays out of the hash");
ok(decodeHash(pasteHash).q === pasted.q, "paste=1 reloads the text from sessionStorage");

const sid = createSearchSid();
saveSearchState(sid, {
  hash: full,
  pastedText: "TFOX 401-449",
  ids: [1, 2, 3],
  selection: [2, 3],
  scrollY: 480,
  results: {
    mode: "text",
    rows: [{ id: 2 }],
    total: 199,
    summary: { total: 199 },
    notFound: [],
    inactiveMatches: [],
    ambiguous: [],
    counts: { railcars: 199 },
    match: { kind: "car_type" },
    truncated: false,
    rejectedRanges: [],
    expandedFrom: [],
  },
});
const loaded = loadSearchState(sid);
ok(loaded?.selection.join(",") === "2,3", "selection is stored");
ok(loaded?.scrollY === 480, "scrollY is stored");
ok(loaded?.pastedText === "TFOX 401-449", "pasted text is stored");
ok(Array.isArray(loaded?.results?.rows) && loaded?.results?.total === 199, "cached results are stored");
ok(loaded?.ids.join(",") === "1,2,3", "resolved ids are stored");

for (let i = 0; i < 25; i += 1) {
  saveSearchState(`s${i}`, {
    hash: emptySearchHash(`s${i}`),
    pastedText: "",
    ids: [],
    selection: [],
    scrollY: 0,
    results: null,
  });
}
ok(loadSearchState("s0") == null, "older than the last 20 sids are dropped");
ok(loadSearchState("s24") != null && loadSearchState("s5") != null, "the newest 20 sids are kept");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
