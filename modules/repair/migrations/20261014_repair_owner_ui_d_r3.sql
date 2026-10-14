-- Owner UI §D Estimate Review r3 — email outbox (local mode) + send-lessee history
-- Integer cents elsewhere unchanged. Append-only / VOIDED pattern for soft-delete.

CREATE TABLE IF NOT EXISTS repair.email_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL DEFAULT 'residco',
  event_id          uuid,
  estimate_id       uuid,
  revision_id       uuid,
  notification_type text NOT NULL,
  recipients        jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc                jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject           text NOT NULL,
  body_text         text NOT NULL,
  body_html         text,
  attachments       jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachment_bytes  bigint NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'logged',
  local_mode        boolean NOT NULL DEFAULT true,
  provider_message_id text,
  note              text,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_outbox_estimate_idx
  ON repair.email_outbox (estimate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_outbox_event_idx
  ON repair.email_outbox (event_id, created_at DESC);

COMMENT ON TABLE repair.email_outbox IS
  'Local-mode / logged outbound email (no real send). Send-lessee preview + history.';
