/* eslint-disable no-console */
/** Run: npx tsx shared/change-log.test.ts */

import { changedKeys, jsonEqual } from "./change-log";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(jsonEqual(null, undefined), "null equals undefined");
ok(jsonEqual("a", "a"), "same string");
ok(!jsonEqual("a", "b"), "different string");
ok(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), "object key order ignored");

const onlyChanged = changedKeys(
  { entity: "Main", notes: "keep", sold_to: null },
  { entity: "Coal", notes: "keep", sold_to: null },
);
ok(Object.keys(onlyChanged.before).join(",") === "entity", "only changed keys in before");
ok(onlyChanged.after.entity === "Coal", "after has new entity");
ok(!("notes" in onlyChanged.after), "unchanged notes omitted");

const nullFlip = changedKeys({ sold_to: "RTEX" }, { sold_to: null });
ok(nullFlip.before.sold_to === "RTEX" && nullFlip.after.sold_to === null, "null after is recorded");

const insert = changedKeys({}, { fleet_status: "Sold" });
ok(insert.before.fleet_status === null && insert.after.fleet_status === "Sold", "insert treats missing as null");

const none = changedKeys({ a: 1 }, { a: 1 });
ok(Object.keys(none.before).length === 0 && Object.keys(none.after).length === 0, "identical rows yield empty diff");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
