-- Railcars workbench (R1): scrap/UMLER columns, tags, saved lists.
-- Also appends KPI view columns and treats open Off rent stops like abatement for on_rent.

ALTER TABLE public.railcars ADD COLUMN IF NOT EXISTS scrapped_at date;
ALTER TABLE public.railcars ADD COLUMN IF NOT EXISTS scrap_source text;
ALTER TABLE public.railcars ADD COLUMN IF NOT EXISTS umler_status text;
ALTER TABLE public.railcars ADD COLUMN IF NOT EXISTS umler_status_at date;

ALTER TABLE public.railcars DROP CONSTRAINT IF EXISTS railcars_umler_status_check;
ALTER TABLE public.railcars
  ADD CONSTRAINT railcars_umler_status_check
  CHECK (umler_status IS NULL OR umler_status = ANY (ARRAY['delete_requested'::text, 'deleted'::text]));

CREATE TABLE IF NOT EXISTS public.car_tags (
  id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  railcar_id int NOT NULL REFERENCES public.railcars(id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (railcar_id, tag)
);

CREATE TABLE IF NOT EXISTS public.car_lists (
  id serial PRIMARY KEY,
  name text NOT NULL,
  owner text,
  shared boolean NOT NULL DEFAULT false,
  query jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.car_list_members (
  id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  list_id int NOT NULL REFERENCES public.car_lists(id) ON DELETE CASCADE,
  railcar_id int NOT NULL REFERENCES public.railcars(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, railcar_id)
);

CREATE INDEX IF NOT EXISTS idx_car_tags_tag ON public.car_tags (tag);
CREATE INDEX IF NOT EXISTS idx_car_lists_owner ON public.car_lists (owner);
CREATE INDEX IF NOT EXISTS idx_railcars_scrapped_at ON public.railcars (scrapped_at)
  WHERE scrapped_at IS NOT NULL;

ALTER TABLE public.car_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_list_members ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.car_tags, public.car_lists, public.car_list_members TO authenticated;
GRANT ALL ON public.car_tags, public.car_lists, public.car_list_members TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.car_lists_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.rlms_has_open_off_rent(p_railcar_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.car_rent_stops s
    WHERE s.railcar_id = p_railcar_id
      AND s.type = 'Off rent'
      AND s.actual_resume_date IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.rlms_has_open_off_rent(bigint) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_rlms_kpi_car_rows AS
SELECT
  v.railcar_id,
  v.active,
  btrim(coalesce(v.reporting_marks, '')) || ' ' || btrim(coalesce(v.car_number, '')) AS car,
  v.reporting_marks,
  v.car_number,
  v.entity,
  v.fleet_status AS status_tag,
  public.rlms_derived_fleet_status(
    v.is_sold,
    v.off_rent,
    v.on_ol,
    v.has_open_commitment OR v.in_open_program OR v.going_on_lease OR v.awaiting_rent_start
  ) AS derived_status,
  v.link_rider AS current_lease,
  v.lessee_name AS lessee,
  v.legal_owner,
  coalesce(
    nullif(btrim(v.car_sold_to), ''),
    nullif(btrim(v.rider_sold_to), ''),
    nullif(btrim(v.mla_sold_to), ''),
    nullif(btrim(v.sale_buyer), '')
  ) AS buyer,
  CASE
    WHEN v.has_open_commitment THEN (
      SELECT cc.type || ': ' || cc.name || coalesce(' (' || cc.target_date::text || ')', '')
      FROM public.car_commitments cc
      WHERE cc.railcar_id = v.railcar_id AND cc.cleared_at IS NULL
      ORDER BY cc.id DESC
      LIMIT 1
    )
    WHEN v.awaiting_rent_start THEN v.implicit_commitment
    ELSE NULL
  END AS commitment,
  v.rent_start_date,
  (
    SELECT coalesce(nullif(btrim(ah.rider_external_id), ''), nullif(btrim(r2.rider_name), ''))
    FROM public.assignment_history ah
    LEFT JOIN public.riders r2 ON r2.id = ah.to_rider_id
    WHERE ah.railcar_id = v.railcar_id
      AND (
        upper(btrim(coalesce(ah.rider_external_id, ''))) ~ '^(OL|FL)[0-9]'
        OR upper(btrim(coalesce(r2.rider_name, ''))) ~ '^(OL|FL)[0-9]'
      )
    ORDER BY ah.moved_at DESC NULLS LAST, ah.id DESC
    LIMIT 1
  ) AS last_ol,
  CASE
    WHEN v.is_sold IS NOT TRUE AND v.on_ol AND public.rlms_has_open_abatement(v.railcar_id) THEN 'rental abatement'
    WHEN v.is_sold IS NOT TRUE AND public.rlms_has_open_off_rent(v.railcar_id) THEN 'off rent (rent stop)'
    WHEN v.sold_needs_tag THEN 'Sold – needs tag'
    WHEN v.fleet_status = 'Sold' THEN 'Sold'
    WHEN v.no_assignment THEN 'no link'
    WHEN v.awaiting_rent_start AND v.fleet_status = 'Idle' AND v.on_ol THEN 'Idle-on-OL awaiting rent start'
    WHEN v.future_rent_start THEN 'future rent start'
    WHEN upper(btrim(coalesce(v.link_rider, ''))) ~ '^(EA|EX|XOL)' THEN 'EA/EX/xOL'
    WHEN btrim(coalesce(v.lessee_name, '')) ~ '^[(]?x[A-Z(]'
      OR btrim(coalesce(v.assignment_label, '')) ~ '^[(]?x[A-Z(]' THEN 'x-lessee'
    WHEN v.has_open_commitment THEN 'open Commitment'
    WHEN v.in_open_program THEN 'program'
    WHEN v.going_on_lease THEN 'Going On Lease'
    WHEN v.awaiting_rent_start THEN 'Idle-on-OL awaiting rent start'
    ELSE NULL
  END AS reason,
  v.sale_class,
  v.is_sold,
  v.is_op,
  v.off_rent,
  v.on_ol,
  (v.on_rent
    AND NOT (v.is_sold IS NOT TRUE AND v.on_ol AND public.rlms_has_open_abatement(v.railcar_id))
    AND NOT public.rlms_has_open_off_rent(v.railcar_id)
  ) AS on_rent,
  v.awaiting_rent_start,
  v.shop_conflict,
  v.future_rent_start,
  v.no_assignment,
  v.has_open_commitment,
  v.in_open_program,
  v.going_on_lease,
  v.sold_needs_tag,
  v.sale_unclear,
  v.sold_tag_suspect,
  v.sold_missing_buyer,
  v.lease_status,
  v.master_lease_id,
  v.rider_id,
  (v.active IS TRUE AND v.is_sold IS NOT TRUE AND v.on_ol AND public.rlms_has_open_abatement(v.railcar_id)) AS open_abatement,
  s.type AS rent_stop_type,
  s.stop_date,
  s.expected_resume_date,
  s.reason AS rent_stop_reason,
  rc.scrapped_at,
  rc.umler_status,
  (
    SELECT string_agg(t.tag, ', ' ORDER BY t.tag)
    FROM public.car_tags t
    WHERE t.railcar_id = v.railcar_id
  ) AS tags,
  s.type AS latest_rent_stop_type,
  s.stop_date AS latest_rent_stop_date
FROM public.v_rlms_car_kpi v
LEFT JOIN public.railcars rc ON rc.id = v.railcar_id
LEFT JOIN LATERAL (
  SELECT st.type, st.stop_date, st.expected_resume_date, st.reason
  FROM public.car_rent_stops st
  WHERE st.railcar_id = v.railcar_id
    AND st.actual_resume_date IS NULL
  ORDER BY st.id DESC
  LIMIT 1
) s ON true
WHERE v.active IS TRUE;

GRANT SELECT ON public.v_rlms_kpi_car_rows TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rlms_program_car_is_program_done(p_program_car_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT
      rc.active IS NOT TRUE
      OR rc.scrapped_at IS NOT NULL
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
  'Program done: inactive, scrapped_at, Complete checkbox / outcome_reached_at, or trail/latest milestone On rent/Scrapped/Sold/Stored.';

CREATE OR REPLACE FUNCTION public.rlms_apply_jsonb_patch(p_table text, p_id bigint, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  stmt text;
  col text;
  typ text;
  parts text[] := ARRAY[]::text[];
BEGIN
  IF p_patch IS NULL OR p_patch = '{}'::jsonb THEN
    RETURN;
  END IF;
  IF p_table NOT IN (
    'railcars', 'car_commitments', 'car_rent_stops', 'program_cars',
    'program_car_milestones', 'programs', 'railcar_assignments',
    'assignment_history', 'car_tags', 'car_lists', 'car_list_members'
  ) THEN
    RAISE EXCEPTION 'undo: table % is not patchable', p_table;
  END IF;
  FOR col, typ IN
    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = p_table AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF p_patch ? col THEN
      IF p_patch -> col = 'null'::jsonb THEN
        parts := array_append(parts, format('%I = NULL', col));
      ELSE
        parts := array_append(parts, format('%I = ($1->>%L)::%s', col, col, typ));
      END IF;
    END IF;
  END LOOP;
  IF coalesce(array_length(parts, 1), 0) = 0 THEN
    RETURN;
  END IF;
  stmt := format('UPDATE public.%I SET %s WHERE id = $2', p_table, array_to_string(parts, ', '));
  EXECUTE stmt USING p_patch, p_id;
END;
$$;
