/** Run: npx tsx shared/lineage-identity.test.ts */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { splitCarNumber } from "./residco-import";
import {
  LINEAGE_CAR_CAP,
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

function fleet(): { cars: LineageCarRow[]; history: LineageHistoryRow[] } {
  const cars: LineageCarRow[] = [];
  const history: LineageHistoryRow[] = [];
  for (let n = 310100; n <= 310899; n += 1) {
    const id = n - 310099;
    const number = String(n);
    cars.push({ id, reporting_marks: "OFOX", car_initial: "OFOX", car_number: number });
    history.push({
      railcar_id: id,
      old_car_initial: "KCS",
      old_car_number: number,
      new_car_initial: "OFOX",
      new_car_number: number,
    });
  }
  cars.push({ id: 9000, reporting_marks: "KCS", car_initial: "KCS", car_number: "000001" });
  cars.push({ id: 9001, reporting_marks: "KCS", car_initial: "KCS", car_number: "000002" });
  history.push({
    railcar_id: 9001,
    old_car_initial: "ABC",
    old_car_number: "000002",
    new_car_initial: "KCS",
    new_car_number: "000002",
  });
  cars.push({ id: 9100, reporting_marks: "TILX", car_initial: "TILX", car_number: "1310100" });
  return { cars, history };
}

const { cars, history } = fleet();
const find = (raw: string) => resolveLineageIdentities(raw, cars, history);

ok(LINEAGE_CAR_CAP === 80, "the cap matches the bare-number fan-out");
ok(/too many/i.test(LINEAGE_TOO_MANY_MESSAGE) && /narrow it/i.test(LINEAGE_TOO_MANY_MESSAGE), "the cap message says to narrow it");

const glued = splitCarNumber("OFOX 310100 OFOX 310110");
ok(glued.car_number.includes("OFOX"), "splitting the whole list glues the second mark into the number");

const spaced = parseLineageQuery("OFOX 310100 OFOX 310110");
ok(spaced.message == null && spaced.identities.length === 2, "a space-separated list is two cars");
ok(spaced.identities[0]?.kind === "car" && spaced.identities[0].number === "310100" && spaced.identities[0].mark === "OFOX", "the first mark stays with 310100");
ok(spaced.identities[1]?.kind === "car" && spaced.identities[1].number === "310110" && spaced.identities[1].mark === "OFOX", "the second mark stays with 310110");
ok(ids(find("OFOX 310100 OFOX 310110")) === "1,11", "OFOX 310100 OFOX 310110 resolves both remarked cars");
ok(ids(find("ofox 310100 ofox 310110")) === "1,11", "spacing and case still pair mark and number");

ok(parseLineageQuery("OFOX310100").identities[0]?.kind === "car", "OFOX310100 is one car");
ok(ids(find("OFOX310100")) === "1", "a glued mark and number still resolves");
ok(ids(find("OFOX 310100")) === "1", "a single mark and number still resolves");
ok(ids(find("KCS 310100")) === "1", "an old mark and number resolves the remarked car");
ok(!find("KCS 310100").ids.includes(11), "old mark plus number does not take the neighbor");

ok(ids(find("OFOX 310100, OFOX 310110")) === "1,11", "a comma list still resolves");
ok(ids(find("OFOX 310100,OFOX310110")) === "1,11", "a comma list without spaces still resolves");
ok(ids(find("OFOX 310100\nOFOX 310110")) === "1,11", "a newline list still resolves");
ok(ids(find("OFOX 310100; OFOX 310110")) === "1,11", "a semicolon list resolves");

const bareNumber = find("310100");
ok(bareNumber.message == null && bareNumber.ids.includes(1), "a bare number still resolves");
ok(bareNumber.ids.includes(9100), "a bare number still substring-matches");
ok(!find("310100-310100").ids.includes(9100), "a one-number range stays exact");
ok(ids(find("310450")) === "351", "a bare number in the remarked series resolves that car");

const within = find("310100-310179");
ok(within.message == null && within.ids.length === 80 && within.ids[0] === 1 && within.ids[79] === 80, "a range of 80 numbers resolves");
ok(find("310100-310180").message === LINEAGE_TOO_MANY_MESSAGE && find("310100-310180").ids.length === 0, "a range of 81 numbers asks to narrow it");
ok(find("310100-310899").message === LINEAGE_TOO_MANY_MESSAGE && find("310100-310899").ids.length === 0, "310100-310899 is too many to open");
ok(ids(find("310102-310100")) === "1,2,3", "a reversed range still walks the numbers");
ok(ids(find("310100 - 310102")) === "1,2,3", "spaces around the range dash still count as a range");

ok(ids(find("OFOX 310100-310102")) === "1,2,3", "a mark prefix limits the range to that mark");
ok(ids(find("OFOX310100-310102")) === "1,2,3", "a glued mark prefix limits the range");
ok(ids(find("KCS 310100-310104")) === "1,2,3,4,5", "KCS 310100-310104 finds the cars remarked off KCS");
ok(find("KCS 310100-310899").message === LINEAGE_TOO_MANY_MESSAGE, "the full KCS to OFOX range asks to narrow it");

const narrowKcs = find("KCS 310100-310179");
ok(narrowKcs.message == null && narrowKcs.ids.length === 80 && !narrowKcs.ids.includes(9000), "a narrow KCS range is the remarked cars, not every car currently marked KCS");

const bareKcs = find("KCS");
ok(bareKcs.message === LINEAGE_TOO_MANY_MESSAGE && bareKcs.ids.length === 0, "bare KCS over the remarked series asks to narrow it");
ok(!bareKcs.ids.includes(9000), "bare KCS does not return cars that only currently carry the mark");

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

const eighty = Array.from({ length: 80 }, (_, index) => ({
  id: index + 1,
  reporting_marks: "OFOX",
  car_initial: "OFOX",
  car_number: String(100000 + index),
}));
const eightyHistory = eighty.map((car) => ({
  railcar_id: car.id,
  old_car_initial: "KCS",
  old_car_number: car.car_number,
  new_car_initial: "OFOX",
  new_car_number: car.car_number,
}));
const atCap = resolveLineageIdentities("KCS", eighty, eightyHistory);
ok(atCap.message == null && atCap.ids.length === 80, "a bare mark of 80 history cars resolves");
const eightyOneHistory = eightyHistory.concat({
  railcar_id: 81,
  old_car_initial: "KCS",
  old_car_number: "100080",
  new_car_initial: "OFOX",
  new_car_number: "100080",
});
const overCap = resolveLineageIdentities("KCS", eighty, eightyOneHistory);
ok(overCap.message === LINEAGE_TOO_MANY_MESSAGE && overCap.ids.length === 0, "a bare mark past 80 cars asks to narrow it");

const listed = Array.from({ length: 81 }, (_, index) => `OFOX ${310100 + index}`).join(", ");
const listedPlan = parseLineageQuery(listed);
ok(listedPlan.message == null && listedPlan.identities.length === 81, "an explicit car list is not cut off by the range cap");

const bothRanges = parseLineageQuery("310100-310139 310140-310180");
ok(bothRanges.message === LINEAGE_TOO_MANY_MESSAGE, "ranges that add up past 80 ask to narrow it");

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
ok(resolveFn.indexOf("parseLineageQuery") !== -1 && resolveFn.indexOf("parseLineageQuery") < resolveFn.indexOf("loadCars"), "a too-wide query is rejected before the database read");
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
