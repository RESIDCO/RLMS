/** Run: npx tsx shared/lineage-filters.test.ts */
import { LINEAGE_FILTERS, activityMatchesFilter } from "./lineage-filters";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const moves = LINEAGE_FILTERS.find((filter) => filter.id === "moves");
const assignment = LINEAGE_FILTERS.find((filter) => filter.id === "reassignment");
ok(moves?.label === "Moves", "Lineage has a Moves filter");
ok(assignment?.label === "Assignment", "the existing reassignment filter stays labeled Assignment");

ok(activityMatchesFilter("reassignment", "moves"), "Moves shows a reassignment");
ok(!activityMatchesFilter("note", "moves"), "Moves hides notes");
ok(activityMatchesFilter("reassignment", "reassignment"), "Assignment still shows a reassignment");
ok(activityMatchesFilter("note", "all"), "All shows every action");
ok(!activityMatchesFilter("reassignment", "note"), "Notes stays notes");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
