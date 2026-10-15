-- Monthly close + CRB export + lessee rebill (Resp 6 harden)
-- repair schema only. Local Postgres apply via npm run repair:migrate:local.
BEGIN;

-- ── Lessee approval harden ───────────────────────────────────────────
ALTER TABLE repair.lessee_approvals
  DROP CONSTRAINT IF EXISTS lessee_approvals_status_check;

ALTER TABLE repair.lessee_approvals
  ADD CONSTRAINT lessee_approvals_status_check CHECK (status IN (
    'PENDING',
    'APPROVED_VIA_LINK',
    'REJECTED_VIA_LINK',
    'REPLY_RECEIVED',
    'REPLY_CONFIRMED',
    'REPLY_REJECTED',
    'EXPIRED'
  ));

ALTER TABLE repair.lessee_approvals
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS amount_presented_cents bigint,
  ADD COLUMN IF NOT EXISTS amount_presented numeric(14, 2),
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS comment text;

COMMENT ON COLUMN repair.lessee_approvals.channel IS
  'url (primary link) or email_reply (secondary; needs reviewer confirm)';

-- Append-only decision trail (brief §5 lessee_approvals is append-only;
-- workflow status stays on parent; each decision is a new immutable row)
CREATE TABLE IF NOT EXISTS repair.lessee_approval_decisions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES repair.tenants(id),
  approval_id             uuid NOT NULL REFERENCES repair.lessee_approvals(id),
  event_id                uuid NOT NULL REFERENCES repair.events(id),
  revision_id             uuid NOT NULL REFERENCES repair.estimate_revisions(id),
  lessee_email            text NOT NULL,
  decision                text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  channel                 text NOT NULL CHECK (channel IN ('url', 'email_reply')),
  amount_presented_cents  bigint,
  comment                 text,
  inbound_email_id        text,
  parsed_confidence       text,
  confirmed_by_reviewer   text,
  confirmed_at            timestamptz,
  decided_at              timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              text
);

CREATE INDEX IF NOT EXISTS lessee_approval_decisions_approval_idx
  ON repair.lessee_approval_decisions (approval_id, decided_at DESC);

DROP TRIGGER IF EXISTS lessee_approval_decisions_no_update ON repair.lessee_approval_decisions;
CREATE TRIGGER lessee_approval_decisions_no_update
  BEFORE UPDATE ON repair.lessee_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS lessee_approval_decisions_no_delete ON repair.lessee_approval_decisions;
CREATE TRIGGER lessee_approval_decisions_no_delete
  BEFORE DELETE ON repair.lessee_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

-- Align LESSEE_ESTIMATE_APPROVAL with RESP6 rule (contact bank + ad hoc; never shop)
INSERT INTO repair.notification_rules
  (tenant_id, notification_type, include_roles, exclude_roles, template_subject, template_body, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'LESSEE_ESTIMATE_APPROVAL',
   '["lessee_contacts","ad_hoc"]', '["shop"]',
   'Estimate approval (Resp 6) — {Equipment}',
   'Please review Resp 6 portion for {Equipment}. Primary: login-free link in this email. Reply APPROVE/REJECT is secondary and needs reviewer confirmation.',
   'migration:20261014_monthly_close'),
  ('00000000-0000-4000-8000-000000000001', 'LESSEE_DECISION_RECEIVED',
   '["reviewers"]', '["shop"]',
   'Lessee decision received — {Equipment}',
   'A lessee email reply was recorded for {Equipment} and needs reviewer confirmation.',
   'migration:20261014_monthly_close')
ON CONFLICT (tenant_id, notification_type) DO UPDATE
  SET include_roles = EXCLUDED.include_roles,
      exclude_roles = EXCLUDED.exclude_roles,
      template_subject = EXCLUDED.template_subject,
      template_body = EXCLUDED.template_body,
      active = true;

UPDATE repair.notification_rules
SET include_roles = '["lessee_contacts","ad_hoc"]'::jsonb,
    exclude_roles = '["shop"]'::jsonb,
    active = true
WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
  AND notification_type = 'RESP6_LESSEE_EMAIL';

-- Tenant CRB defaults (billing party mark = cols 2–5)
UPDATE repair.tenants
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'crbBillingPartyMark', 'OFOX',
  'crbCurrency', 'U',
  'crbTaxpayerId', '',
  'crbPaymentTerms', '30',
  'crbExportDir', 'modules/repair/dev/exports'
)
WHERE id = '00000000-0000-4000-8000-000000000001';

