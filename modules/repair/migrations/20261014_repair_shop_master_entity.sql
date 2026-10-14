-- 20261014_repair_shop_master_entity.sql
-- Owner UI §B Shop master + RESIDCO entity/workspace tags.
-- APPLY ONLY to local Postgres. Schema "repair" only (+ local stub columns).
--
-- Rules:
--   • Shop dropdown empty until owner creates shops (never seed from payee/billing roads).
--   • Billing roads = separate lookup for optional mark validation only.
--   • Shops never hard-deleted — deactivate (active=false) / soft-delete.
--   • Entity tags MAIN/COAL/RPS snapshotted onto BO/estimate at create.

BEGIN;

-- ── Shop master columns ───────────────────────────────────────────────
ALTER TABLE repair.shops
  ADD COLUMN IF NOT EXISTS splc text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN repair.shops.name IS
  'Legal name (shop master). Display everywhere as Name – City, ST.';
COMMENT ON COLUMN repair.shops.splc IS
  'SPLC location code (required for owner-created shops).';
COMMENT ON COLUMN repair.shops.active IS
  'false = deactivated (hidden from dropdowns). Never hard-delete.';
COMMENT ON COLUMN repair.shops.billing_road IS
  'Optional mark / billing road — must exist in repair.billing_roads when set.';
COMMENT ON COLUMN repair.shops.reporting_mark IS
  'Internal key / optional mark. May match billing_road when provided.';

-- Contacts: phone + role for shop contact bank
ALTER TABLE repair.contacts
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS role text;

COMMENT ON COLUMN repair.contacts.role IS
  'Contact role (e.g. Shop Manager, Billing).';

-- ── Billing roads (validation only — NOT the shop list) ───────────────
CREATE TABLE IF NOT EXISTS repair.billing_roads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  mark            text NOT NULL,
  name            text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, mark)
);

COMMENT ON TABLE repair.billing_roads IS
  'Billing road / railroad marks for optional shop mark validation. Not selectable as shops.';

CREATE INDEX IF NOT EXISTS billing_roads_tenant_active_idx
  ON repair.billing_roads (tenant_id, mark)
  WHERE deleted_at IS NULL AND active;

-- Move former payee-list "shops" into billing_roads, then soft-remove from shop master.
INSERT INTO repair.billing_roads (tenant_id, mark, name, active, created_by)
SELECT tenant_id, upper(btrim(reporting_mark)), name, true, 'migration:shop-master'
FROM repair.shops
WHERE deleted_at IS NULL
  AND created_by = 'seed:payee-list'
  AND nullif(btrim(reporting_mark), '') IS NOT NULL
ON CONFLICT (tenant_id, mark) DO UPDATE SET
  name = COALESCE(EXCLUDED.name, repair.billing_roads.name),
  active = true
  WHERE repair.billing_roads.deleted_at IS NULL;

UPDATE repair.shops
SET
  deleted_at = COALESCE(deleted_at, now()),
  deleted_by = COALESCE(deleted_by, 'migration:shop-master'),
  delete_reason = COALESCE(
    delete_reason,
    'Not a shop — payee/billing-road seed retired from shop master (OWNER_UI §B)'
  ),
  active = false
WHERE created_by = 'seed:payee-list'
  AND deleted_at IS NULL;

-- Also soft-remove any remaining railroad-looking seeds that polluted the shop list
-- (created_by variants) while leaving owner-created shops alone.
UPDATE repair.shops
SET
  deleted_at = COALESCE(deleted_at, now()),
  deleted_by = COALESCE(deleted_by, 'migration:shop-master'),
  delete_reason = COALESCE(delete_reason, 'Retired non-shop seed entry'),
  active = false
WHERE deleted_at IS NULL
  AND created_by IN ('seed:payee-list', 'seed:billing-roads', 'seed:railroads');

-- Partial unique: allow re-create of a mark after soft-delete
ALTER TABLE repair.shops DROP CONSTRAINT IF EXISTS shops_tenant_id_reporting_mark_key;
DROP INDEX IF EXISTS repair.shops_tenant_id_reporting_mark_key;
CREATE UNIQUE INDEX IF NOT EXISTS shops_tenant_mark_active_uidx
  ON repair.shops (tenant_id, reporting_mark)
  WHERE deleted_at IS NULL;

-- ── Owner entity tags (per-tenant configurable) ───────────────────────
CREATE TABLE IF NOT EXISTS repair.owner_entity_tags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,           -- MAIN / COAL / RPS
  display_name    text NOT NULL,           -- label in UI
  source_value    text,                   -- railcars.entity value (Main / Coal / …)
  sort_order      int NOT NULL DEFAULT 100,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, code)
);

