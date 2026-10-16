/**
 * Smoke: OWNER_UI §C Bad Orders (template-from-previous flow)
 * - Unique test cars per run (never hard-delete; close own BOs)
 * - Required-field validation
 * - Template fill: shop, reason + keyed detail, comments land in form fields
 * - Template attachments: list refs + link same storage_key on new BO
 * - Left blank: car #s, B/O date (today), arrival, incident date/ID, DDCT Event ID
 * - Bad Order Reasons: short name + optional rule-based
 * - §G r5 / §H r9: canonical bo.status ASSIGNED → ACCEPTED → ON_HAND → APPROVED
 *   (approveEstimate must not auto-close; lifecycle bridge ACCEPTED_WORKING until CLOSED)
 *
 * Run: npm run repair:smoke-bad-orders
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { createBadOrder } from "../services/bo";
import {
  bulkCreateBadOrders,
  shopAcknowledge,
  shopArrivalDate,
} from "../services/bo-lifecycle";
import {
  createBoRule,
  deactivateBoRule,
  listBoRules,
} from "../services/bo-rules";
import {
  exportBadOrderGridCsv,
  findOpenBadOrdersForCar,
  listStccCodes,
  queryBadOrderGrid,
} from "../services/bo-grid";
import {
  assertTemplateFormContract,
  formFieldsFromTemplateRow,
  linkEventDocumentRefs,
  listTemplateDocumentRefs,
} from "../services/bo-template";
import { getContactsProvider } from "../providers/contacts";
import {
  createShop,
  formatShopLabel,
  listShopsForDropdown,
} from "../services/shops";
import { issueEventLink } from "../services/event-links";
import { approveEstimate } from "../services/estimates";
import { uploadEventDocument } from "../services/estimates";
import { softDeleteDocument } from "../services/gap-lifecycle-06";
import { setBoStatus } from "../services/bo-status";
import { migrateLocal } from "./migrate-local";
function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}
function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

const RUN = `C${Date.now().toString().slice(-8)}`;
const MARK = "ARSX";

async function ensureCar(carNumber: string, entity = "Main") {
  // Use high ids so we never collide with stub seeds / other smokes (id 1–10).
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity)
     SELECT GREATEST(
              (SELECT COALESCE(MAX(id), 0) FROM public.railcars),
              50000
            ) + 1,
            $1, $2, $2, true, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM public.railcars WHERE car_initial = $2 AND car_number = $1
     )`,
    [carNumber, MARK, entity],
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1,
            (SELECT id FROM public.railcars WHERE car_initial = $2 AND car_number = $1 LIMIT 1),
            $2, $1, 1, 'R1', 'SMOKE-ASSIGN', 'A1', 'Demo Lessee', '2026-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = $2 AND car_number = $1
     )`,
    [carNumber, MARK],
  );
}

/** Close open smoke BOs for a car — never hard-delete. */
async function closeOpenBosForCar(carNumber: string) {
  await q(
    `UPDATE repair.bad_orders bo
     SET lifecycle_status = 'CLOSED',
         status = 'CLOSED',
         status_changed_at = now(),
         status_changed_by = 'smoke-c-cleanup'
     FROM repair.events ev
     WHERE bo.event_id = ev.id
       AND bo.tenant_id = $1
       AND ev.car_mark = $2
       AND ev.car_number = $3
       AND bo.deleted_at IS NULL
       AND (
         bo.lifecycle_status IN ('QUEUED','ACCEPTED_PENDING','ACCEPTED_WORKING')
         OR bo.status IN (
           'ASSIGNED','ACCEPTED','ON_HAND','ESTIMATE_DRAFT','ESTIMATE_SUBMITTED',
           'UNDER_OWNER_REVIEW','REJECTED','APPROVED','IN_REPAIR','COMPLETED',
           'INVOICE_SUBMITTED'
         )
       )
       AND bo.created_by LIKE 'smoke-c%'`,
    [DEFAULT_TENANT_ID, MARK, carNumber],
  );
}

