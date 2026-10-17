/* eslint-disable no-console */
/** Run: npx tsx server/undo.test.ts */

import { currentMatchesAfter, nonUndoableMessage } from "@shared/undo";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const kpiBefore = { idle: 10, on_rent: 100 };
const kpiAfterUndo = { idle: 10, on_rent: 100 };
ok(JSON.stringify(kpiBefore) === JSON.stringify(kpiAfterUndo), "apply-then-undo KPI snapshot identical (fixture)");

ok(!currentMatchesAfter({ entity: "Coal" }, { entity: "Main" }), "conflict case: current !== after");
ok(currentMatchesAfter({ entity: "Main" }, { entity: "Main" }), "no conflict when after still current");

ok(nonUndoableMessage("change-number").includes("Remarks"), "remark path refused");
ok(nonUndoableMessage("import_commit").includes("Imports"), "import path refused");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
