/** Run: npx tsx shared/lineage-identity.test.ts */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { splitCarNumber } from "./residco-import";
import {
  LINEAGE_BARE_NUMBER_LIMIT,
  LINEAGE_MATCH_CAP,
  LINEAGE_RANGE_WIDTH_CAP,
  LINEAGE_TOO_MANY_MESSAGE,
  parseLineageQuery,
  resolveLineageIdentities,
  type LineageCarRow,
  type LineageHistoryRow,
  type LineageIdentityResult,
} from "./lineage-identity";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function ids(result: LineageIdentityResult): string {
  return result.ids.join(",");
}

function remarkedSeries(count: number, start: number, idStart = 1): { cars: LineageCarRow[]; history: LineageHistoryRow[] } {
  const cars: LineageCarRow[] = [];
  const history: LineageHistoryRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = idStart + i;
    const number = String(start + i);
    cars.push({ id, reporting_marks: "OFOX", car_initial: "OFOX", car_number: number });
    history.push({
      railcar_id: id,
      old_car_initial: "KCS",
      old_car_number: number,
      new_car_initial: "OFOX",
      new_car_number: number,
    });
  }
  return { cars, history };
}

function sparseFleet(): { cars: LineageCarRow[]; history: LineageHistoryRow[]; idOf: (number: string) => number } {
  const numbers = ["310100", "310101", "310102", "310110", "310450"];
  for (let n = 310200; numbers.length < 60; n += 1) numbers.push(String(n));
  const cars: LineageCarRow[] = [];
  const history: LineageHistoryRow[] = [];
  numbers.forEach((number, index) => {
    const id = index + 1;
    cars.push({ id, reporting_marks: "OFOX", car_initial: "OFOX", car_number: number });
    history.push({
      railcar_id: id,
      old_car_initial: "KCS",
      old_car_number: number,
      new_car_initial: "OFOX",
      new_car_number: number,
    });
  });
  cars.push({ id: 9000, reporting_marks: "KCS", car_initial: "KCS", car_number: "000001" });
  cars.push({ id: 9100, reporting_marks: "TILX", car_initial: "TILX", car_number: "1310100" });
  return {
    cars,
    history,
    idOf: (number: string) => numbers.indexOf(number) + 1,
  };
}

const fleet = sparseFleet();
const find = (raw: string) => resolveLineageIdentities(raw, fleet.cars, fleet.history);

ok(LINEAGE_BARE_NUMBER_LIMIT === 80, "bare-number partial matches stay capped at 80");
ok(LINEAGE_MATCH_CAP === 200, "ranges and bare marks cap at 200 matched cars");
ok(LINEAGE_RANGE_WIDTH_CAP === 100_000, "only a typo-sized span is rejected up front");
ok(LINEAGE_BARE_NUMBER_LIMIT !== LINEAGE_MATCH_CAP, "the bare-number limit is not the match cap");
ok(/too many/i.test(LINEAGE_TOO_MANY_MESSAGE) && /narrow it/i.test(LINEAGE_TOO_MANY_MESSAGE), "the cap message says to narrow it");

const glued = splitCarNumber("OFOX 310100 OFOX 310110");
ok(glued.car_number.includes("OFOX"), "splitting the whole list glues the second mark into the number");

const spaced = parseLineageQuery("OFOX 310100 OFOX 310110");
ok(spaced.message == null && spaced.identities.length === 2, "a space-separated list is two cars");
ok(spaced.identities[0]?.kind === "car" && spaced.identities[0].number === "310100" && spaced.identities[0].mark === "OFOX", "the first mark stays with 310100");
ok(spaced.identities[1]?.kind === "car" && spaced.identities[1].number === "310110" && spaced.identities[1].mark === "OFOX", "the second mark stays with 310110");
ok(ids(find("OFOX 310100 OFOX 310110")) === `${fleet.idOf("310100")},${fleet.idOf("310110")}`, "OFOX 310100 OFOX 310110 resolves both remarked cars");
ok(ids(find("ofox 310100 ofox 310110")) === `${fleet.idOf("310100")},${fleet.idOf("310110")}`, "spacing and case still pair mark and number");

ok(parseLineageQuery("OFOX310100").identities[0]?.kind === "car", "OFOX310100 is one car");
ok(ids(find("OFOX310100")) === String(fleet.idOf("310100")), "a glued mark and number still resolves");
ok(ids(find("OFOX 310100")) === String(fleet.idOf("310100")), "a single mark and number still resolves");
ok(ids(find("KCS 310100")) === String(fleet.idOf("310100")), "an old mark and number resolves the remarked car");
ok(!find("KCS 310100").ids.includes(fleet.idOf("310110")), "old mark plus number does not take the neighbor");

