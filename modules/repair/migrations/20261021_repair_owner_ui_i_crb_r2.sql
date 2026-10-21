-- §I r2: file delete must cascade through records and pool rows.
-- The first migration is already applied on databases that hit the
-- crb_lines_record_id_fkey error when a CRB file is removed.
BEGIN;

ALTER TABLE repair.crb_lines DROP CONSTRAINT IF EXISTS crb_lines_record_id_fkey;
ALTER TABLE repair.crb_lines
  ADD CONSTRAINT crb_lines_record_id_fkey
  FOREIGN KEY (record_id) REFERENCES repair.crb_records(id) ON DELETE CASCADE;

ALTER TABLE repair.month_pool_lines DROP CONSTRAINT IF EXISTS month_pool_lines_crb_line_id_fkey;
ALTER TABLE repair.month_pool_lines
  ADD CONSTRAINT month_pool_lines_crb_line_id_fkey
  FOREIGN KEY (crb_line_id) REFERENCES repair.crb_lines(id) ON DELETE CASCADE;

ALTER TABLE repair.biller_invoice_headers DROP CONSTRAINT IF EXISTS biller_invoice_headers_crb_invoice_id_fkey;
ALTER TABLE repair.biller_invoice_headers
  ADD CONSTRAINT biller_invoice_headers_crb_invoice_id_fkey
  FOREIGN KEY (crb_invoice_id) REFERENCES repair.crb_invoices(id) ON DELETE SET NULL;

COMMIT;
