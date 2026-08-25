/* eslint-disable no-console */
/** Run: npx tsx shared/account-transitions.test.ts */

import { isFlaggedTransition, transitionPct } from "./account-transitions";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(!isFlaggedTransition(null), "blank incoming is not flagged");
ok(!isFlaggedTransition("  "), "whitespace incoming is not flagged");
ok(isFlaggedTransition("GS"), "incoming AM flags the record");
ok(transitionPct(0, 0) === null, "zero flagged has no percent");
ok(transitionPct(1, 4) === 25, "1 of 4 is 25%");
ok(transitionPct(2, 7) === 29, "rounds 2/7");

console.log(`passed ${passed} failed ${failed}`);
if (failed) process.exit(1);
