-- 20261014_repair_pod_invoice_contacts.sql
--
-- POD/ERD, completion lock, invoices, dispo relay, contact bank,
-- ad hoc emails, notification rules/log, optional step OTP config.
-- APPLY ONLY to local Postgres. Creates/alters objects in schema "repair" only.

BEGIN;

-- Append-only POD / ERD history
CREATE TABLE IF NOT EXISTS repair.pod_dates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  kind            text NOT NULL CHECK (kind IN ('POD', 'ERD')),
  date_value      date NOT NULL,
  entered_by      text NOT NULL,
  entered_at      timestamptz NOT NULL DEFAULT now(),
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

DROP TRIGGER IF EXISTS pod_dates_no_update ON repair.pod_dates;
CREATE TRIGGER pod_dates_no_update
  BEFORE UPDATE ON repair.pod_dates
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS pod_dates_no_delete ON repair.pod_dates;
CREATE TRIGGER pod_dates_no_delete
  BEFORE DELETE ON repair.pod_dates
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

CREATE INDEX IF NOT EXISTS pod_dates_event_idx
  ON repair.pod_dates (event_id, kind, entered_at DESC);

-- Dispo relay (information only — no waybill / movement tracking)
CREATE TABLE IF NOT EXISTS repair.dispo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  direction       text NOT NULL CHECK (direction IN ('to_shop', 'from_shop')),
  instructions    text NOT NULL,
  at              timestamptz NOT NULL DEFAULT now(),
  by_actor        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text
);

CREATE INDEX IF NOT EXISTS dispo_event_idx
  ON repair.dispo (event_id, at DESC)
  WHERE deleted_at IS NULL;

-- Shop invoices vs approved final estimate total
CREATE TABLE IF NOT EXISTS repair.invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES repair.tenants(id),
  event_id            uuid NOT NULL REFERENCES repair.events(id),
  shop_id             uuid REFERENCES repair.shops(id),
  invoice_no          text NOT NULL,
  total               numeric(14,2) NOT NULL,
  estimate_total      numeric(14,2),
  document_id         uuid REFERENCES repair.documents(id),
  match_status        text NOT NULL CHECK (match_status IN (
                        'MATCHED', 'MISMATCH', 'PENDING_REVIEW', 'APPROVED'
                      )),
  mismatch_flagged    boolean NOT NULL DEFAULT false,
  approved_by         text,
  approved_at         timestamptz,
  export_batch_id     text,
  submitted_by_email  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  deleted_at          timestamptz,
  deleted_by          text,
  delete_reason       text
);

CREATE INDEX IF NOT EXISTS invoices_event_idx
  ON repair.invoices (event_id)
  WHERE deleted_at IS NULL;

-- Optional contact bank (shops + lessees + other)
-- repair.contacts already exists; add uniqueness helper index
CREATE INDEX IF NOT EXISTS contacts_tenant_party_email_idx
  ON repair.contacts (tenant_id, party_type, lower(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL;

-- Pasted ad hoc emails per event (and optional per notification type)
CREATE TABLE IF NOT EXISTS repair.event_adhoc_emails (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES repair.tenants(id),
  event_id            uuid NOT NULL REFERENCES repair.events(id),
  email               text NOT NULL,
  notification_type   text, -- NULL = apply to all types for this event
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  deleted_at          timestamptz,
  deleted_by          text,
  delete_reason       text
);

CREATE INDEX IF NOT EXISTS event_adhoc_emails_event_idx
  ON repair.event_adhoc_emails (event_id)
  WHERE deleted_at IS NULL;

-- Per-tenant notification recipient rules
CREATE TABLE IF NOT EXISTS repair.notification_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  notification_type text NOT NULL,
  -- include: shop_contact | lessee_contacts | owner_users | ad_hoc | reviewers
  include_roles     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- hard exclusions, e.g. ["shop"] for RESP6_LESSEE_EMAIL
  exclude_roles     jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_subject  text,
  template_body     text,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  deleted_at        timestamptz,
  deleted_by        text,
  delete_reason     text,
  UNIQUE (tenant_id, notification_type)
);

-- Append-only notification log
CREATE TABLE IF NOT EXISTS repair.notifications_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES repair.tenants(id),
  event_id              uuid REFERENCES repair.events(id),
  notification_type     text NOT NULL,
  recipients            jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject               text NOT NULL,
  body_snapshot         text,
  attachments           jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_message_id   text,
  status                text NOT NULL DEFAULT 'logged',
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text
);

DROP TRIGGER IF EXISTS notifications_log_no_update ON repair.notifications_log;
CREATE TRIGGER notifications_log_no_update
  BEFORE UPDATE ON repair.notifications_log
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

