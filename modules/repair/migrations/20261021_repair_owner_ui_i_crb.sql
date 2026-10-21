-- Owner UI §I — CRB staging (additive, repair schema only).
-- Local Postgres. Nothing here is a licensed AAR code or price table.

BEGIN;

CREATE TABLE IF NOT EXISTS repair.crb_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  file_name         text NOT NULL,
  sha256            text NOT NULL,
  raw_bytes         bytea,
  uploaded_by       text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  billed_party      text,
  account_months    text[] NOT NULL DEFAULT '{}',
  dx_outbound_date  date,
  record_counts     jsonb NOT NULL DEFAULT '{}'::jsonb,
  control_status    text NOT NULL CHECK (control_status IN ('BALANCED', 'OUT_OF_BALANCE')),
  version_status    text NOT NULL DEFAULT 'ACTIVE' CHECK (version_status IN ('ACTIVE', 'SUPERSEDED')),
  parse_errors      jsonb NOT NULL DEFAULT '[]'::jsonb,
  month_bucket_id   uuid REFERENCES repair.accounting_months(id),
  superseded_by     uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crb_files_sha256_uq
  ON repair.crb_files (tenant_id, sha256);

CREATE INDEX IF NOT EXISTS crb_files_party_month_idx
  ON repair.crb_files (tenant_id, billed_party, version_status);

CREATE TABLE IF NOT EXISTS repair.crb_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  file_id         uuid NOT NULL REFERENCES repair.crb_files(id) ON DELETE CASCADE,
  line_no         int NOT NULL,
  record_format   text NOT NULL,
  raw_line        text NOT NULL,
  parsed          jsonb NOT NULL DEFAULT '{}'::jsonb,
  warning         text,
  UNIQUE (file_id, line_no)
);

CREATE TABLE IF NOT EXISTS repair.crb_invoices (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES repair.tenants(id),
  file_id                 uuid NOT NULL REFERENCES repair.crb_files(id) ON DELETE CASCADE,
  billing_party           text NOT NULL,
  billed_party            text,
  invoice_number          text NOT NULL,
  account_date            text NOT NULL,
  currency                text,
  invoice_date            date,
  detail_subtotals        jsonb NOT NULL DEFAULT '[]'::jsonb,
  grand_total_cents       bigint NOT NULL DEFAULT 0,
  computed_total_cents    bigint NOT NULL DEFAULT 0,
  contacts                jsonb NOT NULL DEFAULT '[]'::jsonb,
  resubmitted             boolean NOT NULL DEFAULT false,
  original_invoice        text,
  original_account_date   text,
  dx_available_date       date,
  receipt_date            date,
  status                  text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                            'PENDING', 'IN_REVIEW', 'READY', 'APPROVED',
                            'RETURN_UNPAID', 'APPROVED_WITH_EXCEPTIONS'
                          )),
  control_ok              boolean NOT NULL DEFAULT true,
  error_panel             jsonb,
  month_bucket_id         uuid REFERENCES repair.accounting_months(id),
  car_count               int NOT NULL DEFAULT 0,
  reviewed                boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, billing_party, invoice_number, account_date)
);

CREATE INDEX IF NOT EXISTS crb_invoices_party_idx
  ON repair.crb_invoices (tenant_id, billing_party, account_date);

CREATE TABLE IF NOT EXISTS repair.crb_cars (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES repair.tenants(id),
  invoice_id            uuid NOT NULL REFERENCES repair.crb_invoices(id) ON DELETE CASCADE,
  car_initial           text NOT NULL,
  car_number            text NOT NULL,
  kind                  text,
  valid_car_id          bigint,
  lease_id              text,
  lessee_id             text,
  lessee_name           text,
  owned_on_repair_date  boolean,
  repair_date           date,
  status                text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                          'PENDING', 'APPROVED', 'OVERRIDDEN', 'REJECTED', 'REJECTED_PARTIAL'
                        )),
  labor_cents           bigint NOT NULL DEFAULT 0,
  material_cents        bigint NOT NULL DEFAULT 0,
  total_cents           bigint NOT NULL DEFAULT 0,
  line_count            int NOT NULL DEFAULT 0,
  flags                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_corrections  jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (invoice_id, car_initial, car_number)
);

