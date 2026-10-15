-- Owner UI §F — Lessee screen: response window, overdue flag, decision metadata.
-- Never auto-approve. Integer cents. Append-only decisions.

BEGIN;

-- Tenant defaults: 3 business days, ≥72h floor, owner holidays (YYYY-MM-DD ET).
UPDATE repair.tenants
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'lesseeResponseBusinessDays',
    COALESCE((settings->>'lesseeResponseBusinessDays')::int, 3),
  'lesseeResponseMinHours',
    COALESCE((settings->>'lesseeResponseMinHours')::int, 72),
  'ownerHolidays',
    COALESCE(settings->'ownerHolidays', '[]'::jsonb),
  'lesseeResponseByEntity',
    COALESCE(settings->'lesseeResponseByEntity', '{}'::jsonb)
);

COMMENT ON COLUMN repair.tenants.settings IS
  'JSON settings. §F: lesseeResponseBusinessDays (default 3), lesseeResponseMinHours (72), ownerHolidays[], lesseeResponseByEntity{CODE:{businessDays,minHours,holidays}}. Also lesseeResponseHours (legacy), systemFrom*, emailOutboxDir.';

-- Expand approval status for VIEWED / OVERDUE / MANUAL / SUPERSEDED
ALTER TABLE repair.lessee_approvals
  DROP CONSTRAINT IF EXISTS lessee_approvals_status_check;

ALTER TABLE repair.lessee_approvals
  ADD CONSTRAINT lessee_approvals_status_check CHECK (status IN (
    'PENDING',
    'VIEWED',
    'OVERDUE',
    'APPROVED_VIA_LINK',
    'REJECTED_VIA_LINK',
    'REPLY_RECEIVED',
    'REPLY_CONFIRMED',
    'REPLY_REJECTED',
    'MANUAL_APPROVED',
    'MANUAL_REJECTED',
    'SUPERSEDED',
    'EXPIRED'
  ));

ALTER TABLE repair.lessee_approvals
  ADD COLUMN IF NOT EXISTS response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_window_business_days int,
  ADD COLUMN IF NOT EXISTS link_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS overdue_flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS respondent_name text,
  ADD COLUMN IF NOT EXISTS respondent_email text,
  ADD COLUMN IF NOT EXISTS respondent_ip text,
  ADD COLUMN IF NOT EXISTS send_version int,
  ADD COLUMN IF NOT EXISTS outbox_id uuid,
  ADD COLUMN IF NOT EXISTS manual_note text,
  ADD COLUMN IF NOT EXISTS manual_recorded_by text,
  ADD COLUMN IF NOT EXISTS entity_code text;

COMMENT ON COLUMN repair.lessee_approvals.response_due_at IS
  'End of lessee response window (ET business days, ≥72h). Past due → OVERDUE flag; never auto-approve.';
COMMENT ON COLUMN repair.lessee_approvals.link_expires_at IS
  'Signed link hard expiry = response_due_at + 30 days (or revoked on supersede). After respond: read-only.';
COMMENT ON COLUMN repair.lessee_approvals.send_version IS
  'Monotonic per-estimate send number; newer send supersedes older links.';
COMMENT ON COLUMN repair.lessee_approvals.overdue_flagged_at IS
  'When Lessee response overdue was stamped. Never triggers auto-approve.';

CREATE INDEX IF NOT EXISTS lessee_approvals_due_idx
  ON repair.lessee_approvals (response_due_at)
  WHERE deleted_at IS NULL AND status IN ('PENDING', 'VIEWED', 'OVERDUE');

-- Estimate-level overdue flag for owner queue
ALTER TABLE repair.estimates
  ADD COLUMN IF NOT EXISTS lessee_response_overdue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lessee_response_overdue_at timestamptz;

COMMENT ON COLUMN repair.estimates.lessee_response_overdue IS
  'Owner queue flag: Lessee response overdue. Never auto-approves.';

-- Decision trail: allow manual channel + IP / respondent
ALTER TABLE repair.lessee_approval_decisions
  DROP CONSTRAINT IF EXISTS lessee_approval_decisions_channel_check;

ALTER TABLE repair.lessee_approval_decisions
  ADD CONSTRAINT lessee_approval_decisions_channel_check
  CHECK (channel IN ('url', 'email_reply', 'manual'));

ALTER TABLE repair.lessee_approval_decisions
  ADD COLUMN IF NOT EXISTS respondent_name text,
  ADD COLUMN IF NOT EXISTS respondent_email text,
  ADD COLUMN IF NOT EXISTS respondent_ip text,
  ADD COLUMN IF NOT EXISTS send_version int;

COMMIT;
