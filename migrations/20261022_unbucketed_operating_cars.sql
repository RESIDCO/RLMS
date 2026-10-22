-- Read-only safety list for operating cars that the four dashboard buckets do not partition.
-- On rent: off_rent is false and open_abatement is false.
-- Rental abatement: open_abatement is true.
-- Idle (committed): off_rent and an open Commitment, an open program, a Going on lease label, or awaiting rent start.
-- Unassigned: off_rent and that idle seed is false.
-- A car is listed when it is in none of those four, or in more than one of abatement, idle, and unassigned.
-- Does not replace rlms_fleet_kpis or rlms_fleet_kpis_core, and does not change their counts.
-- Predicate matches isUnbucketedOperatingCar in shared/kpi-buckets.ts.

CREATE OR REPLACE VIEW public.v_rlms_unbucketed_cars
WITH (security_invoker = true) AS
SELECT v.*
FROM public.v_rlms_kpi_car_rows v
WHERE v.is_op IS TRUE
  AND (
    (
      (CASE WHEN v.off_rent IS FALSE AND v.open_abatement IS FALSE THEN 1 ELSE 0 END)
      + (CASE WHEN v.open_abatement IS TRUE THEN 1 ELSE 0 END)
      + (CASE
          WHEN v.off_rent IS TRUE
           AND (v.has_open_commitment OR v.in_open_program OR v.going_on_lease OR v.awaiting_rent_start) IS TRUE
          THEN 1 ELSE 0
        END)
      + (CASE
          WHEN v.off_rent IS TRUE
           AND (v.has_open_commitment OR v.in_open_program OR v.going_on_lease OR v.awaiting_rent_start) IS FALSE
          THEN 1 ELSE 0
        END)
    ) = 0
    OR (
      (CASE WHEN v.open_abatement IS TRUE THEN 1 ELSE 0 END)
      + (CASE
          WHEN v.off_rent IS TRUE
           AND (v.has_open_commitment OR v.in_open_program OR v.going_on_lease OR v.awaiting_rent_start) IS TRUE
          THEN 1 ELSE 0
        END)
      + (CASE
          WHEN v.off_rent IS TRUE
           AND (v.has_open_commitment OR v.in_open_program OR v.going_on_lease OR v.awaiting_rent_start) IS FALSE
          THEN 1 ELSE 0
        END)
    ) > 1
  );

COMMENT ON VIEW public.v_rlms_unbucketed_cars IS
  'Operating cars in none of on rent, abatement, idle, and unassigned, or in more than one of abatement, idle, and unassigned.';

REVOKE ALL ON public.v_rlms_unbucketed_cars FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_rlms_unbucketed_cars TO service_role;
