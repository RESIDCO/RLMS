-- Restore Complete checkbox + outcome_reached_at as Program done (PR #15 regression).
-- Trail On rent/Scrapped/Sold/Stored and inactive still count. Status text does not.

CREATE OR REPLACE FUNCTION public.rlms_program_car_is_program_done(p_program_car_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT
      rc.active IS NOT TRUE
      OR pc.outcome_reached_at IS NOT NULL
      OR COALESCE(pc.custom_fields->>'__complete', '') IN ('true', 't', '1')
      OR EXISTS (
        SELECT 1
        FROM public.program_car_milestones m
        WHERE m.program_car_id = pc.id
          AND lower(btrim(m.milestone)) IN ('on rent', 'scrapped', 'sold', 'stored')
      )
      OR lower(btrim(COALESCE(pc.milestone, ''))) IN ('on rent', 'scrapped', 'sold', 'stored')
    FROM public.program_cars pc
    JOIN public.railcars rc ON rc.id = pc.railcar_id
    WHERE pc.id = p_program_car_id
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.rlms_program_car_is_program_done(bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.rlms_program_car_is_program_done(bigint) IS
  'Program done: inactive, Complete checkbox (__complete) / outcome_reached_at, or trail/latest milestone On rent/Scrapped/Sold/Stored.';

DROP TRIGGER IF EXISTS program_cars_recompute_percent_complete ON public.program_cars;
CREATE TRIGGER program_cars_recompute_percent_complete
  AFTER INSERT OR UPDATE OF milestone, exited_date, outcome_reached_at, custom_fields OR DELETE
  ON public.program_cars
  FOR EACH ROW
  EXECUTE FUNCTION public.programs_recompute_percent_complete();

SELECT public.programs_set_percent_complete(id) FROM public.programs;
