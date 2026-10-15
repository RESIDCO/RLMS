-- 20261014_repair_inbound_invoice_audit.sql
--
-- Inbound shop 500-byte invoice intake + CRB pre-pay audit.
-- Original file stored immutably (documents); each automated check and
-- reviewer decision is append-only. ACH payment stays outside the system.
-- APPLY ONLY to local Postgres. Creates/alters objects in schema "repair" only.

BEGIN;

-- Extend invoices for CRB/500-byte intake metadata
ALTER TABLE repair.invoices
  ADD COLUMN IF NOT EXISTS intake_channel text,
  ADD COLUMN IF NOT EXISTS file_sha256 text,
  ADD COLUMN IF NOT EXISTS billing_party text,
  ADD COLUMN IF NOT EXISTS billed_party text,
  ADD COLUMN IF NOT EXISTS car_mark text,
  ADD COLUMN IF NOT EXISTS car_number text,
  ADD COLUMN IF NOT EXISTS total_cents bigint,
  ADD COLUMN IF NOT EXISTS detail_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_status text,
  ADD COLUMN IF NOT EXISTS inbound_email_id text;

COMMENT ON COLUMN repair.invoices.intake_channel IS
  'SHOP_LINK | INBOUND_EMAIL — how the 500-byte/PDF arrived';
COMMENT ON COLUMN repair.invoices.review_status IS
  'PENDING_REVIEW | APPROVED_FOR_ACH | REJECTED (ACH payment is outside RLMS)';
COMMENT ON COLUMN repair.invoices.file_sha256 IS
  'SHA-256 of the immutable original shop file (documents.sha256)';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_intake_channel_check'
      AND conrelid = 'repair.invoices'::regclass
  ) THEN
    ALTER TABLE repair.invoices
      ADD CONSTRAINT invoices_intake_channel_check
      CHECK (intake_channel IS NULL OR intake_channel IN ('SHOP_LINK', 'INBOUND_EMAIL', 'PDF_LINK'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_review_status_check'
      AND conrelid = 'repair.invoices'::regclass
  ) THEN
    ALTER TABLE repair.invoices
      ADD CONSTRAINT invoices_review_status_check
      CHECK (
        review_status IS NULL
        OR review_status IN ('PENDING_REVIEW', 'APPROVED_FOR_ACH', 'REJECTED')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS invoices_review_status_idx
  ON repair.invoices (tenant_id, review_status, created_at DESC)
  WHERE deleted_at IS NULL AND review_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_file_sha256_idx
  ON repair.invoices (tenant_id, file_sha256)
  WHERE deleted_at IS NULL AND file_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_invoice_no_shop_idx
  ON repair.invoices (tenant_id, shop_id, invoice_no)
  WHERE deleted_at IS NULL;

-- Append-only automated pre-pay check results
CREATE TABLE IF NOT EXISTS repair.invoice_prepay_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  invoice_id      uuid NOT NULL REFERENCES repair.invoices(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  check_code      text NOT NULL,
  -- PASS | FAIL | WARN
  result          text NOT NULL CHECK (result IN ('PASS', 'FAIL', 'WARN')),
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS invoice_prepay_checks_invoice_idx
  ON repair.invoice_prepay_checks (invoice_id, created_at ASC);

CREATE INDEX IF NOT EXISTS invoice_prepay_checks_event_idx
  ON repair.invoice_prepay_checks (event_id, check_code);

DROP TRIGGER IF EXISTS invoice_prepay_checks_no_update ON repair.invoice_prepay_checks;
CREATE TRIGGER invoice_prepay_checks_no_update
  BEFORE UPDATE ON repair.invoice_prepay_checks
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS invoice_prepay_checks_no_delete ON repair.invoice_prepay_checks;
CREATE TRIGGER invoice_prepay_checks_no_delete
  BEFORE DELETE ON repair.invoice_prepay_checks
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

-- Append-only reviewer decisions (approve for external ACH, or reject to shop)
CREATE TABLE IF NOT EXISTS repair.invoice_review_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  invoice_id      uuid NOT NULL REFERENCES repair.invoices(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  decision        text NOT NULL CHECK (decision IN ('APPROVED_FOR_ACH', 'REJECTED')),
  reason          text,
  decided_by      text NOT NULL,
  decided_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS invoice_review_decisions_invoice_idx
  ON repair.invoice_review_decisions (invoice_id, decided_at DESC);

DROP TRIGGER IF EXISTS invoice_review_decisions_no_update ON repair.invoice_review_decisions;
CREATE TRIGGER invoice_review_decisions_no_update
  BEFORE UPDATE ON repair.invoice_review_decisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS invoice_review_decisions_no_delete ON repair.invoice_review_decisions;
CREATE TRIGGER invoice_review_decisions_no_delete
  BEFORE DELETE ON repair.invoice_review_decisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

-- Notification rules for pre-pay review queue
INSERT INTO repair.notification_rules
  (tenant_id, notification_type, include_roles, exclude_roles, template_subject, template_body, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'INVOICE_PREPAY_REVIEW',
   '["reviewers"]', '[]',
   'Shop invoice ready for pre-pay review — {Equipment}',
   'A shop 500-byte invoice was ingested for {Equipment}. Automated pre-pay checks are logged; approve for ACH (outside RLMS) or reject back to the shop.',
   'migration:20261014_inbound_invoice_audit'),
  ('00000000-0000-4000-8000-000000000001', 'INVOICE_REJECTED_TO_SHOP',
   '["shop_contact"]', '[]',
   'Invoice rejected — {Equipment}',
   'Your invoice for {Equipment} was rejected. See reason from the reviewer.',
   'migration:20261014_inbound_invoice_audit')
ON CONFLICT (tenant_id, notification_type) DO UPDATE
  SET include_roles = EXCLUDED.include_roles,
      exclude_roles = EXCLUDED.exclude_roles,
      template_subject = EXCLUDED.template_subject,
      template_body = EXCLUDED.template_body,
      active = true;

COMMIT;
