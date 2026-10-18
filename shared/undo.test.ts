/* eslint-disable no-console */
/** Run: npx tsx shared/undo.test.ts */

import { currentMatchesAfter, isUndoAllowedTable, nonUndoableMessage, opOf, summarizeUndoRows } from "./undo";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(currentMatchesAfter({ comment_event_note: "a" }, { comment_event_note: "a" }), "same note matches");
ok(!currentMatchesAfter({ comment_event_note: "b" }, { comment_event_note: "a" }), "conflict when current drifted");
ok(currentMatchesAfter({ active: true }, { active: "true" }), "bool coercion");
ok(currentMatchesAfter({ d: "2026-10-17T00:00:00" }, { d: "2026-10-17" }), "date prefix");
ok(
  opOf({ id: 1, change_group: "g", table_name: "railcars", row_pk: 1, before: {}, after: { x: 1 }, detail: { op: "insert" } }) === "insert",
  "insert op",
);
ok(nonUndoableMessage("remark_applied").includes("Remarks"), "remark message");
ok(nonUndoableMessage("vcf-import").includes("Imports"), "import message");
const s = summarizeUndoRows([
  { id: 1, change_group: "g", table_name: "railcars", row_pk: 9, before: { comment_event_note: "old" }, after: { comment_event_note: "new" }, detail: { op: "update" } },
  { id: 2, change_group: "g", table_name: "railcars", row_pk: 10, before: { comment_event_note: "old" }, after: { comment_event_note: "new" }, detail: { op: "update" } },
]);
ok(s.count === 2, "bulk group count");
ok(s.lines[0].includes("railcars #9"), "summarize line");
ok(
  opOf({ id: 3, change_group: "g", table_name: "car_commitments", row_pk: 1, before: { id: 1 }, after: {}, detail: {} }) === "delete",
  "commitment clear is delete op",
);
ok(
  opOf({ id: 4, change_group: "g", table_name: "program_cars", row_pk: 2, before: {}, after: { railcar_id: 1 }, detail: {} }) === "insert",
  "program_cars insert op",
);

const mileRow = {
  id: 5,
  change_group: "g-mile",
  table_name: "program_car_milestones" as const,
  row_pk: 47,
  before: {},
  after: { milestone: "Work complete", milestone_date: "2026-10-17", program_car_id: 120 },
  detail: { op: "insert" as const },
};
ok(isUndoAllowedTable(mileRow.table_name), "milestone table is undoable");
ok(isUndoAllowedTable("riders"), "riders undoable");
ok(isUndoAllowedTable("master_leases"), "master_leases undoable");
ok(isUndoAllowedTable("attachments"), "attachments undoable");
ok(isUndoAllowedTable("opportunities"), "opportunities undoable");
ok(isUndoAllowedTable("crm_activities"), "crm_activities undoable");
ok(opOf(mileRow) === "insert", "milestone append is insert");
ok(summarizeUndoRows([mileRow]).lines[0].includes("program_car_milestones"), "milestone summarize");
ok(
  currentMatchesAfter(mileRow.after, mileRow.after),
  "milestone after-values are a stable undo snapshot",
);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
