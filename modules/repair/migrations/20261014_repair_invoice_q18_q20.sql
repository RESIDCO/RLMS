-- 20261014_repair_invoice_q18_q20.sql
--
-- Q18 blank invoice_no keying + reviewer entry
-- Q19 duplicate scope (billing+invoice_no hard; car+total+jobs soft)
-- Q20 MISMATCH cannot APPROVED_FOR_ACH (no override)
-- APPLY ONLY to local Postgres. Creates/alters objects in schema "repair" only.

BEGIN;

ALTER TABLE repair.invoices
  ADD COLUMN IF NOT EXISTS invoice_no_blank boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_no_source text,
  ADD COLUMN IF NOT EXISTS invoice_no_entered_by text,
  ADD COLUMN IF NOT EXISTS invoice_no_entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS job_codes text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN repair.invoices.invoice_no_blank IS
  'True when shop 500-byte left invoice_number blank; invoice_no holds synthetic key (shop mark + car + event + submit date) until reviewer enters the real number (Q18)';
COMMENT ON COLUMN repair.invoices.invoice_no_source IS
  'FILE | SYNTHETIC | REVIEWER — provenance of invoice_no';
COMMENT ON COLUMN repair.invoices.job_codes IS
  'Distinct AAR job codes from Format 1 lines; used for Q19 soft duplicate (car + total + overlapping jobs within 12 months)';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_invoice_no_source_check'
      AND conrelid = 'repair.invoices'::regclass
  ) THEN
    ALTER TABLE repair.invoices
      ADD CONSTRAINT invoices_invoice_no_source_check
      CHECK (
        invoice_no_source IS NULL
        OR invoice_no_source IN ('FILE', 'SYNTHETIC', 'REVIEWER')
      );
  END IF;
END $$;

-- Q19(a): same billing party + invoice_no any period (non-rejected)
CREATE INDEX IF NOT EXISTS invoices_billing_invoice_no_idx
  ON repair.invoices (tenant_id, billing_party, invoice_no)
  WHERE deleted_at IS NULL
    AND billing_party IS NOT NULL
    AND COALESCE(review_status, '') <> 'REJECTED';

-- Q19(b): car + total within rolling window
CREATE INDEX IF NOT EXISTS invoices_car_total_created_idx
  ON repair.invoices (tenant_id, car_mark, car_number, total_cents, created_at DESC)
  WHERE deleted_at IS NULL
    AND COALESCE(review_status, '') <> 'REJECTED';

CREATE INDEX IF NOT EXISTS invoices_job_codes_gin_idx
  ON repair.invoices USING GIN (job_codes)
  WHERE deleted_at IS NULL;

COMMIT;
