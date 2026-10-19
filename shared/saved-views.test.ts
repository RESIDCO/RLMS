/* eslint-disable no-console */
/** Run: npx tsx shared/saved-views.test.ts */

import { activityLogRailcarFkAllows, buildActivityLogRow } from "./change-log";
import { currentMatchesAfter, opOf } from "./undo";
import {
  CAR_LIST_NOT_NULL,
  FOCUS_COLUMN_KEYS,
  FOCUS_PRESET_LABEL,
  GRAYMONT_INACTIVE_NUMBERS,
  GRAYMONT_MARKS,
  GRAYMONT_NUMBERS,
  INACTIVE_NOTE_MESSAGE,
  SAVED_VIEWS_SCHEMA_MESSAGE,
  VIEWS_UNAVAILABLE_MESSAGE,
  VIEW_NAME_UNDO_CONFLICT,
  abandonedListPatch,
  applyJsonbPatch,
  countCacheKey,
  createSkipsPasteMatch,
  partitionSavedViews,
  pasteMemberIds,
  daysStopped,
  focusPresetLayout,
  formatEtTime,
  openStopFocusFields,
  pasteSearchBody,
  runViewCreate,
  stickyLeftOffsets,
  viewSavedToast,
  withFocusColumnsAfterIdentity,
  withLeadingIdentityColumns,
  idsWithoutInactive,
  isMissingViewSchema,
  listChangeLogIds,
  liveViewNameHeld,
  layoutNeedsFocus,
  memberNoteAllowed,
  memberReaddSnapshots,
  memberRemoveSnapshots,
  parseViewLayout,
  parseViewQuery,
  persistableChange,
  pickOpenPrograms,
  pickOpenStop,
  schemaProbeResult,
  snapshotBeforePatch,
  viewCreateRoundTrips,
  viewCountLabel,
  viewCreateSnapshots,
  viewDeleteSnapshots,
  viewNamesCollide,
  viewUndoNameConflict,
  viewUpdatedAtConflicts,
  viewWriteError,
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

const notNull = new Set<string>(CAR_LIST_NOT_NULL);
const viewRow: Record<string, unknown> = {
  id: 4,
  name: "Old",
  kind: "fixed",
  shared: true,
  layout: { v: 1, pageSize: 75, order: ["marks"] },
  pinned: true,
  created_at: "2026-10-19T12:00:00.000Z",
  updated_at: "2026-10-19T14:00:00.000Z",
  updated_by: "user-0",
  deleted_at: null,
};
function stampedPatch(at: string, by: string, extra: Record<string, unknown>) {
  return { updated_at: at, updated_by: by, ...extra };
}
function undoPatch(label: string, current: Record<string, unknown>, patch: Record<string, unknown>) {
  const before = snapshotBeforePatch(current, patch);
  const change = persistableChange(before, patch);
  ok(change.op === "update", `${label} is recorded as an update`);
  ok("updated_at" in change.before && "updated_by" in change.before, `${label} before includes the stamp`);
  for (const key of Object.keys(change.before)) {
    if (notNull.has(key)) ok(change.before[key] != null, `${label} before.${key} is not null`);
  }
  const saved = { ...current, ...patch };
  ok(currentMatchesAfter(saved, change.after), `${label} after still matches the saved row`);
  const undone = applyJsonbPatch(saved, change.before);
  ok(undone.updated_at === current.updated_at && undone.updated_by === current.updated_by, `${label} undo restores updated_at and updated_by`);
  return { change, undone };
}
const renamePatch = stampedPatch("2026-10-19T15:00:00.000Z", "user-1", { name: "Graymont PD" });
const renameUndo = undoPatch("rename", viewRow, renamePatch);
ok(renameUndo.undone.name === "Old", "undo of rename restores the name");
const layoutPatch = stampedPatch("2026-10-19T15:00:00.000Z", "user-1", { layout: { v: 1, pageSize: 200, order: ["marks", "program_status"] } });
const layoutUndo = undoPatch("layout save", viewRow, layoutPatch);
ok(JSON.stringify(layoutUndo.undone.layout) === JSON.stringify(viewRow.layout), "undo of layout save restores the layout");
const afterRename = { ...viewRow, ...renamePatch };
const memberStamp = stampedPatch("2026-10-19T16:00:00.000Z", "user-2", {});
const memberChange = persistableChange(snapshotBeforePatch(afterRename, memberStamp), memberStamp);
const afterMembers = applyJsonbPatch(afterRename, memberStamp);
ok(!currentMatchesAfter(afterMembers, renameUndo.change.after), "a later member stamp blocks undo of the rename");
const stampRestored = applyJsonbPatch(afterMembers, memberChange.before);
ok(currentMatchesAfter(stampRestored, renameUndo.change.after), "undo of the member stamp lets the rename undo");
ok(idsWithoutInactive([9, 406, 406, 11], new Set([406])).join(",") === "9,11", "selected add and remove skip inactive cars");
ok(viewUndoNameConflict({ code: "23505", message: 'duplicate key value violates unique constraint "car_lists_name_live_uq"' }) === VIEW_NAME_UNDO_CONFLICT, "undo of a reused view name is a clean conflict");
ok(viewUndoNameConflict({ code: "23505", message: 'duplicate key value violates unique constraint "railcars_pkey"' }) == null, "a different unique violation is left alone");
const outage = schemaProbeResult({ code: "ECONNRESET", message: "fetch failed" });
ok(!outage.ready && outage.unavailable && outage.message === VIEWS_UNAVAILABLE_MESSAGE, "a transient probe error is Views unavailable");
ok(schemaProbeResult({ code: "42703", message: "column car_lists.kind does not exist" }).message === SAVED_VIEWS_SCHEMA_MESSAGE, "a missing column stays the schema message");

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
const fkError = {
  code: "23503",
  message: 'insert or update on table "activity_log" violates foreign key constraint "activity_log_railcar_id_fkey"',
  details: 'Key (railcar_id)=(1) is not present in table "railcars".',
};
ok(!isMissingViewSchema(fkError), "a railcar foreign key error is not a missing column");
const fkBody = viewWriteError(fkError);
ok(fkBody.status === 500 && fkBody.code === "23503" && fkBody.message === fkError.message && fkBody.schema_ready == null, "a Supabase error keeps its message and code");
ok(fkBody.message !== SAVED_VIEWS_SCHEMA_MESSAGE, "the foreign key is not reported as a database update");
const missingTable = viewWriteError({ code: "42P01", message: 'relation "public.car_lists" does not exist' });
ok(missingTable.status === 503 && missingTable.message === SAVED_VIEWS_SCHEMA_MESSAGE && missingTable.schema_ready === false, "a missing table uses the database update message");
ok(isMissingViewSchema({ code: "PGRST205", message: "Could not find the table 'public.car_lists' in the schema cache" }), "a missing PostgREST table is the schema gap");
ok(viewWriteError(Object.assign(new Error("A view with that name already exists"), { status: 409 })).message === "A view with that name already exists", "an Error keeps its own message");

const existingRailcars = new Set<number>([29330]);
for (const viewId of [1, 2]) {
  ok(!existingRailcars.has(viewId), `view id ${viewId} is not a railcar`);
  const ids = listChangeLogIds(viewId);
  ok(ids.entity_id === viewId && ids.railcar_id === null, `view ${viewId} is logged with a null railcar_id`);
  ok(activityLogRailcarFkAllows(ids.railcar_id, existingRailcars), `view ${viewId} satisfies activity_log_railcar_id_fkey`);
  ok(!activityLogRailcarFkAllows(viewId, existingRailcars), `writing view id ${viewId} as railcar_id would violate the FK`);
}
const ghost = { id: 1, name: "Graymont PD", deleted_at: null as string | null };
ok(liveViewNameHeld(ghost.deleted_at), "a half-created row holds its name");
const hidden = abandonedListPatch("2026-10-19T15:01:00.000Z");
ghost.deleted_at = hidden.deleted_at;
ok(!liveViewNameHeld(ghost.deleted_at) && ghost.deleted_at === "2026-10-19T15:01:00.000Z", "soft-delete releases the live name");
ok(countCacheKey(3, "2026-10-19T13:00:00.000Z", false, "active").includes("3|"), "count cache key includes the view and updated_at");
ok(GRAYMONT_NUMBERS.length === 31 && new Set(GRAYMONT_NUMBERS).size === 31, "the Graymont check list is 31 cars");
ok(GRAYMONT_INACTIVE_NUMBERS.join(",") === "406,416" && GRAYMONT_NUMBERS.filter((n) => (GRAYMONT_INACTIVE_NUMBERS as readonly string[]).includes(n)).length === 2, "406 and 416 are the two inactive cars");
ok(GRAYMONT_MARKS === "TFOX", "the Graymont check list is TFOX");

const presetOrder = focusPresetLayout().order;
ok(presetOrder[0] === "marks" && presetOrder[1] === "car_number", "the focus preset keeps marks and car number first");
ok(layoutNeedsFocus(presetOrder), "the focus preset needs focus columns");
const pasteBody = pasteSearchBody({
  q: "TFOX 430",
  active: "all",
  scope: { cars: true, leases: true, carData: false },
  layoutKeys: presetOrder,
});
ok(pasteBody.focus === 1 && pasteBody.q === "TFOX 430", "a paste whose layout needs focus sends focus=1");
const plainPaste = pasteSearchBody({
  q: "TFOX 430",
  active: "active",
  scope: { cars: true, leases: true, carData: false },
  layoutKeys: ["marks", "car_number", "lessee"],
});
ok(plainPaste.focus == null, "a paste without focus columns does not send focus");

const foxStop = openStopFocusFields([{ type: "Abatement", stop_date: "2026-10-16", reason: "quality repair", actual_resume_date: null }], new Date("2026-10-19T16:00:00.000Z"));
ok(foxStop.open_stop_type === "Abatement" && foxStop.open_stop_since === "2026-10-16" && String(foxStop.open_stop_reason).includes("quality repair"), "TFOX 430's open stop fills the focus fields");
const closedOnly = openStopFocusFields([{ type: "Abatement", stop_date: "2026-01-01", reason: "old", actual_resume_date: "2026-02-01" }]);
ok(closedOnly.open_stop_type == null && closedOnly.open_stop_since == null && closedOnly.open_stop_reason == null, "a closed stop is not attached");

const stickyOrder = withLeadingIdentityColumns(["open_stop_since", "open_stop_days", "marks", "car_number", "lessee"]);
ok(stickyOrder[0] === "marks" && stickyOrder[1] === "car_number" && stickyOrder[2] === "open_stop_since", "marks and car number move to the front");
const offsets = stickyLeftOffsets(stickyOrder, (key) => (key === "marks" ? 80 : 120), 36);
ok(offsets.marks === 36 && offsets.car_number === 116 && offsets.open_stop_since == null, "sticky left offsets follow the real widths and do not overlap");

ok(viewSavedToast("Graymont PD", true, true) === "Saved 'Graymont PD' — shared with RESIDCO, pinned", "a shared pinned save names the view");
let posts = 0;
const saved = await runViewCreate({
  post: async () => {
    posts += 1;
    return { id: 7, name: "Graymont PD" };
  },
  refetch: async () => [{ id: 7, name: "Graymont PD" }],
});
ok(posts === 1 && saved.posts === 1 && saved.selected.name === "Graymont PD", "save posts once, then selects the refetched view");

const activeIds = Array.from({ length: 29 }, (_, index) => 1000 + index);
const inactiveIds = [1406, 1416];
const members = pasteMemberIds(activeIds, inactiveIds);
ok(members.length === 31 && members.includes(1406) && members.includes(1416), "a resolved paste keeps the 29 active cars and the 2 inactive ones");
ok(createSkipsPasteMatch({ railcar_ids: members, text: "TFOX 401" }), "railcar ids skip a second paste match");
ok(!createSkipsPasteMatch({ text: "TFOX 401" }), "text alone still matches on the server");
const smallCreate = viewCreateRoundTrips(31);
const largeCreate = viewCreateRoundTrips(500);
ok(smallCreate.total === 4 && smallCreate.memberActivityInserts === 1 && smallCreate.memberInserts === 1, "31 cars are four database writes");
ok(largeCreate.total === 8 && largeCreate.memberActivityInserts === 3 && largeCreate.total < 20, "500 cars stay under a handful of writes");
ok(smallCreate.total !== 31 && largeCreate.memberActivityInserts !== 500, "creates are not one write per car");

const pinnedShared = { id: 2, name: "Graymont PD", pinned: true, shared: true, owner: "bruce" };
const privateMine = { id: 3, name: "Mine", pinned: false, shared: false, owner: "bruce" };
const sharedOnly = { id: 4, name: "Fleet", pinned: false, shared: true, owner: "bruce" };
const sections = partitionSavedViews([pinnedShared, privateMine, sharedOnly], "bruce");
ok(sections.pinned.length === 1 && sections.pinned[0].id === 2, "a pinned view is listed under Pinned");
ok(sections.shared.every((view) => view.id !== 2) && sections.mine.every((view) => view.id !== 2), "a pinned view is not repeated under Shared or Mine");
ok(sections.shared.some((view) => view.id === 4) && sections.mine.some((view) => view.id === 3), "unpinned shared and private views stay in their sections");
ok(viewCountLabel({ count: 29, active: 29, inactive: 2 }) === "29 active of 31", "the header names the hidden inactive cars");
ok(viewCountLabel({ count: 12, active: 12, inactive: 0 }) === "12", "a list with no inactive cars stays a plain count");

const buried = withFocusColumnsAfterIdentity([
  "marks", "car_number", "lessee", "expires", "description", "mechanical_designation", "equipment_type",
  "open_stop_type", "open_stop_since", "open_stop_days", "open_stop_reason",
]);
ok(buried[0] === "marks" && buried[1] === "car_number" && buried[2] === "open_stop_type" && buried[3] === "open_stop_since" && buried[5] === "open_stop_reason", "stop columns move to just after the car number");
const presetNear = focusPresetLayout().order;
ok(presetNear.indexOf("open_stop_reason") === presetNear.indexOf("open_stop_days") + 1, "the focus preset keeps the stop reason next to the days");
ok(withFocusColumnsAfterIdentity(presetNear).join(",") === presetNear.join(","), "a focus preset that is already near the front stays put");

const graymontGroup = "graymont-view-2";
const graymontAt = "2026-10-19T16:00:48.000Z";
const graymontView = 2;
const graymontCars = Array.from({ length: 31 }, (_, index) => 5000 + index);
const listIds = listChangeLogIds(graymontView);
const createdSnaps = viewCreateSnapshots({ id: graymontView, name: "Graymont PD", kind: "fixed", shared: true, deleted_at: null }, graymontAt);
const listLog = buildActivityLogRow({
  table: "car_lists",
  pk: graymontView,
  before: createdSnaps.before,
  after: createdSnaps.after,
  action: "view_create",
  entity_type: "railcar",
  entity_id: listIds.entity_id,
  railcar_id: listIds.railcar_id,
  actor: "bruce",
  detail: { view_id: graymontView },
}, { group: graymontGroup, actor: "bruce", occurred_at: graymontAt });
ok(listLog != null && listLog.railcar_id == null && listLog.change_group === graymontGroup && listLog.entity_id === graymontView, "undo of create still keys the list row, with a null railcar_id");
const memberLogs = graymontCars.map((railcarId, index) => buildActivityLogRow({
  table: "car_list_members",
  pk: index + 10,
  before: {},
  after: { id: index + 10, list_id: graymontView, railcar_id: railcarId, removed_at: null },
  action: "view_member_add",
  entity_type: "railcar",
  entity_id: railcarId,
  railcar_id: railcarId,
  actor: "bruce",
  detail: { view_id: graymontView },
}, { group: graymontGroup, actor: "bruce", occurred_at: graymontAt }));
ok(memberLogs.length === 31 && memberLogs.every((row) => row != null && row.change_group === graymontGroup && row.railcar_id !== graymontView && row.action === "view_member_add"), "31 member adds are one batch and never store the view id as railcar_id");
const liveList = { id: graymontView, name: "Graymont PD", deleted_at: null as string | null };
const undoneCreate = applyJsonbPatch(liveList, (listLog?.before ?? {}) as Record<string, unknown>);
ok(undoneCreate.deleted_at === graymontAt && undoneCreate.name === "Graymont PD", "undo create hides the view without nulling the name");
const graymontRename = { name: "Graymont PD x", updated_at: "2026-10-19T16:05:00.000Z", updated_by: "bruce" };
const graymontRenameBefore = snapshotBeforePatch({ name: "Graymont PD", updated_at: graymontAt, updated_by: "bruce" }, graymontRename);
const graymontRenameChange = persistableChange(graymontRenameBefore, graymontRename);
ok(currentMatchesAfter({ ...graymontRename }, graymontRenameChange.after) && applyJsonbPatch(graymontRename, graymontRenameChange.before).name === "Graymont PD", "undo rename restores the name");
const pinPatch = { pinned: true, pin_order: 0 };
const pinChange = persistableChange({ pinned: false, pin_order: null }, pinPatch);
ok(pinChange.op === "update" && applyJsonbPatch(pinPatch, pinChange.before).pinned === false, "undo pin clears pinned");
const removeSnaps = memberRemoveSnapshots(graymontAt);
const removeChange = persistableChange(removeSnaps.before, removeSnaps.after);
ok(removeChange.op === "update" && applyJsonbPatch({ removed_at: graymontAt }, removeChange.before).removed_at == null, "undo remove puts the car back");
const noteChange = persistableChange({ note: null }, { note: "scrap" });
ok(applyJsonbPatch({ note: "scrap" }, noteChange.before).note == null, "undo note clears the note");
const deleteSnaps = viewDeleteSnapshots(graymontAt);
const deleteChange = persistableChange(deleteSnaps.before, deleteSnaps.after);
ok(opOf({ id: 1, change_group: graymontGroup, table_name: "car_lists", row_pk: graymontView, before: deleteChange.before, after: deleteChange.after, detail: { op: "update" }, railcar_id: null }) === "update", "undo delete still finds the list when railcar_id is null");
ok(applyJsonbPatch({ deleted_at: graymontAt }, deleteChange.before).deleted_at == null, "undo delete restores the view");
ok(memberLogs.every((row) => row != null && opOf({ id: 1, change_group: graymontGroup, table_name: "car_list_members", row_pk: Number(row.row_pk), before: row.before as Record<string, unknown>, after: row.after as Record<string, unknown>, detail: row.detail as Record<string, unknown>, railcar_id: Number(row.railcar_id) }) === "insert"), "undo of each member add deletes that new row");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
