/**
 * Smoke: MG1–MG4 lifecycle-06.
 * Run: npm run repair:smoke-lifecycle-06
 */
import { createBadOrder } from "../services/bo";
import { uploadEstimate, listRevisions, getRevisionLines } from "../services/estimates";
import { compareRevisions, addComment } from "../services/comments";
import { voidEstimate } from "../services/bo-lifecycle";
import { getTankCarDocGate, assertOutboundAllowed, setTankCarDocGate } from "../services/tank-docs";
import { setEventTankCar } from "../services/gap-lifecycle-05";
import {
  saveInternalCorrection,
  restoreVoidedEstimate,
  softDeleteDocument,
  restoreDocument,
  softDeleteComment,
  restoreComment,
  cropImportPhase2Stub,
  assertShopLinkNotVoidLocked,
} from "../services/gap-lifecycle-06";
import { getPhase2Hooks, listEventDocuments } from "../services/ops-grid";
import { DEFAULT_TENANT_ID, q } from "../db";
import { getStorageProvider } from "../providers/storage";

let passed = 0;
let failed = 0;
function ok(n: string) {
  passed++;
  console.log(`  OK  ${n}`);
}
function bad(n: string, d: string) {
  failed++;
  console.error(`  FAIL ${n}: ${d}`);
}

async function seedCar(mark: string, number: string, id: number) {
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active)
     VALUES ($1,$2,$3,$3,true)
     ON CONFLICT (id) DO UPDATE SET car_initial=$3, car_number=$2, active=true`,
    [id, number, mark],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1,$1,$2,$3,1,'R','A','A1','L','2026-01-01',NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data WHERE car_initial=$2 AND car_number=$3
     )`,
    [id, mark, number],
  );
}

