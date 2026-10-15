/* eslint-disable no-console */
/** Run: npx tsx shared/vcf-assignment-closeout.test.ts */

import {
  closeoutStats,
  endDateMatchKey,
  openPeriodMatchKey,
  planVcfAssignmentCloseout,
  skipVcfAssignmentWrites,
  stripManualProtectedRailcarFields,
} from "./vcf-assignment-closeout";
import type { AssignmentHistoryPeriodPayload } from "./vcf-import";

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function hist(
  partial: Partial<AssignmentHistoryPeriodPayload> & { railcar_id: number },
): AssignmentHistoryPeriodPayload {
  return {
    rider_external_id: "EA1739",
    assignment_label: "EA1739 - xKBX",
    start_date: "2026-07-21",
    end_date: null,
    active: true,
    comment: null,
    assignment_id_ext: null,
    moved_at: "2026-08-13T00:00:00.000Z",
    moved_by: "vcf-import",
    reason: "V_VALID_CARS assignment period",
    ...partial,
  };
}

ok(skipVcfAssignmentWrites({ active_source: "manual", active: true }), "manual skips AH");
ok(skipVcfAssignmentWrites({ active_source: "auto", active: false }), "inactive skips AH");
ok(!skipVcfAssignmentWrites({ active_source: "auto", active: true }), "active auto writes AH");

const stripped = stripManualProtectedRailcarFields({
  active: true,
  active_status: "Active",
  status: "Active/In-Service",
  active_source: "auto",
  lessee_name: "KBX",
});
ok(stripped.lessee_name === "KBX", "strip keeps lessee");
ok(stripped.active === undefined, "strip drops active");
ok(stripped.status === undefined, "strip drops status");

ok(
  openPeriodMatchKey(1, "EA1739", "2026-07-21") ===
    openPeriodMatchKey(1, "EA1739", "2026-07-21"),
  "match key equal",
);
ok(
  openPeriodMatchKey(1, "EA1739", "2026-07-21") !==
    openPeriodMatchKey(1, "OL1739", "2026-07-21"),
  "EA !== OL",
);
ok(endDateMatchKey("4000-12-31") === "" && endDateMatchKey("4000-12-21") === "", "indefinite ends match as open");
ok(endDateMatchKey(null) === endDateMatchKey("4000-12-31"), "null end matches 4000-12-31");

// Same key, two existing opens, one incoming: match filled id; leftover sibling stays
{
  const actions = planVcfAssignmentCloseout({
    existingRows: [
      { id: 32, ...hist({ assignment_id_ext: null, railcar_id: 15516 }) },
      { id: 41074, ...hist({ assignment_id_ext: "558", railcar_id: 15516 }) },
    ],
    incoming: [hist({ assignment_id_ext: "558", railcar_id: 15516 })],
  });
  const stats = closeoutStats(actions);
  ok(stats.closed === 0, "does not auto-close leftover sibling in the same key");
  ok(stats.inserted === 0, "does not insert a third open");
  ok(
    actions.some((a) => a.op === "unchanged" && a.existingId === 41074) ||
      actions.some((a) => a.op === "update" && a.existingId === 41074),
    "keeps filled ASSIGNMENT_ID row",
  );
}

// Re-run after collapse: one open, same content → unchanged, no insert
{
  const incoming = hist({ assignment_id_ext: "558", railcar_id: 15516 });
  const actions = planVcfAssignmentCloseout({
    existingRows: [{ id: 41074, ...incoming }],
    incoming: [incoming],
  });
  const stats = closeoutStats(actions);
  ok(stats.unchanged === 1 && stats.inserted === 0 && stats.closed === 0 && stats.updated === 0, "re-run is no-op");
}

// Changed rider: close old at incoming start, insert new
{
  const actions = planVcfAssignmentCloseout({
    existingRows: [{ id: 10, ...hist({ rider_external_id: "OL1739", railcar_id: 1 }) }],
    incoming: [hist({ rider_external_id: "EA1739", start_date: "2026-07-21", railcar_id: 1, assignment_id_ext: "558" })],
  });
  const stats = closeoutStats(actions);
  ok(stats.closed === 1, "closes old OL period");
  ok(stats.inserted === 1, "inserts EA period");
  const close = actions.find((a) => a.op === "close");
  ok(close?.op === "close" && close.end_date === "2026-07-21", "changed close uses incoming start");
}

// Closed historical period upserts on full natural key
{
  const closed = hist({
    railcar_id: 1,
    rider_external_id: "OL1739",
    start_date: "2020-10-01",
    end_date: "2026-07-21",
    active: false,
    assignment_id_ext: "503",
  });
  const first = planVcfAssignmentCloseout({ existingRows: [], incoming: [closed] });
  ok(first.filter((a) => a.op === "insert").length === 1, "closed period inserts once");
  const again = planVcfAssignmentCloseout({
    existingRows: [{ id: 99, ...closed }],
    incoming: [closed],
  });
  ok(closeoutStats(again).unchanged === 1, "closed period re-run unchanged");
}

// Two incoming opens (different rider+start): keep both, close unmatched existing
{
  const incomingA = hist({ rider_external_id: "EA1739", start_date: "2026-07-21", railcar_id: 1, assignment_id_ext: "558" });
  const incomingB = hist({ rider_external_id: "EA1816", start_date: "2026-08-01", railcar_id: 1, assignment_id_ext: "559" });
  const actions = planVcfAssignmentCloseout({
    existingRows: [{ id: 10, ...hist({ rider_external_id: "OL1739", start_date: "2020-01-01", railcar_id: 1 }) }],
    incoming: [incomingA, incomingB],
  });
  const stats = closeoutStats(actions);
  ok(stats.inserted === 2, "inserts both incoming opens");
  ok(stats.closed === 1, "closes unmatched existing open");
}

// HMBX 291402-style: two file rows same car+start+rider, different ends — stay two rows
{
  const closed = hist({
    railcar_id: 9,
    rider_external_id: "OL1221",
    start_date: "2012-11-01",
    end_date: "2023-12-31",
    active: false,
    assignment_id_ext: "1221",
  });
  const opened = hist({
    railcar_id: 9,
    rider_external_id: "OL1221",
    start_date: "2012-11-01",
    end_date: null,
    active: true,
    assignment_id_ext: "1221",
  });
  const existing = [
    { id: 1, ...closed },
    { id: 2, ...opened },
  ];
  const incoming = [closed, opened];
  const first = planVcfAssignmentCloseout({ existingRows: existing, incoming });
  ok(closeoutStats(first).unchanged === 2 && closeoutStats(first).inserted === 0, "pair matches both ends");
  const again = planVcfAssignmentCloseout({ existingRows: existing, incoming });
  ok(closeoutStats(again).unchanged === 2 && closeoutStats(again).inserted === 0, "second load changes nothing");
}

// End-date change: exactly one leftover each side → update in place
{
  const old = hist({
    railcar_id: 1,
    rider_external_id: "OL1739",
    start_date: "2020-10-01",
    end_date: "2026-08-03",
    active: false,
    assignment_id_ext: "503",
  });
  const incoming = { ...old, end_date: "2026-08-04" };
  const actions = planVcfAssignmentCloseout({
    existingRows: [{ id: 26950, ...old }],
    incoming: [incoming],
  });
  ok(closeoutStats(actions).updated === 1 && closeoutStats(actions).inserted === 0, "1:1 leftover updates end date");
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
