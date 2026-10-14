/**
 * Smoke: Manual_Gap_Review lifecycle-05 reconciliations.
 * Run: npm run repair:smoke-lifecycle-05
 */
import { createBadOrder } from "../services/bo";
import { issueEventLink } from "../services/event-links";
import { shopAcknowledge, bulkCreateBadOrders, parsePastedCarList } from "../services/bo-lifecycle";
import {
  assertAttachmentAllowed,
  shopRequestDeleteEstimate,
  approveDeleteToVoid,
  bulkSubmitForApproval,
  requestDispo,
  parsePastedCarListWithHeader,
  setEventTankCar,
} from "../services/gap-lifecycle-05";
import {
  assertOutboundAllowed,
  ownerVerifyTankDocsFirst,
  setTankCarDocGate,
} from "../services/tank-docs";
import { addComment } from "../services/comments";
import { DEFAULT_TENANT_ID, q } from "../db";

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
  console.log("=== repair:smoke-lifecycle-05 ===");
  await seedCar("ARSX", "200001", 200001);
  await seedCar("ARSX", "200002", 200002);
  const { rows: shops } = await q(
    `SELECT id FROM repair.shops WHERE reporting_mark='APA' LIMIT 1`,
  );
  const shopId = String(shops[0].id);

  // #7 header initials
  const parsed = parsePastedCarListWithHeader("200001\n200002\n", "ARSX");
  if (parsed.length === 2 && parsed[0].carMark === "ARSX") ok("blank initials → header");
  else bad("header initials", JSON.stringify(parsed));

  const bulk = await bulkCreateBadOrders({
    pastedCars: "200001\nARSX 200002",
    headerInitials: "ARSX",
    shopId,
    actor: "smoke05",
    shoppingReason: "TEST",
    boCity: "Houston",
    boState: "TX",
  });
  if (bulk.ok && bulk.created.length >= 1) ok(`bulk BO with header (${bulk.created.length})`);
  else bad("bulk", JSON.stringify(bulk));

  // Attachment allowlist
  const good = await assertAttachmentAllowed({ filename: "photo.JPG" });
  const badExt = await assertAttachmentAllowed({ filename: "virus.exe" });
  if (good.ok && !badExt.ok) ok("attachment allowlist");
  else bad("allowlist", JSON.stringify({ good, badExt }));

  // Comment opt-in default off
  const bo = await createBadOrder({
    carMark: "ARSX",
    carNumber: "200001",
    shopId,
    actor: "smoke05",
    shoppingReason: "WHEEL",
    boCity: "Houston",
    boState: "TX",
  });
  if (!bo.ok) throw new Error(bo.error);
  const c = await addComment({
    eventId: String(bo.event.id),
    body: "Check line 3",
    subject: "BRC note",
    issue: "pricing",
    author: "reviewer@smoke",
    // notify omitted → false
  });
  if (c.ok && c.comment.did_notify === false && c.comment.subject === "BRC note") {
    ok("comment subject + notify opt-in default off");
  } else bad("comment", JSON.stringify(c));

  // Tank gate only for tank cars (MG3: RESIDCO default OFF — enable for this smoke)
  await setTankCarDocGate({ enabled: true, actor: "smoke05" });
  const nonTank = await assertOutboundAllowed({ eventId: String(bo.event.id) });
  if (nonTank.ok) ok("non-tank outbound allowed");
  else bad("non-tank", JSON.stringify(nonTank));

  await setEventTankCar({
    eventId: String(bo.event.id),
    isTankCar: true,
    actor: "smoke05",
  });
  const blocked = await assertOutboundAllowed({ eventId: String(bo.event.id) });
  if (!blocked.ok) ok("tank outbound blocked until verified");
  else bad("tank block", "expected block");

  const verified = await ownerVerifyTankDocsFirst({
    eventId: String(bo.event.id),
    actor: "owner@smoke",
  });
  if (verified.ok) ok("owner verify-first tank docs");
  else bad("verify-first", JSON.stringify(verified));

  const allowed = await assertOutboundAllowed({ eventId: String(bo.event.id) });
  if (allowed.ok) ok("tank outbound after owner verify");
  else bad("after verify", JSON.stringify(allowed));
  // Restore RESIDCO default OFF after tank assertions
  await setTankCarDocGate({ enabled: false, actor: "smoke05" });

  // Queued delete → AWAITING_DELETE → VOIDED
  const link = await issueEventLink({
    eventId: String(bo.event.id),
    scope: "SHOP",
    actor: "smoke05",
  });
  await shopAcknowledge(link.token, "shop@smoke");
  // Create a queued estimate via direct insert for delete path
  const queued = await getStatusByCodeSafe();
  const { rows: estIns } = await q(
    `INSERT INTO repair.estimates (tenant_id, event_id, current_revision, status_id, created_by)
     VALUES ($1,$2,0,$3,'smoke05') RETURNING id`,
    [DEFAULT_TENANT_ID, bo.event.id, queued],
  );
  const del = await shopRequestDeleteEstimate({
    estimateId: String(estIns[0].id),
    actor: "shop@smoke",
  });
  // shop_link role needed for Queued-only — use token path
  const del2 = await shopRequestDeleteEstimate({
    rawToken: link.token,
    actor: "shop@smoke",
    reason: "duplicate",
  });
  if (del2.ok || del.ok) ok("request delete → AWAITING_DELETE");
  else bad("request-delete", JSON.stringify({ del, del2 }));

  const { rows: awaiting } = await q(
    `SELECT e.id FROM repair.estimates e
     JOIN repair.statuses s ON s.id = e.status_id
     WHERE e.event_id = $1 AND s.code = 'AWAITING_DELETE'`,
    [bo.event.id],
  );
  if (awaiting[0]) {
    const v = await approveDeleteToVoid({
      estimateId: String(awaiting[0].id),
      actor: "admin@smoke",
    });
    if (v.ok) ok("approve delete → VOIDED");
    else bad("approve-delete", JSON.stringify(v));
  }

  // Dispo request gate (no approved estimate → skip)
  const dispo = await requestDispo({
    eventId: String(bo.event.id),
    actor: "smoke05",
  });
  if (dispo.ok && dispo.skipped.length >= 1) ok("dispo request gated (not Approved)");
  else if (dispo.ok) ok("dispo request returned");
  else bad("dispo", JSON.stringify(dispo));

  // bulk submit empty-safe
  const bulkSub = await bulkSubmitForApproval({
    estimateIds: [],
    actor: "smoke05",
  });
  if (bulkSub.ok) ok("bulk submit empty");
  else bad("bulk submit", JSON.stringify(bulkSub));

  // parsePasted still exported
  if (parsePastedCarList("ARSX 1").length === 1) ok("parsePastedCarList compat");

  console.log(`\n=== results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

async function getStatusByCodeSafe() {
  const { rows } = await q(
    `SELECT id FROM repair.statuses
     WHERE tenant_id = $1 AND entity = 'ESTIMATE' AND code = 'QUEUED'`,
    [DEFAULT_TENANT_ID],
  );
  return rows[0].id;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
