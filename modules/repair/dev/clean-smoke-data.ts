/**
 * §G r3 / §H r2 / §H r4 — Soft-delete smoke-tagged shops / events / bad orders,
 * smoke invoices (GA*, INV-R4*, INV-H-*), legacy APA-OFOX528313, and stale
 * DEMO-* invoices/events left by older seed runs (wrong shop, duplicates,
 * renamed DEMO-INV-UNIT5). Keeps the current DS01 DEMO seed set intact.
 * Requires REPAIR_LOCAL_DB=1.
 *
 * Run: npm run repair:clean-smoke-data
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { migrateLocal } from "./migrate-local";

function ok(m: string) {
  console.log(`  OK  ${m}`);
}

/** Smoke invoice number patterns from §G/§H smokes (+ legacy APA). */
const SMOKE_INVOICE_NO_SQL = `
  invoice_no ~ '^(GA|INV-R4|INV-H-)'
  OR invoice_no LIKE 'GA%'
  OR invoice_no LIKE 'INV-R4%'
  OR invoice_no LIKE 'INV-H-%'
  OR invoice_no = 'APA-OFOX528313'
  OR invoice_no = 'DEMO-INV-UNIT5'
`;

async function main() {
  console.log("=== repair:clean-smoke-data ===");
  if (process.env.REPAIR_LOCAL_DB !== "1") {
    throw new Error("Refusing: set REPAIR_LOCAL_DB=1 (local DB only)");
  }
  process.env.REPAIR_DEV_BYPASS_AUTH = process.env.REPAIR_DEV_BYPASS_AUTH ?? "1";
  if (!process.env.DATABASE_URL && !process.env.REPAIR_DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev";
  }

  await migrateLocal();

  const actor = "clean-smoke-data";

  // Soft-delete smoke invoices first (by number pattern + smoke events)
  const { rowCount: invN } = await q(
    `UPDATE repair.invoices i
     SET deleted_at = coalesce(i.deleted_at, now()), deleted_by = $1
     WHERE i.deleted_at IS NULL
       AND i.tenant_id = $2
       AND (
         ${SMOKE_INVOICE_NO_SQL}
         OR EXISTS (
           SELECT 1 FROM repair.events e
           WHERE e.id = i.event_id AND e.is_smoke = true
         )
         OR coalesce(i.created_by, '') IN ('smoke-h', 'smoke-g', 'smoke-g-r4')
       )`,
    [actor, DEFAULT_TENANT_ID],
  );
  ok(`soft-deleted smoke invoices (${invN ?? 0})`);

  await q(
    `UPDATE repair.invoice_cars ic
     SET line_status = 'REJECTED',
         reject_reason = coalesce(reject_reason, 'smoke clean')
     WHERE ic.line_status = 'ACTIVE'
       AND EXISTS (
         SELECT 1 FROM repair.invoices i
         WHERE i.id = ic.invoice_id AND i.deleted_at IS NOT NULL
       )`,
  );
  ok("deactivated invoice_cars for deleted invoices");

  const { rowCount: apaN } = await q(
    `UPDATE repair.invoices
     SET deleted_at = coalesce(deleted_at, now()), deleted_by = $1
     WHERE deleted_at IS NULL AND tenant_id = $2
       AND invoice_no = 'APA-OFOX528313'`,
    [actor, DEFAULT_TENANT_ID],
  );
  ok(`hid legacy APA-OFOX528313 (${apaN ?? 0})`);

  // §H r4 — hide stale DEMO-* from older seed runs (wrong/deleted shop,
  // duplicate cars, renamed UNIT5). Keep invoices on the live DS01 shop.
  const { rows: ds01 } = await q(
    `SELECT id FROM repair.shops
     WHERE deleted_at IS NULL
       AND (upper(shop_mark) = 'DS01' OR upper(reporting_mark) = 'DS01')
     ORDER BY created_at ASC LIMIT 1`,
  );
  const ds01Id = ds01[0] ? String(ds01[0].id) : null;

  if (ds01Id) {
    // Soft-delete duplicate DEMO events (keep oldest per car on DS01)
    const { rowCount: dupEvN } = await q(
      `UPDATE repair.events e
       SET deleted_at = coalesce(e.deleted_at, now()), deleted_by = $1
       WHERE e.deleted_at IS NULL
         AND e.tenant_id = $2
         AND e.car_mark = 'DEMO'
         AND e.id NOT IN (
           SELECT DISTINCT ON (car_number) id
           FROM repair.events
           WHERE deleted_at IS NULL AND tenant_id = $2 AND car_mark = 'DEMO'
             AND shop_id = $3::uuid
           ORDER BY car_number, created_at ASC
         )
         AND (
           e.shop_id IS DISTINCT FROM $3::uuid
           OR EXISTS (
             SELECT 1 FROM repair.events e2
             WHERE e2.deleted_at IS NULL AND e2.tenant_id = $2
               AND e2.car_mark = 'DEMO' AND e2.car_number = e.car_number
               AND e2.shop_id = $3::uuid AND e2.created_at < e.created_at
           )
         )`,
      [actor, DEFAULT_TENANT_ID, ds01Id],
    );
    ok(`hid stale/duplicate DEMO events (${dupEvN ?? 0})`);
  } else {
    ok("no live DS01 — skipped DEMO event prune");
  }

  const { rowCount: staleDemoInvN } = await q(
    `UPDATE repair.invoices i
     SET deleted_at = coalesce(i.deleted_at, now()), deleted_by = $1,
         delete_reason = coalesce(i.delete_reason, 'stale DEMO seed')
     WHERE i.deleted_at IS NULL
       AND i.tenant_id = $2
       AND i.invoice_no LIKE 'DEMO-%'
       AND (
         i.invoice_no = 'DEMO-INV-UNIT5'
         OR NOT EXISTS (
           SELECT 1 FROM repair.events e
           WHERE e.id = i.event_id AND e.deleted_at IS NULL
         )
         OR (
           $3::uuid IS NOT NULL
           AND i.shop_id IS DISTINCT FROM $3::uuid
         )
       )`,
    [actor, DEFAULT_TENANT_ID, ds01Id],
  );
  ok(`hid stale DEMO-* invoices (${staleDemoInvN ?? 0})`);

  await q(
    `UPDATE repair.bad_orders bo
     SET deleted_at = coalesce(bo.deleted_at, now()), deleted_by = $1
     WHERE bo.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM repair.events e
         WHERE e.id = bo.event_id AND e.deleted_at IS NOT NULL
           AND e.car_mark = 'DEMO'
       )`,
    [actor],
  );
  ok("hid bad_orders for deleted DEMO events");

  // Soft-delete payment batches that only reference deleted smoke invoices,
  // or were created by smoke actors / empty after smoke clean
  const { rowCount: batchN } = await q(
    `UPDATE repair.payment_batches b
     SET deleted_at = coalesce(b.deleted_at, now()), deleted_by = $1
     WHERE b.deleted_at IS NULL
       AND b.tenant_id = $2
       AND (
         coalesce(b.created_by, '') IN ('smoke-h', 'owner@smoke-h.test', 'smoke-g')
         OR NOT EXISTS (
           SELECT 1 FROM repair.invoices i
           WHERE i.payment_batch_id = b.id AND i.deleted_at IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM repair.invoices i
           WHERE i.payment_batch_id = b.id
             AND (
               i.invoice_no ~ '^(GA|INV-R4|INV-H-)'
               OR i.invoice_no LIKE 'INV-H-%'
             )
         )
       )`,
    [actor, DEFAULT_TENANT_ID],
  );
  ok(`soft-deleted smoke payment batches (${batchN ?? 0})`);

  const { rowCount: boN } = await q(
    `UPDATE repair.bad_orders
     SET deleted_at = coalesce(deleted_at, now()), deleted_by = $1
     WHERE is_smoke = true AND deleted_at IS NULL`,
    [actor],
  );
  ok(`soft-deleted smoke bad_orders (${boN ?? 0})`);

  const { rowCount: evN } = await q(
    `UPDATE repair.events
     SET deleted_at = coalesce(deleted_at, now()), deleted_by = $1
     WHERE is_smoke = true AND deleted_at IS NULL`,
    [actor],
  );
  ok(`soft-deleted smoke events (${evN ?? 0})`);

  const { rowCount: shN } = await q(
    `UPDATE repair.shops
     SET deleted_at = coalesce(deleted_at, now()), deleted_by = $1, active = false
     WHERE is_smoke = true AND deleted_at IS NULL`,
    [actor],
  );
  ok(`soft-deleted smoke shops (${shN ?? 0})`);

  // Also catch legacy §G smoke marks GA*/GB* with legal names containing §G Shop
  const { rowCount: legacy } = await q(
    `UPDATE repair.shops
     SET is_smoke = true,
         deleted_at = coalesce(deleted_at, now()),
         deleted_by = $1,
         active = false
     WHERE deleted_at IS NULL
       AND tenant_id = $2
       AND (
         name LIKE '§G Shop %'
         OR (shop_mark ~ '^GA[0-9A-Z]{2}$' AND created_by = 'smoke-g')
         OR (shop_mark ~ '^GB[0-9A-Z]{2}$' AND created_by = 'smoke-g')
       )`,
    [actor, DEFAULT_TENANT_ID],
  );
  ok(`legacy §G Shop A/B smoke marks cleaned (${legacy ?? 0})`);

  console.log("=== repair:clean-smoke-data PASS ===");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
