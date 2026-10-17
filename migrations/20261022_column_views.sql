-- Column picker v2: named views, unique (user_id, list_key, view_name, is_shared),
-- RLS on prefs/programs/program_cars, KPI status Idle includes Going On Lease.
-- Re-runnable. Backfill prefs keys so the new unique index can apply.
-- Does not UPDATE railcars or recompute fleet_status.

ALTER TABLE public.user_column_prefs ADD COLUMN IF NOT EXISTS list_key text;
ALTER TABLE public.user_column_prefs ADD COLUMN IF NOT EXISTS view_name text;
ALTER TABLE public.user_column_prefs ADD COLUMN IF NOT EXISTS is_default boolean;
ALTER TABLE public.user_column_prefs ADD COLUMN IF NOT EXISTS is_shared boolean;

ALTER TABLE public.user_column_prefs DROP CONSTRAINT IF EXISTS user_column_prefs_user_id_page_key;
DROP INDEX IF EXISTS public.user_column_prefs_list_view_uidx;
DROP INDEX IF EXISTS public.user_column_prefs_list_view_shared_uidx;

UPDATE public.user_column_prefs
SET
  list_key = coalesce(nullif(btrim(list_key), ''), page),
  view_name = coalesce(nullif(btrim(view_name), ''), 'Default'),
  is_default = coalesce(is_default, false),
  is_shared = coalesce(is_shared, false)
WHERE list_key IS NULL
   OR nullif(btrim(list_key), '') IS NULL
   OR view_name IS NULL
   OR nullif(btrim(view_name), '') IS NULL
   OR is_default IS NULL
   OR is_shared IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_column_prefs_list_view_shared_uidx
  ON public.user_column_prefs (user_id, list_key, view_name, is_shared);

CREATE OR REPLACE VIEW public.v_user_column_prefs AS
SELECT
  id,
  user_id,
  page,
  CASE
    WHEN list_key IS NOT NULL AND btrim(list_key) <> '' THEN
      CASE WHEN list_key ~ '^program_cars_[0-9]+$' THEN 'program_cars' ELSE list_key END
    WHEN page ~ '^program_cars_[0-9]+$' THEN 'program_cars'
    ELSE page
  END AS list_key,
  COALESCE(NULLIF(btrim(view_name), ''), 'Default') AS view_name,
  COALESCE(is_default, false) AS is_default,
  COALESCE(is_shared, false) AS is_shared,
  visible_cols,
  updated_at
FROM public.user_column_prefs;

REVOKE ALL ON public.v_user_column_prefs FROM PUBLIC, anon;
GRANT SELECT ON public.v_user_column_prefs TO authenticated, service_role;

ALTER TABLE public.user_column_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_column_prefs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_column_prefs TO authenticated;
GRANT ALL ON public.user_column_prefs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.user_column_prefs_id_seq TO authenticated, service_role;

DROP POLICY IF EXISTS user_column_prefs_select ON public.user_column_prefs;
CREATE POLICY user_column_prefs_select ON public.user_column_prefs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR COALESCE(is_shared, false) IS TRUE);

DROP POLICY IF EXISTS user_column_prefs_insert_own ON public.user_column_prefs;
CREATE POLICY user_column_prefs_insert_own ON public.user_column_prefs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND COALESCE(is_shared, false) IS NOT TRUE);

DROP POLICY IF EXISTS user_column_prefs_update_own ON public.user_column_prefs;
CREATE POLICY user_column_prefs_update_own ON public.user_column_prefs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND COALESCE(is_shared, false) IS NOT TRUE)
  WITH CHECK (user_id = auth.uid() AND COALESCE(is_shared, false) IS NOT TRUE);

DROP POLICY IF EXISTS user_column_prefs_delete_own ON public.user_column_prefs;
CREATE POLICY user_column_prefs_delete_own ON public.user_column_prefs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND COALESCE(is_shared, false) IS NOT TRUE);

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.programs FROM PUBLIC, anon;
GRANT SELECT ON public.programs TO authenticated;
GRANT ALL ON public.programs TO service_role;

DROP POLICY IF EXISTS programs_select_authenticated ON public.programs;
CREATE POLICY programs_select_authenticated ON public.programs
  FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.program_cars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_cars FROM PUBLIC, anon;
GRANT SELECT ON public.program_cars TO authenticated;
GRANT ALL ON public.program_cars TO service_role;

DROP POLICY IF EXISTS program_cars_select_authenticated ON public.program_cars;
CREATE POLICY program_cars_select_authenticated ON public.program_cars
  FOR SELECT TO authenticated
  USING (true);

-- KPI status Idle matches dashboard Idle (commitment, open program, Going On Lease, awaiting rent start).
-- 4th argument is idle-plan, not commitment-only. on_ol no longer forces Idle.
CREATE OR REPLACE FUNCTION public.rlms_derived_fleet_status(
  p_sold boolean,
  p_off_rent boolean,
  p_on_ol boolean,
  p_has_open_commitment boolean
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_sold THEN 'Sold'
    WHEN NOT p_off_rent THEN 'Leased'
    WHEN coalesce(p_has_open_commitment, false) THEN 'Idle'
    ELSE 'Unassigned'
  END;
$$;

CREATE OR REPLACE VIEW public.v_kpi_preview_retag AS
SELECT
  v.railcar_id,
  v.reporting_marks,
  v.car_number,
  v.entity,
  v.fleet_status AS current_tag,
  v.link_rider,
  v.lessee_name,
  v.assignment_label,
  v.rent_start_date,
  public.rlms_derived_fleet_status(
    v.is_sold,
    v.off_rent,
    v.on_ol,
    v.has_open_commitment OR v.in_open_program OR v.going_on_lease OR v.awaiting_rent_start
  ) AS derived_status
FROM public.v_rlms_car_kpi v
WHERE v.is_op
  AND v.off_rent
  AND v.fleet_status = 'Leased';

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
  v.on_rent,
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
  v.rider_id
FROM public.v_rlms_car_kpi v
WHERE v.active IS TRUE;

GRANT SELECT ON public.v_kpi_preview_retag TO authenticated, service_role;
GRANT SELECT ON public.v_rlms_kpi_car_rows TO authenticated, service_role;
