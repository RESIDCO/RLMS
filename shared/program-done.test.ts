/* eslint-disable no-console */
/** OL1503 completion must not regress: checkbox/outcome/trail still count. scrapped_at is also done. */

function isProgramDone(row: {
  active?: boolean;
  scrapped_at?: string | null;
  outcome_reached_at?: string | null;
  complete?: boolean;
  milestone?: string | null;
}) {
  if (row.active === false) return true;
  if (row.scrapped_at) return true;
  if (row.outcome_reached_at) return true;
  if (row.complete) return true;
  const m = String(row.milestone ?? "").trim().toLowerCase();
  return ["on rent", "scrapped", "sold", "stored"].includes(m);
}

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(isProgramDone({ active: true, complete: true }), "OL1503 checkbox still Program done");
ok(isProgramDone({ active: true, outcome_reached_at: "2026-01-01" }), "outcome_reached_at still Program done");
ok(isProgramDone({ active: true, milestone: "On rent" }), "On rent milestone still Program done");
ok(!isProgramDone({ active: true, milestone: "Work complete" }), "Work complete is not Program done");
ok(isProgramDone({ active: true, scrapped_at: "2026-09-18" }), "scrapped_at is Program done");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
