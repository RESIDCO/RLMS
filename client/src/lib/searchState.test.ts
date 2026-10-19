/* eslint-disable no-console */
/** Run: npx tsx client/src/lib/searchState.test.ts */

import {
  createSearchSid,
  decodeHash,
  emptySearchHash,
  encodeHash,
  isStaleSearchResults,
  loadSearchState,
  pasteFoundLabel,
  pasteShowsInactiveSeparately,
  resolveStoredSearch,
  saveSearchState,
  shouldRebootSearch,
  type SearchHashState,
  type StoredSearchResults,
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
ok(trip.decoded.fleet === true, "exact fleet match stays on by default");
const asText = roundTrip({ ...full, fleet: false });
ok(asText.encoded.includes("fleet=0") && asText.decoded.fleet === false, "fleet=0 round-trips");
ok(!shouldRebootSearch({ q: "J312", sid: "a" }, { q: "J312", sid: "a" }), "same q and sid does not reboot");
ok(shouldRebootSearch({ q: "J312", sid: "a" }, { q: "LO", sid: "" }), "a new top-bar query reboots");
ok(shouldRebootSearch({ q: "J312", sid: "a" }, { q: "J312", sid: "b" }), "Back to another sid reboots");
ok(pasteFoundLabel(38, 5, "active") === "38 found", "active paste found is the active count");
ok(pasteFoundLabel(43, 5, "all") === "43 found (incl. 5 inactive)", "showing inactive does not count those cars twice");
ok(pasteShowsInactiveSeparately("active") && !pasteShowsInactiveSeparately("all"), "inactive is separate only while it is hidden");

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

function stored(id: string, withRow: boolean): StoredSearchResults {
  return {
    mode: "text",
    rows: withRow ? [{ id: 1 }] : [],
    total: 1,
    summary: null,
    notFound: [],
    inactiveMatches: [],
    ambiguous: [],
    counts: null,
    match: null,
    truncated: false,
    rejectedRanges: [],
    expandedFrom: [],
  };
}

sessionStorage.clear();
for (const id of ["row0", "row1", "row2", "row3", "row4", "row5"]) {
  saveSearchState(id, {
    hash: emptySearchHash(id),
    pastedText: "",
    ids: [1],
    selection: [1],
    scrollY: 0,
    results: stored(id, true),
  });
}
ok((loadSearchState("row5")?.results?.rows.length ?? 0) === 1, "the newest sid keeps full rows");
ok((loadSearchState("row1")?.results?.rows.length ?? 0) === 1, "the newest five sids keep full rows");
ok((loadSearchState("row0")?.results?.rows.length ?? 0) === 0, "older sids drop full rows");
ok(loadSearchState("row0")?.ids.join(",") === "1" && loadSearchState("row0")?.selection.join(",") === "1", "older sids keep ids and selection");

sessionStorage.clear();
saveSearchState("old", { hash: emptySearchHash("old"), pastedText: "", ids: [9], selection: [], scrollY: 0, results: stored("old", true) });
saveSearchState("mid", { hash: emptySearchHash("mid"), pastedText: "", ids: [8], selection: [], scrollY: 0, results: stored("mid", true) });
let quotaThrows = 1;
const origSet = sessionStorage.setItem.bind(sessionStorage);
sessionStorage.setItem = (key: string, value: string) => {
  if (quotaThrows > 0 && key.indexOf("rlms-search:") === 0) {
    quotaThrows -= 1;
    const err = new Error("quota");
    err.name = "QuotaExceededError";
    throw err;
  }
  origSet(key, value);
};
saveSearchState("new", { hash: emptySearchHash("new"), pastedText: "", ids: [7], selection: [7], scrollY: 12, results: stored("new", true) });
sessionStorage.setItem = origSet;
ok(loadSearchState("old") == null, "a quota error drops the oldest saved search and retries");
ok(loadSearchState("new")?.ids.join(",") === "7" && loadSearchState("new")?.scrollY === 12, "the new search is saved after the retry");

function results(mode: "text" | "paste", rows: unknown[], total: number): StoredSearchResults {
  return {
    mode,
    rows,
    total,
    summary: { total },
    notFound: [],
    inactiveMatches: [],
    ambiguous: [],
    counts: { found: total },
    match: null,
    truncated: false,
    rejectedRanges: [],
    expandedFrom: [],
  };
}

sessionStorage.clear();
sessionStorage.setItem("rlms-search-paste", "WRONG PASTE");
const staleHash = emptySearchHash("stale-paste");
staleHash.paste = true;
staleHash.q = "";
saveSearchState("stale-paste", {
  hash: staleHash,
  pastedText: "TFOX 401-449",
  ids: [1],
  selection: [9, 10],
  scrollY: 640,
  results: results("paste", [], 38),
});
sessionStorage.setItem("rlms-search-paste", "WRONG PASTE");
const stale = resolveStoredSearch(loadSearchState("stale-paste"));
ok(isStaleSearchResults(loadSearchState("stale-paste")?.results), "no stored rows and a count above 0 is stale");
ok(stale != null && stale.useCache === false, "a stale entry is not a cache hit");
ok(stale?.query === "TFOX 401-449", "a stale entry re-runs its saved pasted text");
ok(stale?.query !== "WRONG PASTE", "a stale entry ignores the global paste key");
ok(stale?.selection.join(",") === "9,10" && stale?.scrollY === 640, "a stale entry keeps its selection and scroll");

const emptyHash = emptySearchHash("empty-hit");
emptyHash.q = "nomatch";
saveSearchState("empty-hit", {
  hash: emptyHash,
  pastedText: "",
  ids: [],
  selection: [4],
  scrollY: 12,
  results: results("text", [], 0),
});
const emptyHit = resolveStoredSearch(loadSearchState("empty-hit"));
ok(emptyHit?.useCache === true && emptyHit.query === "nomatch", "a real empty result stays cached and uses the saved query");
ok(emptyHit?.selection.join(",") === "4" && emptyHit?.scrollY === 12, "a cached empty result keeps selection and scroll");

const textHash = emptySearchHash("text-stale");
textHash.q = "hopper";
saveSearchState("text-stale", {
  hash: textHash,
  pastedText: "",
  ids: [],
  selection: [7],
  scrollY: 80,
  results: results("text", [], 12),
});
const textStale = resolveStoredSearch(loadSearchState("text-stale"));
ok(textStale?.useCache === false && textStale.query === "hopper", "a stale text search re-runs the saved query");
ok(textStale?.selection.join(",") === "7" && textStale.scrollY === 80, "a stale text search keeps selection and scroll");

sessionStorage.clear();
for (let i = 1; i <= 7; i += 1) {
  const hash = emptySearchHash(`slim${i}`);
  hash.q = `q${i}`;
  saveSearchState(`slim${i}`, {
    hash,
    pastedText: `q${i}`,
    ids: [i],
    selection: [i],
    scrollY: i * 10,
    results: results("text", [{ id: i }, { id: i + 100 }], 2),
  });
}
const oldest = resolveStoredSearch(loadSearchState("slim1"));
const second = resolveStoredSearch(loadSearchState("slim2"));
const newest = resolveStoredSearch(loadSearchState("slim7"));
ok((loadSearchState("slim1")?.results?.rows.length ?? -1) === 0 && (loadSearchState("slim2")?.results?.rows.length ?? -1) === 0, "searches older than five drop their rows");
ok(oldest?.useCache === false && oldest.query === "q1" && oldest.selection.join(",") === "1" && oldest.scrollY === 10, "the oldest trimmed search is re-run with its selection and scroll");
ok(second?.useCache === false && second.query === "q2" && second.scrollY === 20, "the second trimmed search is re-run too");
ok(newest?.useCache === true && (loadSearchState("slim7")?.results?.rows.length ?? 0) === 2, "a search that still has rows stays a cache hit");

const viewHash = emptySearchHash("viewsid");
viewHash.q = "J312";
viewHash.view = "12";
viewHash.openStop = "Abatement";
viewHash.program = "scrap";
viewHash.tag = "JSS";
viewHash.page = 2;
const viewRoundTrip = decodeHash("#" + encodeHash(viewHash));
ok(viewRoundTrip.view === "12" && viewRoundTrip.openStop === "Abatement" && viewRoundTrip.program === "scrap" && viewRoundTrip.tag === "JSS" && viewRoundTrip.page === 2 && viewRoundTrip.q === "J312", "view, stop, program, and tag survive the hash");
ok(shouldRebootSearch({ q: "J312", sid: "viewsid", view: "" }, { q: "J312", sid: "viewsid", view: "12" }), "opening a view reboots search");
saveSearchState("viewsid", {
  hash: viewHash,
  pastedText: "J312",
  ids: [1, 2, 3],
  selection: [1, 2, 3],
  scrollY: 40,
  results: results("text", [{ id: 1 }, { id: 2 }, { id: 3 }], 3),
  draft: { viewId: 12, dirty: true, density: "compact", panelCollapsed: true, cols: ["program_status"], order: ["marks", "car_number", "program_status"], widths: { marks: 90 } },
});
const restored = loadSearchState("viewsid");
ok(restored?.draft?.dirty === true && restored.draft.order[2] === "program_status" && restored.selection.join(",") === "1,2,3", "a dirty view draft comes back with the selection");

const pending = emptySearchHash("pending");
pending.q = "FL";
saveSearchState("pending", {
  hash: pending,
  pastedText: "FL",
  ids: [],
  selection: [],
  scrollY: 0,
  results: results("text", [], 3),
  ready: false,
});
ok(resolveStoredSearch(loadSearchState("pending")) == null, "an in-flight save is not treated as a finished cache");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
