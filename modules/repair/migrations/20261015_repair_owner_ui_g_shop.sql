-- Owner UI §G — Shop portal + Railinc-style validation (stub).
-- Integer cents. Append-only validation findings. Local outbox only.
-- Stub validator interface — no live Railinc calls.

BEGIN;

-- Catalog of validation rules (shown in Reference Data admin)
CREATE TABLE IF NOT EXISTS repair.validation_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  message         text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('HARD_REJECT', 'FLAG')),
  ref_link        text,
  applies_to      text NOT NULL DEFAULT 'ESTIMATE_LOAD'
                    CHECK (applies_to IN ('ESTIMATE_LOAD', 'FINAL_INVOICE', 'BOTH')),
  active          boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS repair_validation_rules_active_idx
  ON repair.validation_rules (tenant_id, severity, active)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE repair.validation_rules IS
  '§G Railinc-style validation rule catalog. Stub today; live Railinc maps to same codes later.';

-- Per-revision validation run (shop submit / owner Run Railinc validation)
CREATE TABLE IF NOT EXISTS repair.estimate_validation_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  estimate_id       uuid NOT NULL REFERENCES repair.estimates(id),
  revision_id       uuid REFERENCES repair.estimate_revisions(id),
  load_run_id       uuid REFERENCES repair.estimate_load_runs(id),
  mode              text NOT NULL DEFAULT 'ESTIMATE'
                      CHECK (mode IN ('ESTIMATE', 'FINAL_INVOICE')),
  validator         text NOT NULL DEFAULT 'stub',
  outcome           text NOT NULL
                      CHECK (outcome IN ('ACCEPTED', 'ACCEPTED_WITH_FLAGS', 'HARD_REJECT')),
  hard_reject_count int NOT NULL DEFAULT 0,
  flag_count        int NOT NULL DEFAULT 0,
  labor_cents       bigint NOT NULL DEFAULT 0,
  material_cents    bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  priced_quarter    text,
  actor             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text
);

CREATE INDEX IF NOT EXISTS repair_est_val_runs_est_idx
  ON repair.estimate_validation_runs (estimate_id, created_at DESC);

-- Append-only findings per run
CREATE TABLE IF NOT EXISTS repair.estimate_validation_findings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  run_id          uuid NOT NULL REFERENCES repair.estimate_validation_runs(id),
  rule_code       text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('HARD_REJECT', 'FLAG')),
  message         text NOT NULL,
  ref_link        text,
  line_no         int,
  field_key       text,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  cleared_at      timestamptz,
  cleared_by      text,
  clear_reason    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

DROP TRIGGER IF EXISTS estimate_validation_findings_no_delete ON repair.estimate_validation_findings;
CREATE TRIGGER estimate_validation_findings_no_delete
  BEFORE DELETE ON repair.estimate_validation_findings
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE INDEX IF NOT EXISTS repair_est_val_findings_run_idx
  ON repair.estimate_validation_findings (run_id, severity);

COMMENT ON TABLE repair.estimate_validation_findings IS
  'Append-only §G validation findings. Clear flags via cleared_at (owner/MP only).';

-- Shop portal email contact list (open-Q default c: LIST)
ALTER TABLE repair.shops
  ADD COLUMN IF NOT EXISTS portal_notify_emails jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN repair.shops.portal_notify_emails IS
  '§G shop portal notification recipients (email LIST). Falls back to shop contacts + default_inbox.';