DROP TRIGGER IF EXISTS notifications_log_no_delete ON repair.notifications_log;
CREATE TRIGGER notifications_log_no_delete
  BEFORE DELETE ON repair.notifications_log
  FOR EACH ROW EXECUTE FUNCTION repair.reject_mutation();

-- One-time codes for sensitive shop steps (hash only; never log raw code)
CREATE TABLE IF NOT EXISTS repair.step_otp_challenges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  step            text NOT NULL, -- e.g. invoice_submit
  email           text NOT NULL,
  code_hash       text NOT NULL,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS step_otp_event_step_idx
  ON repair.step_otp_challenges (event_id, step, created_at DESC);

-- Reminder tracking (avoid duplicate fires)
CREATE TABLE IF NOT EXISTS repair.reminder_fires (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES repair.tenants(id),
  event_id        uuid NOT NULL REFERENCES repair.events(id),
  reminder_type   text NOT NULL, -- POD_DUE | POD_MISSED | POD_REVISED | ON_HAND | COMPLETE
  fired_at        timestamptz NOT NULL DEFAULT now(),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id, reminder_type)
);

-- Seed default notification rules (Resp 6 lessee emails never go to the shop)
INSERT INTO repair.notification_rules
  (tenant_id, notification_type, include_roles, exclude_roles, template_subject, template_body, created_by)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'POD_DUE',
   '["shop_contact","owner_users","ad_hoc"]', '[]',
   'POD coming due — {Equipment}', 'Promised outbound date is due soon for {Equipment}.',
   'migration:20261014_pod'),
  ('00000000-0000-4000-8000-000000000001', 'POD_MISSED',
   '["shop_contact","owner_users","ad_hoc"]', '[]',
   'POD missed — {Equipment}', 'Promised outbound date was missed for {Equipment}.',
   'migration:20261014_pod'),
  ('00000000-0000-4000-8000-000000000001', 'POD_REVISED',
   '["shop_contact","owner_users","ad_hoc"]', '[]',
   'POD/ERD revised — {Equipment}', 'POD/ERD was revised for {Equipment}.',
   'migration:20261014_pod'),
  ('00000000-0000-4000-8000-000000000001', 'EVENT_COMPLETE',
   '["shop_contact","owner_users","lessee_contacts","ad_hoc","reviewers"]', '[]',
   'Event complete — {Equipment}', 'Repair event completed for {Equipment}.',
   'migration:20261014_pod'),
  ('00000000-0000-4000-8000-000000000001', 'EVENT_COMPLETE_ROLLBACK',
   '["shop_contact","owner_users","lessee_contacts","ad_hoc","reviewers"]', '[]',
   'Completed date rolled back — {Equipment}', 'Completed date was rolled back for {Equipment}.',
   'migration:20261014_pod'),
  ('00000000-0000-4000-8000-000000000001', 'DISPO',
   '["shop_contact","ad_hoc"]', '[]',
   'Dispo instructions — {Equipment}', 'Dispo relay for {Equipment}.',
   'migration:20261014_pod'),
  ('00000000-0000-4000-8000-000000000001', 'INVOICE_LOADED',
   '["owner_users","reviewers","ad_hoc"]', '[]',
   'Invoice loaded — {Equipment}', 'Shop invoice loaded for {Equipment}.',
   'migration:20261014_pod'),
  ('00000000-0000-4000-8000-000000000001', 'RESP6_LESSEE_EMAIL',
   '["lessee_contacts","ad_hoc"]', '["shop"]',
   'Estimate approval (Resp 6) — {Equipment}', 'Please review Resp 6 portion for {Equipment}.',
   'migration:20261014_pod'),
  ('00000000-0000-4000-8000-000000000001', 'INVOICE_OTP',
   '["shop_contact"]', '[]',
   'One-time code for invoice submit — {Equipment}', 'Your one-time code was emailed (dev adapter logs only).',
   'migration:20261014_pod')
ON CONFLICT (tenant_id, notification_type) DO UPDATE
  SET include_roles = EXCLUDED.include_roles,
      exclude_roles = EXCLUDED.exclude_roles,
      template_subject = EXCLUDED.template_subject,
      template_body = EXCLUDED.template_body,
      active = true;

-- Default OTP step flags on tenant settings (invoice_submit off until Q3 decided)
UPDATE repair.tenants
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'otpSteps', jsonb_build_object('invoice_submit', false),
  'podDueDays', 5
)
WHERE id = '00000000-0000-4000-8000-000000000001';

-- original_filename may already exist from prior migration; keep idempotent
ALTER TABLE repair.documents
  ADD COLUMN IF NOT EXISTS original_filename text;

COMMIT;
