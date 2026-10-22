-- K3: distinct cars behind the Fleet data issues page.
-- Badge N is count(distinct railcar_id) across every issue, not the sum of the cards.
-- Shop conflict is not an issue. Stale programs are not cars; only stale commitment cars are.
-- Predicates match shared/fleet-data-issues.ts and the existing KPI card counts.
-- New views are security invoker and granted to service_role only.

CREATE OR REPLACE VIEW public.v_rlms_fleet_data_issue_cars
WITH (security_invoker = true) AS
SELECT v.railcar_id, 'no_lease_link'::text AS issue
FROM public.v_rlms_car_kpi v
WHERE v.is_op IS TRUE
  AND v.no_assignment IS TRUE
UNION ALL
SELECT v.railcar_id, 'sold_needs_tag'::text
FROM public.v_rlms_car_kpi v
WHERE v.active IS TRUE
  AND v.sold_needs_tag IS TRUE
UNION ALL
SELECT v.railcar_id, 'sale_unclear'::text
FROM public.v_rlms_car_kpi v
WHERE v.active IS TRUE
  AND v.sale_unclear IS TRUE
UNION ALL
SELECT v.railcar_id, 'sold_tag_suspect'::text
FROM public.v_rlms_car_kpi v
WHERE v.active IS TRUE
  AND v.sold_tag_suspect IS TRUE
UNION ALL
SELECT v.railcar_id, 'sold_missing_buyer'::text
FROM public.v_rlms_car_kpi v
WHERE v.active IS TRUE
  AND v.sold_missing_buyer IS TRUE
UNION ALL
SELECT v.railcar_id, 'leased_off_rent'::text
FROM public.v_rlms_car_kpi v
WHERE v.is_op IS TRUE
  AND v.off_rent IS TRUE
  AND v.fleet_status = 'Leased'
UNION ALL
SELECT u.railcar_id, 'unbucketed'::text
FROM public.v_rlms_unbucketed_cars u
UNION ALL
SELECT v.railcar_id, 'awaiting_rent_start'::text
FROM public.v_rlms_car_kpi v
WHERE v.is_op IS TRUE
  AND v.awaiting_rent_start IS TRUE
UNION ALL
SELECT v.railcar_id, 'idle_on_ol'::text
FROM public.v_rlms_car_kpi v
WHERE v.is_op IS TRUE
  AND v.fleet_status = 'Idle'
  AND v.on_ol IS TRUE
UNION ALL
SELECT cc.railcar_id, 'stale_commitment'::text
FROM public.car_commitments cc
WHERE cc.cleared_at IS NULL
  AND (
    cc.target_date IS NULL
    OR cc.target_date < current_date
    OR cc.set_at < now() - interval '90 days'
  )
UNION ALL
SELECT v.railcar_id, 'going_on_lease_overdue'::text
FROM public.v_rlms_car_kpi v
WHERE v.is_op IS TRUE
  AND v.going_on_lease IS TRUE
  AND substring(btrim(coalesce(v.rider_expiration_date::text, v.lease_end_date::text, '')) from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
  AND substring(btrim(coalesce(v.rider_expiration_date::text, v.lease_end_date::text, '')) from 1 for 10)::date < current_date
UNION ALL
SELECT v.railcar_id, 'lease_end_conflict'::text
FROM public.v_rlms_car_kpi v
WHERE v.is_op IS TRUE
  AND substring(btrim(coalesce(v.rider_expiration_date::text, '')) from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
  AND substring(btrim(coalesce(v.lease_end_date::text, '')) from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
  AND substring(btrim(v.rider_expiration_date::text) from 1 for 10)
      IS DISTINCT FROM substring(btrim(v.lease_end_date::text) from 1 for 10);

COMMENT ON VIEW public.v_rlms_fleet_data_issue_cars IS
  'One row per car per fleet data issue. The dashboard badge counts distinct railcar_id.';

REVOKE ALL ON public.v_rlms_fleet_data_issue_cars FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_rlms_fleet_data_issue_cars TO service_role;

CREATE OR REPLACE VIEW public.v_rlms_kpi_gol_overdue
WITH (security_invoker = true) AS
SELECT r.*
FROM public.v_rlms_kpi_car_rows r
WHERE r.railcar_id IN (
  SELECT c.railcar_id
  FROM public.v_rlms_fleet_data_issue_cars c
  WHERE c.issue = 'going_on_lease_overdue'
);

COMMENT ON VIEW public.v_rlms_kpi_gol_overdue IS
  'Going on lease cars whose rider expiration or car lease end is already past.';

REVOKE ALL ON public.v_rlms_kpi_gol_overdue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_rlms_kpi_gol_overdue TO service_role;

CREATE OR REPLACE VIEW public.v_rlms_kpi_lease_end_conflict
WITH (security_invoker = true) AS
SELECT r.*
FROM public.v_rlms_kpi_car_rows r
WHERE r.railcar_id IN (
  SELECT c.railcar_id
  FROM public.v_rlms_fleet_data_issue_cars c
  WHERE c.issue = 'lease_end_conflict'
);

COMMENT ON VIEW public.v_rlms_kpi_lease_end_conflict IS
  'Operating cars whose rider expiration and car lease end are both set and differ.';

REVOKE ALL ON public.v_rlms_kpi_lease_end_conflict FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_rlms_kpi_lease_end_conflict TO service_role;

CREATE OR REPLACE FUNCTION public.rlms_fleet_data_issue_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO public
AS $$
  SELECT jsonb_build_object(
    'cars', (SELECT count(DISTINCT railcar_id)::int FROM public.v_rlms_fleet_data_issue_cars),
    'by_issue', (
      SELECT coalesce(jsonb_object_agg(issue, n), '{}'::jsonb)
      FROM (
        SELECT issue, count(DISTINCT railcar_id)::int AS n
        FROM public.v_rlms_fleet_data_issue_cars
        GROUP BY issue
      ) s
    )
  );
$$;

COMMENT ON FUNCTION public.rlms_fleet_data_issue_counts() IS
  'Distinct cars across fleet data issues, plus a per-issue car count.';

REVOKE ALL ON FUNCTION public.rlms_fleet_data_issue_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_fleet_data_issue_counts() TO service_role;
