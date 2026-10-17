-- Programs v2: lifecycle/type columns + progress/backfill views.
-- DDL and views only. Re-runnable. Does not UPDATE program or car rows.
-- Legacy status, category_id, closed_date, target_completion_date stay in place.
-- Lifecycle overlay: closed when closed_date IS NOT NULL, else stored lifecycle (default active).
-- #4 OL2519 stays status='complete' with closed_date null → lifecycle active.

ALTER TABLE public.programs
  ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active';
ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_lifecycle_check;
ALTER TABLE public.programs
  ADD CONSTRAINT programs_lifecycle_check
  CHECK (lifecycle = ANY (ARRAY['draft'::text, 'active'::text, 'closed'::text, 'cancelled'::text]));

ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.programs DROP CONSTRAINT IF EXISTS programs_type_check;
ALTER TABLE public.programs
  ADD CONSTRAINT programs_type_check
  CHECK (
    type IS NULL
    OR type = ANY (ARRAY[
      'Acquisition'::text,
      'Return'::text,
      'Sale'::text,
      'New Assignment'::text,
      'Scrap'::text,
      'Repair'::text,
      'Inspection'::text,
      'Quals'::text,
      'Lining/Cleaning'::text,
      'Other'::text
    ])
  );

ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS type_other text;
ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS pending_note text;
ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.programs ADD COLUMN IF NOT EXISTS cancelled_by uuid;

ALTER TABLE public.program_cars ADD COLUMN IF NOT EXISTS milestone text;
ALTER TABLE public.program_cars ADD COLUMN IF NOT EXISTS milestone_at date;
ALTER TABLE public.program_cars ADD COLUMN IF NOT EXISTS outcome_reached_at date;
ALTER TABLE public.program_cars ADD COLUMN IF NOT EXISTS exit_reason text;
ALTER TABLE public.program_cars ADD COLUMN IF NOT EXISTS exited_by uuid;

CREATE INDEX IF NOT EXISTS idx_programs_lifecycle ON public.programs (lifecycle);
CREATE INDEX IF NOT EXISTS idx_programs_type ON public.programs (type);
CREATE INDEX IF NOT EXISTS idx_program_cars_outcome ON public.program_cars (program_id) WHERE outcome_reached_at IS NOT NULL;

CREATE OR REPLACE VIEW public.v_program_type_map AS
SELECT
  p.id AS program_id,
  p.type AS stored_type,
  p.type_other,
  c.name AS category_name,
  CASE
    WHEN nullif(btrim(p.type), '') IS NOT NULL THEN btrim(p.type)
    WHEN c.name ILIKE 'Acquisition%' THEN 'Acquisition'
    WHEN c.name ILIKE 'EOLR%' THEN 'Return'
    WHEN c.name ILIKE 'NLD%' THEN 'New Assignment'
    WHEN c.name ILIKE 'Sale%' THEN 'Sale'
    WHEN c.name ILIKE 'Scrap%' THEN 'Scrap'
    WHEN c.name ILIKE 'Remark%' THEN 'Repair'
    WHEN c.name ILIKE 'Qualif%' THEN 'Quals'
    WHEN c.name ILIKE 'Inspection%' THEN 'Inspection'
    WHEN c.name ILIKE 'Other%' THEN 'Other'
    ELSE NULL
  END AS display_type
FROM public.programs p
LEFT JOIN public.program_categories c ON c.id = p.category_id;

CREATE OR REPLACE VIEW public.v_program_lifecycle AS
SELECT
  p.id AS program_id,
  p.status,
  p.closed_date,
  p.lifecycle AS stored_lifecycle,
  CASE
    WHEN p.closed_date IS NOT NULL THEN 'closed'
    WHEN p.lifecycle IN ('draft', 'cancelled') THEN p.lifecycle
    ELSE 'active'
  END AS lifecycle
FROM public.programs p;

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
      AND (
        rc.active IS NOT TRUE
        OR pc.outcome_reached_at IS NOT NULL
        OR COALESCE(pc.custom_fields->>'__complete', '') IN ('true', 't', '1')
      )
  )::int AS done,
  COUNT(pc.id) FILTER (
    WHERE pc.exited_date IS NULL
      AND rc.active IS TRUE
      AND pc.outcome_reached_at IS NULL
      AND COALESCE(pc.custom_fields->>'__complete', '') NOT IN ('true', 't', '1')
  )::int AS remaining,
  (
    lc.lifecycle = 'active'
    AND COUNT(pc.id) FILTER (
      WHERE pc.exited_date IS NULL
        AND rc.active IS TRUE
        AND pc.outcome_reached_at IS NULL
        AND COALESCE(pc.custom_fields->>'__complete', '') NOT IN ('true', 't', '1')
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
LEFT JOIN public.railcars rc ON rc.id = pc.railcar_id
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
  AND lc.lifecycle = 'active';

CREATE OR REPLACE VIEW public.v_program_commitment_backfill AS
WITH open_links AS (
  SELECT * FROM public.v_program_open_links
),
multi AS (
  SELECT ol.railcar_id, count(*)::int AS open_program_count
  FROM open_links ol
  JOIN public.railcars rc ON rc.id = ol.railcar_id AND rc.active IS TRUE
  GROUP BY ol.railcar_id
  HAVING count(*) > 1
),
earliest AS (
  SELECT DISTINCT ON (ol.railcar_id)
    ol.railcar_id,
    ol.program_id AS earliest_program_id,
    ol.program_name AS earliest_program_name,
    ol.joined_date AS earliest_joined_date,
    ol.target_completion_date
  FROM open_links ol
  ORDER BY ol.railcar_id, ol.joined_date ASC NULLS LAST, ol.link_id ASC
)
SELECT
  rc.id AS railcar_id,
  rc.reporting_marks,
  rc.car_number,
  rc.entity,
  rc.active,
  e.earliest_program_id AS program_id,
  e.earliest_program_name AS program_name,
  e.earliest_joined_date,
  e.target_completion_date,
  COALESCE(m.open_program_count, 1) AS open_program_count,
  (COALESCE(m.open_program_count, 1) > 1) AS in_multiple_programs,
  k.is_op,
  k.off_rent,
  k.on_rent,
  (cc.id IS NOT NULL) AS has_open_commitment,
  cc.program_id AS commitment_program_id,
  (
    rc.active IS TRUE
    AND k.is_op IS TRUE
    AND k.off_rent IS TRUE
    AND cc.id IS NULL
  ) AS needs_commitment
FROM public.railcars rc
JOIN earliest e ON e.railcar_id = rc.id
JOIN public.v_rlms_car_kpi k ON k.railcar_id = rc.id
LEFT JOIN public.car_commitments cc
  ON cc.railcar_id = rc.id AND cc.cleared_at IS NULL
LEFT JOIN multi m ON m.railcar_id = rc.id
WHERE rc.active IS TRUE
  AND (
    (k.is_op IS TRUE AND k.off_rent IS TRUE AND cc.id IS NULL)
    OR m.railcar_id IS NOT NULL
  );

REVOKE ALL ON public.v_program_type_map FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_program_lifecycle FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_program_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_program_open_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_program_commitment_backfill FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_program_type_map TO authenticated, service_role;
GRANT SELECT ON public.v_program_lifecycle TO authenticated, service_role;
GRANT SELECT ON public.v_program_progress TO authenticated, service_role;
GRANT SELECT ON public.v_program_open_links TO authenticated, service_role;
GRANT SELECT ON public.v_program_commitment_backfill TO authenticated, service_role;