-- Seed validation rules
INSERT INTO repair.validation_rules
  (tenant_id, code, message, severity, ref_link, applies_to, sort_order, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'BAD_SOURCE_CODE',
   'Invalid or missing Detail Source (source code)', 'HARD_REJECT',
   'docs/repair/OWNER_UI_G_SHOP.md#hard-reject', 'ESTIMATE_LOAD', 10, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'UNPARSEABLE',
   'File unparseable or line length not 500 bytes', 'HARD_REJECT',
   'docs/repair/OWNER_UI_G_SHOP.md#hard-reject', 'ESTIMATE_LOAD', 20, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'MISSING_CRITICAL_HEADER',
   'Missing critical header (car initial/number, billing party, or shop mark)', 'HARD_REJECT',
   'docs/repair/OWNER_UI_G_SHOP.md#hard-reject', 'ESTIMATE_LOAD', 30, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'PRICE_NOT_CURRENT',
   'Job pricing not current for account-date quarter', 'HARD_REJECT',
   'docs/repair/OWNER_UI_G_SHOP.md#hard-reject', 'ESTIMATE_LOAD', 40, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'CAR_NOT_IN_VCF',
   'Car not in VCF', 'HARD_REJECT',
   'docs/repair/OWNER_UI_G_SHOP.md#hard-reject', 'ESTIMATE_LOAD', 50, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'MIXED_WRECK',
   'Mixed Resp 3 / non-3 wreck file — HARD REJECT', 'HARD_REJECT',
   'docs/repair/OWNER_UI_G_SHOP.md#hard-reject', 'ESTIMATE_LOAD', 60, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'MISSING_CID',
   'Missing AAR Component ID (CID) — blocks completed date / invoicing', 'FLAG',
   'docs/repair/OWNER_UI_G_SHOP.md#accept-flag', 'BOTH', 110, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'UNKNOWN_QUALIFIER',
   'Unknown qualifier or code', 'FLAG',
   'docs/repair/OWNER_UI_G_SHOP.md#accept-flag', 'ESTIMATE_LOAD', 120, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'QTY_PRICE_OFF_TABLE',
   'Quantity or price off Price Master table', 'FLAG',
   'docs/repair/OWNER_UI_G_SHOP.md#accept-flag', 'ESTIMATE_LOAD', 130, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'MISSING_INVOICE_NO',
   'Missing invoice number (HARD REJECT on final invoice only)', 'FLAG',
   'docs/repair/OWNER_UI_G_SHOP.md#accept-flag', 'BOTH', 140, 'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'UNPRICED_LABOR_RATE',
   'Unpriced item not at current quarterly AAR labor rate', 'FLAG',
   'docs/repair/OWNER_UI_G_SHOP.md#accept-flag', 'ESTIMATE_LOAD', 150, 'migration:g_shop')
ON CONFLICT (tenant_id, code) DO UPDATE
  SET message = EXCLUDED.message,
      severity = EXCLUDED.severity,
      ref_link = EXCLUDED.ref_link,
      applies_to = EXCLUDED.applies_to,
      active = true,
      deleted_at = NULL;

-- Notification rules for shop portal lifecycle (local outbox)
INSERT INTO repair.notification_rules
  (tenant_id, notification_type, include_roles, exclude_roles, template_subject, template_body, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'ESTIMATE_RECEIVED',
   '["owner_users","reviewers"]', '[]',
   'Estimate received — {Equipment}',
   'Shop submitted an estimate for {Equipment}. Review in Estimate Review.',
   'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'ESTIMATE_REJECTED',
   '["shop_contact","ad_hoc"]', '[]',
   'Estimate rejected — {Equipment}',
   'Your estimate for {Equipment} was rejected. See reasons and resubmit a revision.',
   'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'ESTIMATE_ADJUSTMENT_REQUESTED',
   '["shop_contact","ad_hoc"]', '[]',
   'Adjustment requested — {Equipment}',
   'Owner requested an adjustment for {Equipment}. Resubmit with revisions.',
   'migration:g_shop'),
  ('00000000-0000-4000-8000-000000000001', 'ESTIMATE_APPROVED',
   '["shop_contact","ad_hoc"]', '[]',
   'Estimate approved — {Equipment}',
   'Your estimate for {Equipment} was approved.',
   'migration:g_shop')
ON CONFLICT (tenant_id, notification_type) DO UPDATE
  SET include_roles = EXCLUDED.include_roles,
      exclude_roles = EXCLUDED.exclude_roles,
      template_subject = EXCLUDED.template_subject,
      template_body = EXCLUDED.template_body,
      active = true,
      deleted_at = NULL;

COMMIT;
