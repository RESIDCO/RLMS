-- Stored fleet_status (Leased / Idle / Sold) + source flag so imports cannot
-- silently overwrite a human pick. Safe to re-run.

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS fleet_status text;

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS fleet_status_source text;

UPDATE public.railcars
SET fleet_status = 'Leased'
WHERE fleet_status IS NULL;

UPDATE public.railcars
SET fleet_status_source = 'auto'
WHERE fleet_status_source IS NULL;

ALTER TABLE public.railcars
  ALTER COLUMN fleet_status SET DEFAULT 'Leased';

ALTER TABLE public.railcars
  ALTER COLUMN fleet_status SET NOT NULL;

ALTER TABLE public.railcars
  ALTER COLUMN fleet_status_source SET DEFAULT 'auto';

ALTER TABLE public.railcars
  ALTER COLUMN fleet_status_source SET NOT NULL;

ALTER TABLE public.railcars
  DROP CONSTRAINT IF EXISTS railcars_fleet_status_check;

ALTER TABLE public.railcars
  ADD CONSTRAINT railcars_fleet_status_check
  CHECK (fleet_status IN ('Leased', 'Idle', 'Sold'));

ALTER TABLE public.railcars
  DROP CONSTRAINT IF EXISTS railcars_fleet_status_source_check;

ALTER TABLE public.railcars
  ADD CONSTRAINT railcars_fleet_status_source_check
  CHECK (fleet_status_source IN ('auto', 'manual'));

-- One-time backfill from the same rules as shared/fleet-status.ts
-- (assignment_label ILIKE '%sold%' primary, rider_external_id = SOLD secondary,
--  managed_category = Idle). Overwrites auto rows only — never a manual pick
--  if this script is re-run after humans have edited.
UPDATE public.railcars
SET
  fleet_status = CASE
    WHEN active IS TRUE AND (
      coalesce(assignment_label, '') ILIKE '%sold%'
      OR upper(btrim(coalesce(rider_external_id, ''))) = 'SOLD'
    ) THEN 'Sold'
    WHEN active IS TRUE AND btrim(coalesce(managed_category, '')) = 'Idle' THEN 'Idle'
    ELSE 'Leased'
  END,
  fleet_status_source = 'auto'
WHERE fleet_status_source = 'auto';

CREATE INDEX IF NOT EXISTS idx_railcars_fleet_status
  ON public.railcars (fleet_status)
  WHERE active IS TRUE;

