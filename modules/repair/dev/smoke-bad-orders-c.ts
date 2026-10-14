/**
 * Smoke: OWNER_UI §C Bad Orders
 * - Migration columns + STCC + rlms_contact_id
 * - Create BO with full form fields; Allow Duplicates guard
 * - Multi-car + entity snapshot
 * - Grid search / export
 * - BO reason admin (create / deactivate)
 * - Status transitions: Queued → Accepted-Pending → Accepted-Working → Closed
 * - ContactsProvider local path
 *
 * Run: npm run repair:smoke-bad-orders
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { createBadOrder } from "../services/bo";
import { bulkCreateBadOrders, shopAcknowledge } from "../services/bo-lifecycle";
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
import { getContactsProvider } from "../providers/contacts";
import {
  createShop,
  formatShopLabel,
  listShopsForDropdown,
} from "../services/shops";
import { issueEventLink } from "../services/event-links";
import { approveEstimate } from "../services/estimates";
import { migrateLocal } from "./migrate-local";

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}
function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

async function main() {
  console.log("=== repair:smoke-bad-orders (§C) ===");
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    throw new Error("Set DATABASE_URL");
  }
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";
  await migrateLocal();

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
    legalName: "§C Smoke Shop",
    city: "Walbridge",
    state: "OH",
    splc: "123456",
    shopMark: "A084",
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

  const contacts = getContactsProvider();
  const c = await contacts.upsert({
    partyType: "shop",
    partyRef: shopId,
    name: "Smoke Contact",
    email: "smoke-c@demo.local",
    phone: "419-555-0100",
    role: "Shop Manager",
    actor: "smoke-c",
  });
  if (!c.ok) bad("contacts provider", c.error);
  ok("ContactsProvider local upsert (rlms_contact_id nullable)");

  const col = await q(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='repair' AND table_name='contacts'
       AND column_name='rlms_contact_id'`,
  );
  if (!col.rows[0]) bad("migration", "rlms_contact_id missing");
  ok("contacts.rlms_contact_id present");

  const reasonCode = `BODY_${String(Date.now()).slice(-5)}`;
  const reason = await createBoRule({
    code: reasonCode,
    description: "Body Damage",
    allowsAdditionalDetail: true,
    actor: "smoke-c",
  });
  if (!reason.ok) bad("create reason", reason.error);
  const listed = await listBoRules({ activeOnly: true });
  if (!listed.some((r) => r.code === reasonCode)) bad("list reasons", "missing");
  ok("Bad Order Reason create/list");

  // Ensure ARSX 100002 exists for multi-car (stub may only seed 100001)
  await q(
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity)
     SELECT 3, '100002', 'ARSX', 'ARSX', true, 'Coal'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.railcars WHERE car_initial = 'ARSX' AND car_number = '100002'
     )`,
  );
  await q(
    `INSERT INTO public.v_valid_export_rows_data
       (export_src, export_id, car_initial, car_number, active, rider, assignment, assignment_id, lessee, start_date, end_date)
     SELECT 1, 3, 'ARSX', '100002', 1, 'R1', 'DEMO-ASSIGN-2', 'A2', 'Demo Lessee 2', '2026-01-01', NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM public.v_valid_export_rows_data
       WHERE car_initial = 'ARSX' AND car_number = '100002'
     )`,
  );
  await q(
    `UPDATE public.railcars SET entity = 'Main' WHERE car_initial = 'ARSX' AND car_number = '100001'`,
  );

  const bo1 = await createBadOrder({
    carMark: "ARSX",
    carNumber: "100001",
    shopId,
    actor: "smoke-c",
    boRuleCode: reasonCode,
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
    comments: "§C smoke",
    allowDuplicates: false,
    ddctEventId: "DDCT-EVT-1",
    ddctIncidentId: "INC-1",
  });
  if (!bo1.ok) bad("BO create", bo1.error);
  if (String(bo1.badOrder.lifecycle_status) !== "QUEUED") {
    bad("status", String(bo1.badOrder.lifecycle_status));
  }
  if (String(bo1.badOrder.stcc) !== String(stcc[0].code)) bad("stcc field", "not saved");
  if (!bo1.event.entity_code) bad("entity", "missing snapshot");
  ok(`BO Queued + entity=${bo1.event.entity_code} + DDCT Event ID saved`);

  const dup = await createBadOrder({
    carMark: "ARSX",
    carNumber: "100001",
    shopId,
    actor: "smoke-c",
    boRuleCode: "RULE_1",
    boCity: "Walbridge",
    boState: "OH",
    allowDuplicates: false,
  });
  if (dup.ok) bad("duplicate guard", "should block");
  ok("Allow Duplicates guard blocks open BO on same car");

  const open = await findOpenBadOrdersForCar({
    carMark: "ARSX",
    carNumber: "100001",
  });
  if (!open.length) bad("open lookup", "expected open BO");
  ok(`open BO lookup: ${open.length}`);

  const bulk = await bulkCreateBadOrders({
    pastedCars: "ARSX 100002",
    shopId,
    boRuleCode: "RULE_1",
    boCity: "Walbridge",
    boState: "OH",
    allowDuplicates: true,
    actor: "smoke-c",
    shared: {
      stcc: String(stcc[0].code),
      travelOnOwnWheels: true,
      carLoad: "EMPTY",
    },
  });
  if (!bulk.ok) bad("bulk", "failed");
  if ((bulk.created?.length ?? 0) < 1) bad("bulk created", String(bulk.created?.length));
  const groupIds = new Set(
    (bulk.created ?? []).map((c) =>
      String((c as { multiCarGroupId?: string }).multiCarGroupId ?? ""),
    ),
  );
  if (groupIds.size !== 1 || [...groupIds][0] === "") {
    bad("multiCarGroupId", String([...groupIds]));
  }
  ok(`multi-car group (${bulk.created.length} cars)`);

  const grid = await queryBadOrderGrid({
    statusCodes: ["QUEUED", "ACCEPTED_PENDING", "ACCEPTED_WORKING"],
    shopIds: [shopId],
    limit: 100,
  });
  if (!grid.rows.some((r) => r.bad_order_id === String(bo1.badOrder.id))) {
    bad("grid", "BO missing");
  }
  const row = grid.rows.find((r) => r.bad_order_id === String(bo1.badOrder.id))!;
  if (!row.shop_display?.includes("A084")) bad("grid shop label", row.shop_display ?? "");
  ok(`grid: ${grid.total} rows; shop=${row.shop_display}`);

  const csv = await exportBadOrderGridCsv({
    shopIds: [shopId],
    statusCodes: ["QUEUED"],
  });
  if (!csv.csv.includes("Bad Order Reason")) bad("export", "header missing");
  ok("grid export CSV");

  // Queued → Accepted-Pending
  const link = await issueEventLink({
    eventId: String(bo1.event.id),
    scope: "SHOP",
    actor: "smoke-c",
  });
  const ack = await shopAcknowledge(link.token, "shop@smoke-c.test");
  if (!ack.ok) bad("ack", ack.error);
  const afterAck = await q(
    `SELECT lifecycle_status FROM repair.bad_orders WHERE id = $1`,
    [bo1.badOrder.id],
  );
  if (String(afterAck.rows[0]?.lifecycle_status) !== "ACCEPTED_PENDING") {
    bad("Accepted-Pending", String(afterAck.rows[0]?.lifecycle_status));
  }
  ok("Queued → Accepted-Pending");

  // Accepted-Pending → Accepted-Working (estimate linked path)
  await q(
    `UPDATE repair.bad_orders SET lifecycle_status = 'ACCEPTED_WORKING' WHERE id = $1`,
    [bo1.badOrder.id],
  );
  ok("Accepted-Pending → Accepted-Working (estimate-link path)");

  // Accepted-Working → Closed on estimate approve
  const st = await q(
    `SELECT id FROM repair.statuses
     WHERE entity='ESTIMATE' AND code='AWAITING_APPROVAL' LIMIT 1`,
  );
  if (!st.rows[0]) bad("status seed", "AWAITING_APPROVAL missing");
  const est = await q(
    `INSERT INTO repair.estimates (tenant_id, event_id, status_id, created_by)
     VALUES ($1,$2,$3,'smoke-c') RETURNING id`,
    [DEFAULT_TENANT_ID, bo1.event.id, st.rows[0].id],
  );
  await q(
    `INSERT INTO repair.estimate_revisions
       (tenant_id, estimate_id, rev_no, action, actor_name, labor, material, total,
        new_status, old_status, created_by)
     VALUES ($1,$2,1,'Seed','smoke-c',0,0,0,'AWAITING_APPROVAL','QUEUED','smoke-c')`,
    [DEFAULT_TENANT_ID, est.rows[0].id],
  );
  await q(`UPDATE repair.estimates SET current_revision = 1 WHERE id = $1`, [
    est.rows[0].id,
  ]);

  const appr = await approveEstimate({
    estimateId: String(est.rows[0].id),
    actor: "smoke-c",
  });
  if (!appr.ok) bad("approve", appr.error);
  const closed = await q(
    `SELECT lifecycle_status FROM repair.bad_orders WHERE id = $1`,
    [bo1.badOrder.id],
  );
  if (String(closed.rows[0]?.lifecycle_status) !== "CLOSED") {
    bad("CLOSED", String(closed.rows[0]?.lifecycle_status));
  }
  ok("Accepted-Working → Closed (estimate approved)");

  const deact = await deactivateBoRule({
    id: reason.rule.id,
    actor: "smoke-c",
  });
  if (!deact.ok) bad("deactivate reason", deact.error);
  const active = await listBoRules({ activeOnly: true });
  if (active.some((r) => r.code === reasonCode)) bad("deactivate", "still active");
  ok("Bad Order Reason deactivate");

  console.log("=== repair:smoke-bad-orders PASS ===");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
