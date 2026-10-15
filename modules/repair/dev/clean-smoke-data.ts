/**
 * §G r3 — Soft-delete smoke-tagged shops / events / bad orders (local DB only).
 * Requires REPAIR_LOCAL_DB=1. Never touches non-smoke rows.
 *
 * Run: npm run repair:clean-smoke-data
 */
import { DEFAULT_TENANT_ID, q } from "../db";
import { migrateLocal } from "./migrate-local";

function ok(m: string) {
  console.log(`  OK  ${m}`);
}

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