CREATE TABLE IF NOT EXISTS repair.crb_lines (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES repair.tenants(id),
  invoice_id                uuid NOT NULL REFERENCES repair.crb_invoices(id) ON DELETE CASCADE,
  car_id                    uuid NOT NULL REFERENCES repair.crb_cars(id) ON DELETE CASCADE,
  record_id                 uuid REFERENCES repair.crb_records(id) ON DELETE CASCADE,
  line_number               text,
  detail_source             text,
  responsibility            text,
  dc_party                  text,
  dc_date                   date,
  labor_cents               bigint NOT NULL DEFAULT 0,
  material_cents            bigint NOT NULL DEFAULT 0,
  material_sign             text,
  machine_priceable         text,
  wrong_repair              text,
  narrative                 text,
  wheel                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ddct_incident_id          text,
  cid                       text,
  bucket_hint               text,
  status                    text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
                              'PENDING', 'APPROVED', 'REJECTED', 'EXCEPTED'
                            )),
  applied_job_code          text,
  applied_qualifier         text,
  removed_job_code          text,
  removed_qualifier         text,
  why_made                  text,
  condition_code            text,
  location_on_car           text,
  facility_type             text,
  quantity                  text,
  repairing_party           text,
  repairing_party_invoice   text,
  repair_date               date,
  kind_of_car               text,
  load_empty                text,
  splc                      text,
  doc_ref                   text,
  parsed                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_corrections      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order                int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS crb_lines_car_idx ON repair.crb_lines (car_id, sort_order);
CREATE INDEX IF NOT EXISTS crb_lines_match_idx
  ON repair.crb_lines (car_id, applied_job_code, location_on_car);

CREATE TABLE IF NOT EXISTS repair.biller_invoice_headers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  billing_party     text NOT NULL,
  invoice_number    text NOT NULL,
  account_month     text NOT NULL,
  invoice_date      date,
  received_date     date,
  total_cents       bigint,
  car_count         int,
  attachment_name   text,
  attachment_bytes  bytea,
  crb_invoice_id    uuid REFERENCES repair.crb_invoices(id) ON DELETE SET NULL,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, billing_party, invoice_number, account_month)
);

CREATE TABLE IF NOT EXISTS repair.audit_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  rule_ref        text,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled         boolean NOT NULL DEFAULT true,
  severity        text NOT NULL CHECK (severity IN ('INFO', 'WARN', 'HARD_STOP')),
  effective_from  date NOT NULL,
  effective_to    date,
  version         int NOT NULL DEFAULT 1,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, version)
);

CREATE TABLE IF NOT EXISTS repair.audit_findings (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     uuid NOT NULL REFERENCES repair.tenants(id),
  rule_id                       uuid REFERENCES repair.audit_rules(id),
  rule_code                     text NOT NULL,
  rule_version                  int NOT NULL,
  scope                         text NOT NULL CHECK (scope IN ('LINE', 'CAR', 'INVOICE', 'FILE')),
  target_id                     uuid,
  invoice_id                    uuid REFERENCES repair.crb_invoices(id) ON DELETE CASCADE,
  amount_in_question_cents      bigint NOT NULL DEFAULT 0,
  suggested_correct_amount_cents bigint,
  message                       text NOT NULL,
  status                        text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                                  'OPEN', 'OVERRIDDEN', 'ACCEPTED_AS_EXCEPTION', 'RESOLVED'
                                )),
  invalid                       boolean NOT NULL DEFAULT false,
  exempt_type                   text,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_findings_invoice_idx
  ON repair.audit_findings (invoice_id, status);

