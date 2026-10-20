/** Run: npx tsx shared/timeline-filters.test.ts */
import { ACTIVITY_TIMELINE_FILTERS, timelineFilters } from "./timeline-filters";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const activityIds = timelineFilters("activity").map((filter) => filter.id);
const lineageIds = timelineFilters("lineage").map((filter) => filter.id);

ok(activityIds.join(",") === ACTIVITY_TIMELINE_FILTERS.map((filter) => filter.id).join(","), "activity callers use the original filter list");
ok(!activityIds.includes("moves"), "car and lease timelines do not gain a Moves filter");
ok(!activityIds.includes("rent_stop") && !activityIds.includes("program") && !activityIds.includes("import"), "source filters stay off the activity timeline");
ok(lineageIds.includes("rent_stop") && lineageIds.includes("program") && lineageIds.includes("import"), "Lineage adds its source filters");
ok(lineageIds.includes("reassignment") && lineageIds.includes("note"), "Lineage still has the original filters");
ok(lineageIds.includes("moves"), "Lineage has the Moves filter");
ok(!timelineFilters("activity").some((filter) => filter.id === "moves"), "Moves stays off car and lease timelines");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
