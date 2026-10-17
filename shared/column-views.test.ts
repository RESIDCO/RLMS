/* eslint-disable no-console */
/** Run: npx tsx shared/column-views.test.ts */

import { parsePrefsPayload } from "./column-views";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

const parsed = parsePrefsPayload({
  cols: ["notes", "commitment"],
  order: ["commitment", "notes"],
  widths: { notes: 180 },
  sort: { key: "car", dir: "desc" },
});
ok(parsed?.sort?.key === "car" && parsed.sort.dir === "desc", "sort persists on saved view");
ok(parsePrefsPayload({ cols: ["notes"] })?.sort == null, "missing sort is null");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
