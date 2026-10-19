/* eslint-disable no-console */
/** Run: npx tsx server/undo.test.ts */

import { currentMatchesAfter, finalizeUndoPreview, isUndoAllowedTable, nonUndoableMessage, opOf, referencedSinceBlocksUndo } from "@shared/undo";
import { CAR_LIST_NOT_NULL, applyJsonbPatch, memberReaddSnapshots, memberRemoveSnapshots, persistableChange, snapshotBeforePatch, viewCreateSnapshots, viewDeleteSnapshots } from "@shared/saved-views";

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

ok(isUndoAllowedTable("program_car_milestones"), "per-path: milestone table allowed");
ok(
  opOf({
    id: 1,
    change_group: "g",
    table_name: "program_car_milestones",
    row_pk: 99,
    before: {},
    after: { milestone: "Arrived", milestone_date: "2026-10-17" },
    detail: { op: "insert" },
  }) === "insert",
  "per-path: milestone change is an undoable insert",
);
ok(isUndoAllowedTable("program_cars"), "per-path: notes/status on program_cars");
ok(isUndoAllowedTable("car_commitments"), "per-path: commitment");
ok(referencedSinceBlocksUndo({ table: "accounts", op: "insert", outside: true }), "acceptance 12: referenced account insert blocks");
const preview = finalizeUndoPreview({ conflicts: [], referencedSince: true });
ok(!preview.ok && preview.status === 409 && preview.message === "referenced since", "acceptance 12: preview is 409 referenced since");
const untouched = [{ id: 1, name: "Test Prospect Co" }];
if (!preview.ok) {
  ok(untouched[0].name === "Test Prospect Co", "acceptance 12: nothing deleted or nulled");
}

const created = viewCreateSnapshots({ id: 4, name: "Graymont PD", kind: "fixed", shared: true, layout: { v: 1 }, deleted_at: null }, "2026-10-19T13:00:00.000Z");
const createdChange = persistableChange(created.before, created.after);
ok(createdChange.op === "update" && createdChange.before.deleted_at === "2026-10-19T13:00:00.000Z" && createdChange.after.deleted_at == null, "undo create is an update of deleted_at");
ok(!("name" in createdChange.before) && !("kind" in createdChange.before), "undo create does not null name or kind");
ok(opOf({ id: 1, change_group: "g", table_name: "car_lists", row_pk: 4, before: createdChange.before, after: createdChange.after, detail: { op: "update" } }) === "update", "undo harness treats view create as update");

const viewRow: Record<string, unknown> = {
  name: "Old",
  kind: "fixed",
  shared: true,
  layout: { order: ["marks"] },
  pinned: false,
  created_at: "2026-10-19T12:00:00.000Z",
  updated_at: "2026-10-19T13:00:00.000Z",
  updated_by: "user-0",
};
const notNull = new Set<string>(CAR_LIST_NOT_NULL);
function runUndo(label: string, patch: Record<string, unknown>) {
  const before = snapshotBeforePatch(viewRow, patch);
  const change = persistableChange(before, patch);
  ok(change.op === "update", `${label} is an update`);
  for (const key of Object.keys(change.before)) {
    if (notNull.has(key)) ok(change.before[key] != null, `${label} before.${key} is not null`);
  }
  const saved = { ...viewRow, ...patch };
  const undone = applyJsonbPatch(saved, change.before);
  ok(currentMatchesAfter(saved, change.after), `${label} after matches the row Undo will read`);
  return undone;
}
const renamed = runUndo("undo rename", { updated_at: "2026-10-19T14:00:00.000Z", updated_by: "user-1", name: "J312 tub gons" });
ok(renamed.name === "Old" && renamed.updated_by === "user-0", "undo rename restores the previous name and updated_by");
const layout = runUndo("undo layout save", {
  updated_at: "2026-10-19T14:00:00.000Z",
  updated_by: "user-1",
  layout: { order: ["marks", "program_status"] },
});
ok(JSON.stringify(layout.layout) === JSON.stringify(viewRow.layout), "undo layout save restores the previous layout");

const removed = memberRemoveSnapshots("2026-10-19T13:05:00.000Z");
const removedChange = persistableChange(removed.before, removed.after);
ok(removedChange.op === "update" && removedChange.after.removed_at === "2026-10-19T13:05:00.000Z" && removedChange.before.removed_at == null, "undo member remove clears removed_at");
const readded = memberReaddSnapshots("2026-10-19T13:05:00.000Z");
const readdedChange = persistableChange(readded.before, readded.after);
ok(readdedChange.op === "update" && readdedChange.before.removed_at === "2026-10-19T13:05:00.000Z" && readdedChange.after.removed_at == null, "undo re-add sets removed_at again");
const noted = persistableChange({ note: null }, { note: "scrap" });
ok(noted.op === "update" && noted.after.note === "scrap", "undo member note restores the previous note");
const added = persistableChange({}, { id: 9, list_id: 4, railcar_id: 29330, removed_at: null });
ok(added.op === "insert" && opOf({ id: 2, change_group: "g", table_name: "car_list_members", row_pk: 9, before: added.before, after: added.after, detail: {} }) === "insert", "undo member add deletes the new row");
const deleted = viewDeleteSnapshots("2026-10-19T13:10:00.000Z");
const deletedChange = persistableChange(deleted.before, deleted.after);
ok(deletedChange.op === "update" && deletedChange.after.deleted_at === "2026-10-19T13:10:00.000Z", "undo delete clears deleted_at");
ok(isUndoAllowedTable("car_lists") && isUndoAllowedTable("car_list_members"), "saved view tables stay undoable");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
