/* eslint-disable no-console */
/** Run: npx tsx server/crm-bid-attachments.test.ts */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildActivityLogRow } from "@shared/change-log";

process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const { attachmentStoragePathsRemovedOnUndo } = await import("./undo");
const {
  AttachmentHttpError,
  LINE_HAS_FILES_MESSAGE,
  assertCanPinLine,
  filterAttachmentsByLine,
  lineInsertBlockedByOutsideFiles,
  opportunityFileDeleteChange,
  opportunityFileInsertChange,
  opportunityFileUpdateChange,
  patchOpportunityAttachment,
  pickAttachmentUploads,
  readOpportunityCategory,
  readOpportunityLineId,
} = await import("./crm-bid-attachments");
const { attachmentInsertPayload } = await import("./attachments");
const { opportunityAttachmentForbidden } = await import("./attachment-access");

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

function statusOf(fn: () => void): number {
  try {
    fn();
    return 0;
  } catch (err) {
    return err instanceof AttachmentHttpError ? err.status : -1;
  }
}

const root = resolve(import.meta.dirname, "..");
function src(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

ok(readOpportunityCategory(undefined, "upload") === "other", "upload default category is other");
ok(readOpportunityCategory("", "upload") === "other", "blank category defaults to other");
ok(statusOf(() => readOpportunityCategory("lease_docs", "upload")) === 400, "bad category is 400");
ok(readOpportunityCategory(undefined, "patch") === undefined, "patch omits category when it is absent");
ok(statusOf(() => readOpportunityLineId("nope", "upload")) === 400, "bad line id is 400");
ok(
  statusOf(() => assertCanPinLine({ id: 4, opportunity_id: 2, deleted_at: null }, 9)) === 400,
  "line from another opportunity is 400",
);
ok(
  statusOf(() => assertCanPinLine({ id: 4, opportunity_id: 9, deleted_at: "2026-10-20T00:00:00Z" }, 9)) === 400,
  "pinning to a soft-deleted line is 400",
);
assertCanPinLine({ id: 4, opportunity_id: 9, deleted_at: null }, 9);
ok(true, "a live line on this offering can be pinned");

ok(opportunityAttachmentForbidden("viewer", "opportunity"), "viewer upload/list/PATCH/download is forbidden");
ok(!opportunityAttachmentForbidden("editor", "opportunity"), "editor can use bid files");
ok(!opportunityAttachmentForbidden("viewer", "rider"), "viewer access to other files is unchanged");

let riderPatch = 0;
try {
  await patchOpportunityAttachment({ id: 3, entity_type: "rider" }, { doc_category: "legal" }, "user-1");
} catch (err) {
  riderPatch = err instanceof AttachmentHttpError ? err.status : -1;
}
ok(riderPatch === 404, "PATCH on a rider attachment is 404");

const base = {
  entity_id: 1,
  file_name: "a.pdf",
  file_size: 10,
  mime_type: "application/pdf",
  storage_path: "rider/1/a.pdf",
  uploaded_by: "ada",
  notes: null,
  source_module: "lease_management" as const,
};
for (const entityType of ["rider", "master_lease", "company"] as const) {
  const payload = attachmentInsertPayload({
    ...base,
    entity_type: entityType,
    doc_category: "legal",
    opportunity_line_id: 5,
  });
  ok(!("doc_category" in payload) && !("opportunity_line_id" in payload), `${entityType} upload leaves the new columns unset`);
}
const bidPayload = attachmentInsertPayload({
  ...base,
  entity_type: "opportunity",
  source_module: "crm",
  storage_path: "opportunity/1/a.pdf",
});
ok(bidPayload.doc_category === "other" && bidPayload.opportunity_line_id === null, "bid upload defaults category to other and line to null");

const listed = filterAttachmentsByLine(
  [
    { id: 1, opportunity_line_id: 7 },
    { id: 2, opportunity_line_id: null },
  ],
  "none",
);
ok(listed.length === 1 && listed[0].id === 2, "line=none returns offering files");
ok(pickAttachmentUploads({ file: ["one"], files: ["a", "b"] }, "rider").join(",") === "one", "rider upload still reads the single file field");
ok(pickAttachmentUploads({ file: ["one"], files: ["a", "b"] }, "opportunity").join(",") === "a,b", "bid upload reads the batch");

const ctx = { group: "11111111-1111-1111-1111-111111111111", actor: "user-1", occurred_at: "2026-10-20T12:00:00.000Z" };
const path = "opportunity/9/10-0-cars.xlsx";
const bytes = Buffer.from("bid-sheet-bytes");
const row: Record<string, unknown> = {
  id: 4,
  entity_type: "opportunity",
  entity_id: 9,
  file_name: "cars.xlsx",
  storage_path: path,
  doc_category: "other",
  opportunity_line_id: 7,
  file_size: bytes.length,
  mime_type: "application/vnd.ms-excel",
  notes: null,
};

function download(storage: Map<string, Buffer>, storagePath: string): Buffer {
  const buf = storage.get(storagePath);
  if (!buf) throw new Error("file missing");
  return buf;
}

const storage = new Map<string, Buffer>([[path, bytes]]);
const inserted = buildActivityLogRow(opportunityFileInsertChange(row, "user-1"), ctx);
ok(inserted?.detail && (inserted.detail as { op?: string }).op === "insert", "upload is an insert");
const insertedPaths = attachmentStoragePathsRemovedOnUndo([inserted!]);
for (const item of insertedPaths) storage.delete(item);
let insertDownloadFailed = false;
try {
  download(storage, path);
} catch {
  insertDownloadFailed = true;
}
ok(insertDownloadFailed && insertedPaths.includes(path), "upload then Undo removes the storage object");

storage.set(path, bytes);
const deleted = buildActivityLogRow(opportunityFileDeleteChange(row, "user-1"), ctx);
ok((deleted?.detail as { op?: string }).op === "delete", "delete records op delete");
ok((deleted?.detail as { storage_path?: string }).storage_path === path, "delete detail still carries storage_path");
const table = new Map<number, Record<string, unknown>>([[4, row]]);
table.delete(4);
for (const item of attachmentStoragePathsRemovedOnUndo([deleted!])) storage.delete(item);
const restored = { ...row, ...(deleted?.before as Record<string, unknown>) };
table.set(4, restored);
ok(download(storage, String(restored.storage_path)).equals(bytes), "delete then Undo leaves the file downloadable");

storage.set(path, bytes);
const updated = { ...row, doc_category: "legal" };
const recategorized = buildActivityLogRow(opportunityFileUpdateChange(row, updated, "user-1"), ctx);
ok((recategorized?.detail as { op?: string }).op === "update", "recategorize records op update");
ok((recategorized?.detail as { storage_path?: string }).storage_path === path, "recategorize detail still carries storage_path");
for (const item of attachmentStoragePathsRemovedOnUndo([recategorized!])) storage.delete(item);
const undone = { ...updated, ...(recategorized?.before as Record<string, unknown>) };
ok(undone.doc_category === "other", "recategorize then Undo restores the category");
ok(download(storage, path).equals(bytes), "recategorize then Undo leaves the file downloadable");

ok(
  attachmentStoragePathsRemovedOnUndo([{
    table_name: "attachments",
    detail: { op: "delete", storage_path: path },
    after: { storage_path: path },
  }]).length === 0,
  "delete undo ignores a storage path on the row",
);
ok(
  attachmentStoragePathsRemovedOnUndo([{
    table_name: "attachments",
    detail: { op: "update", storage_path: path },
    after: { storage_path: path, doc_category: "legal" },
  }]).length === 0,
  "recategorize undo ignores a storage path on the row",
);
ok(
  attachmentStoragePathsRemovedOnUndo([{
    table_name: "attachments",
    detail: { op: "insert", storage_path: "rider/1/contract.pdf" },
    after: {},
  }]).join(",") === "rider/1/contract.pdf",
  "lease-contract insert undo still removes the object",
);

ok(lineInsertBlockedByOutsideFiles([8], []), "a file outside the group blocks line undo");
ok(!lineInsertBlockedByOutsideFiles([8], [8]), "a file inside the group does not block");
ok(LINE_HAS_FILES_MESSAGE === "Line has files — move or delete them first", "line undo message");

const serverFiles = [
  "server/crm-bid-attachments.ts",
  "shared/attachment-category.ts",
  "client/src/components/OpportunityFiles.tsx",
  "migrations/20261119_crm_bid_p1_1.sql",
  "migrations/20261119_crm_bid_p1_1_down.sql",
];
const leaseWords = ["master_leases", "from(\"riders\")", "from(\"master_leases\")", "railcar_assignments", "rent_events", "/api/lease-mgmt"];
for (const file of serverFiles) {
  const text = src(file);
  for (const word of leaseWords) ok(!text.includes(word), `${file} does not query ${word}`);
}
const migration = src("migrations/20261119_crm_bid_p1_1.sql");
const migrationSql = migration.replace(/--.*$/gm, "");
ok(!/doc_class/i.test(migrationSql), "migration SQL does not touch doc_class");
ok(!/update\s+(public\.)?attachments/i.test(migrationSql), "migration does not update attachment rows");
ok(!/revoke\s+(all|execute)\s+on\s+function\s+public\.rlms_/i.test(migration), "migration does not revoke the undo functions");
ok(!/grant\s+execute\s+on\s+function\s+public\.rlms_/i.test(migration), "migration does not re-grant the undo functions");
ok(!/grant\s+.*\son\s+(table\s+)?(public\.)?attachments/i.test(migrationSql), "migration does not grant on attachments");
ok(migration.includes("66be7d422ec47e8c711f83c8ca001c79"), "apply md5 guard");
ok(migration.includes("fda2979bbd2d37e82c936b0abcdf8927"), "undo md5 guard");
ok(migration.includes("ee76481bbbeb897c18d4f0349e9c0f2d"), "referenced md5 guard");
ok(migration.includes("b997a1a457d73f865b29560eeef625a6"), "fk md5 guard");
ok(migration.includes("set local lock_timeout = '5s'"), "lock timeout is 5s");
ok(migration.includes("set search_path = public, pg_temp"), "trigger function sets search_path");
ok(migration.includes("public.opportunity_lines"), "trigger reads public.opportunity_lines");
ok(/revoke execute on function public\.crm_attachment_line_matches\(\) from public, anon, authenticated/i.test(migration), "execute revoked from public, anon, authenticated");
ok(/grant execute on function public\.crm_attachment_line_matches\(\) to service_role/i.test(migration), "service_role keeps execute");

const down = src("migrations/20261119_crm_bid_p1_1_down.sql");
ok(down.includes("down refused"), "down refuses when bid file data exists");
ok(!/create\s+or\s+replace\s+function\s+public\.rlms_/i.test(down), "down does not replace undo functions");

function sliceFn(text: string, name: string): string {
  const start = text.indexOf(`export async function ${name}`);
  const rest = text.slice(start + 1);
  const next = rest.indexOf("\nexport async function ");
  return text.slice(start, next === -1 ? undefined : start + 1 + next);
}
const bidSrc = src("server/crm-bid-attachments.ts");
const uploadFn = sliceFn(bidSrc, "uploadOpportunityFiles");
ok(uploadFn.includes("withChangeGroup(") && !uploadFn.includes("withChangeGroupResult("), "multi-file upload uses one change group");
ok((uploadFn.match(/withChangeGroup\(/g) ?? []).length === 1, "the batch is not split across groups");
const deleteFn = sliceFn(bidSrc, "deleteOpportunityAttachment");
ok(!deleteFn.includes(".remove("), "opportunity delete does not remove the storage object");
ok(deleteFn.includes("opportunityFileDeleteChange"), "opportunity delete records the change");

const routes = src("server/routes.ts");
const accessCalls = routes.split("assertAttachmentAccess").length - 1;
ok(accessCalls >= 6, "attachment routes, including PATCH, call assertAttachmentAccess");
const patchAt = routes.indexOf('app.patch("/api/attachments/:id"');
ok(patchAt > routes.indexOf('app.delete("/api/attachments/:id"') && patchAt < routes.indexOf('app.get("/api/rent-events"'), "PATCH sits with the attachment routes");
ok(!routes.slice(patchAt, patchAt + 1200).includes("account-management"), "PATCH is not in the account-management block");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