async function main() {
  console.log("=== repair:smoke-lifecycle-06 (MG1–MG4) ===");
  await seedCar("ARSX", "300001", 300001);
  const { ensureDemoShop } = await import("../services/shops");
  const shopId = await ensureDemoShop({
    mark: "APA",
    legalName: "Apache Railway Shop",
    city: "Snowflake",
    state: "AZ",
    splc: "859370",
    actor: "smoke06",
  });

  const bo = await createBadOrder({
    carMark: "ARSX",
    carNumber: "300001",
    shopId,
    actor: "smoke06",
    shoppingReason: "MG1",
    boCity: "Houston",
    boState: "TX",
  });
  if (!bo.ok) throw new Error(bo.error);
  const eventId = String(bo.event.id);

  // Seed estimate with lines via uploadEstimate
  const up = await uploadEstimate({
    eventId,
    actorName: "smoke06",
    via: "UI",
    lines: [
      {
        lineNo: 1,
        aarJobCode: "4450",
        qualifier: "1",
        whyMade: "01",
        respCode: "1",
        labor: 100,
        material: 50,
        total: 150,
      },
      {
        lineNo: 2,
        aarJobCode: "4451",
        qualifier: "1",
        whyMade: "02",
        respCode: "1",
        labor: 20,
        material: 10,
        total: 30,
      },
    ],
  });
  if (!up.ok) throw new Error(up.error);
  const estimateId = String(up.estimate.id);
  ok(`seed estimate ${estimateId.slice(0, 8)} total=${up.revision.total}`);

  // ── MG1: internal correction ──
  const noReason = await saveInternalCorrection({
    estimateId,
    actor: "reviewer@smoke",
    actorRole: "reviewer",
    reason: "  ",
    lines: [{ lineNo: 1, labor: 1, material: 0, total: 1 }],
  });
  if (!noReason.ok && noReason.status === 400) ok("MG1 reason required");
  else bad("MG1 reason", JSON.stringify(noReason));

  const shopBlocked = await saveInternalCorrection({
    estimateId,
    actor: "shop@smoke",
    actorRole: "shop_link",
    reason: "shop try",
    lines: [{ lineNo: 1, labor: 1, material: 0, total: 1 }],
  });
  if (!shopBlocked.ok && shopBlocked.status === 403) ok("MG1 shop link blocked");
  else bad("MG1 shop block", JSON.stringify(shopBlocked));

  const corr = await saveInternalCorrection({
    estimateId,
    actor: "reviewer@smoke",
    actorRole: "reviewer",
    reason: "Fix labor on line 1 per audit",
    header: { shopMark: "APA", splc: "123456", notes: "corrected" },
    lines: [
      {
        lineNo: 1,
        aarJobCode: "4450",
        qualifier: "1",
        whyMade: "01",
        respCode: "1",
        labor: 90,
        material: 50,
        total: 140,
      },
      {
        lineNo: 2,
        aarJobCode: "4451",
        qualifier: "1",
        whyMade: "02",
        respCode: "1",
        labor: 20,
        material: 10,
        total: 30,
      },
    ],
  });
  if (corr.ok && corr.totals.total === 170) ok("MG1 correction totals recalculated");
  else bad("MG1 correction", JSON.stringify(corr));

  const revs = await listRevisions(estimateId);
  const last = revs[revs.length - 1];
  if (last?.is_internal_correction && last?.correction_reason?.includes("Fix labor")) {
    ok("MG1 revision who/when/reason");
  } else bad("MG1 rev meta", JSON.stringify(last));

  if (revs.length >= 2) {
    const cmp = await compareRevisions({
      leftRevisionId: String(revs[0].id),
      rightRevisionId: String(revs[revs.length - 1].id),
    });
    if (cmp.changed.length >= 1 || cmp.totals.right.total === 170) {
      ok("MG1 compare view works");
    } else bad("MG1 compare", JSON.stringify(cmp.totals));
  }

  // Approve then block correction without Adjustment
  await q(
    `UPDATE repair.estimates SET status_id = (
       SELECT id FROM repair.statuses WHERE tenant_id=$1 AND entity='ESTIMATE' AND code='APPROVED'
     ) WHERE id=$2`,
    [DEFAULT_TENANT_ID, estimateId],
  );
  const afterAppr = await saveInternalCorrection({
    estimateId,
    actor: "reviewer@smoke",
    actorRole: "reviewer",
    reason: "should fail",
    lines: [{ lineNo: 1, labor: 1, material: 0, total: 1 }],
  });
  if (!afterAppr.ok && afterAppr.status === 409 && String(afterAppr.error).includes("Adjustment")) {
    ok("MG1 post-Approved requires Adjustment");
  } else bad("MG1 post-Approved", JSON.stringify(afterAppr));

  // Move to ADJUSTMENT via asAdjustment
  const adj = await saveInternalCorrection({
    estimateId,
    actor: "admin@smoke",
    actorRole: "admin",
    reason: "Approved adjustment after invoice mismatch",
    asAdjustment: true,
    header: { shopMark: "APA" },
    lines: [
      {
        lineNo: 1,
        aarJobCode: "4450",
        respCode: "1",
        labor: 95,
        material: 50,
        total: 145,
      },
    ],
  });
  if (adj.ok && adj.status === "ADJUSTMENT_FOR_APPROVAL") ok("MG1 Adjustment path");
  else bad("MG1 Adjustment", JSON.stringify(adj));

  // ── MG2: VOIDED restore + soft-delete docs/comments ──
  // Reset to Queued-ish for void
  await q(
    `UPDATE repair.estimates SET status_id = (
       SELECT id FROM repair.statuses WHERE tenant_id=$1 AND entity='ESTIMATE' AND code='AWAITING_APPROVAL'
     ), deleted_at=NULL WHERE id=$2`,
    [DEFAULT_TENANT_ID, estimateId],
  );
  const voided = await voidEstimate({
    estimateId,
    actor: "admin@smoke",
    actorRole: "admin",
    reason: "duplicate load",
  });
  if (voided.ok) ok("MG2 void");
  else bad("MG2 void", JSON.stringify(voided));

  const locked = await assertShopLinkNotVoidLocked({ eventId });
  if (!locked.ok && locked.status === 409) ok("MG2 shop link locked when VOIDED");
  else bad("MG2 shop lock", JSON.stringify(locked));

  const restoreFail = await restoreVoidedEstimate({
    estimateId,
    actor: "reviewer@smoke",
    actorRole: "reviewer",
    reason: "nope",
  });
  if (!restoreFail.ok && restoreFail.status === 403) ok("MG2 restore admin-only");
  else bad("MG2 restore role", JSON.stringify(restoreFail));

  const restored = await restoreVoidedEstimate({
    estimateId,
    actor: "admin@smoke",
    actorRole: "admin",
    reason: "voided in error",
  });
  if (restored.ok && restored.status !== "VOIDED") ok(`MG2 restore → ${restored.status}`);
  else bad("MG2 restore", JSON.stringify(restored));

  const unlocked = await assertShopLinkNotVoidLocked({ eventId });
  if (unlocked.ok) ok("MG2 shop unlocked after restore");
  else bad("MG2 unlock", JSON.stringify(unlocked));

  // Document soft-delete / restore
  const stored = await getStorageProvider().put({
    tenantId: DEFAULT_TENANT_ID,
    kind: "photo",
    filename: "wheel.jpg",
    mime: "image/jpeg",
    bytes: Buffer.from("fake-jpeg"),
  });
  const { rows: docs } = await q(
    `INSERT INTO repair.documents
       (tenant_id, event_id, kind, storage_key, sha256, size, mime, original_filename, created_by)
     VALUES ($1,$2,'photo',$3,$4,$5,'image/jpeg','wheel.jpg','smoke06')
     RETURNING id`,
    [DEFAULT_TENANT_ID, eventId, stored.storageKey, stored.sha256, stored.size],
  );
  const docId = String(docs[0].id);
  const delDoc = await softDeleteDocument({
    documentId: docId,
    actor: "admin@smoke",
    reason: "wrong file",
  });
  if (delDoc.ok) ok("MG2 soft-delete document");
  else bad("MG2 del doc", JSON.stringify(delDoc));
  const listed = await listEventDocuments({ eventId });
  if (!listed.find((d) => String(d.id) === docId)) ok("MG2 voided doc hidden from normal list");
  else bad("MG2 doc hide", "still visible");
  const restDoc = await restoreDocument({
    documentId: docId,
    actor: "admin@smoke",
    reason: "needed after all",
  });
  if (restDoc.ok) ok("MG2 restore document");
  else bad("MG2 rest doc", JSON.stringify(restDoc));

  const c = await addComment({
    eventId,
    estimateId,
    body: "temp note",
    author: "smoke06",
  });
  if (!c.ok) throw new Error("comment");
  const delC = await softDeleteComment({
    commentId: String(c.comment.id),
    actor: "admin@smoke",
    reason: "spam",
  });
  if (delC.ok) ok("MG2 soft-delete comment");
  else bad("MG2 del comment", JSON.stringify(delC));
  const restC = await restoreComment({
    commentId: String(c.comment.id),
    actor: "admin@smoke",
    reason: "restore thread",
  });
  if (restC.ok) ok("MG2 restore comment");
  else bad("MG2 rest comment", JSON.stringify(restC));

  // Never hard-deleted check
  const { rows: stillThere } = await q(
    `SELECT id FROM repair.documents WHERE id=$1`,
    [docId],
  );
  if (stillThere[0]) ok("MG2 document row never hard-deleted");
  else bad("MG2 purge", "row missing");

  // ── MG3: tank gate OFF for RESIDCO ──
  const gate = await getTankCarDocGate();
  if (gate.enabled === false) ok("MG3 RESIDCO tank gate OFF");
  else bad("MG3 default", JSON.stringify(gate));

  await setEventTankCar({ eventId, isTankCar: true, actor: "smoke06" });
  const outbound = await assertOutboundAllowed({ eventId });
  if (outbound.ok) ok("MG3 tank outbound allowed when gate OFF");
  else bad("MG3 outbound", JSON.stringify(outbound));

  await setTankCarDocGate({
    enabled: true,
    byCarType: { TANK: true },
    actor: "smoke06",
  });
  const on = await getTankCarDocGate();
  if (on.enabled && on.byCarType?.TANK === true) ok("MG3 per-tenant + per car-type setting");
  else bad("MG3 setting", JSON.stringify(on));
  await setTankCarDocGate({ enabled: false, actor: "smoke06" });

  // ── MG4: CROP Phase 2 hooks only ──
  const hooks = await getPhase2Hooks();
  if (hooks?.crop && hooks?.carMarqs && !(hooks as { crop?: { enabled?: boolean } }).crop?.enabled) {
    ok("MG4 phase2 hooks present (disabled)");
  } else bad("MG4 hooks", JSON.stringify(hooks));
  const stub = await cropImportPhase2Stub({ actor: "smoke06" });
  if (!stub.ok && stub.status === 501) ok("MG4 CROP import stub 501");
  else bad("MG4 stub", JSON.stringify(stub));

  // Lines still readable for compare after correction
  const lines = await getRevisionLines(String(last.id));
  if (lines.length >= 1) ok("revision lines intact");

  console.log(`\n=== results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
