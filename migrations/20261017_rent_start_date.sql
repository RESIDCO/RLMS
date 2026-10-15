-- Per-car rent_start_date. Safe to re-run. Does NOT write rent dates (preview views only).
-- Apply after 20261016_car_commitments_derived_status.sql.

ALTER TABLE public.railcar_assignments
  ADD COLUMN IF NOT EXISTS rent_start_date date,
  ADD COLUMN IF NOT EXISTS rent_start_set_by text,
  ADD COLUMN IF NOT EXISTS rent_start_set_at timestamptz;

CREATE TABLE IF NOT EXISTS public.rlms_app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO public.rlms_app_settings (key, value)
VALUES ('awaiting_rent_days', '60')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.rlms_preview_tokens (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  snapshot jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rlms_preview_tokens_exp_ix ON public.rlms_preview_tokens (expires_at);
ALTER TABLE public.rlms_preview_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rlms_preview_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rlms_preview_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.rlms_is_on_ol(
  has_assignment boolean,
  link_rider text,
  lessee_name text,
  assignment_label text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(has_assignment, false) IS TRUE
    AND upper(btrim(coalesce(link_rider, ''))) ~ '^OL'
    AND upper(btrim(coalesce(link_rider, ''))) !~ '^XOL'
    AND btrim(coalesce(lessee_name, '')) !~ '^[(]?x[A-Z(]'
    AND btrim(coalesce(assignment_label, '')) !~ '^[(]?x[A-Z(]';
$$;

CREATE OR REPLACE FUNCTION public.rlms_is_on_rent(
  p_on_ol boolean,
  p_rent_start date
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(p_on_ol, false) IS TRUE
    AND p_rent_start IS NOT NULL
    AND p_rent_start <= current_date;
$$;

CREATE OR REPLACE FUNCTION public.rlms_is_off_rent(
  has_assignment boolean,
  link_rider text,
  lessee_name text,
  assignment_label text,
  rent_start date
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT NOT public.rlms_is_on_rent(
    public.rlms_is_on_ol(has_assignment, link_rider, lessee_name, assignment_label),
    rent_start
  );
$$;

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
    WHEN coalesce(p_on_ol, false) OR coalesce(p_has_open_commitment, false) THEN 'Idle'
    ELSE 'Unassigned'
  END;
$$;

CREATE OR REPLACE VIEW public.v_rlms_car_kpi AS
SELECT
  rc.id AS railcar_id,
  rc.entity,
  rc.active,
  rc.fleet_status,
  rc.lease_end_date,
  rc.lease_start_date,
  rc.lessee_name,
  rc.assignment_label,
  rc.reporting_marks,
  rc.car_number,
  rc.ops_flag,
  a.id AS assignment_id,
  a.rider_id,
  a.assigned_at,
  a.rent_start_date,
  a.rent_start_set_by,
  a.rent_start_set_at,
  r.rider_name AS link_rider,
  r.lease_status,
  r.expiration_date AS rider_expiration_date,
  (rc.active IS TRUE AND coalesce(rc.fleet_status, 'Leased') <> 'Sold') AS is_op,
  public.rlms_is_on_ol(
    a.railcar_id IS NOT NULL,
    r.rider_name,
    rc.lessee_name,
    rc.assignment_label
  ) AS on_ol,
  public.rlms_is_on_rent(
    public.rlms_is_on_ol(
      a.railcar_id IS NOT NULL,
      r.rider_name,
      rc.lessee_name,
      rc.assignment_label
    ),
    a.rent_start_date
  ) AS on_rent,
  public.rlms_is_off_rent(
    a.railcar_id IS NOT NULL,
    r.rider_name,
    rc.lessee_name,
    rc.assignment_label,
    a.rent_start_date
  ) AS off_rent,
  (
    public.rlms_is_on_ol(
      a.railcar_id IS NOT NULL,
      r.rider_name,
      rc.lessee_name,
      rc.assignment_label
    )
    AND NOT public.rlms_is_on_rent(
      public.rlms_is_on_ol(
        a.railcar_id IS NOT NULL,
        r.rider_name,
        rc.lessee_name,
        rc.assignment_label
      ),
      a.rent_start_date
    )
  ) AS awaiting_rent_start,
  (
    a.rent_start_date IS NOT NULL
    AND a.rent_start_date > current_date
    AND a.rent_start_date <= current_date + 30
    AND public.rlms_is_on_ol(
      a.railcar_id IS NOT NULL,
      r.rider_name,
      rc.lessee_name,
      rc.assignment_label
    )
  ) AS future_rent_start,
  (
    a.rent_start_date IS NOT NULL
    AND a.rent_start_date <= current_date
    AND (
      EXISTS (
        SELECT 1
        FROM public.program_cars pc
        JOIN public.programs p ON p.id = pc.program_id
        WHERE pc.railcar_id = rc.id
          AND pc.exited_date IS NULL
          AND pc.shop_id IS NOT NULL
          AND p.closed_date IS NULL
      )
      OR coalesce(rc.ops_flag, '') ~* '(shop|repair)'
    )
  ) AS shop_conflict,
  CASE
    WHEN public.rlms_is_on_ol(
      a.railcar_id IS NOT NULL,
      r.rider_name,
      rc.lessee_name,
      rc.assignment_label
    )
    AND NOT public.rlms_is_on_rent(
      public.rlms_is_on_ol(
        a.railcar_id IS NOT NULL,
        r.rider_name,
        rc.lessee_name,
        rc.assignment_label
      ),
      a.rent_start_date
    )
    THEN btrim(coalesce(r.rider_name, '')) || ' – ' || coalesce(nullif(btrim(rc.lessee_name), ''), 'lessee') || ' (awaiting rent start)'
    ELSE NULL
  END AS implicit_commitment,
  EXISTS (
    SELECT 1 FROM public.car_commitments cc
    WHERE cc.railcar_id = rc.id AND cc.cleared_at IS NULL
  ) AS has_open_commitment,
  EXISTS (
    SELECT 1
    FROM public.program_cars pc
    JOIN public.programs p ON p.id = pc.program_id
    WHERE pc.railcar_id = rc.id
      AND pc.exited_date IS NULL
      AND p.closed_date IS NULL
      AND lower(coalesce(p.status, '')) NOT IN ('closed', 'complete', 'completed')
  ) AS in_open_program,
  (SELECT pc.shop_id
     FROM public.program_cars pc
     JOIN public.programs p ON p.id = pc.program_id
    WHERE pc.railcar_id = rc.id
      AND pc.exited_date IS NULL
      AND p.closed_date IS NULL
    ORDER BY pc.id
    LIMIT 1) AS open_program_shop_id,
  (upper(btrim(coalesce(r.lease_status, ''))) LIKE '%GOING ON LEASE%') AS going_on_lease,
  (a.railcar_id IS NULL) AS no_assignment
FROM public.railcars rc
LEFT JOIN LATERAL (
  SELECT a0.*
  FROM public.railcar_assignments a0
  WHERE a0.railcar_id = rc.id
  ORDER BY a0.id DESC
  LIMIT 1
) a ON true
LEFT JOIN public.riders r ON r.id = a.rider_id;

GRANT SELECT ON public.v_rlms_car_kpi TO anon, authenticated, service_role;

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
  public.rlms_derived_fleet_status(false, v.off_rent, v.on_ol, v.has_open_commitment) AS derived_status
FROM public.v_rlms_car_kpi v
WHERE v.is_op
  AND v.off_rent
  AND v.fleet_status = 'Leased';

CREATE OR REPLACE VIEW public.v_kpi_preview_idle_on_ol AS
SELECT
  v.railcar_id,
  v.reporting_marks,
  v.car_number,
  v.entity,
  v.fleet_status AS current_tag,
  v.link_rider,
  v.lessee_name,
  v.assignment_label,
  v.rent_start_date
FROM public.v_rlms_car_kpi v
WHERE v.is_op
  AND v.fleet_status = 'Idle'
  AND v.on_ol;

CREATE OR REPLACE VIEW public.v_kpi_preview_seed_off_rent AS
SELECT
  v.railcar_id,
  v.reporting_marks,
  v.car_number,
  v.entity,
  v.link_rider,
  v.lessee_name,
  v.lease_status,
  CASE
    WHEN v.awaiting_rent_start THEN 'awaiting_rent_start'
    WHEN EXISTS (
      SELECT 1
      FROM public.program_cars pc
      JOIN public.programs p ON p.id = pc.program_id
      WHERE pc.railcar_id = v.railcar_id
        AND pc.exited_date IS NULL
        AND p.closed_date IS NULL
        AND lower(coalesce(p.status, '')) NOT IN ('closed', 'complete', 'completed')
    ) THEN 'program'
    WHEN upper(btrim(coalesce(v.link_rider, ''))) = 'EA2435' THEN 'deal'
    ELSE 'unassigned'
  END AS seed_bucket,
  (
    SELECT p.name
    FROM public.program_cars pc
    JOIN public.programs p ON p.id = pc.program_id
    WHERE pc.railcar_id = v.railcar_id
      AND pc.exited_date IS NULL
      AND p.closed_date IS NULL
      AND lower(coalesce(p.status, '')) NOT IN ('closed', 'complete', 'completed')
    ORDER BY pc.id
    LIMIT 1
  ) AS program_name
FROM public.v_rlms_car_kpi v
WHERE v.is_op AND v.off_rent;

-- Default rent start for OL cars not tagged Idle. Bruce signs off CSV before any UPDATE.
CREATE OR REPLACE VIEW public.v_kpi_preview_rent_start_default AS
SELECT
  v.railcar_id,
  v.assignment_id,
  v.reporting_marks,
  v.car_number,
  v.entity,
  v.fleet_status AS current_tag,
  v.link_rider,
  v.lessee_name,
  v.lease_start_date,
  v.lease_start_date AS proposed_rent_start_date,
  v.rent_start_date AS current_rent_start_date
FROM public.v_rlms_car_kpi v
WHERE v.is_op
  AND v.on_ol
  AND v.fleet_status IS DISTINCT FROM 'Idle'
  AND v.fleet_status IS DISTINCT FROM 'Sold';

-- Idle-on-OL review: leave rent_start blank unless Bruce fills it.
CREATE OR REPLACE VIEW public.v_kpi_preview_rent_start_idle_on_ol AS
SELECT
  v.railcar_id,
  v.reporting_marks,
  v.car_number,
  v.entity,
  v.fleet_status AS current_tag,
  v.link_rider,
  v.lessee_name,
  v.lease_start_date,
  NULL::date AS rent_start_date,
  v.assigned_at
FROM public.v_rlms_car_kpi v
WHERE v.is_op
  AND v.on_ol
  AND v.fleet_status = 'Idle';

GRANT SELECT ON public.v_kpi_preview_retag TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kpi_preview_idle_on_ol TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kpi_preview_seed_off_rent TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kpi_preview_rent_start_default TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kpi_preview_rent_start_idle_on_ol TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rlms_app_settings TO service_role;
GRANT SELECT ON public.rlms_app_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.rlms_recompute_fleet_status(p_railcar_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sold boolean;
  v_off boolean;
  v_on_ol boolean;
  v_open boolean;
  v_status text;
BEGIN
  SELECT
    (active IS TRUE AND fleet_status = 'Sold'),
    public.rlms_is_off_rent(
      EXISTS (SELECT 1 FROM railcar_assignments a WHERE a.railcar_id = railcars.id),
      (SELECT r.rider_name FROM railcar_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.railcar_id = railcars.id ORDER BY a.id DESC LIMIT 1),
      lessee_name,
      assignment_label,
      (SELECT a.rent_start_date FROM railcar_assignments a WHERE a.railcar_id = railcars.id ORDER BY a.id DESC LIMIT 1)
    ),
    public.rlms_is_on_ol(
      EXISTS (SELECT 1 FROM railcar_assignments a WHERE a.railcar_id = railcars.id),
      (SELECT r.rider_name FROM railcar_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.railcar_id = railcars.id ORDER BY a.id DESC LIMIT 1),
      lessee_name,
      assignment_label
    )
  INTO v_sold, v_off, v_on_ol
  FROM railcars
  WHERE id = p_railcar_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_sold THEN
    RETURN 'Sold';
  END IF;

  IF v_off IS NOT TRUE THEN
    UPDATE car_commitments
    SET cleared_at = now(),
        cleared_by = 'system: on rent'
    WHERE railcar_id = p_railcar_id
      AND cleared_at IS NULL;
  END IF;

  v_open := EXISTS (
    SELECT 1 FROM car_commitments
    WHERE railcar_id = p_railcar_id AND cleared_at IS NULL
  );
  v_status := public.rlms_derived_fleet_status(false, v_off, v_on_ol, v_open);

  UPDATE railcars
  SET fleet_status = v_status,
      fleet_status_source = 'derived'
  WHERE id = p_railcar_id
    AND fleet_status IS DISTINCT FROM 'Sold';

  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.rlms_recompute_fleet_status_trig()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid bigint;
BEGIN
  rid := COALESCE(NEW.railcar_id, OLD.railcar_id);
  IF rid IS NOT NULL THEN
    PERFORM public.rlms_recompute_fleet_status(rid);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_status_assignment ON public.railcar_assignments;
CREATE TRIGGER trg_recompute_status_assignment
AFTER INSERT OR UPDATE OR DELETE ON public.railcar_assignments
FOR EACH ROW EXECUTE FUNCTION public.rlms_recompute_fleet_status_trig();
ALTER TABLE public.railcar_assignments DISABLE TRIGGER trg_recompute_status_assignment;

DROP TRIGGER IF EXISTS trg_recompute_status_commitment ON public.car_commitments;
CREATE TRIGGER trg_recompute_status_commitment
AFTER INSERT OR UPDATE OR DELETE ON public.car_commitments
FOR EACH ROW EXECUTE FUNCTION public.rlms_recompute_fleet_status_trig();
ALTER TABLE public.car_commitments DISABLE TRIGGER trg_recompute_status_commitment;

GRANT EXECUTE ON FUNCTION public.rlms_is_on_ol(boolean, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rlms_is_on_rent(boolean, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rlms_is_off_rent(boolean, text, text, text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rlms_derived_fleet_status(boolean, boolean, boolean, boolean) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rlms_recompute_fleet_status(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_recompute_fleet_status(bigint) TO service_role;

DROP FUNCTION IF EXISTS public.rlms_is_off_rent(boolean, text, text, text);
DROP FUNCTION IF EXISTS public.rlms_derived_fleet_status(boolean, boolean, boolean);

-- KPI rewrite: Off Rent / Active / Utilization from the lease link, not the tag.
CREATE OR REPLACE FUNCTION public.rlms_fleet_kpis()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
WITH op AS (
  SELECT
    rc.id,
    rc.entity,
    rc.fleet_status,
    rc.rider_external_id,
    rc.lessee_name,
    rc.lease_end_date,
    CASE
      WHEN upper(btrim(coalesce(rc.rider_external_id, ''))) ~ '^OL[0-9]'
        THEN upper(btrim(rc.rider_external_id))
      ELSE NULL
    END AS ol_code,
    CASE
      WHEN rc.lessee_name IS NULL THEN NULL
      WHEN btrim(rc.lessee_name) ~* '\(x' THEN NULL
      ELSE btrim(rc.lessee_name)
    END AS lessee_clean
  FROM railcars rc
  WHERE rc.active IS TRUE
    AND coalesce(rc.fleet_status, 'Leased') <> 'Sold'
),
k AS (
  SELECT
    (SELECT count(*) FROM railcars)::int AS scanned,
    (SELECT count(*) FROM railcars WHERE active IS TRUE)::int AS active_including_sold,
    (SELECT count(*) FROM railcars WHERE active IS TRUE AND fleet_status = 'Sold')::int AS sold,
    count(*) FILTER (
      WHERE off_rent AND (has_open_commitment OR in_open_program OR going_on_lease OR awaiting_rent_start)
    )::int AS idle,
    count(*) FILTER (WHERE NOT off_rent)::int AS leased,
    0::int AS abatement,
    count(*)::int AS operating,
    count(*) FILTER (WHERE NOT off_rent)::int AS leased_operating,
    count(*) FILTER (WHERE NOT off_rent)::int AS leased_only,
    count(*) FILTER (
      WHERE off_rent AND NOT (has_open_commitment OR in_open_program OR going_on_lease OR awaiting_rent_start)
    )::int AS unassigned,
    count(*) FILTER (WHERE entity = 'Rail Partners Select')::int AS rps_total,
    count(*) FILTER (WHERE entity = 'Rail Partners Select' AND NOT off_rent)::int AS rps_assigned,
    count(*) FILTER (WHERE entity IN ('Main', 'Coal'))::int AS owned_total,
    count(*) FILTER (WHERE entity IN ('Main', 'Coal') AND NOT off_rent)::int AS owned_assigned,
    count(*) FILTER (WHERE entity = 'Coal')::int AS coal_total,
    count(*) FILTER (
      WHERE NOT off_rent AND (lease_end_date IS NULL OR btrim(lease_end_date::text) = '')
    )::int AS undefined_end,
    (
      SELECT count(DISTINCT r.id)::int
      FROM riders r
      INNER JOIN railcar_assignments a ON a.rider_id = r.id
      INNER JOIN railcars rc ON rc.id = a.railcar_id
        AND rc.active IS TRUE
        AND coalesce(rc.fleet_status, 'Leased') <> 'Sold'
    ) AS riders_count,
    count(*) FILTER (WHERE off_rent)::int AS off_rent,
    (
      SELECT count(DISTINCT pc.railcar_id)::int
      FROM program_cars pc
      INNER JOIN programs p ON p.id = pc.program_id
      INNER JOIN v_rlms_car_kpi v2 ON v2.railcar_id = pc.railcar_id AND v2.is_op
      WHERE pc.exited_date IS NULL
        AND p.closed_date IS NULL
        AND lower(coalesce(p.status, '')) NOT IN ('closed', 'complete', 'completed')
    ) AS in_program_count,
    count(*) FILTER (WHERE off_rent AND entity = 'Main')::int AS off_rent_main,
    count(*) FILTER (WHERE off_rent AND entity = 'Coal')::int AS off_rent_coal,
    count(*) FILTER (WHERE off_rent AND entity = 'Rail Partners Select')::int AS off_rent_rps,
    count(*) FILTER (
      WHERE off_rent AND NOT (has_open_commitment OR in_open_program OR going_on_lease OR awaiting_rent_start) AND entity = 'Main'
    )::int AS unassigned_main,
    count(*) FILTER (
      WHERE off_rent AND NOT (has_open_commitment OR in_open_program OR going_on_lease OR awaiting_rent_start)
        AND entity = 'Rail Partners Select'
    )::int AS unassigned_rps,
    count(*) FILTER (
      WHERE fleet_status = 'Idle' AND on_ol
    )::int AS idle_on_ol_review,
    count(*) FILTER (WHERE awaiting_rent_start)::int AS awaiting_rent_start,
    count(*) FILTER (WHERE shop_conflict)::int AS shop_conflict,
    count(*) FILTER (WHERE future_rent_start)::int AS future_rent_start,
    count(*) FILTER (WHERE no_assignment)::int AS no_lease_link,
    count(*) FILTER (
      WHERE upper(btrim(coalesce(lease_status, ''))) ~ '(MTM|MONTH[[:space:]]*TO[[:space:]]*MONTH)'
    )::int AS month_to_month
  FROM v_rlms_car_kpi
  WHERE is_op
),
gol AS (
  SELECT
    count(DISTINCT rider_id)::int AS leases,
    count(*)::int AS cars,
    min(substring(btrim(coalesce(rider_expiration_date::text, lease_end_date::text, '')) from 1 for 10)) AS earliest_end
  FROM v_rlms_car_kpi
  WHERE is_op
    AND upper(btrim(coalesce(lease_status, ''))) LIKE '%GOING ON LEASE%'
),
stale_commitments AS (
  SELECT count(*)::int AS n
  FROM car_commitments cc
  WHERE cc.cleared_at IS NULL
    AND (
      cc.target_date IS NULL
      OR cc.target_date < current_date
      OR cc.set_at < now() - interval '90 days'
    )
),
stale_programs AS (
  SELECT count(*)::int AS n
  FROM programs p
  WHERE p.closed_date IS NULL
    AND p.target_completion_date IS NOT NULL
    AND p.target_completion_date < current_date
    AND lower(coalesce(p.status, '')) NOT IN ('closed', 'complete', 'completed')
),
watch AS (
  SELECT count(*)::int AS n
  FROM v_rlms_car_kpi v
  WHERE v.is_op
    AND v.off_rent IS NOT TRUE
    AND v.no_assignment IS NOT TRUE
    AND upper(btrim(coalesce(v.lease_status, ''))) !~ '(MTM|MONTH[[:space:]]*TO[[:space:]]*MONTH)'
    AND (
      (
        substring(btrim(coalesce(v.rider_expiration_date::text, '')) from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
        AND substring(btrim(v.rider_expiration_date::text) from 1 for 10)::date < current_date
      )
      OR (
        substring(btrim(coalesce(v.lease_end_date::text, '')) from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
        AND substring(btrim(v.lease_end_date::text) from 1 for 10)::date < current_date
      )
    )
),
lessees AS (
  SELECT
    lessee_clean AS fleet_name,
    count(*)::int AS count,
    min(id)::text AS expiration_date,
    NULL::text AS rider_name,
    count(DISTINCT ol_code)::int AS ol_n
  FROM op
  WHERE lessee_clean IS NOT NULL AND lessee_clean <> ''
  GROUP BY lessee_clean
),
ol_counts AS (
  SELECT ol_code, count(*)::int AS cnt
  FROM op
  WHERE ol_code IS NOT NULL
  GROUP BY ol_code
),
vcf AS (
  SELECT
    ol_code AS rider_name,
    min(substring(btrim(lease_end_date::text) from 1 for 10)) AS expiration_date,
    max(lessee_clean) AS lessee_name,
    count(*)::int AS car_count
  FROM op
  WHERE ol_code IS NOT NULL
    AND lease_end_date IS NOT NULL
    AND btrim(lease_end_date::text) <> ''
    AND substring(btrim(lease_end_date::text) from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$'
  GROUP BY ol_code
),
c AS (
  SELECT
    active,
    coalesce(build_year, built_year)::int AS build_year
  FROM railcars
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
  SELECT
    max(substring(btrim(snapshot_month::text) from 1 for 10)) AS snap,
    bool_or(lease_exp_date IS NOT NULL) FILTER (
      WHERE substring(btrim(snapshot_month::text) from 1 for 10) = (
        SELECT max(substring(btrim(snapshot_month::text) from 1 for 10))
        FROM rider_financial_summary
        WHERE snapshot_month IS NOT NULL
      )
    ) AS has_lease_exp
  FROM rider_financial_summary
  WHERE snapshot_month IS NOT NULL
),
fin_ol AS (
  SELECT
    upper(btrim(f.rider_id::text)) AS ol,
    min(
      coalesce(
        f.lease_exp_date,
        CASE
          WHEN latest_fin.has_lease_exp IS TRUE THEN NULL
          WHEN f.months_until_lease_exp IS NULL THEN NULL
          ELSE (
            (substring(btrim(f.snapshot_month::text) from 1 for 10))::date
            + make_interval(months => round(f.months_until_lease_exp::numeric)::int)
            - interval '1 day'
          )::date
        END
      )
    )::text AS expiration_date,
    max(nullif(btrim(f.lessee), '')) AS lessee,
    min(round(f.months_until_lease_exp::numeric)::int) AS months_until
  FROM rider_financial_summary f
  CROSS JOIN latest_fin
  WHERE latest_fin.snap IS NOT NULL
    AND substring(btrim(f.snapshot_month::text) from 1 for 10) = latest_fin.snap
    AND btrim(f.rider_id::text) <> ''
    AND (
      f.lease_exp_date IS NOT NULL
      OR (latest_fin.has_lease_exp IS NOT TRUE AND f.months_until_lease_exp IS NOT NULL)
    )
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
    'in_program_count', k.in_program_count,
    'off_rent_main', k.off_rent_main,
    'off_rent_coal', k.off_rent_coal,
    'off_rent_rps', k.off_rent_rps,
    'unassigned_main', k.unassigned_main,
    'unassigned_rps', k.unassigned_rps,
    'no_lease_link', k.no_lease_link,
    'idle_on_ol_review', k.idle_on_ol_review,
    'awaiting_rent_start', k.awaiting_rent_start,
    'shop_conflict', k.shop_conflict,
    'future_rent_start', k.future_rent_start,
    'month_to_month', k.month_to_month,
    'going_on_lease_leases', (SELECT leases FROM gol),
    'going_on_lease_cars', (SELECT cars FROM gol),
    'going_on_lease_earliest_end', (SELECT earliest_end FROM gol),
    'stale_commitments', (SELECT n FROM stale_commitments),
    'stale_programs', (SELECT n FROM stale_programs),
    'lease_ended_watch', (SELECT n FROM watch)
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

REVOKE ALL ON FUNCTION public.rlms_fleet_kpis() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rlms_fleet_kpis() FROM anon;
GRANT EXECUTE ON FUNCTION public.rlms_fleet_kpis() TO authenticated, service_role;
