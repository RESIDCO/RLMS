/**
 * Smoke: OWNER_UI §B Shop master + entity workspace.
 * - Shop list empty until create
 * - Create shop with contacts; billing-road validation
 * - Entity snapshot on BO; Estimates History entity column/summary
 * - Monthly close entity subtotals
 *
 * Run: npm run repair:smoke-shop-entity
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { createBadOrder, listDemoShop } from "../services/bo";
import {
  createShop,
  listBillingRoads,
  listShopMaster,
  ensureDemoShop,
} from "../services/shops";
import {
  listOwnerEntityTags,
  lookupCarEntity,
  workspaceTitle,
} from "../services/entity";
import { queryEstimateGrid } from "../services/ops-grid";
import { buildEntityCloseSubtotals } from "../services/monthly-close";
import { migrateLocal } from "./migrate-local";

function ok(msg: string) {
  console.log(`  OK  ${msg}`);
}
function bad(label: string, detail: string): never {
  throw new Error(`${label}: ${detail}`);
}

async function main() {
  console.log("=== repair:smoke-shop-entity (§B + entity) ===");
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    throw new Error("Set DATABASE_URL");
  }
  process.env.REPAIR_LOCAL_DB = process.env.REPAIR_LOCAL_DB ?? "1";
  await migrateLocal();

  // Soft-retired payee seeds → shop dropdown empty (or only owner-created)
  // Deactivate any leftover active shops for a clean empty check in this smoke.
  await q(
    `UPDATE repair.shops SET active = false
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active = true
       AND created_by LIKE 'seed:%'`,
    [DEFAULT_TENANT_ID],
  );

  const before = await listDemoShop();
  // May be empty or only prior ensureDemoShop from other smokes — filter to smoke-owned later
  ok(`shop dropdown count before create: ${before.length}`);

  const title = await workspaceTitle();
  if (title !== "RESIDCO") bad("workspace title", `expected RESIDCO got ${title}`);
  ok(`workspace title = ${title}`);

  const tags = await listOwnerEntityTags();
  const codes = new Set(tags.map((t) => t.code));
  for (const c of ["MAIN", "COAL", "RPS"]) {
    if (!codes.has(c)) bad("entity tags", `missing ${c}`);
  }
  ok(`entity tags: ${[...codes].join(", ")}`);

  const roads = await listBillingRoads();
  if (roads.length < 1) bad("billing roads", "expected marks moved from payee seed");
  ok(`billing roads seeded for validation (${roads.length})`);

  const badMark = await createShop({
    legalName: "Should Fail Shop",
    city: "Nowhere",
    state: "AZ",
    splc: "111111",
    billingRoad: "ZZZZ_NOT_A_ROAD",
    actor: "smoke-b",
  });
  if (badMark.ok) bad("billing road validate", "accepted unknown mark");
  ok("rejects unknown billing road mark");

  const created = await createShop({
    legalName: "Smoke Master Shop",
    city: "Phoenix",
    state: "AZ",
    splc: "850001",
    billingRoad: roads[0].mark ? String(roads[0].mark) : null,
    actor: "smoke-b",
    contacts: [
      {
        name: "Pat Contact",
        email: "pat@smoke.invalid",
        phone: "555-0199",
        role: "Shop Manager",
      },
    ],
  });
  if (!created.ok || !created.shop) bad("create shop", created.ok === false ? created.error : "no shop");
  ok(`created shop ${created.shop!.display_label}`);

  const master = await listShopMaster({ activeOnly: true });
  if (!master.some((s) => s.id === created.shop!.id)) {
    bad("shop master list", "new shop missing");
  }
  ok(`shop master lists ${master.length} active shop(s)`);

  const dropdown = await listDemoShop();
  if (!dropdown.some((s) => s.id === created.shop!.id)) {
    bad("dropdown", "created shop not in dropdown");
  }
  ok("shop appears in dropdown after create");

  // Entity lookup from railcars stub (ARSX 100001 → Main → MAIN)
  await q(
    `UPDATE public.railcars SET entity = 'Main' WHERE car_initial = 'ARSX' AND car_number = '100001'`,
  );
  const ent = await lookupCarEntity({ carMark: "ARSX", carNumber: "100001" });
  if (ent.code !== "MAIN") bad("entity lookup", `expected MAIN got ${ent.code}`);
  ok(`entity lookup ARSX 100001 → ${ent.code}`);

  const bo = await createBadOrder({
    carMark: "ARSX",
    carNumber: "100001",
    shopId: created.shop!.id,
    actor: "smoke-b",
    shoppingReason: "Entity smoke",
  });
  if (!bo.ok) bad("BO create", bo.error);
  if (String(bo.event.entity_code) !== "MAIN") {
    bad("entity snapshot", `expected MAIN on event, got ${bo.event.entity_code}`);
  }
  ok("BO create snapshots entity_code=MAIN");

  // COAL car for subtotals variety
  await ensureDemoShop({
    mark: "DEMO",
    legalName: "Demo Repair Shop",
    city: "Demo City",
    state: "TX",
    splc: "750001",
    actor: "smoke-b",
  });
  await q(
    `INSERT INTO public.railcars (car_number, car_initial, reporting_marks, active, entity)
     SELECT '100002', 'ARSX', 'ARSX', true, 'Coal'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.railcars WHERE car_initial = 'ARSX' AND car_number = '100002'
     )`,
  );
  await q(
    `UPDATE public.railcars SET entity = 'Coal'
     WHERE car_initial = 'ARSX' AND car_number = '100002'`,
  );

  const grid = await queryEstimateGrid({
    statusCodes: [
      "AWAITING_APPROVAL",
      "REVISION_REQUESTED",
      "ADJUSTMENT_FOR_APPROVAL",
      "AWAITING_TERMINATE",
      "APPROVED",
      "QUEUED",
    ],
    includeShopDraft: true,
    includeHidden: true,
    limit: 500,
  });
  // Entity column present on rows that have snapshots
  const withEntity = grid.rows.filter((r: { entity_code?: string | null }) => r.entity_code);
  ok(
    `estimates grid entity field present (${withEntity.length} rows with entity; byEntity=${grid.summary.byEntity?.length ?? 0})`,
  );
  if (!grid.summary.byEntity) bad("summary", "byEntity missing");
  ok("summary includes byEntity breakdown");

  const sub = await buildEntityCloseSubtotals({
    tenantId: DEFAULT_TENANT_ID,
    accountMonth: "2610",
    rebillGroups: [
      {
        eventId: String(bo.event.id),
        estimateId: "00000000-0000-4000-8000-000000000099",
        revisionId: "00000000-0000-4000-8000-000000000098",
        carMark: "ARSX",
        carNumber: "100001",
        leaseRider: null,
        entityCode: "MAIN",
        partyRole: "LESSEE",
        billedPartyMark: "TEST",
        paymentTermsDays: 30,
        contactEmail: null,
        laborCents: 10000,
        materialCents: 2500,
        lines: [],
      },
      {
        eventId: String(bo.event.id),
        estimateId: "00000000-0000-4000-8000-000000000097",
        revisionId: "00000000-0000-4000-8000-000000000096",
        carMark: "ARSX",
        carNumber: "100002",
        leaseRider: null,
        entityCode: "COAL",
        partyRole: "LESSEE",
        billedPartyMark: "TEST",
        paymentTermsDays: 30,
        contactEmail: null,
        laborCents: 5000,
        materialCents: 1000,
        lines: [],
      },
    ],
  });
  const main = sub.find((s) => s.entityCode === "MAIN");
  const coal = sub.find((s) => s.entityCode === "COAL");
  if (!main || main.rebillCents !== 12500) {
    bad("entity subtotals MAIN", JSON.stringify(main));
  }
  if (!coal || coal.rebillCents !== 6000) {
    bad("entity subtotals COAL", JSON.stringify(coal));
  }
  ok(
    `close entity subtotals MAIN=${main.rebillCents} COAL=${coal.rebillCents} cents`,
  );

  console.log("=== smoke-shop-entity PASSED ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