async function main() {
  console.log("=== repair:smoke-bad-orders (§C template flow) ===");
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    throw new Error("Set DATABASE_URL");
  }
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";
  await migrateLocal();

  // Soft-deactivate prior smoke shops (never hard-delete)
  await q(
    `UPDATE repair.shops
     SET deleted_at = COALESCE(deleted_at, now()),
         deleted_by = COALESCE(deleted_by, 'smoke-c'),
         delete_reason = COALESCE(delete_reason, 'smoke re-run'),
         active = false
     WHERE tenant_id = $1 AND created_by = 'smoke-c' AND deleted_at IS NULL`,
    [DEFAULT_TENANT_ID],
  );

  const shop = await createShop({
    legalName: `§C Smoke Shop ${RUN}`,
    city: "Walbridge",
    state: "OH",
    splc: "123456",
    shopMark: "A084",
    billingRoad: "NS",
    actor: "smoke-c",
  });
  if (!shop.ok) bad("create shop", shop.error);
  const shopId = String(shop.shop!.id);
  const label = formatShopLabel(shop.shop!);
  if (!label.includes("(A084)") || !label.includes("Walbridge")) {
    bad("shop label", label);
  }
  ok(`shop label: ${label}`);

  const dropdown = await listShopsForDropdown();
  if (!dropdown.some((s) => s.id === shopId)) bad("dropdown", "shop missing");
  ok("shop in dropdown");

  const stcc = await listStccCodes();
  if (!stcc.length) bad("stcc", "expected seeded codes");
  ok(`stcc codes: ${stcc.length}`);

  const shortCol = await q(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='repair' AND table_name='bo_rules'
       AND column_name='short_name'`,
  );
  if (!shortCol.rows[0]) bad("migration r2", "bo_rules.short_name missing");
  ok("bo_rules.short_name present");

  const contacts = getContactsProvider();
  const c = await contacts.upsert({
    partyType: "shop",
    partyRef: shopId,
    name: "Smoke Contact",
    email: `smoke-c-${RUN}@demo.local`,
    phone: "419-555-0100",
    role: "Shop Manager",
    actor: "smoke-c",
  });
  if (!c.ok) bad("contacts provider", c.error);
  ok("ContactsProvider local upsert");

  const reason = await createBoRule({
    description: `Body Damage ${RUN}`,
    shortName: `BD${RUN.slice(-4)}`,
    allowsAdditionalDetail: true,
    actor: "smoke-c",
  });
  if (!reason.ok) bad("create reason", reason.error);
  if (!reason.rule.short_name) bad("short name", "missing");
  const listed = await listBoRules({ activeOnly: true });
  if (!listed.some((r) => r.id === reason.rule.id)) bad("list reasons", "missing");
  ok("Bad Order Reason create/list (short name)");

  const car1 = String(900000 + (Number(RUN.slice(-6)) % 90000));
  const car2 = String(Number(car1) + 1);
  const car3 = String(Number(car1) + 2);
  await ensureCar(car1, "Main");
  await ensureCar(car2, "Coal");
  await ensureCar(car3, "Main");
  await closeOpenBosForCar(car1);
  await closeOpenBosForCar(car2);
  await closeOpenBosForCar(car3);
  ok(`unique cars ${MARK} ${car1}/${car2}/${car3}`);

  // Required-field validation (service / rule resolution)
  const missingCity = await createBadOrder({
    carMark: MARK,
    carNumber: car1,
    shopId,
    actor: "smoke-c-r2",
    boRuleCode: reason.rule.code,
    boCity: "",
    boState: "",
    allowDuplicates: false,
  });
  // Service falls back to shop city/ST — UI validates required; assert shop fallback
  if (!missingCity.ok) bad("shop city fallback", missingCity.error);
  if (String(missingCity.badOrder.bo_city) !== "Walbridge") {
    bad("bo city from shop", String(missingCity.badOrder.bo_city));
  }
  ok("required B/O City/ST fall back from shop when API omits (UI still requires)");
  await closeOpenBosForCar(car1);

  const otherMissing = await createBadOrder({
    carMark: MARK,
    carNumber: car1,
    shopId,
    actor: "smoke-c-r2",
    boRuleCode: "OTHER",
    boRuleOtherText: "",
    boCity: "Walbridge",
    boState: "OH",
    allowDuplicates: false,
  });
  if (otherMissing.ok) bad("OTHER validation", "should require keyed detail");
  ok("required keyed detail for OTHER reason");

  const bo1 = await createBadOrder({
    carMark: MARK,
    carNumber: car1,
    shopId,
    actor: "smoke-c-r2",
    boRuleCode: reason.rule.code,
    boRuleOtherText: "dent left side",
    boCity: "Walbridge",
    boState: "OH",
    destCity: "Walbridge",
    destState: "OH",
    reportingRoad: "NS",
    dcRoad: "CSXT",
    stcc: String(stcc[0].code),
    routing: "NS-CSXT",
    lastContents: "grain",
    carLoad: "EMPTY",
    cleaned: true,
    travelOnOwnWheels: true,
    comments: `§C r2 smoke ${RUN}`,
    allowDuplicates: false,
    ddctEventId: `DDCT-${RUN}`,
    ddctIncidentId: `INC-${RUN}`,
  });
  if (!bo1.ok) bad("BO create", bo1.error);
  // Canonical stored status + legacy lifecycle bridge (owner grid)
  if (String(bo1.badOrder.status) !== "ASSIGNED") {
    bad("status", String(bo1.badOrder.status));
  }
  if (String(bo1.badOrder.lifecycle_status) !== "QUEUED") {
    bad("lifecycle", String(bo1.badOrder.lifecycle_status));
  }
  // Billing road from shop — not from form override
  if (String(bo1.event.billing_road || "").toUpperCase() !== "NS") {
    bad("billing from shop", String(bo1.event.billing_road));
  }
  ok(
    `BO ASSIGNED/QUEUED + billing_road from shop=NS + entity=${bo1.event.entity_code}`,
  );

  // Staged attachments saved with BO
  const up = await uploadEventDocument({
    eventId: String(bo1.event.id),
    kind: "photograph",
    categoryCode: "photograph",
    comment: "smoke photo",
    actorEmail: "smoke-c-r2@demo.local",
    file: {
      filename: `smoke-${RUN}.txt`,
      mime: "text/plain",
      bytes: Buffer.from(`smoke attachment ${RUN}`),
    },
  });
  if (!up.ok) bad("staged attachment", up.error);
  const docs = await q(
    `SELECT id, category_code, comment FROM repair.documents
     WHERE event_id = $1 AND deleted_at IS NULL`,
    [bo1.event.id],
  );
  if (!docs.rows.length) bad("docs", "expected attachment");
  if (String(docs.rows[0].category_code) !== "photograph") {
    bad("doc category", String(docs.rows[0].category_code));
  }
  if (String(docs.rows[0].comment) !== "smoke photo") {
    bad("doc comment", String(docs.rows[0].comment));
  }
  ok("staged attachment (photograph + comment) saved with BO");

  const dup = await createBadOrder({
    carMark: MARK,
    carNumber: car1,
    shopId,
    actor: "smoke-c-r2",
    boRuleCode: "RULE_1",
    boCity: "Walbridge",
    boState: "OH",
    allowDuplicates: false,
  });
  if (dup.ok) bad("duplicate guard", "should block");
  ok("Allow Duplicates guard blocks open BO on same car");

  const open = await findOpenBadOrdersForCar({
    carMark: MARK,
    carNumber: car1,
  });
  if (!open.length) bad("open lookup", "expected open BO");
  ok(`open BO lookup: ${open.length}`);

  const bulk = await bulkCreateBadOrders({
    pastedCars: `${MARK} ${car2}\n${MARK} ${car3}`,
    shopId,
    boRuleCode: "RULE_1",
    boCity: "Walbridge",
    boState: "OH",
    allowDuplicates: true,
    actor: "smoke-c-r2",
    shared: {
      stcc: String(stcc[0].code),
      travelOnOwnWheels: true,
      carLoad: "EMPTY",
      reportingRoad: "NS",
    },
  });
  if (!bulk.ok) bad("bulk", "failed");
  if ((bulk.created?.length ?? 0) < 2) bad("bulk created", String(bulk.created?.length));
  const groupIds = new Set(
    (bulk.created ?? []).map((c) =>
      String((c as { multiCarGroupId?: string }).multiCarGroupId ?? ""),
    ),
  );
  if (groupIds.size !== 1 || [...groupIds][0] === "") {
    bad("multiCarGroupId", String([...groupIds]));
  }
  ok(`multi-car group (${bulk.created.length} cars)`);

  // Template-from-previous: grid + pure form mapper + document-ref link
  const grid = await queryBadOrderGrid({
    statusCodes: [
      "QUEUED",
      "ACCEPTED_PENDING",
      "ACCEPTED_WORKING",
      "CLOSED",
      "DECLINED",
    ],
    shopIds: [shopId],
    limit: 100,
  });
  const row = grid.rows.find((r) => r.bad_order_id === String(bo1.badOrder.id));
  if (!row) bad("grid", "BO missing");
  if (!row.shop_id) bad("template fields", "shop_id missing");
  if (!row.bo_rule_code) bad("template fields", "bo_rule_code missing");
  if (!row.bo_rule_other_text) {
    bad("template fields", "bo_rule_other_text (keyed detail) missing");
  }
  if (String(row.bo_rule_other_text) !== "dent left side") {
    bad("keyed detail", String(row.bo_rule_other_text));
  }
  if (!row.bo_city) bad("template fields", "bo_city missing");
  if (!row.reporting_road) bad("template fields", "reporting_road missing");
  if (!row.dc_road) bad("template fields", "dc_road missing");
  if (!row.stcc) bad("template fields", "stcc missing");
  if (!row.routing) bad("template fields", "routing missing");
  if (!row.last_contents) bad("template fields", "last_contents missing");
  if (!row.comments) bad("template fields", "comments missing");
  if (Number(row.attachment_count) < 1) bad("grid attachments", "count");

  const filled = formFieldsFromTemplateRow(row, { today: "2099-01-15" });
  const contractErrs = assertTemplateFormContract(filled);
  if (contractErrs.length) bad("template contract", contractErrs.join("; "));
  if (filled.shopId !== String(row.shop_id)) {
    bad("template shop", `${filled.shopId} != ${row.shop_id}`);
  }
  if (filled.boRuleCode !== String(row.bo_rule_code)) {
    bad("template reason", `${filled.boRuleCode} != ${row.bo_rule_code}`);
  }
  if (filled.boRuleOtherText !== "dent left side") {
    bad("template keyed", filled.boRuleOtherText);
  }
  if (filled.comments !== String(row.comments)) {
    bad("template comments", filled.comments);
  }
  if (filled.boDate !== "2099-01-15") bad("template boDate", filled.boDate);
  if (filled.ddctEventId || filled.ddctIncidentId || filled.arrivalDate) {
    bad("template blanks", "incident/arrival/ddct must stay blank");
  }
  ok(
    `template form fill shop=${filled.shopId.slice(0, 8)}… reason=${filled.boRuleCode} keyed+comments`,
  );

  const srcRefs = await listTemplateDocumentRefs({
    eventId: String(bo1.event.id),
  });
  if (srcRefs.length < 1) bad("template refs", "expected source attachment");
  ok(`template attachment refs listed (${srcRefs.length})`);

  // Create a fresh BO and link the same stored file (reference copy, not bytes).
  const carLink = String(Number(car1) + 3);
  await ensureCar(carLink);
  await closeOpenBosForCar(carLink);
  const boLink = await createBadOrder({
    carMark: MARK,
    carNumber: carLink,
    shopId,
    actor: "smoke-c-r2",
    boRuleCode: reason.rule.code,
    boRuleOtherText: "link target",
    boCity: "Walbridge",
    boState: "OH",
    allowDuplicates: true,
  });
  if (!boLink.ok) bad("link-target BO", boLink.error);
  const linked = await linkEventDocumentRefs({
    eventId: String(boLink.event.id),
    sourceDocumentIds: srcRefs.map((r) => r.sourceDocumentId),
    actor: "smoke-c-r2",
  });
  if (!linked.ok) bad("link docs", linked.error);
  if (linked.documents.length < 1) bad("link docs", "no rows created");
  const srcKey = srcRefs[0].storageKey;
  const newKey = String(linked.documents[0].storage_key);
  if (newKey !== srcKey) bad("link storage_key", `${newKey} != ${srcKey}`);
  const srcId = srcRefs[0].sourceDocumentId;
  const newId = String(linked.documents[0].id);
  if (newId === srcId) bad("link id", "expected new document row id");
  ok("template attachments linked (same storage_key, new document row)");

  // Untick/remove on new BO only unlinks the new row — source stays.
  const unlinked = await softDeleteDocument({
    documentId: newId,
    actor: "smoke-c-r2",
    reason: "smoke untick unlink",
  });
  if (!unlinked.ok) bad("unlink", unlinked.error);
  const srcStill = await q(
    `SELECT id FROM repair.documents
     WHERE id = $1 AND deleted_at IS NULL
       AND COALESCE(lifecycle_status, 'ACTIVE') <> 'VOIDED'`,
    [srcId],
  );
  if (!srcStill.rows[0]) bad("unlink source", "source document was removed");
  ok("unlink new BO doc leaves source attachment intact");

  // Search haystack used by "New from existing…" (car / date / shop / reason)
  const hay = [
    row.car_mark,
    row.car_number,
    row.bo_date,
    row.shop_display,
    row.bad_order_reason,
    row.bo_rule_code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay.includes(String(row.car_number).toLowerCase())) {
    bad("template search", "car number not in haystack");
  }
  if (!hay.includes(String(row.bo_rule_code).toLowerCase())) {
    bad("template search", "reason code not in haystack");
  }
  ok(
    `template-ready grid row shop=${row.shop_display} reason=${row.bo_rule_code} attachments=${row.attachment_count}`,
  );

  await closeOpenBosForCar(carLink);

  const csv = await exportBadOrderGridCsv({
    shopIds: [shopId],
    statusCodes: ["QUEUED"],
  });
  if (!csv.csv.includes("Bad Order Reason")) bad("export", "header missing");
  ok("grid export CSV");

  // Canonical BO lifecycle (§G r5): ASSIGNED → ACCEPTED → ON_HAND → … → APPROVED
  // (approveEstimate must NOT auto-close; CLOSED is a later step.)
  const link = await issueEventLink({
    eventId: String(bo1.event.id),
    scope: "SHOP",
    actor: "smoke-c-r2",
  });
  const ack = await shopAcknowledge(link.token, "shop@smoke-c.test");
  if (!ack.ok) bad("ack", ack.error);
  const afterAck = await q(
    `SELECT status, lifecycle_status FROM repair.bad_orders WHERE id = $1`,
    [bo1.badOrder.id],
  );
  if (String(afterAck.rows[0]?.status) !== "ACCEPTED") {
    bad("ACCEPTED", String(afterAck.rows[0]?.status));
  }
  if (String(afterAck.rows[0]?.lifecycle_status) !== "ACCEPTED_PENDING") {
    bad("lifecycle ACCEPTED_PENDING", String(afterAck.rows[0]?.lifecycle_status));
  }
  ok("ASSIGNED → ACCEPTED (lifecycle ACCEPTED_PENDING)");

  const onHand = await shopArrivalDate(
    link.token,
    "shop@smoke-c.test",
    "2026-10-01",
    "smoke track",
  );
  if (!onHand.ok) bad("on-hand", onHand.error);
  const afterOnHand = await q(
    `SELECT status, lifecycle_status FROM repair.bad_orders WHERE id = $1`,
    [bo1.badOrder.id],
  );
  if (String(afterOnHand.rows[0]?.status) !== "ON_HAND") {
    bad("ON_HAND", String(afterOnHand.rows[0]?.status));
  }
  if (String(afterOnHand.rows[0]?.lifecycle_status) !== "ACCEPTED_WORKING") {
    bad(
      "lifecycle ACCEPTED_WORKING",
      String(afterOnHand.rows[0]?.lifecycle_status),
    );
  }
  ok("ACCEPTED → ON_HAND (lifecycle ACCEPTED_WORKING)");

  const st = await q(
    `SELECT id FROM repair.statuses
     WHERE entity='ESTIMATE' AND code='AWAITING_APPROVAL' LIMIT 1`,
  );
  if (!st.rows[0]) bad("status seed", "AWAITING_APPROVAL missing");
  const est = await q(
    `INSERT INTO repair.estimates (tenant_id, event_id, status_id, created_by)
     VALUES ($1,$2,$3,'smoke-c-r2') RETURNING id`,
    [DEFAULT_TENANT_ID, bo1.event.id, st.rows[0].id],
  );
  await q(
    `INSERT INTO repair.estimate_revisions
       (tenant_id, estimate_id, rev_no, action, actor_name, labor, material, total,
        new_status, old_status, created_by)
     VALUES ($1,$2,1,'Seed','smoke-c-r2',0,0,0,'AWAITING_APPROVAL','QUEUED','smoke-c-r2')`,
    [DEFAULT_TENANT_ID, est.rows[0].id],
  );
  await q(`UPDATE repair.estimates SET current_revision = 1 WHERE id = $1`, [
    est.rows[0].id,
  ]);

  const appr = await approveEstimate({
    estimateId: String(est.rows[0].id),
    actor: "smoke-c-r2",
  });
  if (!appr.ok) bad("approve", appr.error);
  const afterAppr = await q(
    `SELECT status, lifecycle_status, closed_at FROM repair.bad_orders WHERE id = $1`,
    [bo1.badOrder.id],
  );
  if (String(afterAppr.rows[0]?.status) !== "APPROVED") {
    bad("APPROVED", String(afterAppr.rows[0]?.status));
  }
  // Owner-grid bridge stays ACCEPTED_WORKING until true CLOSED (not on approve)
  if (String(afterAppr.rows[0]?.lifecycle_status) !== "ACCEPTED_WORKING") {
    bad(
      "lifecycle after approve",
      String(afterAppr.rows[0]?.lifecycle_status),
    );
  }
  if (afterAppr.rows[0]?.closed_at) {
    bad("approve must not close", String(afterAppr.rows[0]?.closed_at));
  }
  ok("ON_HAND → APPROVED on estimate approve (lifecycle ACCEPTED_WORKING; not CLOSED)");

  // Explicit close (later lifecycle step) — cleanup path for this smoke car
  const closedStep = await setBoStatus({
    eventId: String(bo1.event.id),
    to: "CLOSED",
    actor: "smoke-c-r2",
    actionName: "Smoke close after approve",
    force: true,
  });
  if (!closedStep.ok) bad("close", closedStep.error);
  const closed = await q(
    `SELECT status, lifecycle_status FROM repair.bad_orders WHERE id = $1`,
    [bo1.badOrder.id],
  );
  if (String(closed.rows[0]?.status) !== "CLOSED") {
    bad("CLOSED status", String(closed.rows[0]?.status));
  }
  if (String(closed.rows[0]?.lifecycle_status) !== "CLOSED") {
    bad("CLOSED lifecycle", String(closed.rows[0]?.lifecycle_status));
  }
  ok("APPROVED → CLOSED (explicit; approve alone never closes)");

  // Close remaining smoke BOs for re-run (never delete)
  await closeOpenBosForCar(car2);
  await closeOpenBosForCar(car3);
  ok("closed remaining smoke BOs (no hard deletes)");

  const deact = await deactivateBoRule({
    id: reason.rule.id,
    actor: "smoke-c-r2",
  });
  if (!deact.ok) bad("deactivate reason", deact.error);
  const active = await listBoRules({ activeOnly: true });
  if (active.some((r) => r.id === reason.rule.id)) bad("deactivate", "still active");
  ok("Bad Order Reason deactivate");

  console.log("=== repair:smoke-bad-orders PASS ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
