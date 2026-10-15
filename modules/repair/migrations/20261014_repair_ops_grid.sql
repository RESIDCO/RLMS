-- 20261014_repair_ops_grid.sql
--
-- Smaller Phase 1 ops: attachment categories, shared files, target/actual
-- outbound, dispo queue, multi-estimate invoice link, estimate grid helpers,
-- per-user email opt-out + $ threshold on rules, monthly bill summary.
-- Local Postgres only. Schema "repair" only.

BEGIN;

-- Attachment categories / types
CREATE TABLE IF NOT EXISTS repair.attachment_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  code            text NOT NULL,
  display_name    text NOT NULL,
  sort_order      int NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  UNIQUE (tenant_id, code)
);

INSERT INTO repair.attachment_categories (tenant_id, code, display_name, sort_order, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'estimate', 'Estimate file', 10, 'migration:ops_grid'),
  ('00000000-0000-4000-8000-000000000001', 'photo', 'Photo', 20, 'migration:ops_grid'),
  ('00000000-0000-4000-8000-000000000001', 'invoice', 'Invoice', 30, 'migration:ops_grid'),
  ('00000000-0000-4000-8000-000000000001', 'brc', 'BRC', 40, 'migration:ops_grid'),
  ('00000000-0000-4000-8000-000000000001', 'sds', 'SDS', 50, 'migration:ops_grid'),
  ('00000000-0000-4000-8000-000000000001', 'jic', 'JIC', 60, 'migration:ops_grid'),
  ('00000000-0000-4000-8000-000000000001', 'tank_doc', 'Tank car document', 70, 'migration:ops_grid'),
  ('00000000-0000-4000-8000-000000000001', 'shared', 'Shared file', 80, 'migration:ops_grid'),
  ('00000000-0000-4000-8000-000000000001', 'other', 'Other', 90, 'migration:ops_grid')
ON CONFLICT (tenant_id, code) DO NOTHING;

ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS category_code text;
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

-- Target outbound (bulk) + actual
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS target_outbound_at date;
ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS actual_outbound_at date;

CREATE TABLE IF NOT EXISTS repair.outbound_bulk_sets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  target_date     date NOT NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE TABLE IF NOT EXISTS repair.outbound_bulk_set_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  bulk_set_id     uuid NOT NULL REFERENCES repair.outbound_bulk_sets(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (bulk_set_id, event_id)
);

-- One shop invoice → multiple completed estimates
CREATE TABLE IF NOT EXISTS repair.invoice_estimate_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  invoice_id      uuid NOT NULL REFERENCES repair.invoices(id),
  estimate_id     uuid NOT NULL REFERENCES repair.estimates(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (invoice_id, estimate_id)
);

-- Per-user email opt-out
CREATE TABLE IF NOT EXISTS repair.user_email_prefs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  user_id         uuid REFERENCES repair.users(id),
  email           text NOT NULL,
  opted_out       boolean NOT NULL DEFAULT false,
  opt_out_types   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (tenant_id, email)
);

-- $ threshold on notification rules
ALTER TABLE repair.notification_rules
  ADD COLUMN IF NOT EXISTS min_amount_cents bigint;

-- Monthly bill summary / exceptions by account month + billed party
CREATE TABLE IF NOT EXISTS repair.monthly_bill_summaries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  account_month     text NOT NULL,
  billed_party_mark text NOT NULL,
  line_count        int NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  exception_count   int NOT NULL DEFAULT 0,
  close_run_id      uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  UNIQUE (tenant_id, account_month, billed_party_mark)
);

CREATE TABLE IF NOT EXISTS repair.monthly_bill_exceptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  summary_id        uuid NOT NULL REFERENCES repair.monthly_bill_summaries(id),
  account_month     text NOT NULL,
  billed_party_mark text NOT NULL,
  code              text NOT NULL,
  message           text NOT NULL,
  event_id          uuid REFERENCES repair.events(id),
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text
);

DROP TRIGGER IF EXISTS monthly_bill_exceptions_no_update ON repair.monthly_bill_exceptions;
CREATE TRIGGER monthly_bill_exceptions_no_update
  BEFORE UPDATE ON repair.monthly_bill_exceptions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS monthly_bill_exceptions_no_delete ON repair.monthly_bill_exceptions;
CREATE TRIGGER monthly_bill_exceptions_no_delete
  BEFORE DELETE ON repair.monthly_bill_exceptions
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE INDEX IF NOT EXISTS monthly_bill_summaries_month_idx
  ON repair.monthly_bill_summaries (tenant_id, account_month);

COMMIT;
