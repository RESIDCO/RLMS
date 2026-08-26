-- Dashboard remaining tiles: lease expiration, fleet age, financial/rent rollups,
-- and in-program count — all in SQL so /api/dashboard does not fetchAllRows those tables.
-- Reap abandoned API transactions instead of leaving "idle in transaction (aborted)" sessions.

ALTER ROLE authenticator SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE service_role SET idle_in_transaction_session_timeout = '60s';

CREATE OR REPLACE FUNCTION public.rlms_fleet_kpis()
RETURNS jsonb
LANGUAGE sql
STABLE
SET statement_timeout = '20s'
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
    build_year,
    CASE
      WHEN fleet_status IN ('Sold', 'Idle', 'Leased', 'Abatement') THEN fleet_status
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
latest_rent AS (
  SELECT DISTINCT ON (e.car_id) e.car_id, e.event_type
  FROM rent_events e
  ORDER BY e.car_id, e.event_date DESC
),
k AS (
  SELECT
    (SELECT count(*) FROM c2) AS scanned,
    (SELECT count(*) FROM c2 WHERE active IS TRUE) AS active_including_sold,
    (SELECT count(*) FROM c2 WHERE active IS TRUE AND fleet_status = 'Sold') AS sold,
    (SELECT count(*) FROM c2 WHERE active IS TRUE AND fleet_status = 'Idle') AS idle,
    (SELECT count(*) FROM c2 WHERE active IS TRUE AND fleet_status IN ('Leased', 'Abatement')) AS leased,
    (SELECT count(*) FROM c2 WHERE active IS TRUE AND fleet_status = 'Abatement') AS abatement,
    (SELECT count(*) FROM op) AS operating,
    (SELECT count(*) FROM op WHERE fleet_status IN ('Leased', 'Abatement')) AS leased_operating,
    (SELECT count(*) FROM op WHERE fleet_status = 'Leased') AS leased_only,
    (SELECT count(*) FROM op o WHERE NOT EXISTS (
      SELECT 1 FROM railcar_assignments a WHERE a.railcar_id = o.id
    )) AS unassigned,
    (SELECT count(*) FROM op WHERE entity = 'Rail Partners Select') AS rps_total,
    (SELECT count(*) FROM op WHERE entity = 'Rail Partners Select' AND fleet_status IN ('Leased', 'Abatement')) AS rps_assigned,
    (SELECT count(*) FROM op WHERE entity IN ('Main', 'Coal')) AS owned_total,
    (SELECT count(*) FROM op WHERE entity IN ('Main', 'Coal') AND fleet_status IN ('Leased', 'Abatement')) AS owned_assigned,
    (SELECT count(*) FROM op WHERE entity = 'Coal') AS coal_total,
    (SELECT count(*) FROM op WHERE lease_end IS NULL) AS undefined_end,
    (
      SELECT count(*) FROM (
        SELECT a.rider_id
        FROM railcar_assignments a
        INNER JOIN railcars rc ON rc.id = a.railcar_id AND rc.active IS TRUE
        WHERE a.rider_id IS NOT NULL
        GROUP BY a.rider_id
      ) t
    ) AS riders_count,
    (
      SELECT count(*) FROM c2 c
      WHERE c.active IS TRUE
        AND (
          c.fleet_status IN ('Idle', 'Abatement')
          OR EXISTS (
            SELECT 1 FROM latest_rent lr
            WHERE lr.car_id = c.id AND lr.event_type = 'off_rent'
          )
        )
    ) AS off_rent,
    (
      SELECT count(DISTINCT pc.railcar_id)::int
      FROM program_cars pc
      INNER JOIN programs p ON p.id = pc.program_id
      WHERE p.status IS DISTINCT FROM 'complete'
    ) AS in_program_count
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
),
ol_counts AS (
  SELECT ol_code, count(*)::int AS cnt
  FROM op
  WHERE ol_code IS NOT NULL
  GROUP BY ol_code
),
age AS (
  SELECT
    extract(year from current_date)::int AS y0,
    count(*) FILTER (WHERE active IS TRUE)::int AS operating_count,
    count(*) FILTER (WHERE active IS TRUE AND build_year BETWEEN 1800 AND 2100)::int AS known_count,
    count(*) FILTER (
      WHERE active IS TRUE AND (build_year IS NULL OR build_year NOT BETWEEN 1800 AND 2100)
    )::int AS unknown_count,
    count(*) FILTER (
      WHERE active IS TRUE AND build_year BETWEEN 1800 AND 2100
        AND (build_year + 50) = extract(year from current_date)::int
    )::int AS c0,
    count(*) FILTER (
      WHERE active IS TRUE AND build_year BETWEEN 1800 AND 2100
        AND (build_year + 50) = extract(year from current_date)::int + 1
    )::int AS c1,
    count(*) FILTER (
      WHERE active IS TRUE AND build_year BETWEEN 1800 AND 2100
        AND (build_year + 50) = extract(year from current_date)::int + 2
    )::int AS c2,
    count(*) FILTER (
      WHERE active IS TRUE AND build_year BETWEEN 1800 AND 2100
        AND (build_year + 50) = extract(year from current_date)::int + 3
    )::int AS c3
  FROM c
),
active_by_rider AS (
  SELECT a.rider_id, count(*)::int AS car_count
  FROM railcar_assignments a
  INNER JOIN railcars rc ON rc.id = a.railcar_id AND rc.active IS TRUE
  WHERE a.rider_id IS NOT NULL
  GROUP BY a.rider_id
),
rider_tl AS (
  SELECT
    r.id,
    r.rider_name,
    r.schedule_number,
    substring(btrim(r.expiration_date::text) from 1 for 10) AS expiration_date,
    ml.lease_number,
    ab.car_count
  FROM riders r
  INNER JOIN active_by_rider ab ON ab.rider_id = r.id
  LEFT JOIN master_leases ml ON ml.id = r.master_lease_id
  WHERE r.expiration_date IS NOT NULL
    AND btrim(r.expiration_date::text) <> ''
    AND substring(btrim(r.expiration_date::text) from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
),
latest_fin AS (
  SELECT max(substring(btrim(snapshot_month::text) from 1 for 10)) AS snap
  FROM rider_financial_summary
  WHERE snapshot_month IS NOT NULL
),
fin_ol AS (
  SELECT
    upper(btrim(f.rider_id::text)) AS ol,
    min(
      (
        (substring(btrim(f.snapshot_month::text) from 1 for 10))::date
        + make_interval(months => round(f.months_until_lease_exp::numeric)::int)
        - interval '1 day'
      )::date
    )::text AS expiration_date,
    max(nullif(btrim(f.lessee), '')) AS lessee,
    min(round(f.months_until_lease_exp::numeric)::int) AS months_until
  FROM rider_financial_summary f
  CROSS JOIN latest_fin
  WHERE latest_fin.snap IS NOT NULL
    AND substring(btrim(f.snapshot_month::text) from 1 for 10) = latest_fin.snap
    AND f.months_until_lease_exp IS NOT NULL
    AND btrim(f.rider_id::text) <> ''
  GROUP BY 1
)
SELECT jsonb_build_object(
  'kpis', jsonb_build_object(
    'scanned', k.scanned,
    'active_including_sold', k.active_including_sold,
    'sold', k.sold,
    'idle', k.idle,
    'leased', k.leased,
    'abatement', k.abatement,
    'operating', k.operating,
    'leased_operating', k.leased_operating,
    'leased_only', k.leased_only,
    'unassigned', k.unassigned,
    'rps_total', k.rps_total,
    'rps_assigned', k.rps_assigned,
    'owned_total', k.owned_total,
    'owned_assigned', k.owned_assigned,
    'coal_total', k.coal_total,
    'undefined_end', k.undefined_end,
    'riders_count', k.riders_count,
    'off_rent', k.off_rent,
    'in_program_count', k.in_program_count
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
    FROM ol_counts
  ),
  'ol_lessees', (
    SELECT coalesce(jsonb_object_agg(upper(ol_code), lessee), '{}'::jsonb)
    FROM (
      SELECT ol_code, max(lessee_clean) AS lessee
      FROM op WHERE ol_code IS NOT NULL GROUP BY ol_code
    ) s
  ),
  'fleet_age', (
    SELECT jsonb_build_object(
      'tiles', jsonb_build_array(
        jsonb_build_object('year', a.y0, 'count', a.c0),
        jsonb_build_object('year', a.y0 + 1, 'count', a.c1),
        jsonb_build_object('year', a.y0 + 2, 'count', a.c2),
        jsonb_build_object('year', a.y0 + 3, 'count', a.c3)
      ),
      'unknown_count', a.unknown_count,
      'known_count', a.known_count,
      'operating_count', a.operating_count
    )
    FROM age a
  ),
  'rider_expiration_timeline', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'rider_id', id,
      'rider_name', rider_name,
      'schedule_number', schedule_number,
      'expiration_date', expiration_date,
      'lease_number', lease_number,
      'car_count', car_count,
      'source', 'financial',
      'months_until_lease_exp', null
    ) ORDER BY expiration_date, rider_name), '[]'::jsonb)
    FROM rider_tl
  ),
  'deals_expiring', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('year', y, 'count', cnt) ORDER BY y), '[]'::jsonb)
    FROM (
      SELECT
        gs.y,
        count(rt.id)::int AS cnt
      FROM generate_series(
        extract(year from current_date)::int,
        extract(year from current_date)::int + 4
      ) AS gs(y)
      LEFT JOIN rider_tl rt ON substring(rt.expiration_date from 1 for 4)::int = gs.y
      GROUP BY gs.y
    ) d
  ),
  'financial_snapshot_month', (SELECT snap FROM latest_fin),
  'financial_timeline', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'ol', f.ol,
      'expiration_date', f.expiration_date,
      'lessee', f.lessee,
      'months_until', f.months_until,
      'car_count', coalesce(oc.cnt, 0)
    ) ORDER BY f.expiration_date, f.ol), '[]'::jsonb)
    FROM fin_ol f
    LEFT JOIN ol_counts oc ON upper(oc.ol_code) = f.ol
    WHERE f.expiration_date IS NOT NULL
  )
)
FROM k;
$$;

GRANT EXECUTE ON FUNCTION public.rlms_fleet_kpis() TO anon, authenticated, service_role;
