-- Track A step 4: full-text search on companies / company_contacts.
-- Additive only. Does not alter accounts, master_leases, riders, railcars, or rider_contacts.
-- search_vector is trigger-maintained (not GENERATED) because array_to_string / to_tsvector
-- combinations are not IMMUTABLE on this Postgres version.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_companies_search ON public.companies USING gin (search_vector);

ALTER TABLE public.company_contacts
  ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_company_contacts_search ON public.company_contacts USING gin (search_vector);

CREATE OR REPLACE FUNCTION public.companies_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english'::regconfig, coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(array_to_string(NEW.reporting_marks, ' '), '')), 'B');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_search_vector ON public.companies;
CREATE TRIGGER trg_companies_search_vector
  BEFORE INSERT OR UPDATE OF name, reporting_marks
  ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.companies_search_vector_update();

CREATE OR REPLACE FUNCTION public.company_contacts_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english'::regconfig, coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW.title, '') || ' ' || coalesce(NEW.function_role, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW.email, '') || ' ' || coalesce(NEW.phone, '') || ' ' || coalesce(NEW.mobile, '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW.city, '') || ' ' || coalesce(NEW.state, '')), 'D');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_contacts_search_vector ON public.company_contacts;
CREATE TRIGGER trg_company_contacts_search_vector
  BEFORE INSERT OR UPDATE OF name, title, function_role, email, phone, mobile, city, state
  ON public.company_contacts
  FOR EACH ROW EXECUTE FUNCTION public.company_contacts_search_vector_update();

UPDATE public.companies SET name = name WHERE search_vector IS NULL;
UPDATE public.company_contacts SET name = name WHERE search_vector IS NULL;

COMMENT ON COLUMN public.companies.search_vector IS
  'Weighted FTS on company name (A) and reporting_marks (B). Used by directory search.';
COMMENT ON COLUMN public.company_contacts.search_vector IS
  'Weighted FTS on contact name (A), title/function (B), email/phones (C), city/state (D).';

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
        OR exists (
          SELECT 1 FROM public.company_contacts cc
          WHERE cc.company_id = c.id
            AND cc.search_vector @@ p.tsq
        )
        OR exists (
          SELECT 1
          FROM unnest(coalesce(c.reporting_marks, ARRAY[]::text[])) m
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
      c.id AS company_id,
      c.name AS company_name,
      c.relationship_type,
      c.account_id,
      c.reporting_marks,
      c.source,
      c.priority_tier,
      c.status,
      cc.id AS contact_id,
      cc.name AS contact_name,
      cc.title,
      cc.email,
      cc.phone,
      cc.mobile,
      cc.city,
      cc.state,
      NULL::bigint AS rider_id
    FROM matched_companies c
    JOIN public.company_contacts cc ON cc.company_id = c.id
    WHERE (p_state IS NULL OR cc.state = p_state)
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
      c.id AS company_id,
      c.name AS company_name,
      c.relationship_type,
      c.account_id,
      c.reporting_marks,
      c.source,
      c.priority_tier,
      c.status,
      NULL::bigint AS contact_id,
      NULL::text AS contact_name,
      NULL::text AS title,
      NULL::text AS email,
      NULL::text AS phone,
      NULL::text AS mobile,
      NULL::text AS city,
      NULL::text AS state,
      NULL::bigint AS rider_id
    FROM matched_companies c
    WHERE p_state IS NULL
      AND NOT exists (SELECT 1 FROM public.company_contacts cc WHERE cc.company_id = c.id)
  ),
  ol_rows AS (
    SELECT
      'lease_ol'::text AS badge,
      'lease_ol'::text AS result_kind,
      NULL::bigint AS company_id,
      NULL::text AS company_name,
      NULL::text AS relationship_type,
      NULL::bigint AS account_id,
      NULL::text[] AS reporting_marks,
      NULL::text AS source,
      NULL::text AS priority_tier,
      NULL::text AS status,
      rc.id AS contact_id,
      rc.name AS contact_name,
      rc.title,
      rc.email,
      rc.phone,
      NULL::text AS mobile,
      NULL::text AS city,
      NULL::text AS state,
      rc.rider_id
    FROM public.rider_contacts rc
    CROSS JOIN params p
    WHERE p_relationship_type IS NULL
      AND p_priority_tier IS NULL
      AND p_status IS NULL
      AND p_source IS NULL
      AND p_state IS NULL
      AND (
        p.q IS NULL
        OR rc.name ILIKE '%' || p.q || '%'
        OR coalesce(rc.title, '') ILIKE '%' || p.q || '%'
        OR coalesce(rc.email, '') ILIKE '%' || p.q || '%'
        OR coalesce(rc.phone, '') ILIKE '%' || p.q || '%'
        OR coalesce(rc.notes, '') ILIKE '%' || p.q || '%'
      )
  ),
  all_rows AS (
    SELECT * FROM crm_rows
    UNION ALL
    SELECT * FROM company_only
    UNION ALL
    SELECT * FROM ol_rows
  ),
  counted AS (
    SELECT *, count(*) OVER() AS total_count FROM all_rows
  )
  SELECT
    counted.total_count,
    counted.badge,
    counted.result_kind,
    counted.company_id,
    counted.company_name,
    counted.relationship_type,
    counted.account_id,
    counted.reporting_marks,
    counted.source,
    counted.priority_tier,
    counted.status,
    counted.contact_id,
    counted.contact_name,
    counted.title,
    counted.email,
    counted.phone,
    counted.mobile,
    counted.city,
    counted.state,
    counted.rider_id
  FROM counted
  ORDER BY counted.company_name NULLS LAST, counted.contact_name NULLS LAST, counted.contact_id NULLS LAST
  LIMIT greatest(coalesce(p_page_size, 50), 1)
  OFFSET greatest(coalesce(p_page, 1) - 1, 0) * greatest(coalesce(p_page_size, 50), 1);
$$;

GRANT EXECUTE ON FUNCTION public.directory_search(text, boolean, text, text, text, text, text, integer, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.directory_facets()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'relationship_type', (
      SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb)
      FROM (SELECT DISTINCT relationship_type AS v FROM public.companies WHERE merged_into_id IS NULL AND relationship_type IS NOT NULL) s
    ),
    'priority_tier', (
      SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb)
      FROM (SELECT DISTINCT priority_tier AS v FROM public.companies WHERE merged_into_id IS NULL AND priority_tier IS NOT NULL) s
    ),
    'status', (
      SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb)
      FROM (SELECT DISTINCT status AS v FROM public.companies WHERE merged_into_id IS NULL AND status IS NOT NULL) s
    ),
    'source', (
      SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb)
      FROM (SELECT DISTINCT source AS v FROM public.companies WHERE merged_into_id IS NULL AND source IS NOT NULL) s
    ),
    'state', (
      SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb)
      FROM (
        SELECT DISTINCT state AS v
        FROM public.company_contacts
        WHERE state IS NOT NULL AND btrim(state) <> ''
      ) s
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.directory_facets() TO anon, authenticated, service_role;