CREATE TABLE IF NOT EXISTS repair.crb_overrides (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  scope             text NOT NULL CHECK (scope IN ('LINE', 'CAR', 'INVOICE', 'BILLER')),
  target_id         uuid,
  finding_id        uuid,
  rule_id           uuid,
  rule_code         text,
  rule_version      int,
  reason            text NOT NULL CHECK (char_length(reason) >= 8),
  source            text NOT NULL DEFAULT 'user',
  attachment_name   text,
  attachment_bytes  bytea,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair.standing_exceptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  rule_code         text NOT NULL,
  biller            text,
  repairing_party   text,
  lease_id          text,
  lessee_id         text,
  car_mark          text,
  car_number_from   text,
  car_number_to     text,
  job_code          text,
  reason            text NOT NULL,
  effective_from    date NOT NULL,
  effective_to      date,
  enabled           boolean NOT NULL DEFAULT true,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair.crb_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES repair.tenants(id),
  actor       text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  action      text NOT NULL,
  scope       text,
  target_id   uuid,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);

DROP TRIGGER IF EXISTS crb_audit_log_no_update ON repair.crb_audit_log;
CREATE TRIGGER crb_audit_log_no_update
  BEFORE UPDATE ON repair.crb_audit_log
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS crb_audit_log_no_delete ON repair.crb_audit_log;
CREATE TRIGGER crb_audit_log_no_delete
  BEFORE DELETE ON repair.crb_audit_log
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS crb_overrides_no_update ON repair.crb_overrides;
CREATE TRIGGER crb_overrides_no_update
  BEFORE UPDATE ON repair.crb_overrides
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS crb_overrides_no_delete ON repair.crb_overrides;
CREATE TRIGGER crb_overrides_no_delete
  BEFORE DELETE ON repair.crb_overrides
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE TABLE IF NOT EXISTS repair.exception_packages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES repair.tenants(id),
  invoice_id          uuid NOT NULL REFERENCES repair.crb_invoices(id) ON DELETE CASCADE,
  type                text NOT NULL CHECK (type IN (
                        'RETURN_UNPAID_HEADER', 'RETURN_UNPAID_LINES',
                        'PAID_EXCEPTION_LETTER_n', 'REBUTTAL_DR_JR', 'RULE122_PACKET'
                      )),
  letter_seq          int NOT NULL DEFAULT 1,
  contents            jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_path            text,
  xlsx_path           text,
  draft500_path       text,
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                        'DRAFT', 'FILED_MANUALLY', 'RESPONSE_RECEIVED', 'CBA_RECEIVED', 'CLOSED'
                      )),
  filed_at            date,
  filed_by            text,
  response_code       text,
  response_at         date,
  cba_no              text,
  cba_amount_cents    bigint,
  cba_date            date,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Month pool beside §H accounting months. source distinguishes shop vs CRB.
CREATE TABLE IF NOT EXISTS repair.month_pool_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES repair.tenants(id),
  accounting_month_id   uuid NOT NULL REFERENCES repair.accounting_months(id),
  source                text NOT NULL CHECK (source IN ('SHOP', 'CRB')),
  crb_line_id           uuid REFERENCES repair.crb_lines(id) ON DELETE CASCADE,
  invoice_line_id      uuid,
  bucket_hint          text,
  amount_cents          bigint NOT NULL DEFAULT 0,
  car_initial           text,
  car_number            text,
  detail_source         text,
  status                text NOT NULL DEFAULT 'OPEN',
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text,
  UNIQUE (crb_line_id)
);

ALTER TABLE repair.invoice_lines
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE repair.accounting_months
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN repair.month_pool_lines.source IS
  '§I pool source. CRB approved lines insert source=CRB. bucket_hint only; final bucket is later.';
COMMENT ON COLUMN repair.accounting_months.source IS
  'Optional origin note. CRB pool rows live in month_pool_lines.source.';

COMMIT;
