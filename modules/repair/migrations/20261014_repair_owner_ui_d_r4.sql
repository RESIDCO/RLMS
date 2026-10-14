-- Owner UI §D Estimate Review r4
-- Qualifier generic/charts tables; job rule + price-list qualifier;
-- lessee access token scope (estimate+revision+docs, expiring).

-- ── Job code: rule + price-list qualifier (e.g. VZ) ─────────────────
ALTER TABLE repair.ref_job_codes
  ADD COLUMN IF NOT EXISTS rule text,
  ADD COLUMN IF NOT EXISTS price_list_qualifier text;

COMMENT ON COLUMN repair.ref_job_codes.rule IS
  'AAR Field/Office Manual rule number for the job (chart lookup).';
COMMENT ON COLUMN repair.ref_job_codes.price_list_qualifier IS
  'OM price-matrix QLFR for the job (00, 14, VZ, …).';

ALTER TABLE repair.ref_qualifiers
  ADD COLUMN IF NOT EXISTS qualifier_type text,
  ADD COLUMN IF NOT EXISTS basis text;

-- ── Generic car-part qualifiers (job-independent) ───────────────────
CREATE TABLE IF NOT EXISTS repair.ref_qualifier_generic (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  qualifier         text NOT NULL,
  qualifier_type    text,
  description       text,
  category          text,
  sub_category      text,
  source            text,
  rule_page         text,
  effective_quarter text,
  edition           text,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  updated_at        timestamptz,
  updated_by        text,
  deleted_at        timestamptz,
  UNIQUE (tenant_id, qualifier)
);

-- ── Rule-level qualifier charts (may list multiple per job) ─────────
CREATE TABLE IF NOT EXISTS repair.ref_qualifier_charts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES repair.tenants(id),
  /** Stable import key (file order) — chart rows are not unique on rule/group/qual alone */
  import_key           text NOT NULL,
  rule                 text NOT NULL,
  chart_group          text,
  qualifier            text NOT NULL,
  description          text,
  chart_title          text,
  discontinued         boolean NOT NULL DEFAULT false,
  job_codes_using_chart text,
  source               text,
  rule_page            text,
  effective_quarter    text,
  edition              text,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,
  updated_at           timestamptz,
  updated_by           text,
  deleted_at           timestamptz,
  UNIQUE (tenant_id, import_key)
);

CREATE INDEX IF NOT EXISTS repair_ref_qualifier_charts_rule_qual_idx
  ON repair.ref_qualifier_charts (tenant_id, rule, qualifier)
  WHERE deleted_at IS NULL;

-- Idempotent upgrade if an earlier draft used a non-unique natural key
ALTER TABLE repair.ref_qualifier_charts
  ADD COLUMN IF NOT EXISTS import_key text;
DROP INDEX IF EXISTS repair.repair_ref_qualifier_charts_uq;
UPDATE repair.ref_qualifier_charts SET import_key = id::text WHERE import_key IS NULL;
DO $$ BEGIN
  ALTER TABLE repair.ref_qualifier_charts ALTER COLUMN import_key SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE repair.ref_qualifier_charts
    ADD CONSTRAINT repair_ref_qualifier_charts_tenant_import_key_key UNIQUE (tenant_id, import_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ── Lessee access: token scoped to estimate + revision + docs ───────
ALTER TABLE repair.event_links
  ADD COLUMN IF NOT EXISTS estimate_id uuid REFERENCES repair.estimates(id),
  ADD COLUMN IF NOT EXISTS revision_id uuid REFERENCES repair.estimate_revisions(id),
  ADD COLUMN IF NOT EXISTS granted_document_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS event_links_estimate_idx
  ON repair.event_links (estimate_id)
  WHERE revoked_at IS NULL AND scope = 'LESSEE';

COMMENT ON COLUMN repair.event_links.estimate_id IS
  'LESSEE scope: single estimate this token may access.';
COMMENT ON COLUMN repair.event_links.revision_id IS
  'LESSEE scope: single revision; new revision / resend revokes prior tokens.';
COMMENT ON COLUMN repair.event_links.granted_document_ids IS
  'LESSEE scope: attachment ids picked on Send Lessee page.';
