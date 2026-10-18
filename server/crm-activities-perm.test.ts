/* eslint-disable no-console */
/** Run: npx tsx server/crm-activities-perm.test.ts */

import { viewerActivityPatch } from "@shared/crm";
import { crmActivityPermission } from "./crm-activity-access";

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

ok(crmActivityPermission({ role: "viewer", action: "create", actorId: "viewer-1" }).ok, "viewer create is allowed");
ok(
  crmActivityPermission({
    role: "viewer",
    action: "patch",
    actorId: "viewer-1",
    rowActor: "viewer-1",
    patchKeys: ["done_at"],
  }).ok,
  "viewer can mark their own task done",
);
const other = crmActivityPermission({
  role: "viewer",
  action: "patch",
  actorId: "viewer-1",
  rowActor: "editor-2",
  patchKeys: ["done_at"],
});
ok(!other.ok && other.status === 403, "viewer cannot patch another user's row");
const kind = crmActivityPermission({
  role: "viewer",
  action: "patch",
  actorId: "viewer-1",
  rowActor: "viewer-1",
  patchKeys: ["kind"],
});
ok(!kind.ok && kind.status === 403, "viewer cannot patch kind");
const body = crmActivityPermission({
  role: "viewer",
  action: "patch",
  actorId: "viewer-1",
  rowActor: "viewer-1",
  patchKeys: ["body", "due_date"],
});
ok(body.ok, "viewer can edit their own body and due date");
const deleted = crmActivityPermission({ role: "viewer", action: "delete", actorId: "viewer-1" });
ok(!deleted.ok && deleted.status === 403 && deleted.message.includes("cannot delete"), "viewer can never delete");
const editorDelete = crmActivityPermission({ role: "editor", action: "delete", actorId: "editor-1" });
ok(!editorDelete.ok && editorDelete.status === 403, "delete stays unavailable");
ok(crmActivityPermission({ role: "editor", action: "patch", actorId: "editor-1", rowActor: "viewer-1", patchKeys: ["kind"] }).ok, "editor can patch any row");

const activityRow = {
  id: 9,
  kind: "task",
  body: "Call the plant",
  due_date: "2026-11-01",
  done_at: "2026-10-18T12:00:00.000Z",
  actor: "viewer-1",
  account_id: 13,
  occurred_at: "2026-10-01T00:00:00.000Z",
};
const viewerPatch = viewerActivityPatch({ ...activityRow, done_at: activityRow.done_at });
ok(
  Object.keys(viewerPatch).sort().join(",") === "body,done_at,due_date",
  "viewer UI patch keeps only body, due date, and done",
);
ok(!("kind" in viewerPatch) && !("actor" in viewerPatch) && !("id" in viewerPatch) && !("account_id" in viewerPatch), "viewer UI patch drops extra keys");
ok(
  crmActivityPermission({
    role: "viewer",
    action: "patch",
    actorId: "viewer-1",
    rowActor: "viewer-1",
    patchKeys: Object.keys(viewerPatch),
  }).ok,
  "the viewer UI payload is allowed",
);
const rawRow = crmActivityPermission({
  role: "viewer",
  action: "patch",
  actorId: "viewer-1",
  rowActor: "viewer-1",
  patchKeys: Object.keys(activityRow),
});
ok(!rawRow.ok && rawRow.status === 403, "sending the whole activity row is 403");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
