-- Strip synthetic VCF- prefix from master_leases.lease_number.
-- Verified: stripping produces zero collisions (270 distinct before and after).
-- Safe to re-run.

UPDATE public.master_leases
SET lease_number = regexp_replace(lease_number, '^VCF-', '', 'i')
WHERE lease_number ~* '^VCF-';
