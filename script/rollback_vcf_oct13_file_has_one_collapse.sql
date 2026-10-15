-- Restore the 206 file-has-one extras deleted 2026-10-15.
-- Source of truth: public.assignment_history_vcf_collapse_20261015.
-- Does not touch cars 23602 / 23603. Does not delete anything.

BEGIN;

INSERT INTO public.assignment_history (
  id,
  railcar_id,
  from_rider_id,
  to_rider_id,
  from_fleet_name,
  to_fleet_name,
  moved_at,
  moved_by,
  reason,
  rider_external_id,
  assignment_label,
  start_date,
  end_date,
  active,
  comment,
  assignment_id_ext
)
SELECT
  b.id,
  b.railcar_id,
  b.from_rider_id,
  b.to_rider_id,
  b.from_fleet_name,
  b.to_fleet_name,
  b.moved_at,
  b.moved_by,
  b.reason,
  b.rider_external_id,
  b.assignment_label,
  b.start_date,
  b.end_date,
  b.active,
  b.comment,
  b.assignment_id_ext
FROM public.assignment_history_vcf_collapse_20261015 b
WHERE b.railcar_id NOT IN (23602, 23603)
  AND NOT EXISTS (
    SELECT 1 FROM public.assignment_history ah WHERE ah.id = b.id
  );

SELECT setval(
  pg_get_serial_sequence('public.assignment_history', 'id'),
  (SELECT max(id) FROM public.assignment_history)
);

-- COMMIT;
-- ROLLBACK;
