-- View-only, re-runnable. No car-data writes. Do not set RLMS_RECOMPUTE_FLEET_STATUS.
-- sale_unclear excludes Sold cars whose buyer is non-internal (OL2144/RTEX).
-- Same column list as v_rlms_car_kpi from 20261019.
CREATE OR REPLACE VIEW public.v_rlms_car_kpi AS
SELECT
  c.*,
  (c.fleet_status = 'Sold' OR c.sale_class = 'external') AS is_sold,
  (c.active IS TRUE AND NOT (c.fleet_status = 'Sold' OR c.sale_class = 'external')) AS is_op,
  (c.active IS TRUE AND c.sale_class = 'external' AND c.fleet_status IS DISTINCT FROM 'Sold') AS sold_needs_tag,
  (
    c.active IS TRUE
    AND c.sale_class = 'unclear'
    AND NOT (
      c.fleet_status = 'Sold'
      AND c.buyer_text IS NOT NULL
      AND NOT public.rlms_is_internal_party(c.buyer_text)
    )
  ) AS sale_unclear,
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
