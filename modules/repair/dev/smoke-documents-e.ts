/**
 * Smoke: OWNER_UI §E Document Viewer
 *
 * 1. Owner lists all docs; shop sees owner uploads (non-voided) + add;
 *    shop 403 on void/delete/recategorize; owner_only hidden from shop/lessee
 * 2. Preview kinds: image / pdf / 500-byte decode / office download-only
 * 3. Zip download audited
 * 4. Lessee granted-only; ungranted → 403
 * 5. Required-docs checklist (SDS when requires_sds)
 * 6. Client typecheck gate
 *
 * Run: npm run repair:smoke-documents
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { DEFAULT_TENANT_ID, q } from "../db";
import { createBadOrder } from "../services/bo";
import { createShop } from "../services/shops";
import { uploadEventDocument } from "../services/estimates";
import { parseAarFile } from "../services/aar-parser";
import {
  softDeleteDocument,
  recategorizeDocument,
} from "../services/gap-lifecycle-06";
import {
  listViewerDocuments,
  getDocumentContent,
  decodeAar500Preview,
  zipViewerDocuments,
  attachDocumentsToSendLessee,
  setDocumentOwnerOnly,
  buildZipStore,
  previewKindFor,
} from "../services/documents-viewer";
import { migrateLocal } from "./migrate-local";
import { assertDocumentsClientTypecheck } from "./typecheck-client-documents";

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}
function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

const RUN = `E${Date.now().toString().slice(-8)}`;
const MARK = "OFOX";
const NUMBER = `8${String(Date.now()).slice(-5)}`;

const samplePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "reference/Sample_Shop_500byte_OFOX2609.txt",
);

function withCar(bytes: Buffer, mark: string, number: string): Buffer {
  const parsed = parseAarFile(bytes);
  const lines = parsed.lines.map((line) => {
    if (line.recordFormat !== "1") return line.rawLine;
    const m = mark.toUpperCase().padEnd(4, " ").slice(0, 4);
    const n = number.padStart(6, "0").slice(-6);
    return line.rawLine.slice(0, 47) + m + n + line.rawLine.slice(57);
  });
  const ending = parsed.lineEnding === "CRLF" ? "\r\n" : "\n";
  return Buffer.from(lines.join(ending), "latin1");
}

async function seedCar(mark: string, number: string) {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity)
     SELECT GREATEST((SELECT COALESCE(MAX(id),0) FROM public.railcars), 60000) + 1,
            $1, $2, $2, true, 'Main'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.railcars WHERE car_initial = $2 AND car_number = $1
     )`,
    [number, mark],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1,
            (SELECT id FROM public.railcars WHERE car_initial = $2 AND car_number = $1 LIMIT 1),
            $2, $1, 1, 'R1', 'SMOKE-E', 'A1', 'Demo Lessee', '2026-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = $2 AND car_number = $1
     )`,
    [number, mark],
  );
}

async function main() {
  console.log("=== repair:smoke-documents (§E) ===");
  assertDocumentsClientTypecheck();

  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    throw new Error("Set DATABASE_URL");
  }
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";
  process.env.REPAIR_DEV_BYPASS_AUTH = process.env.REPAIR_DEV_BYPASS_AUTH ?? "1";
  await migrateLocal();
  ok("migrate-local (incl. e_documents)");

  await seedCar(MARK, NUMBER);

  const shop = await createShop({
    legalName: `§E Smoke Shop ${RUN}`,
    city: "Walbridge",
    state: "OH",
    splc: "123456",
    shopMark: `E${RUN.slice(-3)}`.slice(0, 4).toUpperCase(),
    actor: "smoke-e",
  });
  if (!shop.ok) bad("shop", shop.error);
  const shopId = String(shop.shop!.id);
  ok(`shop ${shopId.slice(0, 8)}`);

  const bo = await createBadOrder({
    carMark: MARK,
    carNumber: NUMBER,
    shopId,
    actor: "smoke-e-owner",
    boRuleCode: "OTHER",
    boRuleOtherText: "Door - bent",
    boDate: new Date().toISOString().slice(0, 10),
    boCity: "Marion",
    boState: "IL",
    allowDuplicates: true,
  });
  if (!bo.ok) bad("bo", JSON.stringify(bo));
  const eventId = String(bo.event.id);
  ok(`BO event ${eventId.slice(0, 8)}`);

  await q(
    `UPDATE repair.bo_rules SET requires_sds = true
     WHERE tenant_id = $1 AND code = 'OTHER'`,
    [DEFAULT_TENANT_ID],
  );

  const ownerPhoto = await uploadEventDocument({
    eventId,
    kind: "photograph",
    categoryCode: "photograph",
    comment: "inbound photos",
    actorEmail: "owner@smoke-e.test",
    file: {
      filename: "inbound.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x01, 0x02]),
    },
  });
  if (!ownerPhoto.ok) bad("owner photo", ownerPhoto.error);
  ok("owner uploaded photograph");

  const shopDoc = await uploadEventDocument({
    eventId,
    kind: "other",
    categoryCode: "other",
    comment: "shop note",
    actorEmail: "shop@smoke-e.test",
    file: {
      filename: "shop-note.txt",
      mime: "text/plain",
      bytes: Buffer.from("shop upload"),
    },
  });
  if (!shopDoc.ok) bad("shop doc", shopDoc.error);
  await q(
    `UPDATE repair.documents SET uploaded_role = 'shop', uploaded_via = 'shop_link'
     WHERE id = $1`,
    [shopDoc.document.id],
  );
  ok("shop document present");

  const sample = withCar(readFileSync(samplePath), MARK, NUMBER);
  const aar = await uploadEventDocument({
    eventId,
    kind: "aar_500byte",
    categoryCode: "aar_500byte",
    actorEmail: "shop@smoke-e.test",
    file: {
      filename: "OFOX2609.500",
      mime: "text/plain",
      bytes: sample,
    },
  });
  if (!aar.ok) bad("aar", aar.error);
  ok("500-byte uploaded");

  const office = await uploadEventDocument({
    eventId,
    kind: "other",
    categoryCode: "other",
    actorEmail: "owner@smoke-e.test",
    file: {
      filename: "scope.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: Buffer.from("PK\u0003\u0004fake-docx"),
    },
  });
  if (!office.ok) bad("office", office.error);
  if (previewKindFor(office.document) !== "office") {
    bad("office-kind", `expected office got ${previewKindFor(office.document)}`);
  }
  ok("office preview kind = download only");

  const dvDoc = await uploadEventDocument({
    eventId,
    kind: "other",
    categoryCode: "other",
    comment: "DV settlement worksheet",
    actorEmail: "owner@smoke-e.test",
    file: {
      filename: "dv-settlement.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 smoke"),
    },
  });
  if (!dvDoc.ok) bad("dv", dvDoc.error);
  const markOwn = await setDocumentOwnerOnly({
    documentId: String(dvDoc.document.id),
    ownerOnly: true,
    actor: "owner@smoke-e.test",
    actorRole: "owner",
  });
  if (!markOwn.ok) bad("owner-only", markOwn.error);
  ok("owner-only DV doc flagged");

  const ownerList = await listViewerDocuments({ eventId, actorRole: "owner" });
  if (!ownerList.ok) bad("owner-list", ownerList.error);
  const ownerIds = new Set(ownerList.documents.map((d) => String(d.id)));
  if (!ownerIds.has(String(ownerPhoto.document.id))) bad("owner-list", "missing owner photo");
  if (!ownerIds.has(String(shopDoc.document.id))) bad("owner-list", "missing shop doc");
  if (!ownerIds.has(String(dvDoc.document.id))) bad("owner-list", "missing owner_only");
  ok(`owner sees all non-voided (${ownerList.documents.length})`);

  const shopList = await listViewerDocuments({ eventId, actorRole: "shop" });
  if (!shopList.ok) bad("shop-list", shopList.error);
  const shopIds = new Set(shopList.documents.map((d) => String(d.id)));
  if (!shopIds.has(String(ownerPhoto.document.id))) {
    bad("shop-list", "shop must see owner uploads");
  }
  if (shopIds.has(String(dvDoc.document.id))) {
    bad("shop-list", "shop must NOT see owner_only");
  }
  if (!shopList.permissions.canAdd || shopList.permissions.canVoid) {
    bad("shop-perms", JSON.stringify(shopList.permissions));
  }
  ok("shop sees owner uploads; owner_only hidden; add-only perms");

  const shopVoid = await softDeleteDocument({
    documentId: String(shopDoc.document.id),
    actor: "shop@smoke-e.test",
    actorRole: "shop",
    reason: "shop trying void",
  });
  if (shopVoid.ok || shopVoid.status !== 403) {
    bad("shop-void", JSON.stringify(shopVoid));
  }
  const shopRecat = await recategorizeDocument({
    documentId: String(shopDoc.document.id),
    categoryCode: "sds",
    actor: "shop@smoke-e.test",
    actorRole: "shop",
  });
  if (shopRecat.ok || shopRecat.status !== 403) {
    bad("shop-recat", JSON.stringify(shopRecat));
  }
  ok("shop void/recategorize 403");

  const shopDv = await getDocumentContent({
    documentId: String(dvDoc.document.id),
    actorRole: "shop",
    actor: "shop@smoke-e.test",
    audit: false,
  });
  if (shopDv.ok || shopDv.status !== 403) bad("shop-dv", JSON.stringify(shopDv));
  ok("shop content on owner_only → 403");

  const decoded = await decodeAar500Preview({
    documentId: String(aar.document.id),
    actorRole: "owner",
  });
  if (!decoded.ok) bad("decode", decoded.error);
  if (!("lines" in decoded) || !decoded.lines?.length) {
    bad("decode", `no lines: ${"decodeError" in decoded ? decoded.decodeError : "?"}`);
  }
  const first = decoded.lines[0] as { fields: Record<string, unknown> };
  if (String(first.fields.car_initial ?? "").trim() !== MARK) {
    bad("decode-car", JSON.stringify(first.fields.car_initial));
  }
  ok("500-byte decoded field grid");

  const zip = await zipViewerDocuments({
    documentIds: [String(ownerPhoto.document.id), String(aar.document.id)],
    eventId,
    actorRole: "owner",
    actor: "owner@smoke-e.test",
  });
  if (!zip.ok) bad("zip", zip.error);
  if (zip.bytes.length < 50) bad("zip-size", String(zip.bytes.length));
  if (zip.bytes.readUInt32LE(0) !== 0x04034b50) {
    bad("zip-sig", "missing local file header");
  }
  ok(`zip ${zip.count} files sha=${zip.sha256.slice(0, 12)}…`);

  const tiny = buildZipStore([
    { filename: "a.txt", bytes: Buffer.from("hi") },
    { filename: "b.txt", bytes: Buffer.from("bye") },
  ]);
  if (tiny.readUInt32LE(0) !== 0x04034b50) bad("zip-unit", "bad header");
  ok("buildZipStore unit");

  const grantedId = String(ownerPhoto.document.id);
  const lesseeOk = await getDocumentContent({
    documentId: grantedId,
    actorRole: "lessee",
    grantedDocumentIds: [grantedId],
    actor: "lessee@smoke-e.test",
    audit: false,
  });
  if (!lesseeOk.ok) bad("lessee-ok", lesseeOk.error);
  const lesseeDeny = await getDocumentContent({
    documentId: String(aar.document.id),
    actorRole: "lessee",
    grantedDocumentIds: [grantedId],
    actor: "lessee@smoke-e.test",
    audit: false,
  });
  if (lesseeDeny.ok || lesseeDeny.status !== 403) {
    bad("lessee-deny", JSON.stringify(lesseeDeny));
  }
  const lesseeDv = await getDocumentContent({
    documentId: String(dvDoc.document.id),
    actorRole: "lessee",
    grantedDocumentIds: [String(dvDoc.document.id)],
    actor: "lessee@smoke-e.test",
    audit: false,
  });
  if (lesseeDv.ok || lesseeDv.status !== 403) {
    bad("lessee-owner-only", "owner_only must never go to lessee even if listed");
  }
  ok("lessee granted-only; ungranted + owner_only → 403");

  const { rows: anySt } = await q(`SELECT id FROM repair.statuses LIMIT 1`);
  if (!anySt[0]) bad("status", "no statuses");
  const { rows: estRows } = await q(
    `INSERT INTO repair.estimates (tenant_id, event_id, status_id, created_by)
     VALUES ($1,$2,$3,'smoke-e')
     RETURNING id`,
    [DEFAULT_TENANT_ID, eventId, anySt[0].id],
  );
  const estimateId = String(estRows[0].id);
  const attach = await attachDocumentsToSendLessee({
    estimateId,
    documentIds: [grantedId],
    actor: "owner@smoke-e.test",
    actorRole: "owner",
  });
  if (!attach.ok) bad("attach", attach.error);
  const attachShop = await attachDocumentsToSendLessee({
    estimateId,
    documentIds: [grantedId],
    actor: "shop@smoke-e.test",
    actorRole: "shop",
  });
  if (attachShop.ok || attachShop.status !== 403) {
    bad("attach-shop", JSON.stringify(attachShop));
  }
  ok("attach Send Lessee owner-only");

  const again = await listViewerDocuments({ eventId, actorRole: "owner" });
  if (!again.ok) bad("checklist-reload", again.error);
  const sdsMissing = again.checklist.items.find((i) => i.key === "sds");
  if (!sdsMissing?.missing) bad("checklist-sds", JSON.stringify(again.checklist));
  ok("required-docs checklist flags missing SDS");

  const sdsUp = await uploadEventDocument({
    eventId,
    kind: "sds",
    categoryCode: "sds",
    actorEmail: "owner@smoke-e.test",
    file: {
      filename: "sds.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-sds"),
    },
  });
  if (!sdsUp.ok) bad("sds-up", sdsUp.error);
  const afterSds = await listViewerDocuments({ eventId, actorRole: "owner" });
  if (!afterSds.ok) bad("after-sds", afterSds.error);
  const sdsItem = afterSds.checklist.items.find((i) => i.key === "sds");
  if (!sdsItem || sdsItem.missing) bad("sds-present", JSON.stringify(afterSds.checklist));
  ok("SDS present clears checklist flag");

  const { rows: audits } = await q(
    `SELECT mode FROM repair.document_download_audit
     WHERE event_id = $1 ORDER BY created_at`,
    [eventId],
  );
  if (!audits.some((a) => a.mode === "zip")) bad("audit-zip", "missing zip audit");
  if (!audits.some((a) => a.mode === "send_lessee_attach")) {
    bad("audit-attach", "missing send_lessee_attach audit");
  }
  ok(`download audits: ${audits.map((a) => a.mode).join(",")}`);

  const h = createHash("sha256").update(zip.bytes).digest("hex");
  if (h !== zip.sha256) bad("zip-hash", "mismatch");
  ok("zip sha256 matches");

  console.log("=== repair:smoke-documents PASS ===");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
