/* eslint-disable no-console */
/** Run: npx tsx server/crm-activities-perm.test.ts */

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

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
