/**
 * Smoke: OWNER_UI §B Shop master + entity workspace.
 * - Shop list empty until create
 * - Create shop with contacts; billing-road validation
 * - Optional shop mark / delivering lines / capabilities / car types / certs
 * - BO dropdown label "Name (MARK) – City, ST"
 * - Entity snapshot on BO; Estimates History entity column/summary
 * - Monthly close entity subtotals
 * - Tracked migrate (idempotent on already-migrated DB)
 *
 * Run: npm run repair:smoke-shop-entity
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { createBadOrder, listDemoShop } from "../services/bo";
import {
  certExpiryWarning,
  createShop,
  formatShopLabel,
  getShopRecentActivity,
  listBillingRoads,
  listShopMaster,
  ensureDemoShop,
  updateShop,
  uploadShopDocument,
} from "../services/shops";
import { listCatalog } from "../services/shop-catalog";
import {
  formatRailroadLabel,
  listRailroads,
  seedRailroadsFromNarn,
} from "../services/railroads";
import { geocodeCityState, seedPlacesFromBundle } from "../services/places";
import { listShopMapPins } from "../services/shop-map";
import { softDeleteDocument } from "../services/gap-lifecycle-06";
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
  // Deactivate leftover smoke/seed shops so re-runs don't collide on reporting_mark.
  await q(
    `UPDATE repair.shops SET active = false
     WHERE tenant_id = $1 AND deleted_at IS NULL AND active = true
       AND (created_by LIKE 'seed:%' OR created_by = 'smoke-b')`,
    [DEFAULT_TENANT_ID],
  );
  // Soft-delete prior smoke shops so unique (tenant, reporting_mark) can reuse marks
  await q(
    `UPDATE repair.shops
     SET deleted_at = COALESCE(deleted_at, now()),
         deleted_by = COALESCE(deleted_by, 'smoke-b'),
         delete_reason = COALESCE(delete_reason, 'smoke re-run'),
         active = false
     WHERE tenant_id = $1 AND created_by = 'smoke-b' AND deleted_at IS NULL`,
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

  const caps = await listCatalog("capability");
  const cars = await listCatalog("car_type");
  const certs = await listCatalog("cert_type");
  if (caps.length < 1 || cars.length < 1 || certs.length < 1) {
    bad("catalogs", "expected seeded capability/car_type/cert_type");
  }
  ok(
    `admin catalogs seeded caps=${caps.length} cars=${cars.length} certs=${certs.length}`,
  );

  const seededRr = await seedRailroadsFromNarn();
  if (seededRr.total < 100) bad("railroads seed", `expected ≥100 got ${seededRr.total}`);
  ok(
    `railroads seeded total=${seededRr.total} inserted=${seededRr.inserted} updated=${seededRr.updated}`,
  );

  const bpHits = await listRailroads(undefined, { q: "BP", limit: 20 });
  const bprr = bpHits.find((r) => r.mark === "BPRR");
  if (!bprr) bad("railroad typeahead", "BP did not find BPRR");
  const bpLabel = formatRailroadLabel(bprr);
  if (!bpLabel.includes("BPRR") || !/Buffalo/i.test(bpLabel)) {
    bad("railroad label", bpLabel);
  }
  ok(`typeahead BP → ${bpLabel}`);

  const manualLine = await createShop({
    legalName: "Manual Line Shop",
    city: "Tucson",
    state: "AZ",
    splc: "222222",
    deliveringLines: ["ZZZZMAN"],
    actor: "smoke-b",
  });
  if (!manualLine.ok || !manualLine.shop) {
    bad(
      "manual delivering line",
      manualLine.ok === false ? manualLine.error : "no shop",
    );
  }
  const z = manualLine.shop!.delivering_lines.find((l) => l.mark === "ZZZZMAN");
  if (!z?.needs_review || !z.manual_entry) {
    bad("manual flag", JSON.stringify(z));
  }
  ok("unknown delivering mark accepted as manual + needs_review");

  const soon = new Date();
  soon.setUTCDate(soon.getUTCDate() + 30);
  const soonStr = soon.toISOString().slice(0, 10);

  const created = await createShop({
    legalName: "Guardian Rail Services",
    city: "Phoenix",
    state: "AZ",
    splc: "850001",
    billingRoad: roads[0].mark ? String(roads[0].mark) : null,
    shopMark: "A084",
    website: "https://smoke.example.invalid",
    hoursNotes: "Mon–Fri 0700–1700",
    deliveringLines: ["BPRR", "NS"],
    capabilityIds: [caps[0].id],
    carTypeIds: [cars[0].id],
    certifications: [
      {
        certTypeId: certs[0].id,
        certTypeLabel: certs[0].display_name,
        certificateNumber: "CERT-SMOKE-1",
        expiresOn: soonStr,
      },
    ],
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
  const expectedLabel = "Guardian Rail Services (A084) – Phoenix, AZ";
  if (created.shop!.display_label !== expectedLabel) {
    bad("shop label", `expected "${expectedLabel}" got "${created.shop!.display_label}"`);
  }
  ok(`created shop ${created.shop!.display_label}`);
  if (created.shop!.shop_mark !== "A084") bad("shop_mark", String(created.shop!.shop_mark));
  if ((created.shop!.delivering_lines?.length ?? 0) < 2) {
    bad("delivering_lines", "expected BPRR+NS");
  }
  const knownLine = created.shop!.delivering_lines.find((l) => l.mark === "BPRR");
  if (!knownLine || knownLine.needs_review || knownLine.manual_entry) {
    bad("known delivering line", JSON.stringify(knownLine));
  }
  ok(`delivering lines from railroads: ${created.shop!.delivering_lines.map((l) => l.mark).join(",")}`);

  const recent = await getShopRecentActivity(created.shop!.id);
  if (!Array.isArray(recent.badOrders) || !Array.isArray(recent.estimates)) {
    bad("shop profile recent", "missing arrays");
  }
  ok("shop profile recent activity shape ok");
  if ((created.shop!.capability_ids?.length ?? 0) < 1) {
    bad("capabilities", "expected ≥1");
  }
  if ((created.shop!.car_type_ids?.length ?? 0) < 1) {
    bad("car_types", "expected ≥1");
  }
  if ((created.shop!.certifications?.length ?? 0) < 1) {
    bad("certifications", "expected ≥1");
  }
  if (created.shop!.certifications[0].expiry_warning !== "expiring_soon") {
    bad(
      "cert warning",
      `expected expiring_soon got ${created.shop!.certifications[0].expiry_warning}`,
    );
  }
  ok("optional shop fields saved (mark/lines/caps/cars/certs/website)");
  if (certExpiryWarning("2000-01-01") !== "expired") {
    bad("certExpiryWarning", "expected expired for past date");
  }
  ok("certExpiryWarning expired/soon helpers");

  // §B part 3 — places geocode + map pins + lat/lng override
  const placesSeed = await seedPlacesFromBundle();
  if (placesSeed.total < 1000) {
    bad("places seed", `expected ≥1000 places got ${placesSeed.total}`);
  }
  ok(`places seeded (${placesSeed.total} US/CA/MX)`);
  const phoenix = await geocodeCityState("Phoenix", "AZ");
  if (!phoenix || Math.abs(phoenix.lat - 33.45) > 1) {
    bad("geocode Phoenix AZ", JSON.stringify(phoenix));
  }
  ok(`geocode City/ST → ${phoenix!.lat},${phoenix!.lng}`);
  if (
    created.shop!.coord_source !== "places" ||
    created.shop!.lat == null ||
    created.shop!.lng == null
  ) {
    bad(
      "shop geocode",
      `expected places coords got source=${created.shop!.coord_source} lat=${created.shop!.lat}`,
    );
  }
  ok("shop pin from places (Phoenix, AZ)");
  const mapPins = await listShopMapPins({ activeOnly: true });
  const pin = mapPins.pins.find((p) => p.id === created.shop!.id);
  if (!pin) bad("map pins", "created shop missing from map");
  ok(`map pins include shop (${mapPins.pins.length} total)`);
  const overridden = await updateShop({
    shopId: created.shop!.id,
    latOverride: 35.1,
    lngOverride: -106.6,
    actor: "smoke-b",
  });
  if (!overridden.ok || !overridden.shop) {
    bad(
      "lat override",
      overridden.ok === false ? overridden.error : "no shop",
    );
  }
  if (
    overridden.shop!.coord_source !== "override" ||
    overridden.shop!.lat_override !== 35.1
  ) {
    bad("override source", JSON.stringify(overridden.shop));
  }
  ok("manual lat/lng override wins over places");

  const dropdownLabel = formatShopLabel({
    name: "Guardian Rail Services",
    shop_mark: "A084",
    city: "Phoenix",
    state: "AZ",
  });
  if (dropdownLabel !== expectedLabel) {
    bad("formatShopLabel", dropdownLabel);
  }
  ok(`BO dropdown label format = ${dropdownLabel}`);

  const up = await uploadShopDocument({
    shopId: created.shop!.id,
    kind: "w9",
    actor: "smoke-b",
    file: {
      filename: "w9-smoke.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 smoke"),
    },
  });
  if (!up.ok) bad("shop document upload", up.error);
  const voided = await softDeleteDocument({
    documentId: String(up.document.id),
    actor: "smoke-b",
    reason: "smoke void shop attachment",
  });
  if (!voided.ok) bad("shop document void", voided.error);
  if (String(voided.document.lifecycle_status) !== "VOIDED") {
    bad("void status", String(voided.document.lifecycle_status));
  }
  ok("shop attachment upload + VOIDED (retained)");

  // Second migrate must skip (tracked) — no view column-drop error
  await migrateLocal();
  ok("second migrateLocal skipped already-applied files");

  const master = await listShopMaster({ activeOnly: true });
  if (!master.some((s) => s.id === created.shop!.id)) {
    bad("shop master list", "new shop missing");
  }
  const searched = await listShopMaster({
    activeOnly: true,
    search: "A084",
  });
  if (!searched.some((s) => s.id === created.shop!.id)) {
    bad("search shop_mark", "A084 not found");
  }
  ok(`shop master lists ${master.length} active; searchable by shop mark`);

  const dropdown = await listDemoShop();
  const dd = dropdown.find((s) => s.id === created.shop!.id);
  if (!dd) bad("dropdown", "created shop not in dropdown");
  if (dd.display_label !== expectedLabel) {
    bad("dropdown label", dd.display_label);
  }
  ok("shop appears in dropdown after create with mark in label");

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
    `INSERT INTO public.railcars (id, car_number, car_initial, reporting_marks, active, entity)
     SELECT GREATEST(COALESCE((SELECT MAX(id) FROM public.railcars), 0), 50000) + 1,
            '100002', 'ARSX', 'ARSX', true, 'Coal'
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
