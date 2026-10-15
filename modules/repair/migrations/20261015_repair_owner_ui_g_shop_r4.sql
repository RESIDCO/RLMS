-- Owner UI §G r4 — shop BO signed-link workflow, invoice accept gate, yard note.
-- Integer cents. Repair schema only.

BEGIN;

ALTER TABLE repair.events
  ADD COLUMN IF NOT EXISTS yard_track_note text;

COMMENT ON COLUMN repair.events.yard_track_note IS
  '§G r4 optional yard/track note when shop marks on hand';

ALTER TABLE repair.invoices
  ADD COLUMN IF NOT EXISTS workflow_status text,
  ADD COLUMN IF NOT EXISTS aar_document_id uuid REFERENCES repair.documents(id),
  ADD COLUMN IF NOT EXISTS owner_decision_note text,
  ADD COLUMN IF NOT EXISTS decided_by text,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;

COMMENT ON COLUMN repair.invoices.workflow_status IS
  '§G r4 shop invoice: INVOICE_SUBMITTED → UNDER_OWNER_REVIEW → ACCEPTED | REJECTED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_workflow_status_check'
  ) THEN
    ALTER TABLE repair.invoices
      ADD CONSTRAINT invoices_workflow_status_check
      CHECK (
        workflow_status IS NULL
        OR workflow_status IN (
          'INVOICE_SUBMITTED',
          'UNDER_OWNER_REVIEW',
          'ACCEPTED',
          'REJECTED'
        )
      );
  END IF;
END $$;

-- Backfill prior APPROVED / MATCHED invoices as ACCEPTED for close-gate compat.
UPDATE repair.invoices
SET workflow_status = 'ACCEPTED',
    decided_at = coalesce(decided_at, approved_at, created_at),
    decided_by = coalesce(decided_by, approved_by, created_by)
WHERE deleted_at IS NULL
  AND workflow_status IS NULL
  AND match_status IN ('APPROVED', 'MATCHED');

UPDATE repair.invoices
SET workflow_status = 'UNDER_OWNER_REVIEW'
WHERE deleted_at IS NULL
  AND workflow_status IS NULL
  AND match_status IN ('MISMATCH', 'PENDING_REVIEW');

CREATE INDEX IF NOT EXISTS invoices_workflow_status_idx
  ON repair.invoices (tenant_id, workflow_status, created_at DESC)
  WHERE deleted_at IS NULL AND workflow_status IS NOT NULL;

COMMIT;
