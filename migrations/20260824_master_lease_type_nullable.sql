-- Allow blank lease_type on auto-created MLAs so Bulk Import / VCF never
-- invent a default. Humans set Net Lease / Full Service Lease / Modified
-- in Lease Management. Safe to re-run.

ALTER TABLE public.master_leases
  ALTER COLUMN lease_type DROP NOT NULL;

COMMENT ON COLUMN public.master_leases.lease_type IS
  'Human-maintained commercial type (Net Lease / Full Service Lease / Modified Lease). Never written by VCF or Bulk Import.';