-- KPIs now read the stored column (not live text-matching).
CREATE OR REPLACE FUNCTION public.rlms_fleet_kpis()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH c AS (
  SELECT
    id,
    entity,
    active,
    status,
    car_number,
    reporting_marks,
    car_type,
    lessee_name,
    rider_external_id,
    assignment_label,
    managed_category,
    CASE
      WHEN fleet_status IN ('Sold', 'Idle', 'Leased') THEN fleet_status
      ELSE 'Leased'
    END AS fleet_status,
    CASE
      WHEN lease_end_date IS NULL OR btrim(lease_end_date::text) = '' THEN NULL
      WHEN substring(btrim(lease_end_date::text) from 1 for 4) >= '3000' THEN NULL
      ELSE substring(btrim(lease_end_date::text) from 1 for 10)
    END AS end1,
    CASE
      WHEN lease_expiry IS NULL OR btrim(lease_expiry::text) = '' THEN NULL
      WHEN substring(btrim(lease_expiry::text) from 1 for 4) >= '3000' THEN NULL
      ELSE substring(btrim(lease_expiry::text) from 1 for 10)
    END AS end2
  FROM railcars
),
c2 AS (
  SELECT
    *,
    COALESCE(end1, end2) AS lease_end,
    nullif(btrim(lessee_name), '') AS lessee_clean,
    CASE
      WHEN nullif(btrim(rider_external_id), '') IS NULL THEN NULL
      WHEN upper(btrim(rider_external_id)) = 'SOLD' THEN NULL
      ELSE btrim(rider_external_id)
    END AS ol_code
  FROM c
),
op AS (
  SELECT * FROM c2 WHERE active IS TRUE AND fleet_status IS DISTINCT FROM 'Sold'
),
k AS (
  SELECT
    (SELECT count(*) FROM c2) AS scanned,
    (SELECT count(*) FROM c2 WHERE active IS TRUE) AS active_including_sold,
    (SELECT count(*) FROM c2 WHERE active IS TRUE AND fleet_status = 'Sold') AS sold,
    (SELECT count(*) FROM c2 WHERE active IS TRUE AND fleet_status = 'Idle') AS idle,
    (SELECT count(*) FROM c2 WHERE active IS TRUE AND fleet_status = 'Leased') AS leased,
    (SELECT count(*) FROM op) AS operating,
    (SELECT count(*) FROM op WHERE fleet_status = 'Leased') AS leased_operating,
    (SELECT count(*) FROM op o WHERE NOT EXISTS (
      SELECT 1 FROM railcar_assignments a WHERE a.railcar_id = o.id
    )) AS unassigned,
    (SELECT count(*) FROM op WHERE entity = 'Rail Partners Select') AS rps_total,
    (SELECT count(*) FROM op WHERE entity = 'Rail Partners Select' AND fleet_status = 'Leased') AS rps_assigned,
    (SELECT count(*) FROM op WHERE entity = 'Main') AS owned_total,
    (SELECT count(*) FROM op WHERE entity = 'Main' AND fleet_status = 'Leased') AS owned_assigned,
    (SELECT count(*) FROM op WHERE entity = 'Coal') AS coal_total,
    (SELECT count(*) FROM op WHERE lease_end IS NULL) AS undefined_end,
    (SELECT count(DISTINCT ol_code) FROM op WHERE ol_code IS NOT NULL) AS riders_count,
    (
      SELECT count(*) FROM (
        SELECT DISTINCT ON (e.car_id) e.event_type
        FROM rent_events e
        INNER JOIN op o ON o.id = e.car_id
        ORDER BY e.car_id, e.event_date DESC
      ) t WHERE event_type = 'off_rent'
    ) AS off_rent
),
lessees AS (
  SELECT
    coalesce(lessee_clean, 'Unassigned') AS fleet_name,
    count(*)::int AS count,
    max(lease_end) AS expiration_date,
    (array_agg(ol_code ORDER BY ol_code) FILTER (WHERE ol_code IS NOT NULL))[1] AS rider_name,
    count(DISTINCT ol_code) FILTER (WHERE ol_code IS NOT NULL)::int AS ol_n
  FROM op
  GROUP BY 1
  ORDER BY 2 DESC
),
vcf AS (
  SELECT
    upper(ol_code) AS ol,
    ol_code AS rider_name,
    lease_end AS expiration_date,
    max(lessee_clean) AS lessee_name,
    count(*)::int AS car_count
  FROM op
  WHERE ol_code IS NOT NULL AND lease_end IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT jsonb_build_object(
  'kpis', jsonb_build_object(
    'scanned', k.scanned,
    'active_including_sold', k.active_including_sold,
    'sold', k.sold,
    'idle', k.idle,
    'leased', k.leased,
    'operating', k.operating,
    'leased_operating', k.leased_operating,
    'unassigned', k.unassigned,
    'rps_total', k.rps_total,
    'rps_assigned', k.rps_assigned,
    'owned_total', k.owned_total,
    'owned_assigned', k.owned_assigned,
    'coal_total', k.coal_total,
    'undefined_end', k.undefined_end,
    'riders_count', k.riders_count,
    'off_rent', k.off_rent
  ),
  'cars_by_fleet', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'fleet_name', fleet_name,
      'count', count,
      'expiration_date', expiration_date,
      'rider_name', rider_name,
      'schedule_number', CASE WHEN ol_n > 1 THEN ol_n::text || ' OLs' ELSE rider_name END,
      'cars', '[]'::jsonb
    ) ORDER BY count DESC), '[]'::jsonb)
    FROM lessees
  ),
  'expiration_timeline_vcf', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'rider_id', ol || '|' || expiration_date || '|vcf',
      'rider_name', rider_name,
      'schedule_number', rider_name,
      'expiration_date', expiration_date,
      'lease_number', lessee_name,
      'car_count', car_count,
      'source', 'vcf'
    ) ORDER BY expiration_date, rider_name), '[]'::jsonb)
    FROM vcf
  ),
  'ol_counts', (
    SELECT coalesce(jsonb_object_agg(upper(ol_code), cnt), '{}'::jsonb)
    FROM (SELECT ol_code, count(*)::int AS cnt FROM op WHERE ol_code IS NOT NULL GROUP BY ol_code) s
  ),
  'ol_lessees', (
    SELECT coalesce(jsonb_object_agg(upper(ol_code), lessee), '{}'::jsonb)
    FROM (
      SELECT ol_code, max(lessee_clean) AS lessee
      FROM op WHERE ol_code IS NOT NULL GROUP BY ol_code
    ) s
  )
)
FROM k;
$$;

GRANT EXECUTE ON FUNCTION public.rlms_fleet_kpis() TO anon, authenticated, service_role;

-- Verify backfill against the already-confirmed KPI numbers before moving on:
--   Sold 848, Idle 209, Leased 14,568 among active = true.
-- SELECT fleet_status, count(*) FROM public.railcars WHERE active IS TRUE GROUP BY 1 ORDER BY 1;
