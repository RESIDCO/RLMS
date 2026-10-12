-- Remark = retire the old identity in place, insert a new active identity.
-- Never deletes a railcars row. Mirrors VCF: retired rows are active=false,
-- status Off-Lease, entity unchanged. Sets active_source=manual on the retired
-- row so a later VCF that still lists the old mark as ACTIVE cannot flip it back
-- (import already skips active/status when active_source=manual). The new row
-- keeps active_source=auto so later VCF can still update active/status.

CREATE OR REPLACE FUNCTION public.remark_railcars(
  p_items jsonb,
  p_reason text,
  p_changed_by text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  item jsonb;
  v_id bigint;
  v_marks text;
  v_num text;
  v_target_key text;
  v_seen text[] := ARRAY[]::text[];
  v_conflicts jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_hit record;
  v_old record;
  v_new_id bigint;
  v_from text;
  v_to text;
  v_reason text;
  v_note text;
  v_day text;
  v_assign_id bigint;
  v_hist_new_id bigint;
  v_new_status text;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No cars to remark');
  END IF;

  v_day := to_char((now() AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD');

  -- Preflight: normalize, require a mark, lock sources, collect every collision.
  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_id := (item->>'id')::bigint;
    v_marks := upper(btrim(coalesce(item->>'reporting_marks', '')));
    v_num := btrim(coalesce(item->>'car_number', ''));

    IF v_id IS NULL OR v_id <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Each item needs a railcar id');
    END IF;
    IF v_marks = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Enter a mark and number (e.g. OFCX 349699)');
    END IF;
    IF v_num !~ '^[0-9]{1,6}$' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', CASE
          WHEN v_num ~ '[^0-9]' THEN 'Car number must be digits only (up to 6 digits).'
          WHEN length(v_num) > 6 THEN 'Car number must be at most 6 digits.'
          ELSE 'Enter a car number'
        END
      );
    END IF;
    v_num := lpad(v_num, 6, '0');
    v_target_key := v_marks || '|' || v_num;

    IF v_target_key = ANY (v_seen) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Two cars in this batch target the same mark and number');
    END IF;
    v_seen := array_append(v_seen, v_target_key);

    SELECT id, reporting_marks, car_number, car_initial, status, fleet_status, entity, active
      INTO v_old
      FROM public.railcars
     WHERE id = v_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Railcar not found');
    END IF;
    IF v_old.active IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'This car is already inactive. Remark starts from an active identity.');
    END IF;

    IF upper(coalesce(v_old.reporting_marks, '')) = v_marks
       AND v_old.car_number = v_num THEN
      RETURN jsonb_build_object('ok', false, 'error', 'New mark/number is the same as the current value');
    END IF;

    SELECT id, reporting_marks, car_number, status, fleet_status, entity, active
      INTO v_hit
      FROM public.railcars
     WHERE reporting_marks = v_marks
       AND car_number = v_num
     FOR UPDATE;
    IF FOUND THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'source_id', v_id,
        'id', v_hit.id,
        'reporting_marks', v_hit.reporting_marks,
        'car_number', v_hit.car_number,
        'status', v_hit.status,
        'fleet_status', v_hit.fleet_status,
        'entity', v_hit.entity,
        'active', v_hit.active
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'conflicts', v_conflicts);
  END IF;

  -- Apply: retire old, insert new. Copy the lease assignment onto the new
  -- car; leave the old assignment (and current_assignment_id) frozen. Closing
  -- the old open assignment_history row records when this identity stopped
  -- being live — the assignment row itself is not moved or deleted.
  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_id := (item->>'id')::bigint;
    v_marks := upper(btrim(item->>'reporting_marks'));
    v_num := lpad(btrim(item->>'car_number'), 6, '0');
    v_assign_id := NULL;

    SELECT * INTO v_old FROM public.railcars WHERE id = v_id;
    v_from := trim(both ' ' FROM concat_ws(' ', v_old.car_initial, v_old.car_number));
    IF v_from = '' THEN
      v_from := trim(both ' ' FROM concat_ws(' ', v_old.reporting_marks, v_old.car_number));
    END IF;
    v_to := v_marks || ' ' || v_num;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL THEN
      v_reason := 'Remarked from ' || v_from || ' to ' || v_to;
    END IF;
    v_note := 'Remarked to ' || v_to || ' on ' || v_day || ' (retired in RLMS)';
    v_new_status := CASE
      WHEN v_old.active AND coalesce(v_old.status, '') <> '' THEN v_old.status
      ELSE 'Active/In-Service'
    END;

    INSERT INTO public.railcars (
      car_number, reporting_marks, car_initial,
      car_type, capacity_cf, tare_weight_lbs, load_limit_lbs, aar_designation,
      dot_specification, built_year, notes, coating, transit_status, transit_label,
      entity, mechanical_designation, general_description, lease_type, managed,
      managed_category, lining_material, sold_to, nbv, oac, oec, rider_external_id,
      lessee_name, data_source, assignment_label, lease_start_date, lease_end_date,
      lease_expiry, monthly_rent_per_car, monthly_depr_per_car, total_bv_rider,
      cars_on_rider_ar, commodity_family, commodity, build_year, lining, dot_code,
      comment_event_note, description, cover_sheet, legal_owner, update_made,
      financial_snapshot_month, estimated_lease_expiry, lease_expiry_snapshot_month,
      build_date, railinc_oec, fleet_status, fleet_status_source, acquisition_batch_id,
      acquisition_date, purchase_price, needs_completion, lease_date_source,
      equipment_type_code, ops_flag, ops_flag_set_at,
      active, status, active_status, active_source
    )
    SELECT
      v_num, v_marks, v_marks,
      car_type, capacity_cf, tare_weight_lbs, load_limit_lbs, aar_designation,
      dot_specification, built_year, notes, coating, transit_status, transit_label,
      entity, mechanical_designation, general_description, lease_type, managed,
      managed_category, lining_material, sold_to, nbv, oac, oec, rider_external_id,
      lessee_name, data_source, assignment_label, lease_start_date, lease_end_date,
      lease_expiry, monthly_rent_per_car, monthly_depr_per_car, total_bv_rider,
      cars_on_rider_ar, commodity_family, commodity, build_year, lining, dot_code,
      comment_event_note, description, cover_sheet, legal_owner, update_made,
      financial_snapshot_month, estimated_lease_expiry, lease_expiry_snapshot_month,
      build_date, railinc_oec, fleet_status, fleet_status_source, acquisition_batch_id,
      acquisition_date, purchase_price, needs_completion, lease_date_source,
      equipment_type_code, ops_flag, ops_flag_set_at,
      true, v_new_status, 'Active', 'auto'
    FROM public.railcars
    WHERE id = v_id
    RETURNING id INTO v_new_id;

    UPDATE public.railcars
       SET active = false,
           status = 'Off-Lease',
           active_status = 'Inactive',
           active_source = 'manual',
           monthly_rent_per_car = NULL,
           monthly_depr_per_car = NULL,
           nbv = NULL,
           oac = NULL,
           oec = NULL,
           total_bv_rider = NULL,
           cars_on_rider_ar = NULL,
           financial_snapshot_month = NULL,
           update_needed_next_vcf = CASE
             WHEN update_needed_next_vcf IS NULL OR btrim(update_needed_next_vcf) = '' THEN v_note
             ELSE update_needed_next_vcf || E'\n' || v_note
           END
     WHERE id = v_id;

    UPDATE public.assignment_history
       SET end_date = (now() AT TIME ZONE 'America/New_York')::date,
           active = false
     WHERE railcar_id = v_id
       AND end_date IS NULL;

    INSERT INTO public.railcar_assignments (
      railcar_id, rider_id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at
    )
    SELECT
      v_new_id, rider_id, fleet_name, sub_lease_number, sublease_expiration_date, assigned_at
    FROM public.railcar_assignments
    WHERE railcar_id = v_id
    RETURNING id INTO v_assign_id;

    IF v_assign_id IS NOT NULL THEN
      UPDATE public.railcars
         SET current_assignment_id = v_assign_id::text
       WHERE id = v_new_id;

      INSERT INTO public.assignment_history (
        railcar_id, to_rider_id, to_fleet_name, moved_at, moved_by, reason,
        rider_external_id, assignment_label, start_date, end_date, active
      )
      SELECT
        v_new_id, ra.rider_id, ra.fleet_name, now(), coalesce(nullif(p_changed_by, ''), 'system'),
        'Remark assignment copy',
        r.rider_external_id, r.assignment_label,
        (now() AT TIME ZONE 'America/New_York')::date, NULL, true
      FROM public.railcar_assignments ra
      JOIN public.railcars r ON r.id = v_new_id
      WHERE ra.id = v_assign_id;
    END IF;

    INSERT INTO public.car_number_history (
      railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number,
      changed_at, changed_by, reason
    ) VALUES (
      v_id,
      v_old.car_initial,
      v_old.car_number,
      v_marks,
      v_num,
      now(),
      coalesce(nullif(p_changed_by, ''), 'system'),
      'Retired, remarked to ' || v_to || CASE WHEN p_reason IS NULL OR btrim(p_reason) = '' THEN '' ELSE '; ' || v_reason END
    );

    INSERT INTO public.car_number_history (
      railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number,
      changed_at, changed_by, reason
    ) VALUES (
      v_new_id,
      v_old.car_initial,
      v_old.car_number,
      v_marks,
      v_num,
      now(),
      coalesce(nullif(p_changed_by, ''), 'system'),
      v_reason
    )
    RETURNING id INTO v_hist_new_id;

    INSERT INTO public.activity_log (
      entity_type, entity_id, railcar_id, action, detail, actor, source,
      occurred_at, source_table, source_id
    ) VALUES (
      'railcar',
      v_new_id,
      v_new_id,
      'mark_change',
      jsonb_strip_nulls(jsonb_build_object(
        'from', v_from,
        'to', v_to,
        'reason', v_reason,
        'retired_id', v_id,
        'new_id', v_new_id
      )),
      coalesce(nullif(p_changed_by, ''), 'system'),
      'ui',
      now(),
      'car_number_history',
      v_hist_new_id
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'old_id', v_id,
      'new_id', v_new_id,
      'old_car_initial', v_old.car_initial,
      'old_car_number', v_old.car_number,
      'new_car_initial', v_marks,
      'new_car_number', v_num,
      'from', v_from,
      'to', v_to,
      'reason', v_reason
    ));
    v_assign_id := NULL;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$fn$;

REVOKE ALL ON FUNCTION public.remark_railcars(jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_railcars(jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_railcars(jsonb, text, text) TO service_role;

COMMENT ON FUNCTION public.remark_railcars(jsonb, text, text) IS
  'Retire old railcar identity (Off-Lease, inactive) and insert a new active row. Copies the lease assignment onto the new id; leaves the old assignment frozen. All-or-none for a batch. Does not delete rows.';
