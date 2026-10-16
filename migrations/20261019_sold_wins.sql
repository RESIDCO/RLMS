-- Sold-wins (external sales only) + KPI drill-down row view.
-- No car-data writes. Occidental sold_to clear is in 20261019_occidental_ol1818_apply_DO_NOT_RUN.sql.

CREATE TABLE IF NOT EXISTS public.rlms_internal_entities (
  name text PRIMARY KEY,
  kind text,
  note text
);

INSERT INTO public.rlms_internal_entities (name, kind, note) VALUES
  ('ALF', 'legal_owner', NULL),
  ('ALF I', 'legal_owner', NULL),
  ('ALF II INC', 'legal_owner', NULL),
  ('ALF IV', 'legal_owner', NULL),
  ('ALF VII', 'legal_owner', NULL),
  ('ALF XI', 'legal_owner', NULL),
  ('ALF P-I', 'legal_owner', NULL),
  ('ALF P-I Inc.', 'legal_owner', NULL),
  ('ALF P-II', 'legal_owner', NULL),
  ('ALF P-III', 'legal_owner', NULL),
  ('ALFCAN', 'legal_owner', NULL),
  ('RLH1', 'legal_owner', NULL),
  ('RPS LLC', 'legal_owner', NULL),
  ('Rail Partners Select', 'entity', NULL),
  ('AVF II Inc.', 'legal_owner', NULL),
  ('AVF II LLC', 'legal_owner', NULL),
  ('RESIDCO', 'legal_owner', NULL),
  ('BAH', 'legal_owner', 'Inactive cars only'),
  ('RV Star Co.', 'legal_owner', 'Residco-owned; 45 active cars on OL2543/BNSF')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.rlms_sale_classification (
  id bigserial PRIMARY KEY,
  master_lease_id int REFERENCES public.master_leases(id),
  rider_id int REFERENCES public.riders(id),
  class text NOT NULL CHECK (class IN ('external', 'intercompany', 'unclear')),
  buyer text,
  note text,
  set_by text,
  set_at timestamptz NOT NULL DEFAULT now(),
  CHECK (master_lease_id IS NOT NULL OR rider_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS rlms_sale_class_rider_ux
  ON public.rlms_sale_classification (rider_id)
  WHERE rider_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rlms_sale_class_mla_ux
  ON public.rlms_sale_classification (master_lease_id)
  WHERE rider_id IS NULL AND master_lease_id IS NOT NULL;

ALTER TABLE public.rlms_internal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlms_sale_classification ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rlms_internal_entities FROM PUBLIC, anon;
REVOKE ALL ON public.rlms_sale_classification FROM PUBLIC, anon;
GRANT SELECT ON public.rlms_internal_entities TO authenticated, service_role;
GRANT SELECT ON public.rlms_sale_classification TO authenticated, service_role;
GRANT ALL ON public.rlms_internal_entities TO service_role;
GRANT ALL ON public.rlms_sale_classification TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.rlms_sale_classification_id_seq TO service_role;

INSERT INTO public.rlms_sale_classification (master_lease_id, rider_id, class, buyer, note, set_by)
SELECT 371, NULL, 'intercompany', NULL,
  'Main → RPS per Bruce; master_leases.sold_to = Sold to SRIX is wrong', 'bruce:2026-10-15'
WHERE NOT EXISTS (
  SELECT 1 FROM public.rlms_sale_classification s
  WHERE s.master_lease_id = 371 AND s.rider_id IS NULL
);

INSERT INTO public.rlms_sale_classification (master_lease_id, rider_id, class, buyer, note, set_by)
SELECT 371, 557, 'intercompany', NULL,
  'OL1818 rider override; Main → RPS per Bruce', 'bruce:2026-10-15'
WHERE NOT EXISTS (SELECT 1 FROM public.rlms_sale_classification WHERE rider_id = 557);

INSERT INTO public.rlms_sale_classification (master_lease_id, rider_id, class, buyer, note, set_by)
SELECT x.ml, NULL, 'external', x.buyer, x.note, 'bruce:2026-10-15'
FROM (VALUES
  (293, 'SRIX', 'ROCKY MOUNTAIN TRANSPORTATION — SRIX confirmed'),
  (401, 'SRIX', 'XROCKY MOUNTAIN TRANSPORTATION SVES — SRIX confirmed'),
  (402, 'SRIX', 'ROCKY MOUNTAIN TRANSPORTATION SVES — SRIX confirmed'),
  (368, 'SRIX', 'NORFALCO — SRIX confirmed'),
  (349, 'SRIX', 'KOCH RAIL LLC — SRIX confirmed'),
  (448, 'SRIX', 'XINNOPHOS INC — SRIX confirmed'),
  (424, 'SRIX', 'XTETRA TECHNOLOGIES — SRIX confirmed'),
  (214, 'ARS', 'ADAPTIVE RAIL SOLUTIONS XTRINITY — ARS July 2026')
) AS x(ml, buyer, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.rlms_sale_classification s
  WHERE s.master_lease_id = x.ml AND s.rider_id IS NULL
);

INSERT INTO public.rlms_sale_classification (master_lease_id, rider_id, class, buyer, note, set_by)
SELECT 414, 645, 'external', 'RTEX',
  'OL2144 Source Energy Services; cars tagged Sold, sold_to blank', 'bruce:2026-10-15'
WHERE NOT EXISTS (SELECT 1 FROM public.rlms_sale_classification WHERE rider_id = 645);

CREATE OR REPLACE FUNCTION public.rlms_norm_party(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(upper(btrim(coalesce(t, ''))), '[^A-Z0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.rlms_is_internal_party(t text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.rlms_norm_party(t) <> ''
    AND EXISTS (
      SELECT 1 FROM public.rlms_internal_entities e
      WHERE public.rlms_norm_party(e.name) = public.rlms_norm_party(t)
    );
$$;

DROP VIEW IF EXISTS
  public.v_kpi_preview_retag,
  public.v_kpi_preview_idle_on_ol,
  public.v_kpi_preview_seed_off_rent,
  public.v_kpi_preview_rent_start_default,
  public.v_kpi_preview_rent_start_idle_on_ol,
  public.v_kpi_preview_occidental_ol1818,
  public.v_rlms_kpi_car_rows,
  public.v_rlms_car_kpi;

CREATE OR REPLACE VIEW public.v_rlms_car_kpi AS
SELECT
  c.*,
  (c.fleet_status = 'Sold' OR c.sale_class = 'external') AS is_sold,
  (c.active IS TRUE AND NOT (c.fleet_status = 'Sold' OR c.sale_class = 'external')) AS is_op,
  (c.active IS TRUE AND c.sale_class = 'external' AND c.fleet_status IS DISTINCT FROM 'Sold') AS sold_needs_tag,
  (c.active IS TRUE AND c.sale_class = 'unclear') AS sale_unclear,
  (
    c.active IS TRUE
    AND c.fleet_status = 'Sold'
    AND c.on_ol
    AND public.rlms_is_internal_party(c.legal_owner)
    AND c.sale_class IS DISTINCT FROM 'external'
    AND (
      c.buyer_text IS NULL
      OR public.rlms_is_internal_party(c.buyer_text)
    )
  ) AS sold_tag_suspect,
  (
    c.active IS TRUE
    AND c.fleet_status = 'Sold'
    AND nullif(btrim(coalesce(c.car_sold_to, '')), '') IS NULL
    AND c.sale_class = 'external'
  ) AS sold_missing_buyer
FROM (
  SELECT
    base.*,
    CASE
      WHEN base.sale_class_override IS NOT NULL THEN base.sale_class_override
      WHEN base.buyer_text IS NULL THEN 'none'
      WHEN public.rlms_is_internal_party(base.buyer_text) THEN 'intercompany'
      WHEN base.active IS TRUE
        AND public.rlms_is_internal_party(base.legal_owner)
        AND base.on_ol THEN 'unclear'
      ELSE 'external'
    END AS sale_class
  FROM (
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
      rc.legal_owner,
      rc.sold_to AS car_sold_to,
      r.sold_to AS rider_sold_to,
      ml.sold_to AS mla_sold_to,
      r.master_lease_id,
      ml.lessee AS mla_lessee,
      nullif(btrim(coalesce(nullif(btrim(rc.sold_to), ''), nullif(btrim(ml.sold_to), ''))), '') AS buyer_text,
      (
        SELECT sc.class
        FROM public.rlms_sale_classification sc
        WHERE sc.rider_id = r.id
           OR (sc.rider_id IS NULL AND sc.master_lease_id IS NOT DISTINCT FROM r.master_lease_id)
        ORDER BY (sc.rider_id IS NOT NULL) DESC, sc.set_at DESC NULLS LAST
        LIMIT 1
      ) AS sale_class_override,
      (
        SELECT sc.buyer
        FROM public.rlms_sale_classification sc
        WHERE sc.rider_id = r.id
           OR (sc.rider_id IS NULL AND sc.master_lease_id IS NOT DISTINCT FROM r.master_lease_id)
        ORDER BY (sc.rider_id IS NOT NULL) DESC, sc.set_at DESC NULLS LAST
        LIMIT 1
      ) AS sale_buyer,
      a.id AS assignment_id,
      a.rider_id,
      a.assigned_at,
      a.rent_start_date,
      a.rent_start_set_by,
      a.rent_start_set_at,
      r.rider_name AS link_rider,
      r.lease_status,
      r.expiration_date AS rider_expiration_date,
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
        a.rent_start_date,
        rc.fleet_status
      ) AS on_rent,
      public.rlms_is_off_rent(
        a.railcar_id IS NOT NULL,
        r.rider_name,
        rc.lessee_name,
        rc.assignment_label,
        a.rent_start_date,
        rc.fleet_status
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
          a.rent_start_date,
          rc.fleet_status
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
          a.rent_start_date,
          rc.fleet_status
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
    LEFT JOIN public.riders r ON r.id = a.rider_id
    LEFT JOIN public.master_leases ml ON ml.id = r.master_lease_id
  ) base
) c;

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
  public.rlms_derived_fleet_status(v.is_sold, v.off_rent, v.on_ol, v.has_open_commitment) AS derived_status
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
    WHEN v.in_open_program THEN 'program'
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

CREATE OR REPLACE VIEW public.v_kpi_preview_occidental_ol1818 AS
SELECT
  'master_lease'::text AS kind,
  ml.id AS id,
  NULL::text AS reporting_marks,
  NULL::text AS car_number,
  ml.lessee AS label,
  ml.sold_to AS old_value,
  NULL::text AS new_value,
  NULL::text AS entity,
  NULL::text AS legal_owner
FROM public.master_leases ml
WHERE ml.id = 371
  AND ml.sold_to = 'Sold to SRIX'
UNION ALL
SELECT
  'railcar',
  rc.id,
  rc.reporting_marks,
  rc.car_number,
  rc.reporting_marks || ' ' || rc.car_number,
  rc.sold_to,
  NULL,
  rc.entity,
  rc.legal_owner
FROM public.railcars rc
JOIN LATERAL (
  SELECT a0.*
  FROM public.railcar_assignments a0
  WHERE a0.railcar_id = rc.id
  ORDER BY a0.id DESC
  LIMIT 1
) a ON true
JOIN public.riders r ON r.id = a.rider_id AND r.id = 557
WHERE rc.active IS TRUE
  AND rc.sold_to = 'Sold to SRIX';

CREATE OR REPLACE VIEW public.v_rlms_kpi_car_rows AS
SELECT
  v.railcar_id,
  v.active,
  btrim(coalesce(v.reporting_marks, '')) || ' ' || btrim(coalesce(v.car_number, '')) AS car,
  v.reporting_marks,
  v.car_number,
  v.entity,
  v.fleet_status AS status_tag,
  public.rlms_derived_fleet_status(v.is_sold, v.off_rent, v.on_ol, v.has_open_commitment) AS derived_status,
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

GRANT SELECT ON public.v_kpi_preview_retag TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kpi_preview_idle_on_ol TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kpi_preview_seed_off_rent TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kpi_preview_rent_start_default TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kpi_preview_rent_start_idle_on_ol TO anon, authenticated, service_role;
GRANT SELECT ON public.v_kpi_preview_occidental_ol1818 TO authenticated, service_role;
GRANT SELECT ON public.v_rlms_kpi_car_rows TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rlms_norm_party(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rlms_is_internal_party(text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.rlms_fleet_kpis()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
AS $function$
WITH op AS (
  SELECT
    rc.id,
    rc.entity,
    rc.fleet_status,
    rc.rider_external_id,
    rc.lessee_name,
    rc.lease_end_date,
    CASE
      WHEN upper(btrim(coalesce(rc.rider_external_id, ''))) ~ '^(OL|FL)[0-9]'
        THEN upper(btrim(rc.rider_external_id))
      ELSE NULL
    END AS ol_code,
    CASE
      WHEN rc.lessee_name IS NULL THEN NULL
      WHEN btrim(rc.lessee_name) ~* '\(x' THEN NULL
      ELSE btrim(rc.lessee_name)
    END AS lessee_clean
  FROM railcars rc
  INNER JOIN v_rlms_car_kpi vx ON vx.railcar_id = rc.id AND vx.is_op
  WHERE rc.active IS TRUE
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
        AND EXISTS (SELECT 1 FROM v_rlms_car_kpi vo WHERE vo.railcar_id = rc.id AND vo.is_op)
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
    (SELECT count(*)::int FROM v_rlms_car_kpi v3 WHERE v3.active IS TRUE AND v3.sold_needs_tag) AS sold_needs_tag,
    (SELECT count(*)::int FROM v_rlms_car_kpi v3 WHERE v3.active IS TRUE AND v3.sale_unclear) AS sale_unclear,
    (SELECT count(*)::int FROM v_rlms_car_kpi v3 WHERE v3.active IS TRUE AND v3.sold_tag_suspect) AS sold_tag_suspect,
    (SELECT count(*)::int FROM v_rlms_car_kpi v3 WHERE v3.active IS TRUE AND v3.sold_missing_buyer) AS sold_missing_buyer,
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
    upper(ol_code) AS ol,
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
    'lease_ended_watch', (SELECT n FROM watch),
    'sold_needs_tag', k.sold_needs_tag,
    'sale_unclear', k.sale_unclear,
    'sold_tag_suspect', k.sold_tag_suspect,
    'sold_missing_buyer', k.sold_missing_buyer
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
$function$;

REVOKE ALL ON FUNCTION public.rlms_fleet_kpis() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rlms_fleet_kpis() FROM anon;
GRANT EXECUTE ON FUNCTION public.rlms_fleet_kpis() TO authenticated, service_role;

-- Recompute still gated/disabled. When enabled, Sold-wins is_sold is checked first via the view.
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
    v.is_sold,
    v.off_rent,
    v.on_ol
  INTO v_sold, v_off, v_on_ol
  FROM v_rlms_car_kpi v
  WHERE v.railcar_id = p_railcar_id;

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

REVOKE ALL ON FUNCTION public.rlms_recompute_fleet_status(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_recompute_fleet_status(bigint) TO service_role;
