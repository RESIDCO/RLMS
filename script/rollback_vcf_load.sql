-- Rollback one Valid Car File load using vcf_load_* backup tables.
-- Restores previous railcars / assignment_history JSON and deletes only rows
-- inserted by that load. Does not delete pre-existing history.
-- Replace the load_id below with the id from vcf_load_log, then remove the guard.

DO $$
BEGIN
  RAISE EXCEPTION
    'Blocked: rollback only after Bruce signs the load-id. Remove this guard and set v_load_id.';
END
$$;

BEGIN;

DO $$
DECLARE
  v_load_id uuid := '00000000-0000-0000-0000-000000000000'; -- paste vcf_load_log.id
BEGIN
  DELETE FROM public.car_number_history c
  USING public.vcf_load_cnh_insert i
  WHERE i.load_id = v_load_id AND c.id = i.car_number_history_id;

  DELETE FROM public.assignment_history a
  USING public.vcf_load_assignment_insert i
  WHERE i.load_id = v_load_id AND a.id = i.assignment_history_id;

  UPDATE public.assignment_history a
  SET
    assignment_id_ext = b.before->>'assignment_id_ext',
    start_date = NULLIF(b.before->>'start_date', '')::date,
    end_date = NULLIF(b.before->>'end_date', '')::date,
    rider_external_id = b.before->>'rider_external_id',
    assignment_label = b.before->>'assignment_label',
    active = (b.before->>'active')::boolean,
    comment = b.before->>'comment',
    reason = b.before->>'reason',
    moved_at = NULLIF(b.before->>'moved_at', '')::timestamptz,
    moved_by = b.before->>'moved_by'
  FROM public.vcf_load_assignment_backup b
  WHERE b.load_id = v_load_id AND a.id = b.assignment_history_id;

  UPDATE public.railcars r
  SET
    car_type = b.before->>'car_type',
    mechanical_designation = b.before->>'mechanical_designation',
    general_description = b.before->>'general_description',
    lease_type = b.before->>'lease_type',
    managed = b.before->>'managed',
    managed_category = b.before->>'managed_category',
    lining_material = b.before->>'lining_material',
    entity = b.before->>'entity',
    active = (b.before->>'active')::boolean,
    active_status = b.before->>'active_status',
    status = b.before->>'status',
    active_source = b.before->>'active_source',
    rider_external_id = b.before->>'rider_external_id',
    lessee_name = b.before->>'lessee_name',
    assignment_label = b.before->>'assignment_label',
    lease_start_date = NULLIF(b.before->>'lease_start_date', '')::date,
    lease_end_date = NULLIF(b.before->>'lease_end_date', '')::date,
    lease_expiry = NULLIF(b.before->>'lease_expiry', '')::date,
    dot_code = b.before->>'dot_code',
    dot_specification = b.before->>'dot_specification',
    comment_event_note = b.before->>'comment_event_note',
    legacy_valid_car_id = b.before->>'legacy_valid_car_id',
    client_id = b.before->>'client_id',
    cover_sheet = b.before->>'cover_sheet',
    legal_owner = b.before->>'legal_owner',
    update_made = b.before->>'update_made',
    update_needed_next_vcf = b.before->>'update_needed_next_vcf',
    data_source = b.before->>'data_source',
    fleet_status = b.before->>'fleet_status',
    fleet_status_source = b.before->>'fleet_status_source'
  FROM public.vcf_load_railcar_backup b
  WHERE b.load_id = v_load_id AND r.id = b.railcar_id;

  DELETE FROM public.railcars r
  USING public.vcf_load_railcar_insert i
  WHERE i.load_id = v_load_id AND r.id = i.railcar_id;
END
$$;

-- COMMIT;
-- ROLLBACK;