-- ── Billing period / monthly close ───────────────────────────────────
CREATE TABLE IF NOT EXISTS repair.billing_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  account_month   text NOT NULL, -- YYMM
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'closed', 'frozen')),
  closed_at       timestamptz,
  closed_by       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  UNIQUE (tenant_id, account_month)
);

CREATE TABLE IF NOT EXISTS repair.close_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  period_id         uuid NOT NULL REFERENCES repair.billing_periods(id),
  account_month     text NOT NULL,
  status            text NOT NULL DEFAULT 'COMPLETED'
                      CHECK (status IN ('COMPLETED', 'FAILED')),
  event_count       integer NOT NULL DEFAULT 0,
  invoice_count     integer NOT NULL DEFAULT 0,
  detail_count      integer NOT NULL DEFAULT 0,
  labor_cents       bigint NOT NULL DEFAULT 0,
  material_cents    bigint NOT NULL DEFAULT 0,
  crb_filename      text,
  crb_sha256        text,
  crb_local_path    text,
  validation_ok     boolean NOT NULL DEFAULT false,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text
);

DROP TRIGGER IF EXISTS close_runs_no_update ON repair.close_runs;
CREATE TRIGGER close_runs_no_update
  BEFORE UPDATE ON repair.close_runs
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS close_runs_no_delete ON repair.close_runs;
CREATE TRIGGER close_runs_no_delete
  BEFORE DELETE ON repair.close_runs
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE TABLE IF NOT EXISTS repair.close_run_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  close_run_id    uuid NOT NULL REFERENCES repair.close_runs(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  estimate_id     uuid REFERENCES repair.estimates(id),
  revision_id     uuid REFERENCES repair.estimate_revisions(id),
  lessee_mark     text,
  lessee_email    text,
  labor_cents     bigint NOT NULL DEFAULT 0,
  material_cents  bigint NOT NULL DEFAULT 0,
  locked_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (close_run_id, event_id)
);

DROP TRIGGER IF EXISTS close_run_events_no_update ON repair.close_run_events;
CREATE TRIGGER close_run_events_no_update
  BEFORE UPDATE ON repair.close_run_events
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS close_run_events_no_delete ON repair.close_run_events;
CREATE TRIGGER close_run_events_no_delete
  BEFORE DELETE ON repair.close_run_events
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS billing_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_close_run_id uuid REFERENCES repair.close_runs(id);

CREATE TABLE IF NOT EXISTS repair.billing_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  period_id         uuid NOT NULL REFERENCES repair.billing_periods(id),
  close_run_id      uuid NOT NULL REFERENCES repair.close_runs(id),
  event_id          uuid NOT NULL REFERENCES repair.events(id),
  source            text NOT NULL DEFAULT 'CRB'
                      CHECK (source IN ('SHOP', 'CRB', 'STRAY', 'REBUTTAL')),
  car_mark          text NOT NULL,
  car_number        text NOT NULL,
  resp_code         text NOT NULL,
  labor_cents       bigint NOT NULL DEFAULT 0,
  material_cents    bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  billed_party      text,
  invoice_number    text,
  raw_record        text,
  car_lease_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text
);

DROP TRIGGER IF EXISTS billing_lines_no_update ON repair.billing_lines;
CREATE TRIGGER billing_lines_no_update
  BEFORE UPDATE ON repair.billing_lines
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS billing_lines_no_delete ON repair.billing_lines;
CREATE TRIGGER billing_lines_no_delete
  BEFORE DELETE ON repair.billing_lines
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE INDEX IF NOT EXISTS billing_lines_period_idx
  ON repair.billing_lines (period_id);

CREATE TABLE IF NOT EXISTS repair.rebuttal_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  period_id         uuid NOT NULL REFERENCES repair.billing_periods(id),
  close_run_id      uuid NOT NULL REFERENCES repair.close_runs(id),
  lessee_mark       text NOT NULL,
  lessee_email      text,
  invoice_number    text NOT NULL,
  labor_cents       bigint NOT NULL DEFAULT 0,
  material_cents    bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  event_ids         uuid[] NOT NULL DEFAULT '{}',
  detail_count      integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  UNIQUE (close_run_id, invoice_number)
);

