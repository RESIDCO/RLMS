/* eslint-disable no-console */
/** Run: npx tsx shared/saved-views.test.ts */

import { opOf } from "./undo";
import {
  FOCUS_COLUMN_KEYS,
  FOCUS_PRESET_LABEL,
  GRAYMONT_INACTIVE_NUMBERS,
  GRAYMONT_MARKS,
  GRAYMONT_NUMBERS,
  INACTIVE_NOTE_MESSAGE,
  SAVED_VIEWS_SCHEMA_MESSAGE,
  countCacheKey,
  daysStopped,
  focusPresetLayout,
  formatEtTime,
  isMissingViewSchema,
  memberNoteAllowed,
  memberReaddSnapshots,
  memberRemoveSnapshots,
  parseViewLayout,
  parseViewQuery,
  persistableChange,
  pickOpenPrograms,
  pickOpenStop,
  viewCreateSnapshots,
  viewDeleteSnapshots,
  viewNamesCollide,
  viewUpdatedAtConflicts,
  viewWriteStatus,
} from "./saved-views";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(SAVED_VIEWS_SCHEMA_MESSAGE === "Saved views need a database update", "schema message");

const badCol = parseViewLayout({ cols: ["not_a_column"], order: ["marks"] });
ok(!badCol.ok && badCol.ok === false && badCol.message.includes("unknown column not_a_column"), "layout rejects an unknown column");
const badOrder = parseViewLayout({ cols: ["lessee"], order: ["secret"] });
ok(!badOrder.ok && badOrder.message.includes("unknown column secret"), "order rejects an unknown column");
const good = parseViewLayout({
  cols: ["open_stop_type", "program_status"],
  order: ["marks", "car_number", "open_stop_type"],
  widths: { marks: 90 },
  sort: { key: "program_status", dir: "desc" },
  pageSize: 200,
  showInactive: true,
});
ok(good.ok && good.layout.pageSize === 200 && good.layout.sort?.dir === "desc" && good.layout.showInactive, "layout accepts focus columns");
ok(!parseViewLayout({ pageSize: 40 }).ok, "page size is 75, 200, or 500");
ok(!parseViewLayout({ filters: { mystery: "x" } }).ok, "unknown filter is rejected");
ok(!parseViewQuery({}, "query").ok, "a query view needs a query or a filter");
const fixed = parseViewQuery({ source: "paste", unmatched: ["NOPE 1"] }, "fixed");
ok(fixed.ok && fixed.query.source === "paste" && fixed.query.unmatched?.[0] === "NOPE 1", "fixed view keeps unmatched tokens");
const searched = parseViewQuery({ q: "J312", fleet: true, scope: { cars: true, leases: true, carData: false } }, "query");
ok(searched.ok && searched.query.q === "J312" && searched.query.fleet, "query view stores the search");

ok(viewNamesCollide("Graymont PD", " graymont  pd "), "names collide across case and space");
ok(!viewNamesCollide("Graymont PD", "Graymont Shop"), "different names do not collide");
ok(!viewNamesCollide("  ", "Graymont"), "a blank name does not collide");

const created = viewCreateSnapshots({ id: 4, name: "Graymont PD", kind: "fixed", shared: true }, "2026-10-19T14:00:00.000Z");
const createdChange = persistableChange(created.before, created.after);
ok(createdChange.op === "update", "create is recorded as an update");
ok(createdChange.before.deleted_at === "2026-10-19T14:00:00.000Z" && createdChange.after.deleted_at == null, "undo of create only restores deleted_at");
ok(!("name" in createdChange.before) && !("kind" in createdChange.before), "undo of create does not null the new fields");
ok(opOf({
  id: 1,
  change_group: "g",
  table_name: "car_lists",
  row_pk: 4,
  before: createdChange.before,
  after: createdChange.after,
  detail: { op: createdChange.op },
}) === "update", "undo harness treats view create as an update");

const renamed = persistableChange({ name: "Old" }, { name: "Graymont PD" });
ok(renamed.op === "update" && renamed.before.name === "Old" && renamed.after.name === "Graymont PD", "rename is an update");
const layoutSave = persistableChange({ layout: { pageSize: 75 } }, { layout: { pageSize: 200 } });
ok(layoutSave.op === "update" && (layoutSave.after.layout as { pageSize: number }).pageSize === 200, "layout save is an update");

const deleted = persistableChange(...Object.values(viewDeleteSnapshots("2026-10-19T15:00:00.000Z")) as [Record<string, unknown>, Record<string, unknown>]);
ok(deleted.op === "update" && deleted.before.deleted_at == null && typeof deleted.after.deleted_at === "string", "soft delete is an update undo can restore");

