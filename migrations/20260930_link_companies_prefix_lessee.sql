-- Unique longest prefix match (min 6 cleaned chars). Do not attach a short
-- lessee to a "leasing" company unless the lessee name also looks like one.

INSERT INTO public.contact_lease_links (company_id, company_contact_id, master_lease_id, rider_id, relationship_note)
SELECT company_id, NULL::bigint, mla_id, NULL::bigint, 'Matched unique prefix of company name to lessee'
FROM (
  WITH unlinked AS (
    SELECT ml.id, ml.lessee, public.directory_clean_name(ml.lessee) AS ck
    FROM public.master_leases ml
    WHERE public.directory_clean_name(coalesce(ml.lessee, '')) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.contact_lease_links cl
        WHERE cl.master_lease_id = ml.id AND cl.company_id IS NOT NULL
      )
  ),
  cands AS (
    SELECT
      u.id AS mla_id,
      c.id AS company_id,
      length(public.directory_clean_name(c.name)) AS clen
    FROM unlinked u
    JOIN public.companies c ON c.merged_into_id IS NULL
      AND EXISTS (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id = c.id)
      AND public.directory_clean_name(c.name) <> u.ck
      AND least(length(u.ck), length(public.directory_clean_name(c.name))) >= 6
      AND NOT (
        public.directory_clean_name(c.name) LIKE '%leas%'
        AND u.ck NOT LIKE '%leas%'
      )
      AND (
        u.ck LIKE public.directory_clean_name(c.name) || '%'
        OR public.directory_clean_name(c.name) LIKE u.ck || '%'
      )
  ),
  ranked AS (
    SELECT *,
      count(*) OVER (PARTITION BY mla_id, clen) AS n_at_len,
      max(clen) OVER (PARTITION BY mla_id) AS max_len
    FROM cands
  )
  SELECT DISTINCT mla_id, company_id
  FROM ranked
  WHERE clen = max_len AND n_at_len = 1
) x
WHERE NOT EXISTS (
  SELECT 1 FROM public.contact_lease_links cl
  WHERE cl.company_id = x.company_id
    AND cl.master_lease_id = x.mla_id
    AND cl.company_contact_id IS NULL
    AND cl.rider_id IS NULL
);
