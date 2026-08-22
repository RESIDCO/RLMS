-- Flag railcars where Car Status text disagrees with active / active_status.
-- Steady state should be 0 rows. Query: SELECT * FROM v_railcar_active_status_mismatch;

CREATE OR REPLACE VIEW public.v_railcar_active_status_mismatch AS
SELECT
  r.id,
  r.reporting_marks,
  r.car_number,
  r.status,
  r.active,
  r.active_status,
  r.active_source,
  r.updated_at
FROM public.railcars r
WHERE
  CASE
    WHEN COALESCE(btrim(r.status), '') = 'Active/In-Service' THEN
      r.active IS DISTINCT FROM TRUE
      OR lower(COALESCE(btrim(r.active_status), '')) IS DISTINCT FROM 'active'
    ELSE
      r.active IS DISTINCT FROM FALSE
      OR lower(COALESCE(btrim(r.active_status), '')) IS DISTINCT FROM 'inactive'
  END;

COMMENT ON VIEW public.v_railcar_active_status_mismatch IS
  'Cars whose status text disagrees with active/active_status. Should be empty in steady state.';

GRANT SELECT ON public.v_railcar_active_status_mismatch TO service_role;
GRANT SELECT ON public.v_railcar_active_status_mismatch TO authenticated;
