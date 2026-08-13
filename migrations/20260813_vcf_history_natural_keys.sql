-- §2.1 step 5 — idempotent VCF history natural keys
-- ASSIGNMENT_ID alone is NOT unique per car in V_VALID_CARS (renewals reuse it).
-- Period identity = railcar_id + assignment_id_ext + start_date + end_date.
-- ACTIVE is intentionally excluded so month-over-month ACTIVE flips update in place.
-- (Two edge-case VCF rows share the same key with different ACTIVE; app upsert
--  matches by content / updates the first row.)

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_history_vcf_period
  ON public.assignment_history (railcar_id, assignment_id_ext, start_date, end_date)
  NULLS NOT DISTINCT;

COMMENT ON INDEX uq_assignment_history_vcf_period IS
  'VCF assignment-period natural key for monthly upsert (§2.1).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_car_number_history_vcf_remark
  ON public.car_number_history (
    railcar_id,
    COALESCE(old_car_initial, ''),
    old_car_number,
    COALESCE(new_car_initial, ''),
    new_car_number,
    (changed_at AT TIME ZONE 'UTC')::date
  );

COMMENT ON INDEX uq_car_number_history_vcf_remark IS
  'VCF OLD_CAR_* remark natural key for monthly upsert (§2.1).';
