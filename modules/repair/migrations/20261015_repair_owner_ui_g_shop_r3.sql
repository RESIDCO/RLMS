-- Owner UI §G r3 — smoke tags, closed-state clarity support.
-- Integer cents. Repair schema only.

BEGIN;

ALTER TABLE repair.shops
  ADD COLUMN IF NOT EXISTS is_smoke boolean NOT NULL DEFAULT false;

ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS is_smoke boolean NOT NULL DEFAULT false;

ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS is_smoke boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN repair.shops.is_smoke IS
  '§G r3 smoke/test shop — hidden from normal lists; clean via repair:clean-smoke-data';
COMMENT ON COLUMN repair.events.is_smoke IS
  '§G r3 smoke/test event — hidden from normal shop lists';
COMMENT ON COLUMN repair.bad_orders.is_smoke IS
  '§G r3 smoke/test bad order — hidden from normal lists';

CREATE INDEX IF NOT EXISTS repair_shops_is_smoke_idx
  ON repair.shops (tenant_id, is_smoke)
  WHERE deleted_at IS NULL AND is_smoke = true;

CREATE INDEX IF NOT EXISTS repair_events_is_smoke_idx
  ON repair.events (tenant_id, is_smoke)
  WHERE deleted_at IS NULL AND is_smoke = true;

COMMIT;
