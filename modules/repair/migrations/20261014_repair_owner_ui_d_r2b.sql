-- 20261014_repair_owner_ui_d_r2b.sql
-- Align ref_qualifiers / ref_job_code_prices keys with Bruce’s licensed CSV shape.

BEGIN;

ALTER TABLE repair.ref_qualifiers
  ADD COLUMN IF NOT EXISTS job_code text;

-- Drop overly-narrow unique (qualifier alone) — licensed rows are per job_code+qualifier
ALTER TABLE repair.ref_qualifiers DROP CONSTRAINT IF EXISTS ref_qualifiers_tenant_id_qualifier_key;
DROP INDEX IF EXISTS repair.repair_ref_qualifiers_job_qual_uq;
CREATE UNIQUE INDEX IF NOT EXISTS repair_ref_qualifiers_job_qual_uq
  ON repair.ref_qualifiers (tenant_id, COALESCE(job_code, ''), qualifier);

-- Price matrix: multiple rows per job/qualifier (condition/WM/resp). Widen unique key.
DROP INDEX IF EXISTS repair.repair_ref_job_code_prices_uq;
ALTER TABLE repair.ref_job_code_prices
  ADD COLUMN IF NOT EXISTS condition_code text,
  ADD COLUMN IF NOT EXISTS why_made text,
  ADD COLUMN IF NOT EXISTS resp_code text,
  ADD COLUMN IF NOT EXISTS price_key text;
CREATE UNIQUE INDEX IF NOT EXISTS repair_ref_job_code_prices_uq
  ON repair.ref_job_code_prices (tenant_id, COALESCE(price_key, job_code || '|' || COALESCE(qualifier,'')));

COMMIT;
