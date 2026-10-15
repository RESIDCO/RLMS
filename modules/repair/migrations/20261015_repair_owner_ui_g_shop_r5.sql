-- Owner UI §G r5 — one stored BO status, one state machine.
-- Integer cents. Repair schema only.

BEGIN;

ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS status text;

COMMENT ON COLUMN repair.bad_orders.status IS
  '§G r5 single stored BO status (state machine). All screens read this field.';

ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

ALTER TABLE repair.bad_orders
  ADD COLUMN IF NOT EXISTS status_changed_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bad_orders_status_check'
  ) THEN
    ALTER TABLE repair.bad_orders
      ADD CONSTRAINT bad_orders_status_check
      CHECK (
        status IS NULL
        OR status IN (
          'ASSIGNED',
          'ACCEPTED',
          'ON_HAND',
          'ESTIMATE_DRAFT',
          'ESTIMATE_SUBMITTED',
          'UNDER_OWNER_REVIEW',
          'REJECTED',
          'APPROVED',
          'IN_REPAIR',
          'COMPLETED',
          'INVOICE_SUBMITTED',
          'CLOSED',
          'DECLINED'
        )
      );
  END IF;
END $$;

-- Status history (dated transitions; who/when)
CREATE TABLE IF NOT EXISTS repair.bo_status_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  bad_order_id    uuid NOT NULL REFERENCES repair.bad_orders(id),
  event_id        uuid NOT NULL,
  from_status     text,
  to_status       text NOT NULL,
  action_name     text NOT NULL,
  actor           text NOT NULL,
  note            text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bo_status_history_event_idx
  ON repair.bo_status_history (event_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS bad_orders_status_idx
  ON repair.bad_orders (tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL AND status IS NOT NULL;

-- Backfill from event + estimate + lifecycle (best-effort; r5 code owns forward writes)
UPDATE repair.bad_orders bo
SET status = CASE
  WHEN bo.closed_at IS NOT NULL OR bo.lifecycle_status = 'CLOSED' THEN 'CLOSED'
  WHEN bo.lifecycle_status = 'DECLINED' THEN 'DECLINED'
  WHEN EXISTS (
    SELECT 1 FROM repair.invoices i
    WHERE i.event_id = bo.event_id AND i.deleted_at IS NULL
      AND i.workflow_status IN ('INVOICE_SUBMITTED', 'UNDER_OWNER_REVIEW', 'REJECTED')
  ) THEN 'INVOICE_SUBMITTED'
  WHEN bo.completed_date IS NOT NULL THEN 'COMPLETED'
  WHEN EXISTS (
    SELECT 1 FROM repair.events e
    JOIN repair.statuses s ON s.id = e.status_id
    WHERE e.id = bo.event_id AND s.code = 'IN_REPAIR'
  ) THEN 'IN_REPAIR'
  WHEN EXISTS (
    SELECT 1 FROM repair.estimates est
    JOIN repair.statuses st ON st.id = est.status_id
    WHERE est.event_id = bo.event_id AND est.deleted_at IS NULL
      AND st.code = 'APPROVED'
  ) THEN 'APPROVED'
  WHEN EXISTS (
    SELECT 1 FROM repair.estimates est
    JOIN repair.statuses st ON st.id = est.status_id
    WHERE est.event_id = bo.event_id AND est.deleted_at IS NULL
      AND st.code IN ('REVISION_REQUESTED', 'ADJUSTMENT_FOR_APPROVAL')
  ) THEN 'REJECTED'
  WHEN EXISTS (
    SELECT 1 FROM repair.estimates est
    JOIN repair.statuses st ON st.id = est.status_id
    WHERE est.event_id = bo.event_id AND est.deleted_at IS NULL
      AND st.code = 'AWAITING_APPROVAL'
  ) THEN 'UNDER_OWNER_REVIEW'
  WHEN EXISTS (
    SELECT 1 FROM repair.estimates est
    JOIN repair.statuses st ON st.id = est.status_id
    WHERE est.event_id = bo.event_id AND est.deleted_at IS NULL
      AND st.code IN ('DRAFT', 'QUEUED')
  ) THEN 'ESTIMATE_DRAFT'
  WHEN EXISTS (
    SELECT 1 FROM repair.events e
    JOIN repair.statuses s ON s.id = e.status_id
    WHERE e.id = bo.event_id AND s.code = 'ON_HAND'
  ) OR bo.arrival_date IS NOT NULL THEN 'ON_HAND'
  WHEN EXISTS (
    SELECT 1 FROM repair.events e
    JOIN repair.statuses s ON s.id = e.status_id
    WHERE e.id = bo.event_id AND s.code = 'ACCEPTED'
  ) OR bo.lifecycle_status = 'ACCEPTED_PENDING' THEN 'ACCEPTED'
  ELSE 'ASSIGNED'
END,
status_changed_at = coalesce(status_changed_at, now()),
status_changed_by = coalesce(status_changed_by, 'migration:g-shop-r5')
WHERE status IS NULL AND deleted_at IS NULL;

-- Default for new rows
ALTER TABLE repair.bad_orders
  ALTER COLUMN status SET DEFAULT 'ASSIGNED';

UPDATE repair.bad_orders SET status = 'ASSIGNED' WHERE status IS NULL;

ALTER TABLE repair.bad_orders
  ALTER COLUMN status SET NOT NULL;

COMMIT;