const removed = persistableChange(...Object.values(memberRemoveSnapshots("2026-10-19T15:00:00.000Z")) as [Record<string, unknown>, Record<string, unknown>]);
ok(removed.op === "update" && removed.after.removed_at != null, "member remove is a soft update");
const readded = persistableChange(...Object.values(memberReaddSnapshots("2026-10-19T15:00:00.000Z")) as [Record<string, unknown>, Record<string, unknown>]);
ok(readded.op === "update" && readded.after.removed_at == null, "re-adding a member clears removed_at");
const added = persistableChange({}, { list_id: 1, railcar_id: 9, removed_at: null });
ok(added.op === "insert", "a brand-new member is an insert undo already deletes");
const noted = persistableChange({ note: null }, { note: "scrap" });
ok(noted.op === "update" && noted.after.note === "scrap", "member note is an update");

const inactive = memberNoteAllowed(false);
ok(!inactive.ok && inactive.status === 409 && inactive.message === INACTIVE_NOTE_MESSAGE, "inactive member note is 409");
ok(memberNoteAllowed(true).ok, "active member note is allowed");

ok(viewWriteStatus({ role: "viewer", action: "update" }) === 403, "viewer cannot update a view");
ok(viewWriteStatus({ role: "viewer", action: "create_shared" }) === 403, "viewer cannot create a shared view");
ok(viewWriteStatus({ role: "viewer", action: "note" }) === 403, "viewer cannot edit a member note");
ok(viewWriteStatus({ role: "viewer", action: "create_private" }) == null, "viewer can save a private copy");
ok(viewWriteStatus({ role: "viewer", action: "delete", actorId: "v", ownerId: "someone" }) === 403, "viewer cannot delete someone else's view");
ok(viewWriteStatus({ role: "viewer", action: "delete", actorId: "v", ownerId: "v" }) == null, "owner can delete their view");
ok(viewWriteStatus({ role: "editor", action: "update" }) == null, "editor can update a shared view");
ok(viewWriteStatus({ role: "admin", action: "delete", actorId: "a", ownerId: "other" }) == null, "admin can delete");

ok(viewUpdatedAtConflicts("2026-10-19T14:00:00.000Z", "2026-10-19T14:05:00.000Z"), "a newer updated_at is a 409 conflict");
ok(!viewUpdatedAtConflicts("2026-10-19T14:00:00.000Z", "2026-10-19T14:00:00.000Z"), "the same updated_at is not a conflict");
ok(viewUpdatedAtConflicts("2026-10-19T14:00:00.000Z", ""), "a missing expected timestamp conflicts");

ok(pickOpenStop([{ actual_resume_date: "2026-01-01", type: "Abatement" }, { actual_resume_date: null, type: "Off rent", reason: "shop" }])?.type === "Off rent", "an open stop is kept");
ok(pickOpenStop([{ actual_resume_date: "2026-01-01", type: "Abatement", reason: "old" }]) == null, "a car whose only stop is closed is blank");
const programs = pickOpenPrograms([
  { name: "Older", status: "first", added_at: "2026-01-01", exited_date: null },
  { name: "Newer", status: "being sent to scrap soon", added_at: "2026-08-01", exited_date: null },
  { name: "Closed", status: "done", added_at: "2026-09-01", exited_date: "2026-09-02" },
]);
ok(programs.latest?.status === "being sent to scrap soon" && programs.extra === 1, "latest open program wins and extras are counted");
ok(daysStopped("2026-10-16", new Date("2026-10-19T16:00:00.000Z")) === 3, "days stopped uses Eastern Time dates");
ok(formatEtTime("2026-10-19T13:12:00.000Z").includes("ET"), "times are labeled ET");

const preset = focusPresetLayout();
ok(preset.sort?.key === "program_status" && preset.order.includes("view_note") && preset.order[0] === "marks", FOCUS_PRESET_LABEL);
ok(FOCUS_COLUMN_KEYS.includes("open_stop_type") && FOCUS_COLUMN_KEYS.includes("tags"), "focus keys include rent stop and tags");
ok(isMissingViewSchema({ code: "42703", message: "column car_lists.kind does not exist" }), "missing kind column is the schema gap");
ok(!isMissingViewSchema({ code: "23505", message: "duplicate key" }), "a unique-name error is not a schema gap");
ok(countCacheKey(3, "2026-10-19T13:00:00.000Z", false, "active").includes("3|"), "count cache key includes the view and updated_at");
ok(GRAYMONT_NUMBERS.length === 31 && new Set(GRAYMONT_NUMBERS).size === 31, "the Graymont check list is 31 cars");
ok(GRAYMONT_INACTIVE_NUMBERS.join(",") === "406,416" && GRAYMONT_NUMBERS.filter((n) => (GRAYMONT_INACTIVE_NUMBERS as readonly string[]).includes(n)).length === 2, "406 and 416 are the two inactive cars");
ok(GRAYMONT_MARKS === "TFOX", "the Graymont check list is TFOX");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
