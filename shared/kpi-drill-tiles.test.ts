/* eslint-disable no-console */
/** Run: npx tsx shared/kpi-drill-tiles.test.ts */

import { KPI_TITLES } from "./kpi-buckets";
import { KPI_DRILL_TILES, kpiDrillPath, kpiDrillTitle } from "./kpi-drill-tiles";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const seenBuckets = new Set<string>();
const seenIds = new Set<string>();
for (const tile of KPI_DRILL_TILES) {
  ok(!seenIds.has(tile.testId), `unique tile ${tile.testId}`);
  ok(!seenBuckets.has(tile.bucket), `unique bucket ${tile.bucket}`);
  seenIds.add(tile.testId);
  seenBuckets.add(tile.bucket);
  ok(Boolean(KPI_TITLES[tile.bucket]), `${tile.bucket} has title`);
  ok(kpiDrillTitle(tile.bucket) === KPI_TITLES[tile.bucket], `${tile.bucket} title matches`);
  ok(kpiDrillPath(tile.bucket) === `/kpi/cars?bucket=${tile.bucket}`, `${tile.bucket} path`);
}

ok(KPI_DRILL_TILES.find((t) => t.bucket === "op")?.expectedCount === 14513, "op 14513");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "off_rent")?.expectedCount === 295, "off_rent 295");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "idle")?.expectedCount === 249, "idle 249");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "on_rent")?.expectedCount === 14218, "on_rent 14218");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "unassigned")?.expectedCount === 46, "unassigned 46");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "awaiting_rent_start")?.expectedCount === 80, "awaiting 80");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "mtm")?.expectedCount === 37, "mtm 37");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "going_on_lease")?.expectedCount === 6, "gol 6");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "no_link")?.expectedCount === 8, "no_link 8");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "sold_needs_tag")?.expectedCount === 188, "sold_needs_tag 188");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "sold_tag_suspect")?.expectedCount === 2, "sold_tag_suspect 2");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "sold_missing_buyer")?.expectedCount === 1, "sold_missing_buyer 1");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "sale_unclear")?.expectedCount === 0, "sale_unclear 0");
ok(KPI_DRILL_TILES.find((t) => t.bucket === "leased_off_rent")?.expectedCount === 90, "leased_off_rent 90");
ok(!KPI_DRILL_TILES.some((t) => t.bucket === "idle_on_ol"), "idle_on_ol merged into awaiting");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
