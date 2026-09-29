-- Link directory companies to MLAs when the company name matches lessee exactly.
-- Company-only rows (company_id set, company_contact_id null). Idempotent.

INSERT INTO public.contact_lease_links (company_id, company_contact_id, master_lease_id, rider_id, relationship_note)
SELECT DISTINCT
  c.id,
  NULL,
  ml.id,
  NULL,
  'Matched company name to lessee'
FROM public.companies c
JOIN public.master_leases ml
  ON lower(btrim(c.name)) = lower(btrim(ml.lessee))
WHERE c.merged_into_id IS NULL
  AND ml.lessee IS NOT NULL
  AND btrim(ml.lessee) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.contact_lease_links cl
    WHERE cl.company_id = c.id
      AND cl.master_lease_id = ml.id
      AND cl.company_contact_id IS NULL
      AND cl.rider_id IS NULL
  );
