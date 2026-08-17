-- V_Valid Car File export: one joined dataset (history + car attrs + same-day remarks),
-- plus a fallback row for cars with no assignment_history.
-- Safe to re-run. Used by the background job at /api/reports/v-valid-cars/jobs.

CREATE OR REPLACE FUNCTION public.rlms_vcf_lessee(assignment_label text, rider_external_id text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := btrim(coalesce(assignment_label, ''));
  rider text := btrim(coalesce(rider_external_id, ''));
  rid text;
BEGIN
  IF s = '' THEN
    RETURN '';
  END IF;
  IF rider <> '' THEN
    rid := regexp_replace(rider, '([\\[\](){}.+*?^$|])', '\\\1', 'g');
    s := regexp_replace(s, '(?:\s*[-–—]\s*|\s+)' || rid || '\s*$', '', 'i');
    s := regexp_replace(s, rid || '\s*$', '', 'i');
  END IF;
  s := regexp_replace(s, E'[\\s–—-]+$', '');
  RETURN btrim(s);
END;
$$;

CREATE OR REPLACE VIEW public.v_valid_export_rows AS
WITH remarks AS (
  SELECT DISTINCT ON (railcar_id, ((timezone('utc', changed_at))::date))
    railcar_id,
    ((timezone('utc', changed_at))::date) AS remark_date,
    old_car_initial,
    old_car_number
  FROM public.car_number_history
  ORDER BY railcar_id, ((timezone('utc', changed_at))::date), id
)
SELECT
  1::smallint AS export_src,
  ah.id::bigint AS export_id,
  r.car_initial,
  r.car_number,
  r.car_type,
  r.mechanical_designation,
  r.general_description,
  r.dot_code,
  r.lining_material,
  r.lease_type,
  r.managed,
  r.managed_category,
  CASE
    WHEN r.entity = 'Rail Partners Select' THEN 'RPS'
    WHEN lower(r.entity) = 'rps' THEN 'RPS'
    ELSE r.entity
  END AS entity,
  CASE
    WHEN ah.active IS TRUE THEN -1
    WHEN ah.active IS FALSE THEN 0
    ELSE NULL
  END AS active,
  ah.start_date::text AS start_date,
  ah.end_date::text AS end_date,
  ah.rider_external_id AS rider,
  ah.assignment_label AS assignment,
  ah.assignment_id_ext AS assignment_id,
  public.rlms_vcf_lessee(ah.assignment_label, ah.rider_external_id) AS lessee,
  rem.old_car_initial,
  rem.old_car_number,
  r.legal_owner AS owner,
  r.legacy_valid_car_id AS valid_car_id,
  r.client_id,
  r.cover_sheet,
  ah.comment,
  r.update_made,
  r.update_needed_next_vcf
FROM public.assignment_history ah
JOIN public.railcars r ON r.id = ah.railcar_id
LEFT JOIN remarks rem
  ON rem.railcar_id = ah.railcar_id
 AND rem.remark_date = ah.start_date

UNION ALL

SELECT
  2::smallint AS export_src,
  r.id::bigint AS export_id,
  r.car_initial,
  r.car_number,
  r.car_type,
  r.mechanical_designation,
  r.general_description,
  r.dot_code,
  r.lining_material,
  r.lease_type,
  r.managed,
  r.managed_category,
  CASE
    WHEN r.entity = 'Rail Partners Select' THEN 'RPS'
    WHEN lower(r.entity) = 'rps' THEN 'RPS'
    ELSE r.entity
  END AS entity,
  CASE
    WHEN r.active IS TRUE THEN -1
    WHEN r.active IS FALSE THEN 0
    ELSE NULL
  END AS active,
  r.acquisition_date::text AS start_date,
  NULL::text AS end_date,
  r.rider_external_id AS rider,
  r.assignment_label AS assignment,
  NULL::text AS assignment_id,
  r.lessee_name AS lessee,
  NULL::text AS old_car_initial,
  NULL::text AS old_car_number,
  r.legal_owner AS owner,
  r.legacy_valid_car_id AS valid_car_id,
  r.client_id,
  r.cover_sheet,
  NULL::text AS comment,
  r.update_made,
  r.update_needed_next_vcf
FROM public.railcars r
WHERE NOT EXISTS (
  SELECT 1 FROM public.assignment_history ah WHERE ah.railcar_id = r.id
);

GRANT SELECT ON public.v_valid_export_rows TO service_role;
GRANT SELECT ON public.v_valid_export_rows TO authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_vcf_lessee(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rlms_vcf_lessee(text, text) TO authenticated;
