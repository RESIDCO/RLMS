-- Move leftover OL-only rider_contacts into the companies / company_contacts directory
-- and link them to the originating rider. Idempotent.

INSERT INTO public.companies (name, relationship_type, source, account_id)
SELECT DISTINCT
  COALESCE(NULLIF(btrim(ml.lessee), ''), NULLIF(btrim(r.rider_name), ''), 'Unnamed company'),
  'unclassified',
  'rider_contacts_promote',
  NULL::bigint
FROM public.rider_contacts rc
JOIN public.riders r ON r.id = rc.rider_id
LEFT JOIN public.master_leases ml ON ml.id = r.master_lease_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.companies c
  WHERE c.merged_into_id IS NULL
    AND lower(c.name) = lower(COALESCE(NULLIF(btrim(ml.lessee), ''), NULLIF(btrim(r.rider_name), ''), 'Unnamed company'))
);

INSERT INTO public.company_contacts (company_id, name, title, email, phone, notes, source)
SELECT DISTINCT ON (co.id, lower(rc.name), lower(COALESCE(rc.email, '')))
  co.id,
  rc.name,
  rc.title,
  rc.email,
  rc.phone,
  rc.notes,
  'rider_contacts_promote'
FROM public.rider_contacts rc
JOIN public.riders r ON r.id = rc.rider_id
LEFT JOIN public.master_leases ml ON ml.id = r.master_lease_id
JOIN public.companies co
  ON co.merged_into_id IS NULL
 AND lower(co.name) = lower(COALESCE(NULLIF(btrim(ml.lessee), ''), NULLIF(btrim(r.rider_name), ''), 'Unnamed company'))
WHERE NOT EXISTS (
  SELECT 1
  FROM public.company_contacts cc
  WHERE cc.company_id = co.id
    AND lower(cc.name) = lower(rc.name)
    AND lower(COALESCE(cc.email, '')) = lower(COALESCE(rc.email, ''))
);

INSERT INTO public.contact_lease_links (company_contact_id, master_lease_id, rider_id, relationship_note)
SELECT cc.id, r.master_lease_id, rc.rider_id, rc.notes
FROM public.rider_contacts rc
JOIN public.riders r ON r.id = rc.rider_id
LEFT JOIN public.master_leases ml ON ml.id = r.master_lease_id
JOIN public.companies co
  ON co.merged_into_id IS NULL
 AND lower(co.name) = lower(COALESCE(NULLIF(btrim(ml.lessee), ''), NULLIF(btrim(r.rider_name), ''), 'Unnamed company'))
JOIN public.company_contacts cc
  ON cc.company_id = co.id
 AND lower(cc.name) = lower(rc.name)
 AND lower(COALESCE(cc.email, '')) = lower(COALESCE(rc.email, ''))
WHERE NOT EXISTS (
  SELECT 1
  FROM public.contact_lease_links cl
  WHERE cl.company_contact_id = cc.id
    AND cl.rider_id = rc.rider_id
);

DELETE FROM public.rider_contacts rc
WHERE EXISTS (
  SELECT 1
  FROM public.contact_lease_links cl
  JOIN public.company_contacts cc ON cc.id = cl.company_contact_id
  WHERE cl.rider_id = rc.rider_id
    AND lower(cc.name) = lower(rc.name)
    AND lower(COALESCE(cc.email, '')) = lower(COALESCE(rc.email, ''))
);
