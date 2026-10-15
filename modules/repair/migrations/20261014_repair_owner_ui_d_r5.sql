-- Owner UI §D Estimate Review r5
-- Reference Data admin: retire/restore (no hard-delete), owner override,
-- change history, import edition ledger extensions.

-- ── Soft-retire / override columns on every ref table ─────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ref_job_codes',
    'ref_job_code_prices',
    'ref_qualifiers',
    'ref_qualifier_generic',
    'ref_qualifier_charts',
    'ref_why_made',
    'ref_condition_codes',
    'ref_location_codes',
    'ref_responsibility_codes',
    'ref_car_part_codes',
    'ref_repair_categories',
    'component_id_rules'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE repair.%I
         ADD COLUMN IF NOT EXISTS effective_to date,
         ADD COLUMN IF NOT EXISTS owner_override boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS retired_at timestamptz,
         ADD COLUMN IF NOT EXISTS retired_by text,
         ADD COLUMN IF NOT EXISTS retire_reason text',
      t
    );
  END LOOP;
END $$;

COMMENT ON COLUMN repair.ref_job_codes.effective_to IS
  'Set when retired; older estimates keep descriptions; new lines warn/reject.';
COMMENT ON COLUMN repair.ref_job_codes.owner_override IS
  'When true, RESIDCO manual row wins over AAR import conflict.';

-- ── Append-only change history for Reference Data admin ───────────────
CREATE TABLE IF NOT EXISTS repair.ref_data_changes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  table_name      text NOT NULL,
  row_id          uuid,
  natural_key     text NOT NULL,
  action          text NOT NULL, -- ADD | EDIT | RETIRE | RESTORE | IMPORT
  reason          text NOT NULL,
  before_json     jsonb,
  after_json      jsonb,
  actor           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS repair_ref_data_changes_table_idx
  ON repair.ref_data_changes (tenant_id, table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS repair_ref_data_changes_row_idx
  ON repair.ref_data_changes (tenant_id, table_name, row_id, created_at DESC);

-- ── Import ledger: dry-run vs commit + conflict counts ────────────────
ALTER TABLE repair.ref_data_editions
  ADD COLUMN IF NOT EXISTS dry_run boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS added_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS changed_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retired_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conflict_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by text;

COMMENT ON TABLE repair.ref_data_changes IS
  'Reference Data admin audit: every add/edit/retire/restore/import with reason.';