DROP TRIGGER IF EXISTS rebuttal_invoices_no_update ON repair.rebuttal_invoices;
CREATE TRIGGER rebuttal_invoices_no_update
  BEFORE UPDATE ON repair.rebuttal_invoices
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS rebuttal_invoices_no_delete ON repair.rebuttal_invoices;
CREATE TRIGGER rebuttal_invoices_no_delete
  BEFORE DELETE ON repair.rebuttal_invoices
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE TABLE IF NOT EXISTS repair.crb_export_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  close_run_id    uuid NOT NULL REFERENCES repair.close_runs(id),
  filename        text NOT NULL,
  local_path      text NOT NULL,
  sha256          text NOT NULL,
  byte_length     integer NOT NULL,
  record_count    integer NOT NULL,
  validation_ok   boolean NOT NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

DROP TRIGGER IF EXISTS crb_export_files_no_update ON repair.crb_export_files;
CREATE TRIGGER crb_export_files_no_update
  BEFORE UPDATE ON repair.crb_export_files
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS crb_export_files_no_delete ON repair.crb_export_files;
CREATE TRIGGER crb_export_files_no_delete
  BEFORE DELETE ON repair.crb_export_files
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

-- Layout fields for Format 6 / 8 / 9 (CRB Appendix G)
INSERT INTO repair.aar_layout_fields
  (layout_version, record_format, field_key, col_start, length, data_type, required, preserve_raw, notes)
VALUES
  ('CRB-AppG-2024', '6', 'record_format',     1,  1, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '6', 'billing_party',     2,  4, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '6', 'billed_party',      6,  4, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '6', 'account_date_yymm', 10, 4, 'N',   true,  false, NULL),
  ('CRB-AppG-2024', '6', 'invoice_number',    14,16, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '6', 'currency',          30, 1, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '6', 'contact_type',      31, 2, 'A/N', true,  false, 'BP mandatory'),
  ('CRB-AppG-2024', '6', 'company_name',      33,50, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '6', 'contact_name',      83,35, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'title',            118,35, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'phone',            153,25, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'fax',              178,25, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'email',            203,60, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'address1',         263,45, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '6', 'address2',         308,45, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'address3',         353,45, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'address4',         398,45, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'city',             443,35, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'state',            478, 2, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'country',          480, 2, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '6', 'zip',              482,10, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '8', 'record_format',     1,  1, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '8', 'billing_party',     2,  4, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '8', 'billed_party',      6,  4, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '8', 'account_date_yymm', 10, 4, 'N',   true,  false, NULL),
  ('CRB-AppG-2024', '8', 'invoice_number',    14,16, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '8', 'currency',          30, 1, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '8', 'detail_source',     31, 2, 'A/N', true,  false, 'DS or ZZ'),
  ('CRB-AppG-2024', '8', 'record_count',      33, 7, 'N',   true,  false, NULL),
  ('CRB-AppG-2024', '8', 'labor_cents',       40,10, 'cents', true, false, NULL),
  ('CRB-AppG-2024', '8', 'material_cents',    50,16, 'cents', true, false, NULL),
  ('CRB-AppG-2024', '8', 'material_sign',     66, 1, 'A',   true,  false, NULL),
  ('CRB-AppG-2024', '8', 'invoice_date',      67, 6, 'N',   false, false, NULL),
  ('CRB-AppG-2024', '8', 'taxpayer_id',       73,15, 'A/N', false, false, 'required on ZZ'),
  ('CRB-AppG-2024', '8', 'payment_terms',     88, 2, 'A/N', false, false, NULL),
  ('CRB-AppG-2024', '8', 'payment_due_date',  90, 6, 'N',   false, false, NULL),
  ('CRB-AppG-2024', '9', 'record_format',     1,  1, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '9', 'billing_party',     2,  4, 'A/N', true,  false, NULL),
  ('CRB-AppG-2024', '9', 'billed_party',      6,  4, 'A/N', true,  false, 'ZZZZ'),
  ('CRB-AppG-2024', '9', 'account_date_yymm', 10, 4, 'N',   true,  false, NULL),
  ('CRB-AppG-2024', '9', 'invoice_number',    14,16, 'A/N', true,  false, '16×Z'),
  ('CRB-AppG-2024', '9', 'currency',          30, 1, 'A/N', true,  false, 'Z'),
  ('CRB-AppG-2024', '9', 'detail_source',     31, 2, 'A/N', true,  false, 'ZZ'),
  ('CRB-AppG-2024', '9', 'record_count',      33, 7, 'N',   true,  false, NULL),
  ('CRB-AppG-2024', '9', 'labor_cents',       40,10, 'cents', true, false, NULL),
  ('CRB-AppG-2024', '9', 'material_cents',    50,16, 'cents', true, false, NULL),
  ('CRB-AppG-2024', '9', 'material_sign',     66, 1, 'A',   true,  false, NULL)
ON CONFLICT DO NOTHING;

COMMIT;
