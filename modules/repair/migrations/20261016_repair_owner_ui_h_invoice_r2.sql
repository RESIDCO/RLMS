-- §H r2 — invoice line location for match fallback; payment outbox metadata
ALTER TABLE repair.invoice_lines
  ADD COLUMN IF NOT EXISTS location_on_car text;

COMMENT ON COLUMN repair.invoice_lines.location_on_car IS
  'AAR location on car (App. G); used with job+qualifier for invoice↔estimate match fallback';

ALTER TABLE repair.payment_batches
  ADD COLUMN IF NOT EXISTS outbox_path text;

COMMENT ON COLUMN repair.payment_batches.outbox_path IS
  'Local filesystem path of exported CSV under payment-outbox (no real ACH)';
