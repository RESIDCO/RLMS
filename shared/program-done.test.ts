/* eslint-disable no-console */
/** OL1503 completion must not regress: checkbox/outcome/trail still count. Fleet inactive is done unless kept open. */

function isProgramDone(row: {
  active?: boolean;
  keep_open?: boolean;
  scrapped_at?: string | null;
  /** program_cars.status. The text alone is not Program done. */
  status?: string | null;
  outcome_reached_at?: string | null;
  complete?: boolean;
  milestone?: string | null;
  exited_date?: string | null;
}) {
  if (row.active === false && !row.keep_open) return true;
  if (String(row.scrapped_at ?? "").trim()) return true;
  if (row.outcome_reached_at) return true;
  if (row.complete) return true;
  if (String(row.exited_date ?? "").trim()) return true;
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
ok(isProgramDone({ active: true, keep_open: true, scrapped_at: "2026-09-18" }), "keep open plus scrapped_at is Program done");
ok(!isProgramDone({ active: true, scrapped_at: "  " }), "blank scrapped_at is not Program done");
ok(!isProgramDone({ active: true, status: "Complete" }), "status text alone is not Program done");
ok(!isProgramDone({ active: true, status: "Sold" }), "Sold status text is not Program done");
ok(isProgramDone({ active: false }), "fleet inactive is Program done");
ok(!isProgramDone({ active: false, keep_open: true }), "keep open is not done by inactivity");
ok(isProgramDone({ active: false, keep_open: true, outcome_reached_at: "2026-10-17" }), "keep open plus outcome is Program done");
ok(isProgramDone({ active: false, exited_date: "2026-10-01" }), "program exit is Program done");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
