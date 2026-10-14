-- 20261014_repair_bad_orders_c.sql
--
-- OWNER_UI §C Bad Orders: form/history columns, STCC lookup, contacts
-- future RLMS link (rlms_contact_id), bo_rules UX rename hooks.
-- Local Postgres only. Schema "repair" only. No hard deletes.

BEGIN;

-- ── Bad Order form / history columns ─────────────────────────────────
ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS reporting_road text,
  ADD COLUMN IF NOT EXISTS dc_road text,
  ADD COLUMN IF NOT EXISTS stcc text,
  ADD COLUMN IF NOT EXISTS routing text,
  ADD COLUMN IF NOT EXISTS last_contents text,
  ADD COLUMN IF NOT EXISTS car_load text,
  ADD COLUMN IF NOT EXISTS cleaned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS travel_on_own_wheels boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS incident_date date,
  ADD COLUMN IF NOT EXISTS comments text,
  ADD COLUMN IF NOT EXISTS wreck_estimate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS multi_car_group_id uuid,
  ADD COLUMN IF NOT EXISTS arrival_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bad_orders_car_load_check'
  ) THEN
    ALTER TABLE repair.bad_orders
      ADD CONSTRAINT bad_orders_car_load_check
      CHECK (car_load IS NULL OR car_load IN ('EMPTY', 'LOADED'));
  END IF;
END $$;

COMMENT ON COLUMN repair.bad_orders.reporting_road IS
  'Reporting road (BO form).';
COMMENT ON COLUMN repair.bad_orders.dc_road IS
  'D/C (destination/connecting) road.';
COMMENT ON COLUMN repair.bad_orders.stcc IS
  'STCC commodity code (lookup + free entry).';
COMMENT ON COLUMN repair.bad_orders.travel_on_own_wheels IS
  'Travel on own wheels (Wheel Travel in history grid).';
COMMENT ON COLUMN repair.bad_orders.multi_car_group_id IS
  'Shared id when Multi Car creates several BOs together.';
COMMENT ON COLUMN repair.bad_orders.arrival_date IS
  'Owner-entered arrival date on create (optional; shop yard arrival is events.yard_arrived_at).';

-- Mirror reporting road onto events.damaging_road when useful is already separate;
-- keep events.ddct_event_id labeled "DDCT Event ID" in UI (no Estimate ID on BO).

-- ── STCC lookup (admin-extensible; seed only a few known codes) ───────
CREATE TABLE IF NOT EXISTS repair.stcc_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  description     text,
  active          boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, code)
);

COMMENT ON TABLE repair.stcc_codes IS
  'STCC commodity codes for Bad Order dropdown. Seed sparse known codes only; admins add more. Do not invent unmarked AAR lists.';

INSERT INTO repair.stcc_codes (tenant_id, code, description, sort_order, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', '4021125', 'Freight — generic (seed)', 10, 'migration:20261014_bad_orders_c'),
  ('00000000-0000-4000-8000-000000000001', '4611110', 'Empty car (seed)', 20, 'migration:20261014_bad_orders_c')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── Contacts: future RLMS Contacts module link ───────────────────────
ALTER TABLE repair.contacts
  ADD COLUMN IF NOT EXISTS rlms_contact_id text;

COMMENT ON COLUMN repair.contacts.rlms_contact_id IS
  'Nullable future link to RLMS Contacts module id. Local contacts table is source of truth today via ContactsProvider.';

-- ── bo_rules: allow additional keyed detail on rule-based reasons ────
ALTER TABLE repair.bo_rules
  ADD COLUMN IF NOT EXISTS allows_additional_detail boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN repair.bo_rules.allows_additional_detail IS
  'When true, owner may enter optional keyed detail in addition to the selected Bad Order Reason (rule-based). OTHER still requires text via requires_other_text.';

COMMENT ON TABLE repair.bo_rules IS
  'Owner-managed Bad Order Reason list (code + description + active). UX label: Bad Order Reason (not BO rule). Seeded RULE_1 / RULE_107 / OTHER only — do not invent full AAR shopping-reason lists.';

-- Open-BO duplicate guard helper index (car via event)
CREATE INDEX IF NOT EXISTS bad_orders_open_car_idx
  ON repair.bad_orders (tenant_id, lifecycle_status)
  WHERE deleted_at IS NULL
    AND lifecycle_status IN ('QUEUED', 'ACCEPTED_PENDING', 'ACCEPTED_WORKING');

COMMIT;
