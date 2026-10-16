-- Owner UI §H r3 — monthly close (replaces pay-cycle cutoff), multi-car invoices,
-- short-pay line semantics (shortfall not paid amount). Integer cents.

BEGIN;

-- Accounting months: one open at a time; owner/MP closes when ready (no EOM auto).
CREATE TABLE IF NOT EXISTS repair.accounting_months (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  month_label       text NOT NULL, -- YYYY-MM
  status            text NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  opened_by         text,
  closed_at         timestamptz,
  closed_by         text,
  reopen_reason     text,
  reopened_at       timestamptz,
  reopened_by       text,
  close_totals      jsonb,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  deleted_at        timestamptz,
  deleted_by        text,
  UNIQUE (tenant_id, month_label)
);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_months_one_open_idx
  ON repair.accounting_months (tenant_id)
  WHERE status = 'OPEN' AND deleted_at IS NULL;

COMMENT ON TABLE repair.accounting_months IS
  '§H r3 owner/MP accounting months. One OPEN at a time; close freezes invoices in month.';

-- Invoice columns for month bucket + multi-car + snapshots
ALTER TABLE repair.invoices
  ADD COLUMN IF NOT EXISTS accounting_month_id uuid
    REFERENCES repair.accounting_months(id),
  ADD COLUMN IF NOT EXISTS is_multi_car boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS car_count int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS car_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS lease_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS billing_party_mark text,
  ADD COLUMN IF NOT EXISTS entity_billing_code text;

CREATE INDEX IF NOT EXISTS invoices_accounting_month_idx
  ON repair.invoices (tenant_id, accounting_month_id)
  WHERE deleted_at IS NULL AND accounting_month_id IS NOT NULL;

-- Per-car members of a (possibly single-car) invoice
CREATE TABLE IF NOT EXISTS repair.invoice_cars (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES repair.tenants(id),
  invoice_id          uuid NOT NULL REFERENCES repair.invoices(id),
  event_id            uuid NOT NULL REFERENCES repair.events(id),
  estimate_id         uuid REFERENCES repair.estimates(id),
  revision_id         uuid,
  car_mark            text NOT NULL,
  car_number          text NOT NULL,
  estimate_cents      bigint NOT NULL DEFAULT 0,
  invoiced_cents      bigint NOT NULL DEFAULT 0,
  difference_cents    bigint NOT NULL DEFAULT 0,
  flags_summary       text,
  car_snapshot        jsonb,
  lease_snapshot      jsonb,
  line_status         text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (line_status IN ('ACTIVE', 'REJECTED', 'SHORT_PAID')),
  short_pay_cents     bigint,
  short_pay_reason    text,
  reject_reason       text,
  sort_order          int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  UNIQUE (invoice_id, event_id)
);

CREATE INDEX IF NOT EXISTS invoice_cars_invoice_idx
  ON repair.invoice_cars (invoice_id, sort_order);

CREATE INDEX IF NOT EXISTS invoice_cars_event_active_idx
  ON repair.invoice_cars (event_id)
  WHERE line_status = 'ACTIVE';

-- A car may only appear on one active (non-rejected, non-deleted) invoice
CREATE UNIQUE INDEX IF NOT EXISTS invoice_cars_one_active_per_event
  ON repair.invoice_cars (tenant_id, event_id)
  WHERE line_status = 'ACTIVE';

ALTER TABLE repair.invoice_lines
  ADD COLUMN IF NOT EXISTS invoice_car_id uuid
    REFERENCES repair.invoice_cars(id);

-- Expand workflow / payment statuses for monthly close path
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_workflow_status_check'
  ) THEN
    ALTER TABLE repair.invoices DROP CONSTRAINT invoices_workflow_status_check;
  END IF;
  ALTER TABLE repair.invoices
    ADD CONSTRAINT invoices_workflow_status_check
    CHECK (
      workflow_status IS NULL
      OR workflow_status IN (
        'INVOICE_SUBMITTED',
        'UNDER_OWNER_REVIEW',
        'ACCEPTED',
        'REJECTED',
        'APPROVED_IN_OPEN_MONTH',
        'MONTH_CLOSED',
        'SENT_TO_AP',
        'PAYABLE',
        'IN_BATCH',
        'EXPORTED',
        'PAID',
        'SHORT_PAID'
      )
    );
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_payment_status_check'
  ) THEN
    ALTER TABLE repair.invoices DROP CONSTRAINT invoices_payment_status_check;
  END IF;
  ALTER TABLE repair.invoices
    ADD CONSTRAINT invoices_payment_status_check
    CHECK (
      payment_status IS NULL
      OR payment_status IN (
        'APPROVED_IN_OPEN_MONTH',
        'MONTH_CLOSED',
        'SENT_TO_AP',
        'PAYABLE',
        'IN_BATCH',
        'EXPORTED',
        'PAID',
        'SHORT_PAID'
      )
    );
END $$;

-- Seed current open month if none
INSERT INTO repair.accounting_months
  (tenant_id, month_label, status, opened_by, created_by)
SELECT t.id,
       to_char(CURRENT_DATE, 'YYYY-MM'),
       'OPEN',
       'migration:owner-ui-h-r3',
       'migration:owner-ui-h-r3'
FROM repair.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM repair.accounting_months m
  WHERE m.tenant_id = t.id AND m.status = 'OPEN' AND m.deleted_at IS NULL
);

COMMIT;