const pair = `${fleet.idOf("310100")},${fleet.idOf("310110")}`;
ok(ids(find("OFOX 310100, OFOX 310110")) === pair, "a comma list still resolves");
ok(ids(find("OFOX 310100,OFOX310110")) === pair, "a comma list without spaces still resolves");
ok(ids(find("OFOX 310100\nOFOX 310110")) === pair, "a newline list still resolves");
ok(ids(find("OFOX 310100; OFOX 310110")) === pair, "a semicolon list resolves");

const bareNumber = find("310100");
ok(bareNumber.message == null && bareNumber.ids.includes(fleet.idOf("310100")), "a bare number still resolves");
ok(bareNumber.ids.includes(9100), "a bare number still substring-matches");
ok(!find("310100-310100").ids.includes(9100), "a one-number range stays on same-length numbers");
ok(ids(find("310450")) === String(fleet.idOf("310450")), "a bare number in the remarked series resolves that car");

const span = parseLineageQuery("310100-310899");
ok(span.message == null && span.identities[0]?.kind === "range" && span.identities[0].low === "310100" && span.identities[0].high === "310899", "310100-310899 is a range, not a width rejection");
const sparse = find("310100-310899");
ok(sparse.message == null && sparse.ids.length === 60 && sparse.ids[0] === 1 && sparse.ids[59] === 60, "310100-310899 over 60 sparse cars returns those 60");
ok(!sparse.ids.includes(9000) && !sparse.ids.includes(9100), "the range skips a current-only KCS car and a different-length number");

const longer = resolveLineageIdentities("310100-310899", fleet.cars.concat({
  id: 9200,
  reporting_marks: "OFOX",
  car_initial: "OFOX",
  car_number: "0310150",
}), fleet.history);
ok(!longer.ids.includes(9200), "a longer digit string is not inside a 6-digit range");

ok(ids(find("310102-310100")) === "1,2,3", "a reversed range still includes the endpoints");
ok(ids(find("310100 - 310102")) === "1,2,3", "spaces around the range dash still count as a range");
ok(ids(find("OFOX 310100-310102")) === "1,2,3", "a mark prefix limits the range to that current mark");
ok(ids(find("OFOX310100-310102")) === "1,2,3", "a glued mark prefix limits the range");
ok(ids(find("KCS 310100-310104")) === "1,2,3", "KCS 310100-310104 finds the cars remarked off KCS");

const priorInSpan = [
  { id: 1, reporting_marks: "KCS", car_initial: "KCS", car_number: "310100" },
  { id: 2, reporting_marks: "OFOX", car_initial: "OFOX", car_number: "310101" },
];
const priorHistory = [
  { railcar_id: 2, old_car_initial: "KCS", old_car_number: "310101", new_car_initial: "OFOX", new_car_number: "310101" },
];
ok(ids(resolveLineageIdentities("KCS 310100-310110", priorInSpan, priorHistory)) === "1,2", "a marked range matches the current mark or the prior mark");
ok(ids(resolveLineageIdentities("OFOX 310100-310110", priorInSpan, priorHistory)) === "2", "the other mark does not take the car that still carries KCS");

const bareKcs = find("KCS");
ok(bareKcs.message == null && bareKcs.ids.length === 60 && bareKcs.ids[0] === 1 && bareKcs.ids[59] === 60, "bare KCS returns the 60 remarked cars");
ok(!bareKcs.ids.includes(9000), "bare KCS skips a car that currently carries the mark with no history");

const remarked = [
  { id: 1, reporting_marks: "KCS", car_initial: "KCS", car_number: "000010" },
  { id: 2, reporting_marks: "OFOX", car_initial: "OFOX", car_number: "000011" },
  { id: 3, reporting_marks: "KCS", car_initial: "KCS", car_number: "000012" },
];
const remarkedHistory = [
  { railcar_id: 2, old_car_initial: "KCS", old_car_number: "000011", new_car_initial: "OFOX", new_car_number: "000011" },
  { railcar_id: 3, old_car_initial: "ABC", old_car_number: "000012", new_car_initial: "KCS", new_car_number: "000012" },
];
const prior = resolveLineageIdentities("KCS", remarked, remarkedHistory);
ok(prior.message == null && ids(prior) === "2,3", "a bare mark matches history renamed away from or to that mark");
ok(!prior.ids.includes(1), "a bare mark skips a car that currently carries it with no history");

