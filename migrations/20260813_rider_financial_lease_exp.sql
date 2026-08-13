-- Asset Report "Lease Exp" calendar date on rider_financial_summary.
-- months_until_lease_exp already existed; this stores the actual Lease Exp date
-- so Dashboard can age terms against today instead of a stale month count.
ALTER TABLE public.rider_financial_summary
  ADD COLUMN IF NOT EXISTS lease_exp_date date;

COMMENT ON COLUMN public.rider_financial_summary.lease_exp_date IS
  'Asset Report Lease Exp (per rider deal). Distinct from VCF car-level lease_end_date.';
