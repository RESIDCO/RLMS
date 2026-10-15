-- 20261014_repair_owner_ui_d_r2.sql
-- §D Estimate Review round 2: licensed AAR ref tables (empty until import),
-- component_id_rules, split lineage columns, attachment audit helpers.
-- APPLY ONLY to local Postgres. Schema "repair" only.
-- Do NOT invent licensed AAR content — importer fills from modules/repair/ref-data/.

BEGIN;

-- ── Edition / import ledger ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair.ref_data_editions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  table_name      text NOT NULL,
  edition         text,
  quarter         text,
  source_file     text,
  source_path     text,
  row_count       int NOT NULL DEFAULT 0,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  imported_by     text,
  notes           text
);

CREATE INDEX IF NOT EXISTS repair_ref_data_editions_table_idx
  ON repair.ref_data_editions (tenant_id, table_name, imported_at DESC);

-- ── Licensed AAR reference tables (structure only; CSV import fills) ───
CREATE TABLE IF NOT EXISTS repair.ref_job_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  job_code        text NOT NULL,
  description     text,
  category        text,
  sub_category    text,
  source          text,
  rule_page       text,
  effective_quarter text,
  edition         text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, job_code)
);

CREATE TABLE IF NOT EXISTS repair.ref_job_code_prices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  job_code        text NOT NULL,
  qualifier       text,
  condition_code  text,
  why_made        text,
  resp_code       text,
  price_key       text,
  price_cents     bigint,
  labor_cents     bigint,
  material_cents  bigint,
  source          text,
  rule_page       text,
  effective_quarter text,
  edition         text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS repair_ref_job_code_prices_uq
  ON repair.ref_job_code_prices (tenant_id, COALESCE(price_key, job_code || '|' || COALESCE(qualifier,'')));

CREATE TABLE IF NOT EXISTS repair.ref_qualifiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  job_code        text,
  qualifier       text NOT NULL,
  description     text,
  category        text,
  sub_category    text,
  source          text,
  rule_page       text,
  effective_quarter text,
  edition         text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS repair_ref_qualifiers_job_qual_uq
  ON repair.ref_qualifiers (tenant_id, COALESCE(job_code, ''), qualifier);

CREATE TABLE IF NOT EXISTS repair.ref_why_made (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  description     text,
  source          text,
  rule_page       text,
  effective_quarter text,
  edition         text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS repair.ref_condition_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  description     text,
  source          text,
  rule_page       text,
  effective_quarter text,
  edition         text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS repair.ref_location_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  description     text,
  source          text,
  rule_page       text,
  effective_quarter text,
  edition         text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS repair.ref_responsibility_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  description     text,
  source          text,
  rule_page       text,
  effective_quarter text,
  edition         text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS repair.ref_car_part_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  description     text,
  category        text,
  sub_category    text,
  source          text,
  rule_page       text,
  effective_quarter text,
  edition         text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz,
  UNIQUE (tenant_id, code)
);

-- Repair categories licensed mirror (importer also upserts repair.repair_categories)
CREATE TABLE IF NOT EXISTS repair.ref_repair_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  job_code        text NOT NULL,
  qualifier       text,
  combo_key       text NOT NULL,
  description     text,
  category        text,
  sub_category    text,
  source          text,
  rule_page       text,
  effective_quarter text,
  edition         text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz,
  UNIQUE (tenant_id, combo_key)
);

-- ── Component Id required rules (admin-editable; not licensed AAR rows) ─
CREATE TABLE IF NOT EXISTS repair.component_id_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  job_code        text,
  qualifier       text,
  job_code_prefix text,
  label           text,
  require_on      text NOT NULL DEFAULT 'FINAL_OR_INVOICE', -- FINAL | INVOICE | FINAL_OR_INVOICE | ALWAYS
  active          boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz,
  updated_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text
);

CREATE INDEX IF NOT EXISTS repair_component_id_rules_active_idx
  ON repair.component_id_rules (tenant_id)
  WHERE deleted_at IS NULL AND active;

COMMENT ON TABLE repair.component_id_rules IS
  'Admin rules: which job codes require aar_component_id on final/invoice. Not licensed AAR content.';

-- ── Split / carry-forward lineage on estimate_lines ─────────────────────
ALTER TABLE repair.estimate_lines
  ADD COLUMN IF NOT EXISTS parent_line_no int,
  ADD COLUMN IF NOT EXISTS split_label text,
  ADD COLUMN IF NOT EXISTS split_group_id uuid,
  ADD COLUMN IF NOT EXISTS split_kind text,
  ADD COLUMN IF NOT EXISTS source_fingerprint text,
  ADD COLUMN IF NOT EXISTS prior_resp_code text,
  ADD COLUMN IF NOT EXISTS is_tax_line boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_line_no text;

COMMENT ON COLUMN repair.estimate_lines.split_label IS
  'Child label within a split group, e.g. 1a / 1b';
COMMENT ON COLUMN repair.estimate_lines.source_fingerprint IS
  'Stable fingerprint for carry-forward matching across revisions';
COMMENT ON COLUMN repair.estimate_lines.display_line_no IS
  'Display item number (may be 1a/1b); line_no remains integer sort key';

-- ── Document permission / audit helpers ────────────────────────────────
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS uploaded_via text,
  ADD COLUMN IF NOT EXISTS uploaded_role text,
  ADD COLUMN IF NOT EXISTS last_category_by text,
  ADD COLUMN IF NOT EXISTS last_category_at timestamptz;

COMMIT;
