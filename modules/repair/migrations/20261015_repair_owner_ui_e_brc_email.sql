-- Owner UI §E r2 — Billing Repair Card PDF + Lessee responsibility email
-- Tenant settings for customary RESP6 email + local .eml outbox path.

UPDATE repair.tenants
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'lesseeResponseHours', COALESCE((settings->>'lesseeResponseHours')::int, 48),
  'systemFromEmail', COALESCE(NULLIF(settings->>'systemFromEmail', ''), 'noreply@repair.local'),
  'systemFromName', COALESCE(NULLIF(settings->>'systemFromName', ''), 'Contract Shop System'),
  'emailOutboxDir', COALESCE(
    NULLIF(settings->>'emailOutboxDir', ''),
    'modules/repair/dev/email-outbox'
  )
);

COMMENT ON COLUMN repair.tenants.settings IS
  'JSON settings. Includes lesseeResponseHours (default 48), systemFromEmail, systemFromName, emailOutboxDir (local .eml).';

ALTER TABLE repair.email_outbox
  ADD COLUMN IF NOT EXISTS eml_path text;

COMMENT ON COLUMN repair.email_outbox.eml_path IS
  'Filesystem path of .eml written in local mode (never sent).';
