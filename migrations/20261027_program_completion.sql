-- Program completion levels from the milestone trail.
-- Program done = On rent / Scrapped / Sold / Stored / inactive.
-- Work done = Work complete (still awaiting destination). Progress/KPI/ready-to-close
-- use Program done only.

CREATE OR REPLACE FUNCTION public.rlms_program_car_is_program_done(p_program_car_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT
      rc.active IS NOT TRUE
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

CREATE OR REPLACE FUNCTION public.rlms_program_car_completion_level(p_program_car_id bigint)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN public.rlms_program_car_is_program_done(p_program_car_id) THEN 'program_done'
    WHEN EXISTS (
      SELECT 1
      FROM public.program_car_milestones m
      WHERE m.program_car_id = p_program_car_id
        AND lower(btrim(m.milestone)) = 'work complete'
    ) OR (
      SELECT lower(btrim(COALESCE(pc.milestone, ''))) = 'work complete'
      FROM public.program_cars pc
      WHERE pc.id = p_program_car_id
    ) THEN 'work_done'
    WHEN EXISTS (
      SELECT 1 FROM public.program_car_milestones m WHERE m.program_car_id = p_program_car_id
    ) OR EXISTS (
      SELECT 1 FROM public.program_cars pc
      WHERE pc.id = p_program_car_id
        AND (
          nullif(btrim(COALESCE(pc.milestone, '')), '') IS NOT NULL
          OR nullif(btrim(COALESCE(pc.status, '')), '') IS NOT NULL
        )
    ) THEN 'in_progress'
    ELSE 'not_started'
  END;
$$;

CREATE OR REPLACE FUNCTION public.rlms_railcar_in_open_program(p_railcar_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.program_cars pc
    JOIN public.programs p ON p.id = pc.program_id
    WHERE pc.railcar_id = p_railcar_id
      AND pc.exited_date IS NULL
      AND p.closed_date IS NULL
      AND lower(COALESCE(p.status, '')) NOT IN ('closed', 'complete', 'completed')
      AND NOT public.rlms_program_car_is_program_done(pc.id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.rlms_program_car_is_program_done(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rlms_program_car_completion_level(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rlms_railcar_in_open_program(bigint) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_program_car_completion AS
SELECT
  pc.id AS program_car_id,
  pc.program_id,
  pc.railcar_id,
  public.rlms_program_car_completion_level(pc.id) AS completion_level,
  (
    SELECT m.milestone_date
    FROM public.program_car_milestones m
    WHERE m.program_car_id = pc.id AND lower(btrim(m.milestone)) = 'work complete'
    ORDER BY m.milestone_date DESC, m.id DESC
    LIMIT 1
  ) AS work_complete_at,
  (
    SELECT m.milestone_date
    FROM public.program_car_milestones m
    WHERE m.program_car_id = pc.id AND (
      lower(m.milestone) LIKE '%arrived%'
      OR lower(btrim(m.milestone)) IN ('deliver', 'delivered')
    )
    ORDER BY m.milestone_date DESC, m.id DESC
    LIMIT 1
  ) AS arrived_at,
  (
    SELECT m.milestone_date
    FROM public.program_car_milestones m
    WHERE m.program_car_id = pc.id
      AND lower(btrim(m.milestone)) IN ('on rent', 'scrapped', 'sold', 'stored')
    ORDER BY m.milestone_date DESC, m.id DESC
    LIMIT 1
  ) AS program_done_at,
  (
    SELECT m.milestone
    FROM public.program_car_milestones m
    WHERE m.program_car_id = pc.id
      AND lower(btrim(m.milestone)) IN ('on rent', 'scrapped', 'sold', 'stored')
    ORDER BY m.milestone_date DESC, m.id DESC
    LIMIT 1
  ) AS program_done_step
FROM public.program_cars pc;

REVOKE ALL ON public.v_program_car_completion FROM PUBLIC, anon;
GRANT SELECT ON public.v_program_car_completion TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_program_progress AS
SELECT
  p.id AS program_id,
  p.name,
  p.status,
  p.entity,
  p.account_manager,
  p.target_completion_date,
  p.pending_note,
  p.closed_date,
  lc.lifecycle,
  tm.display_type,
  tm.category_name,
  COUNT(pc.id) FILTER (WHERE pc.exited_date IS NULL)::int AS total_open_links,
  COUNT(pc.id) FILTER (
    WHERE pc.exited_date IS NULL
      AND public.rlms_program_car_is_program_done(pc.id)
  )::int AS done,
  COUNT(pc.id) FILTER (
    WHERE pc.exited_date IS NULL
      AND NOT public.rlms_program_car_is_program_done(pc.id)
  )::int AS remaining,
  (
    lc.lifecycle = 'active'
    AND COUNT(pc.id) FILTER (
      WHERE pc.exited_date IS NULL
        AND NOT public.rlms_program_car_is_program_done(pc.id)
    ) = 0
    AND COUNT(pc.id) FILTER (WHERE pc.exited_date IS NULL) > 0
  ) AS ready_to_close,
  (
    lc.lifecycle = 'active'
    AND (p.target_completion_date IS NULL OR p.target_completion_date < CURRENT_DATE)
  ) AS stale,
  GREATEST(
    p.updated_at,
    (
      SELECT max(a.created_at)
      FROM public.program_activity a
      WHERE a.program_id = p.id
    )
  ) AS last_activity_at
FROM public.programs p
JOIN public.v_program_lifecycle lc ON lc.program_id = p.id
LEFT JOIN public.v_program_type_map tm ON tm.program_id = p.id
LEFT JOIN public.program_cars pc ON pc.program_id = p.id
GROUP BY
  p.id, p.name, p.status, p.entity, p.account_manager, p.target_completion_date,
  p.pending_note, p.closed_date, p.updated_at, lc.lifecycle, tm.display_type, tm.category_name;

CREATE OR REPLACE VIEW public.v_program_open_links AS
SELECT
  pc.id AS link_id,
  pc.program_id,
  pc.railcar_id,
  pc.joined_date,
  pc.exited_date,
  p.name AS program_name,
  p.target_completion_date,
  lc.lifecycle
FROM public.program_cars pc
JOIN public.programs p ON p.id = pc.program_id
JOIN public.v_program_lifecycle lc ON lc.program_id = p.id
WHERE pc.exited_date IS NULL
  AND lc.lifecycle = 'active'
  AND NOT public.rlms_program_car_is_program_done(pc.id);

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
        AND public.rlms_program_car_is_program_done(id)
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

DROP TRIGGER IF EXISTS program_cars_recompute_percent_complete ON public.program_cars;
CREATE TRIGGER program_cars_recompute_percent_complete
  AFTER INSERT OR UPDATE OF milestone, exited_date OR DELETE
  ON public.program_cars
  FOR EACH ROW
  EXECUTE FUNCTION public.programs_recompute_percent_complete();

CREATE OR REPLACE FUNCTION public.program_car_milestones_recompute_percent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pid bigint;
BEGIN
  SELECT program_id INTO pid
  FROM public.program_cars
  WHERE id = COALESCE(NEW.program_car_id, OLD.program_car_id);
  IF pid IS NOT NULL THEN
    PERFORM public.programs_set_percent_complete(pid);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS program_car_milestones_recompute_percent ON public.program_car_milestones;
CREATE TRIGGER program_car_milestones_recompute_percent
  AFTER INSERT OR UPDATE OF milestone OR DELETE
  ON public.program_car_milestones
  FOR EACH ROW
  EXECUTE FUNCTION public.program_car_milestones_recompute_percent();

COMMENT ON COLUMN public.programs.percent_complete IS
  'Share of non-exited program cars at Program done (On rent / Scrapped / Sold / Stored / inactive).';

SELECT public.programs_set_percent_complete(id) FROM public.programs;

-- Point KPI in_open_program at Program done (keep column list identical).
DO $$
DECLARE
  def text;
BEGIN
  def := pg_get_viewdef('public.v_rlms_car_kpi'::regclass, true);
  IF def NOT LIKE '%rlms_program_car_is_program_done%' THEN
    def := replace(
      def,
      ')))) AS in_open_program',
      ')) AND NOT public.rlms_program_car_is_program_done(pc.id))) AS in_open_program'
    );
    EXECUTE 'CREATE OR REPLACE VIEW public.v_rlms_car_kpi AS ' || def;
  END IF;
END $$;
