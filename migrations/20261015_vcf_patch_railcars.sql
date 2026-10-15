-- Set-based Valid Car File railcar patches. Only rows whose patched fields
-- actually differ are updated, so unchanged cars keep their updated_at.

CREATE OR REPLACE FUNCTION public.vcf_patch_railcars(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer := 0;
BEGIN
  UPDATE public.railcars r SET
    car_type = CASE WHEN p.patch ? 'car_type' THEN NULLIF(p.patch->>'car_type', '') ELSE r.car_type END,
    mechanical_designation = CASE WHEN p.patch ? 'mechanical_designation' THEN NULLIF(p.patch->>'mechanical_designation', '') ELSE r.mechanical_designation END,
    general_description = CASE WHEN p.patch ? 'general_description' THEN NULLIF(p.patch->>'general_description', '') ELSE r.general_description END,
    lease_type = CASE WHEN p.patch ? 'lease_type' THEN NULLIF(p.patch->>'lease_type', '') ELSE r.lease_type END,
    managed = CASE WHEN p.patch ? 'managed' THEN NULLIF(p.patch->>'managed', '') ELSE r.managed END,
    managed_category = CASE WHEN p.patch ? 'managed_category' THEN NULLIF(p.patch->>'managed_category', '') ELSE r.managed_category END,
    lining_material = CASE WHEN p.patch ? 'lining_material' THEN NULLIF(p.patch->>'lining_material', '') ELSE r.lining_material END,
    entity = CASE WHEN p.patch ? 'entity' THEN NULLIF(p.patch->>'entity', '') ELSE r.entity END,
    active = CASE WHEN p.patch ? 'active' THEN (p.patch->>'active')::boolean ELSE r.active END,
    active_status = CASE WHEN p.patch ? 'active_status' THEN NULLIF(p.patch->>'active_status', '') ELSE r.active_status END,
    status = CASE WHEN p.patch ? 'status' THEN NULLIF(p.patch->>'status', '') ELSE r.status END,
    active_source = CASE WHEN p.patch ? 'active_source' THEN NULLIF(p.patch->>'active_source', '') ELSE r.active_source END,
    rider_external_id = CASE WHEN p.patch ? 'rider_external_id' THEN NULLIF(p.patch->>'rider_external_id', '') ELSE r.rider_external_id END,
    lessee_name = CASE WHEN p.patch ? 'lessee_name' THEN NULLIF(p.patch->>'lessee_name', '') ELSE r.lessee_name END,
    assignment_label = CASE WHEN p.patch ? 'assignment_label' THEN NULLIF(p.patch->>'assignment_label', '') ELSE r.assignment_label END,
    lease_start_date = CASE WHEN p.patch ? 'lease_start_date' THEN NULLIF(p.patch->>'lease_start_date', '')::date ELSE r.lease_start_date END,
    lease_end_date = CASE WHEN p.patch ? 'lease_end_date' THEN NULLIF(p.patch->>'lease_end_date', '')::date ELSE r.lease_end_date END,
    lease_expiry = CASE WHEN p.patch ? 'lease_expiry' THEN NULLIF(p.patch->>'lease_expiry', '')::date ELSE r.lease_expiry END,
    dot_code = CASE WHEN p.patch ? 'dot_code' THEN NULLIF(p.patch->>'dot_code', '') ELSE r.dot_code END,
    dot_specification = CASE WHEN p.patch ? 'dot_specification' THEN NULLIF(p.patch->>'dot_specification', '') ELSE r.dot_specification END,
    comment_event_note = CASE WHEN p.patch ? 'comment_event_note' THEN NULLIF(p.patch->>'comment_event_note', '') ELSE r.comment_event_note END,
    legacy_valid_car_id = CASE WHEN p.patch ? 'legacy_valid_car_id' THEN NULLIF(p.patch->>'legacy_valid_car_id', '') ELSE r.legacy_valid_car_id END,
    client_id = CASE WHEN p.patch ? 'client_id' THEN NULLIF(p.patch->>'client_id', '') ELSE r.client_id END,
    cover_sheet = CASE WHEN p.patch ? 'cover_sheet' THEN NULLIF(p.patch->>'cover_sheet', '') ELSE r.cover_sheet END,
    legal_owner = CASE WHEN p.patch ? 'legal_owner' THEN NULLIF(p.patch->>'legal_owner', '') ELSE r.legal_owner END,
    update_made = CASE WHEN p.patch ? 'update_made' THEN NULLIF(p.patch->>'update_made', '') ELSE r.update_made END,
    update_needed_next_vcf = CASE WHEN p.patch ? 'update_needed_next_vcf' THEN NULLIF(p.patch->>'update_needed_next_vcf', '') ELSE r.update_needed_next_vcf END,
    data_source = CASE WHEN p.patch ? 'data_source' THEN NULLIF(p.patch->>'data_source', '') ELSE r.data_source END,
    fleet_status = CASE WHEN p.patch ? 'fleet_status' THEN NULLIF(p.patch->>'fleet_status', '') ELSE r.fleet_status END,
    fleet_status_source = CASE WHEN p.patch ? 'fleet_status_source' THEN NULLIF(p.patch->>'fleet_status_source', '') ELSE r.fleet_status_source END
  FROM jsonb_to_recordset(p_rows) AS p(id bigint, patch jsonb)
  WHERE r.id = p.id
    AND (
      (p.patch ? 'car_type' AND r.car_type IS DISTINCT FROM NULLIF(p.patch->>'car_type', ''))
      OR (p.patch ? 'mechanical_designation' AND r.mechanical_designation IS DISTINCT FROM NULLIF(p.patch->>'mechanical_designation', ''))
      OR (p.patch ? 'general_description' AND r.general_description IS DISTINCT FROM NULLIF(p.patch->>'general_description', ''))
      OR (p.patch ? 'lease_type' AND r.lease_type IS DISTINCT FROM NULLIF(p.patch->>'lease_type', ''))
      OR (p.patch ? 'managed' AND r.managed IS DISTINCT FROM NULLIF(p.patch->>'managed', ''))
      OR (p.patch ? 'managed_category' AND r.managed_category IS DISTINCT FROM NULLIF(p.patch->>'managed_category', ''))
      OR (p.patch ? 'lining_material' AND r.lining_material IS DISTINCT FROM NULLIF(p.patch->>'lining_material', ''))
      OR (p.patch ? 'entity' AND r.entity IS DISTINCT FROM NULLIF(p.patch->>'entity', ''))
      OR (p.patch ? 'active' AND r.active IS DISTINCT FROM (p.patch->>'active')::boolean)
      OR (p.patch ? 'active_status' AND r.active_status IS DISTINCT FROM NULLIF(p.patch->>'active_status', ''))
      OR (p.patch ? 'status' AND r.status IS DISTINCT FROM NULLIF(p.patch->>'status', ''))
      OR (p.patch ? 'active_source' AND r.active_source IS DISTINCT FROM NULLIF(p.patch->>'active_source', ''))
      OR (p.patch ? 'rider_external_id' AND r.rider_external_id IS DISTINCT FROM NULLIF(p.patch->>'rider_external_id', ''))
      OR (p.patch ? 'lessee_name' AND r.lessee_name IS DISTINCT FROM NULLIF(p.patch->>'lessee_name', ''))
      OR (p.patch ? 'assignment_label' AND r.assignment_label IS DISTINCT FROM NULLIF(p.patch->>'assignment_label', ''))
      OR (p.patch ? 'lease_start_date' AND r.lease_start_date IS DISTINCT FROM NULLIF(p.patch->>'lease_start_date', '')::date)
      OR (p.patch ? 'lease_end_date' AND r.lease_end_date IS DISTINCT FROM NULLIF(p.patch->>'lease_end_date', '')::date)
      OR (p.patch ? 'lease_expiry' AND r.lease_expiry IS DISTINCT FROM NULLIF(p.patch->>'lease_expiry', '')::date)
      OR (p.patch ? 'dot_code' AND r.dot_code IS DISTINCT FROM NULLIF(p.patch->>'dot_code', ''))
      OR (p.patch ? 'dot_specification' AND r.dot_specification IS DISTINCT FROM NULLIF(p.patch->>'dot_specification', ''))
      OR (p.patch ? 'comment_event_note' AND r.comment_event_note IS DISTINCT FROM NULLIF(p.patch->>'comment_event_note', ''))
      OR (p.patch ? 'legacy_valid_car_id' AND r.legacy_valid_car_id IS DISTINCT FROM NULLIF(p.patch->>'legacy_valid_car_id', ''))
      OR (p.patch ? 'client_id' AND r.client_id IS DISTINCT FROM NULLIF(p.patch->>'client_id', ''))
      OR (p.patch ? 'cover_sheet' AND r.cover_sheet IS DISTINCT FROM NULLIF(p.patch->>'cover_sheet', ''))
      OR (p.patch ? 'legal_owner' AND r.legal_owner IS DISTINCT FROM NULLIF(p.patch->>'legal_owner', ''))
      OR (p.patch ? 'update_made' AND r.update_made IS DISTINCT FROM NULLIF(p.patch->>'update_made', ''))
      OR (p.patch ? 'update_needed_next_vcf' AND r.update_needed_next_vcf IS DISTINCT FROM NULLIF(p.patch->>'update_needed_next_vcf', ''))
      OR (p.patch ? 'data_source' AND r.data_source IS DISTINCT FROM NULLIF(p.patch->>'data_source', ''))
      OR (p.patch ? 'fleet_status' AND r.fleet_status IS DISTINCT FROM NULLIF(p.patch->>'fleet_status', ''))
      OR (p.patch ? 'fleet_status_source' AND r.fleet_status_source IS DISTINCT FROM NULLIF(p.patch->>'fleet_status_source', ''))
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vcf_patch_railcars(jsonb) TO service_role;
