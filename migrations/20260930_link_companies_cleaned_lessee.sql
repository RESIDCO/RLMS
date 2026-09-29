-- Normalized lessee ↔ company matching (strip sold-to x-prefix and legal suffixes).

CREATE OR REPLACE FUNCTION public.directory_clean_name(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(t, '')), '^x+', ''),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\y(the|inc|llc|llp|corp|ltd|co|company|corporation|incorporated|limited)\y',
      '',
      'g'
    )),
    '\s+', '', 'g'
  );
$$;

GRANT EXECUTE ON FUNCTION public.directory_clean_name(text) TO anon, authenticated, service_role;

INSERT INTO public.contact_lease_links (company_id, company_contact_id, master_lease_id, rider_id, relationship_note)
SELECT DISTINCT
  c.id,
  NULL::bigint,
  ml.id,
  NULL::bigint,
  'Matched cleaned company name to lessee'
FROM public.companies c
JOIN public.master_leases ml
  ON public.directory_clean_name(c.name) = public.directory_clean_name(ml.lessee)
 AND public.directory_clean_name(ml.lessee) <> ''
WHERE c.merged_into_id IS NULL
  AND ml.lessee IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.companies c2
    WHERE c2.merged_into_id IS NULL
      AND c2.id <> c.id
      AND public.directory_clean_name(c2.name) = public.directory_clean_name(c.name)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.contact_lease_links cl
    WHERE cl.company_id = c.id
      AND cl.master_lease_id = ml.id
      AND cl.company_contact_id IS NULL
      AND cl.rider_id IS NULL
  );
