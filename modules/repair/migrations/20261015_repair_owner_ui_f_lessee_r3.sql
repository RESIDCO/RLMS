-- Owner UI §F r3 — Manual lessee decision by owner/managing partner.
-- APPROVED_MANUAL / REJECTED_MANUAL; proof attachment; undo (append-only).
-- Integer cents. Never delete decision history.

BEGIN;

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
    'APPROVED_MANUAL',
    'REJECTED_MANUAL',
    'SUPERSEDED',
    'EXPIRED'
  ));

ALTER TABLE repair.lessee_approvals
  ADD COLUMN IF NOT EXISTS manual_method text,
  ADD COLUMN IF NOT EXISTS manual_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS proof_document_id uuid REFERENCES repair.documents(id),
  ADD COLUMN IF NOT EXISTS manual_undone_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_undo_reason text,
  ADD COLUMN IF NOT EXISTS manual_undo_by text,
  ADD COLUMN IF NOT EXISTS link_closed_message text;

COMMENT ON COLUMN repair.lessee_approvals.manual_method IS
  'How the off-link response was received: email | phone | other.';
COMMENT ON COLUMN repair.lessee_approvals.manual_received_at IS
  'When the lessee response was received (owner-entered; default now ET).';
COMMENT ON COLUMN repair.lessee_approvals.proof_document_id IS
  'Optional proof (.msg/.eml/PDF) in Document Viewer category Lessee Approval; owner_only.';
COMMENT ON COLUMN repair.lessee_approvals.link_closed_message IS
  'Shown on lessee link after manual record: A response was already recorded.';

DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'repair'
      AND rel.relname = 'lessee_approval_decisions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%decision%'
  LOOP
    EXECUTE format(
      'ALTER TABLE repair.lessee_approval_decisions DROP CONSTRAINT %I',
      cname
    );
  END LOOP;
END $$;

ALTER TABLE repair.lessee_approval_decisions
  ADD CONSTRAINT lessee_approval_decisions_decision_check
  CHECK (decision IN ('APPROVED', 'REJECTED', 'UNDO'));

ALTER TABLE repair.lessee_approval_decisions
  ADD COLUMN IF NOT EXISTS proof_document_id uuid REFERENCES repair.documents(id),
  ADD COLUMN IF NOT EXISTS manual_method text,
  ADD COLUMN IF NOT EXISTS manual_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS recorded_by text;

COMMENT ON COLUMN repair.lessee_approval_decisions.recorded_by IS
  'Owner/managing partner who recorded the manual decision (audit).';

COMMIT;