const atCap = remarkedSeries(LINEAGE_MATCH_CAP, 310100);
const atCapResult = resolveLineageIdentities("310100-310899", atCap.cars, atCap.history);
ok(atCapResult.message == null && atCapResult.ids.length === LINEAGE_MATCH_CAP, "200 cars in a wide range still resolve");
ok(resolveLineageIdentities("KCS", atCap.cars, atCap.history).ids.length === LINEAGE_MATCH_CAP, "a bare mark of 200 history cars resolves");

const over = remarkedSeries(LINEAGE_MATCH_CAP + 1, 310100);
const overRange = resolveLineageIdentities("310100-310899", over.cars, over.history);
ok(overRange.message === LINEAGE_TOO_MANY_MESSAGE && overRange.ids.length === 0, "201 range matches ask to narrow it");
const overMark = resolveLineageIdentities("KCS", over.cars, over.history);
ok(overMark.message === LINEAGE_TOO_MANY_MESSAGE && overMark.ids.length === 0, "201 bare-mark matches ask to narrow it");

const left = remarkedSeries(150, 100000, 1);
const right = remarkedSeries(150, 200000, 151);
const combinedCars = left.cars.concat(right.cars);
const combinedHistory = left.history.concat(right.history);
const combined = resolveLineageIdentities("100000-100149 200000-200149", combinedCars, combinedHistory);
ok(combined.message === LINEAGE_TOO_MANY_MESSAGE && combined.ids.length === 0, "ranges that together match more than 200 cars ask to narrow it");

const huge = parseLineageQuery("1-100001");
ok(huge.message === LINEAGE_TOO_MANY_MESSAGE && huge.identities.length === 0, "a span wider than 100,000 is rejected as a typo");

const listed = Array.from({ length: 81 }, (_, index) => `OFOX ${310100 + index}`).join(", ");
const listedPlan = parseLineageQuery(listed);
ok(listedPlan.message == null && listedPlan.identities.length === 81, "an explicit car list is not cut off by the match cap");

const root = resolve(import.meta.dirname, "..");
function src(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const activity = src("server/activity-log.ts");
const lineageRead = src("server/lineage-read.ts");
const lineageServer = src("server/lineage-identity.ts");
const historyPage = src("client/src/pages/History.tsx");
ok(activity.includes("split(/[\\n\\r,;]+/)"), "the shared resolver still splits only on commas, newlines, and semicolons");
ok(activity.includes("opts.resolvedRailcarIds ?? resolveRailcarsByAnyIdentity(qText)"), "activity uses Lineage ids when the lineage parser already ran");
const resolveFn = lineageServer.slice(lineageServer.indexOf("export async function resolveLineageRailcars"));
ok(resolveFn.indexOf("parseLineageQuery") !== -1 && resolveFn.indexOf("parseLineageQuery") < resolveFn.indexOf("loadCars"), "a typo-sized range is rejected before the database read");
ok(lineageServer.includes("LINEAGE_BARE_NUMBER_LIMIT"), "bare-number reads use the partial-match limit");
ok(lineageServer.includes("LINEAGE_MATCH_CAP + 1"), "range and mark reads fetch at most 201 rows");
ok(lineageServer.includes("throw error"), "a lookup error is raised");
ok(!lineageServer.includes("skipped"), "a lookup error is not dropped");
ok(lineageRead.includes("resolveLineageRailcars"), "GET /api/lineage resolves through the lineage parser");
ok(lineageRead.includes("message"), "a too-wide lineage query returns the narrow-it message");
ok(!/\.(insert|update|delete|upsert)\s*\(/.test(lineageServer), "lineage identity resolution does not write");
ok(historyPage.includes("data?.message"), "the Lineage page shows the narrow-it message");
ok(src("server/global-search.ts").includes('from "./activity-log"') && !src("server/global-search.ts").includes("resolveLineageRailcars"), "Search keeps the shared resolver");
ok(!src("server/programs.ts").includes("resolveLineageRailcars"), "programs keep the shared resolver");
ok(!src("server/railcar-list.ts").includes("resolveLineageRailcars"), "railcar search keeps the shared resolver");
ok(!src("server/railcar-bulk.ts").includes("resolveLineageRailcars"), "bulk tools keep the shared resolver");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
