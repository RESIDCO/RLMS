-- Contacts 360: substring / trigram branch on directory_search (already applied live).
-- Unions ILIKE / pg_trgm similarity with existing tsvector ranking.

CREATE OR REPLACE FUNCTION public.directory_search(
  p_q text DEFAULT NULL,
  p_include_industry boolean DEFAULT false,
  p_relationship_type text DEFAULT NULL,
  p_priority_tier text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS TABLE (
  total_count bigint,
  badge text,
  result_kind text,
  company_id bigint,
  company_name text,
  relationship_type text,
  account_id bigint,
  reporting_marks text[],
  source text,
  priority_tier text,
  status text,
  contact_id bigint,
  contact_name text,
  title text,
  email text,
  phone text,
  mobile text,
  city text,
  state text,
  rider_id bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH params AS (
    SELECT
      NULLIF(btrim(p_q), '') AS q,
      CASE
        WHEN NULLIF(btrim(p_q), '') IS NULL THEN NULL::tsquery
        ELSE plainto_tsquery('english'::regconfig, btrim(p_q))
      END AS tsq
  ),
  matched_companies AS (
    SELECT c.*
    FROM public.companies c
    CROSS JOIN params p
    WHERE c.merged_into_id IS NULL
      AND (p_include_industry OR coalesce(c.relationship_type, '') NOT IN ('lessor', 'railroad'))
      AND (p_relationship_type IS NULL OR c.relationship_type = p_relationship_type)
      AND (p_priority_tier IS NULL OR c.priority_tier = p_priority_tier)
      AND (p_status IS NULL OR c.status = p_status)
      AND (p_source IS NULL OR c.source = p_source)
      AND (
        p.tsq IS NULL
        OR c.search_vector @@ p.tsq
        OR (p.q IS NOT NULL AND (
          c.name ILIKE '%' || p.q || '%'
          OR c.name % p.q
        ))
        OR exists (
          SELECT 1 FROM public.company_contacts cc
          WHERE cc.company_id = c.id
            AND (
              (p.tsq IS NOT NULL AND cc.search_vector @@ p.tsq)
              OR (p.q IS NOT NULL AND (
                cc.name ILIKE '%' || p.q || '%'
                OR coalesce(cc.email, '') ILIKE '%' || p.q || '%'
                OR cc.name % p.q
              ))
            )
        )
        OR exists (
          SELECT 1 FROM unnest(coalesce(c.reporting_marks, ARRAY[]::text[])) m
          WHERE p.q IS NOT NULL AND m ILIKE p.q || '%'
        )
      )
  ),
  crm_rows AS (
    SELECT
      CASE
        WHEN c.account_id IS NOT NULL THEN 'customer'
        WHEN c.relationship_type = 'prospect' THEN 'prospect'
        WHEN c.relationship_type IN ('lessor', 'railroad') THEN 'lessor'
        ELSE 'unclassified'
      END AS badge,
      'company_contact'::text AS result_kind,
      c.id AS company_id, c.name AS company_name, c.relationship_type, c.account_id, c.reporting_marks, c.source, c.priority_tier, c.status,
      cc.id AS contact_id, cc.name AS contact_name, cc.title, cc.email, cc.phone, cc.mobile, cc.city, cc.state, NULL::bigint AS rider_id,
      GREATEST(
        CASE WHEN p.tsq IS NULL THEN 0 ELSE ts_rank(c.search_vector, p.tsq) END,
        CASE WHEN p.tsq IS NULL THEN 0 ELSE ts_rank(cc.search_vector, p.tsq) END,
        CASE WHEN p.q IS NULL THEN 0 ELSE similarity(c.name, p.q) END,
        CASE WHEN p.q IS NULL THEN 0 ELSE similarity(cc.name, p.q) END
      ) AS match_score
    FROM matched_companies c
    JOIN public.company_contacts cc ON cc.company_id = c.id
    CROSS JOIN params p
    WHERE (p_state IS NULL OR cc.state = p_state)
      AND (
        p.q IS NULL
        OR c.search_vector @@ p.tsq
        OR cc.search_vector @@ p.tsq
        OR c.name ILIKE '%' || p.q || '%'
        OR cc.name ILIKE '%' || p.q || '%'
        OR coalesce(cc.email,'') ILIKE '%' || p.q || '%'
        OR exists (SELECT 1 FROM unnest(coalesce(c.reporting_marks, ARRAY[]::text[])) m WHERE m ILIKE p.q || '%')
      )
  ),
  company_only AS (
    SELECT
      CASE
        WHEN c.account_id IS NOT NULL THEN 'customer'
        WHEN c.relationship_type = 'prospect' THEN 'prospect'
        WHEN c.relationship_type IN ('lessor', 'railroad') THEN 'lessor'
        ELSE 'unclassified'
      END AS badge,
      'company'::text AS result_kind,
      c.id, c.name, c.relationship_type, c.account_id, c.reporting_marks, c.source, c.priority_tier, c.status,
      NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::bigint,
      CASE WHEN p.q IS NULL THEN 0 ELSE similarity(c.name, p.q) END AS match_score
    FROM matched_companies c
    CROSS JOIN params p
    WHERE p_state IS NULL
      AND NOT exists (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id = c.id)
  ),
  ol_rows AS (
    SELECT 'lease_ol'::text, 'lease_ol'::text, NULL::bigint, NULL::text, NULL::text, NULL::bigint, NULL::text[], NULL::text, NULL::text, NULL::text,
      rc.id, rc.name, rc.title, rc.email, rc.phone, NULL::text, NULL::text, NULL::text, rc.rider_id,
      CASE WHEN p.q IS NULL THEN 0 ELSE similarity(rc.name, p.q) END
    FROM public.rider_contacts rc CROSS JOIN params p
    WHERE p_relationship_type IS NULL AND p_priority_tier IS NULL AND p_status IS NULL AND p_source IS NULL AND p_state IS NULL
      AND (p.q IS NULL OR rc.name ILIKE '%' || p.q || '%' OR coalesce(rc.title,'') ILIKE '%' || p.q || '%' OR coalesce(rc.email,'') ILIKE '%' || p.q || '%' OR coalesce(rc.phone,'') ILIKE '%' || p.q || '%' OR coalesce(rc.notes,'') ILIKE '%' || p.q || '%')
  ),
  all_rows AS (
    SELECT * FROM crm_rows UNION ALL SELECT * FROM company_only UNION ALL SELECT * FROM ol_rows
  ),
  counted AS (SELECT *, count(*) OVER() AS total_count FROM all_rows)
  SELECT total_count, badge, result_kind, company_id, company_name, relationship_type, account_id, reporting_marks, source, priority_tier, status, contact_id, contact_name, title, email, phone, mobile, city, state, rider_id
  FROM counted
  ORDER BY match_score DESC, company_name NULLS LAST, contact_name NULLS LAST, contact_id NULLS LAST
  LIMIT greatest(coalesce(p_page_size, 50), 1)
  OFFSET greatest(coalesce(p_page, 1) - 1, 0) * greatest(coalesce(p_page_size, 50), 1);
$$;
