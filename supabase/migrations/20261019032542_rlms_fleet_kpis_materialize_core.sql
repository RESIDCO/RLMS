-- rlms_fleet_kpis reads core.j four times. MATERIALIZED runs rlms_fleet_kpis_core() once.
-- Body is 20261017140249_rlms_fleet_kpis_rental_abatement_wrap with that one change.

CREATE OR REPLACE FUNCTION public.rlms_fleet_kpis()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public SET statement_timeout TO '20s'
AS $$
WITH core AS MATERIALIZED (SELECT public.rlms_fleet_kpis_core() AS j),
n AS (
  SELECT count(*)::int AS rental_abatement
  FROM public.v_rlms_kpi_car_rows v
  WHERE v.open_abatement IS TRUE AND v.is_op IS TRUE
)
SELECT jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(core.j, '{kpis,rental_abatement}', to_jsonb(n.rental_abatement), true),
        '{kpis,abatement}', to_jsonb(n.rental_abatement), true
      ),
      '{kpis,leased}', to_jsonb(GREATEST(0, coalesce((core.j->'kpis'->>'leased')::int, 0) - n.rental_abatement)), true
    ),
    '{kpis,leased_operating}', to_jsonb(GREATEST(0, coalesce((core.j->'kpis'->>'leased_operating')::int, 0) - n.rental_abatement)), true
  ),
  '{kpis,leased_only}', to_jsonb(GREATEST(0, coalesce((core.j->'kpis'->>'leased_only')::int, 0) - n.rental_abatement)), true
)
FROM core, n;
$$;

GRANT EXECUTE ON FUNCTION public.rlms_fleet_kpis() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rlms_fleet_kpis_core() TO service_role;
