-- Derive programs.percent_complete from active (non-exited) program_cars.
-- Complete is stored as custom_fields.__complete (boolean JSON).

CREATE OR REPLACE FUNCTION public.programs_set_percent_complete(target_program_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  total int;
  complete int;
BEGIN
  SELECT
    count(*) FILTER (WHERE exited_date IS NULL),
    count(*) FILTER (
      WHERE exited_date IS NULL
        AND COALESCE(custom_fields->>'__complete', '') IN ('true', 't', '1')
    )
  INTO total, complete
  FROM public.program_cars
  WHERE program_id = target_program_id;

  UPDATE public.programs
  SET percent_complete = CASE
    WHEN total = 0 THEN NULL
    ELSE round(100.0 * complete / total)
  END
  WHERE id = target_program_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.programs_recompute_percent_complete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.programs_set_percent_complete(COALESCE(NEW.program_id, OLD.program_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS program_cars_recompute_percent_complete ON public.program_cars;
CREATE TRIGGER program_cars_recompute_percent_complete
  AFTER INSERT OR UPDATE OF custom_fields, exited_date OR DELETE
  ON public.program_cars
  FOR EACH ROW
  EXECUTE FUNCTION public.programs_recompute_percent_complete();

COMMENT ON COLUMN public.programs.percent_complete IS
  'Share of active (non-exited) program cars marked complete. Maintained by trigger; null when there are no active cars.';

SELECT public.programs_set_percent_complete(id) FROM public.programs;