COMMENT ON TABLE repair.owner_entity_tags IS
  'Per-owner entity tags shown in Estimates History / close. RESIDCO defaults MAIN/COAL/RPS; other clients may hide/add.';

INSERT INTO repair.owner_entity_tags
  (tenant_id, code, display_name, source_value, sort_order, active, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'MAIN', 'MAIN', 'Main', 10, true, 'migration:shop-master'),
  ('00000000-0000-4000-8000-000000000001', 'COAL', 'COAL', 'Coal', 20, true, 'migration:shop-master'),
  ('00000000-0000-4000-8000-000000000001', 'RPS',  'RPS',  'Rail Partners Select', 30, true, 'migration:shop-master')
ON CONFLICT (tenant_id, code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  source_value = EXCLUDED.source_value,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active
  WHERE repair.owner_entity_tags.deleted_at IS NULL;

-- Workspace title for owner UI (single login covering all entities)
UPDATE repair.tenants
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'workspaceTitle', 'RESIDCO'
)
WHERE id = '00000000-0000-4000-8000-000000000001';

-- ── Entity snapshot columns ───────────────────────────────────────────
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS entity_code text,
  ADD COLUMN IF NOT EXISTS entity_source_value text,
  ADD COLUMN IF NOT EXISTS entity_corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS entity_corrected_by text,
  ADD COLUMN IF NOT EXISTS entity_correction_reason text;

ALTER TABLE repair.estimates
  ADD COLUMN IF NOT EXISTS entity_code text,
  ADD COLUMN IF NOT EXISTS entity_source_value text;

ALTER TABLE repair.invoices
  ADD COLUMN IF NOT EXISTS entity_code text;

ALTER TABLE repair.estimate_lines
  ADD COLUMN IF NOT EXISTS entity_code text;

ALTER TABLE repair.billing_lines
  ADD COLUMN IF NOT EXISTS entity_code text;

ALTER TABLE repair.close_run_events
  ADD COLUMN IF NOT EXISTS entity_code text;

ALTER TABLE repair.rebuttal_invoices
  ADD COLUMN IF NOT EXISTS entity_code text;

COMMENT ON COLUMN repair.events.entity_code IS
  'Snapshot at BO/create: MAIN / COAL / RPS (or tenant tag). Carried to estimate/invoice/CRIP/rebill.';

-- Admin correction audit (append-only)
CREATE TABLE IF NOT EXISTS repair.entity_corrections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  estimate_id     uuid REFERENCES repair.estimates(id),
  old_code        text,
  new_code        text NOT NULL,
  reason          text NOT NULL,
  actor           text NOT NULL,
  corrected_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS entity_corrections_event_idx
  ON repair.entity_corrections (event_id, corrected_at DESC);

DROP TRIGGER IF EXISTS entity_corrections_no_update ON repair.entity_corrections;
CREATE TRIGGER entity_corrections_no_update
  BEFORE UPDATE ON repair.entity_corrections
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS entity_corrections_no_delete ON repair.entity_corrections;
CREATE TRIGGER entity_corrections_no_delete
  BEFORE DELETE ON repair.entity_corrections
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

-- ── cars_ref: expose railcars.entity for lookup ───────────────────────
-- DROP before CREATE so re-apply / force migrate never hits checkViewColumns
-- when column lists change across migrations.
DROP VIEW IF EXISTS repair.cars_ref CASCADE;
CREATE VIEW repair.cars_ref AS
SELECT
  r.id AS rlms_railcar_id,
  COALESCE(NULLIF(r.car_initial, ''), NULLIF(r.reporting_marks, ''), '') AS car_mark,
  r.car_number,
  COALESCE(r.active, false) AS active_flag,
  EXISTS (
    SELECT 1
    FROM public.v_valid_export_rows v
    WHERE v.car_number = r.car_number
      AND COALESCE(v.car_initial, '') = COALESCE(r.car_initial, '')
      AND v.active = 1
  ) AS in_vcf,
  r.rider_external_id AS lease_rider,
  r.assignment_label AS current_assignment,
  r.current_assignment_id AS current_assignment_id,
  r.lessee_name,
  r.comment_event_note AS remarks,
  r.fleet_status,
  r.managed,
  r.managed_category,
  r.entity AS entity_source
FROM public.railcars r;

COMMENT ON VIEW repair.cars_ref IS
  'Read-only car reference for the repair module. Includes entity_source from railcars.entity.';

COMMIT;
