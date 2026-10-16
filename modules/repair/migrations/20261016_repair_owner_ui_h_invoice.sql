-- Owner UI §H — invoice review + shop payment (export-only; no real ACH).
-- Integer cents. Repair schema only. Defaults: tolerance $0/0%, net 30, generic CSV.

BEGIN;

-- Per-entity invoice tolerance + payment terms (defaults $0 / 0% / net 30)
CREATE TABLE IF NOT EXISTS repair.entity_invoice_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES repair.tenants(id),
  entity_code           text NOT NULL,
  tolerance_cents       bigint NOT NULL DEFAULT 0,
  tolerance_pct_bp      integer NOT NULL DEFAULT 0, -- basis points; 100 = 1.00%
  payment_terms_days    integer NOT NULL DEFAULT 30,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text,
  deleted_at            timestamptz,
  UNIQUE (tenant_id, entity_code)
);

COMMENT ON TABLE repair.entity_invoice_settings IS
  '§H per-entity invoice tolerance ($ and %) and net payment terms. Default $0/0%/net 30.';

INSERT INTO repair.entity_invoice_settings
  (tenant_id, entity_code, tolerance_cents, tolerance_pct_bp, payment_terms_days, created_by)
SELECT t.id, '*', 0, 0, 30, 'migration:owner-ui-h'
FROM repair.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM repair.entity_invoice_settings s
  WHERE s.tenant_id = t.id AND s.entity_code = '*' AND s.deleted_at IS NULL
);

-- Invoice payment / review columns
ALTER TABLE repair.invoices
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS approved_amount_cents bigint,
  ADD COLUMN IF NOT EXISTS short_pay_cents bigint,
  ADD COLUMN IF NOT EXISTS short_pay_reason text,
  ADD COLUMN IF NOT EXISTS over_tolerance_reason text,
  ADD COLUMN IF NOT EXISTS payment_batch_id uuid,
  ADD COLUMN IF NOT EXISTS paid_at date,
  ADD COLUMN IF NOT EXISTS paid_ref text,
  ADD COLUMN IF NOT EXISTS paid_method text,
  ADD COLUMN IF NOT EXISTS rebill_status text,
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS approved_estimate_cents bigint,
  ADD COLUMN IF NOT EXISTS flags_summary text;

COMMENT ON COLUMN repair.invoices.payment_status IS
  '§H Payable → In Batch → Exported → Paid (SHORT_PAID flag via short_pay_cents)';
COMMENT ON COLUMN repair.invoices.rebill_status IS
  '§H Rebill pending for lessee (6) / damaging road (3) — next phase queues only';

-- Expand workflow_status for §H payment path (drop/recreate check)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_workflow_status_check'
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_payment_status_check'
  ) THEN
    ALTER TABLE repair.invoices
      ADD CONSTRAINT invoices_payment_status_check
      CHECK (
        payment_status IS NULL
        OR payment_status IN (
          'PAYABLE',
          'IN_BATCH',
          'EXPORTED',
          'PAID',
          'SHORT_PAID'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_rebill_status_check'
  ) THEN
    ALTER TABLE repair.invoices
      ADD CONSTRAINT invoices_rebill_status_check
      CHECK (
        rebill_status IS NULL
        OR rebill_status IN ('NONE', 'REBILL_PENDING', 'REBILLED')
      );
  END IF;
END $$;

-- Invoice lines (from shop 500-byte / hand entry) for side-by-side review
CREATE TABLE IF NOT EXISTS repair.invoice_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  invoice_id        uuid NOT NULL REFERENCES repair.invoices(id),
  line_no           int NOT NULL,
  aar_job_code      text,
  qualifier         text,
  why_made          text,
  resp_code         text,
  quantity          numeric(14,4),
  labor_cents       bigint NOT NULL DEFAULT 0,
  material_cents    bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  short_pay_cents   bigint,
  short_pay_reason  text,
  raw_line          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  UNIQUE (invoice_id, line_no)
);

CREATE INDEX IF NOT EXISTS invoice_lines_invoice_idx
  ON repair.invoice_lines (invoice_id, line_no);

-- Payment batches (CSV/AP export only — no real payments)
CREATE TABLE IF NOT EXISTS repair.payment_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES repair.tenants(id),
  batch_no          text NOT NULL,
  status            text NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'EXPORTED', 'CLOSED')),
  export_csv        text,
  exported_at       timestamptz,
  exported_by       text,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  deleted_at        timestamptz,
  deleted_by        text,
  UNIQUE (tenant_id, batch_no)
);

ALTER TABLE repair.invoices
  DROP CONSTRAINT IF EXISTS invoices_payment_batch_fk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_payment_batch_fk'
  ) THEN
    ALTER TABLE repair.invoices
      ADD CONSTRAINT invoices_payment_batch_fk
      FOREIGN KEY (payment_batch_id) REFERENCES repair.payment_batches(id);
  END IF;
EXCEPTION WHEN others THEN
  NULL; -- batch table may be empty; FK still valid
END $$;

CREATE INDEX IF NOT EXISTS invoices_payment_status_idx
  ON repair.invoices (tenant_id, payment_status, due_date)
  WHERE deleted_at IS NULL AND payment_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_workflow_owner_queue_idx
  ON repair.invoices (tenant_id, workflow_status, created_at DESC)
  WHERE deleted_at IS NULL;

-- Backfill: ACCEPTED shop invoices → PAYABLE for §H payment path
UPDATE repair.invoices
SET workflow_status = 'PAYABLE',
    payment_status = COALESCE(payment_status, 'PAYABLE'),
    due_date = COALESCE(
      due_date,
      (COALESCE(decided_at, approved_at, created_at)::date + interval '30 days')::date
    ),
    approved_amount_cents = COALESCE(
      approved_amount_cents,
      ROUND(COALESCE(total, 0) * 100)::bigint
    )
WHERE deleted_at IS NULL
  AND workflow_status = 'ACCEPTED'
  AND (payment_status IS NULL OR payment_status = 'PAYABLE');

COMMIT;
