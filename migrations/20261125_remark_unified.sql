-- Unified remark. One transaction for every remark entry point.
-- Repo only. Do not apply to production from this change.
--
-- Does not create tables or views, so there is nothing to mark security_invoker.
-- New functions are SECURITY DEFINER, search_path public, EXECUTE granted to
-- service_role only.
--
-- Does not replace the frozen functions:
--   rlms_apply_jsonb_patch, rlms_undo_change_group,
--   rlms_referenced_outside_group, rlms_fk_outside_group.
-- Undo of a remark goes through rlms_undo_remark_group. It calls
-- rlms_referenced_outside_group and rlms_fk_outside_group and does not
-- replace them. rlms_fk_outside_group only accepts CRM tables; for a railcar
-- child it raises "referenced-since: table … is not checked". The remark
-- undo catches that and applies the same "row id is not in this change
-- group" predicate itself. A direct call to rlms_undo_change_group refuses
-- the group (car_number_history is not an undoable table) and writes nothing.
--
-- Undo deletes the inserted railcar only after every logged child has been
-- moved or deleted. If anything outside the change group still references
-- the new id (program membership, rent stop, tag, list item, assignment,
-- assignment history, and the other children below), undo returns a 409 and
-- writes nothing. Deleting the railcar would CASCADE program_cars,
-- car_rent_stops, car_tags, car_list_members, car_number_history,
-- car_status_history, and rent_events. car_number_history rows this remark
-- inserted are deleted by the logged row id only.
--
-- Tables written by remark_railcars_apply:
--   railcars                  old row deactivated (lease/rent columns kept);
--                             new row inserted with those columns copied
--   railcar_assignments       one copy on the new id; old row left in place
--   assignment_history        open periods on the old id closed; one open
--                             period inserted on the new id when an assignment
--                             was copied
--   program_cars              railcar_id moved to the new id
--   car_commitments           railcar_id moved to the new id
--   car_rent_stops            railcar_id moved; assignment_id follows the copy
--   car_tags                  railcar_id moved
--   car_list_members          railcar_id moved
--   attachments               entity railcar rows moved to the new id
--   car_number_history        one row on the new id, reason names the change_group
--   activity_log              one undoable mark_change group, actor = p_actor
--
-- Not written (and not deleted):
--   rent_events               stay on the retired railcar id (car_id). The new
--                             active car is a different id. Lineage is the
--                             car_number_history row on the new id (old mark ->
--                             new mark). Deleting the retired row would CASCADE
--                             rent_events; this function never deletes a railcar
--                             that existed before the remark. Undo deletes only
--                             the railcar id this remark inserted, and only when
--                             that id has no remaining references. A child
--                             row logged in the change group is restored
--                             first. A child row that is not in the group
--                             blocks the undo.
--   car_status_history        stays on the retired id
--   railcar_ab_items          stays on the retired id
--   dv_calculations           stays on the retired id
--   program_activity          stays on the retired id
--   closed assignment_history stays on the retired id
--
-- VCF (server/vcf-commit.ts) matches railcars by mark+number before it consults
-- remark aliases. After this remark the old mark is a real inactive row
-- (active=false, active_source=manual, status Off-Lease), so the alias is not
-- used. skipVcfRailcarPatch refuses to update that row, which stops the file
-- from resurrecting the old identity. It also stops the file from applying an
-- old-mark row onto the successor. The successor is updated only when the file
-- contains the new mark.

begin;

CREATE OR REPLACE FUNCTION public.remark_capture(
  p_group uuid,
  p_actor text,
  p_railcar_id bigint,
  p_entity_id bigint,
  p_table text,
  p_pk bigint,
  p_op text,
  p_before jsonb,
  p_after jsonb,
  p_detail jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
BEGIN
  INSERT INTO public.activity_log (
    entity_type, entity_id, railcar_id, action, detail, actor, source, occurred_at,
    change_group, table_name, row_pk, before, after, undoable
  ) VALUES (
    'railcar',
    p_entity_id,
    p_railcar_id,
    'mark_change',
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('op', p_op, 'source', 'remark'),
    p_actor,
    'ui',
    now(),
    p_group,
    p_table,
    p_pk,
    coalesce(p_before, '{}'::jsonb),
    coalesce(p_after, '{}'::jsonb),
    true
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.remark_insert_record(
  p_table text,
  p_row jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  col_list text;
  select_list text;
  v_id bigint;
BEGIN
  IF p_table NOT IN ('railcars', 'railcar_assignments') THEN
    RAISE EXCEPTION 'remark insert table %', p_table;
  END IF;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
         string_agg(format('src.%I', a.attname), ', ' ORDER BY a.attnum)
    INTO col_list, select_list
    FROM pg_attribute a
   WHERE a.attrelid = format('public.%I', p_table)::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attname NOT IN ('id', 'created_at', 'updated_at')
     AND a.attidentity = ''
     AND a.attgenerated = '';
  EXECUTE format(
    'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) AS src RETURNING id',
    p_table, col_list, select_list, p_table
  ) USING p_row INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.remark_repoint_railcar(
  p_table text,
  p_from bigint,
  p_to bigint,
  p_group uuid,
  p_actor text,
  p_old_id bigint,
  p_new_id bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  rec record;
BEGIN
  IF p_table NOT IN ('program_cars', 'car_commitments', 'car_tags', 'car_list_members') THEN
    RAISE EXCEPTION 'remark repoint table %', p_table;
  END IF;
  FOR rec IN EXECUTE format(
    'SELECT id, railcar_id FROM public.%I WHERE railcar_id = $1 FOR UPDATE',
    p_table
  ) USING p_from
  LOOP
    EXECUTE format('UPDATE public.%I SET railcar_id = $1 WHERE id = $2', p_table)
      USING p_to, rec.id;
    PERFORM public.remark_capture(
      p_group, p_actor, p_new_id, p_new_id, p_table, rec.id, 'update',
      jsonb_build_object('railcar_id', rec.railcar_id),
      jsonb_build_object('railcar_id', p_to),
      jsonb_build_object('old_id', p_old_id, 'new_id', p_new_id)
    );
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.remark_railcars_apply(
  p_items jsonb,
  p_reason text,
  p_changed_by text,
  p_actor text,
  p_change_group uuid DEFAULT NULL
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
  v_old_marks text;
  v_old_num text;
  v_target_key text;
  v_seen_targets text[] := ARRAY[]::text[];
  v_seen_ids bigint[] := ARRAY[]::bigint[];
  v_conflicts jsonb := '[]'::jsonb;
  v_messages text[] := ARRAY[]::text[];
  v_results jsonb := '[]'::jsonb;
  v_old public.railcars%ROWTYPE;
  v_hit record;
  v_group uuid;
  v_actor text;
  v_by text;
  v_reason text;
  v_from text;
  v_to text;
  v_note text;
  v_day date;
  v_row jsonb;
  v_new_id bigint;
  v_assign_id bigint;
  v_old_assign_id bigint;
  v_asg jsonb;
  v_hist_id bigint;
  v_cur_mark text;
  ah record;
  stop record;
  att record;
  v_stop_assign bigint;
  v_note_next text;
  n int;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No cars to remark');
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'At most 500 cars per batch');
  END IF;
  v_actor := nullif(btrim(coalesce(p_actor, '')), '');
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing actor');
  END IF;
  v_by := coalesce(nullif(btrim(coalesce(p_changed_by, '')), ''), v_actor);
  v_day := (now() AT TIME ZONE 'America/New_York')::date;
  v_group := coalesce(p_change_group, gen_random_uuid());

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_id := (item->>'id')::bigint;
    v_marks := upper(btrim(coalesce(item->>'reporting_marks', '')));
    v_num := btrim(coalesce(item->>'car_number', ''));
    v_old_marks := upper(btrim(coalesce(item->>'old_reporting_marks', '')));
    v_old_num := btrim(coalesce(item->>'old_car_number', ''));

    IF v_id IS NULL OR v_id <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Each item needs a railcar id');
    END IF;
    IF v_id = ANY (v_seen_ids) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'The same car appears twice in this batch');
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);
    IF v_marks = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Enter a mark and number (e.g. OFCX 349699)');
    END IF;
    IF v_num !~ '^[0-9]{1,6}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Car number must be digits only (up to 6 digits).');
    END IF;
    v_num := lpad(v_num, 6, '0');
    IF v_old_marks <> '' OR v_old_num <> '' THEN
      IF v_old_marks = '' OR v_old_num !~ '^[0-9]{1,6}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Car number must be digits only (up to 6 digits).');
      END IF;
      v_old_num := lpad(v_old_num, 6, '0');
    END IF;
    v_target_key := v_marks || '|' || v_num;
    IF v_target_key = ANY (v_seen_targets) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Two cars in this batch target the same mark and number');
    END IF;
    v_seen_targets := array_append(v_seen_targets, v_target_key);

    SELECT * INTO v_old FROM public.railcars WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Railcar not found');
    END IF;
    IF v_old.active IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Only an active car can be remarked. This car is already inactive.');
    END IF;
    v_cur_mark := upper(btrim(coalesce(nullif(v_old.reporting_marks, ''), v_old.car_initial, '')));
    IF v_old_marks <> '' AND (v_cur_mark IS DISTINCT FROM v_old_marks OR v_old.car_number IS DISTINCT FROM v_old_num) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Car identity changed since preview');
    END IF;
    IF v_cur_mark = v_marks AND v_old.car_number = v_num THEN
      RETURN jsonb_build_object('ok', false, 'error', 'New mark/number is the same as the current value');
    END IF;

    SELECT id, reporting_marks, car_number, status, fleet_status, entity, active
      INTO v_hit
      FROM public.railcars
     WHERE reporting_marks = v_marks
       AND car_number = v_num
       AND id <> v_id
     FOR UPDATE;
    IF FOUND THEN
      v_messages := array_append(v_messages, format(
        'Target %s %s already exists as an %s car (record %s). Remark will not merge into it.',
        v_hit.reporting_marks,
        v_hit.car_number,
        CASE WHEN v_hit.active IS TRUE THEN 'active' ELSE 'inactive' END,
        v_hit.id
      ));
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
    RETURN jsonb_build_object(
      'ok', false,
      'error', array_to_string(v_messages, E'\n'),
      'conflicts', v_conflicts
    );
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_id := (item->>'id')::bigint;
    v_marks := upper(btrim(item->>'reporting_marks'));
    v_num := lpad(btrim(item->>'car_number'), 6, '0');
    v_assign_id := NULL;
    v_old_assign_id := NULL;

    SELECT * INTO v_old FROM public.railcars WHERE id = v_id;
    v_from := trim(both ' ' FROM concat_ws(' ', coalesce(nullif(v_old.car_initial, ''), v_old.reporting_marks), v_old.car_number));
    v_to := v_marks || ' ' || v_num;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL THEN
      v_reason := 'Remarked from ' || v_from || ' to ' || v_to;
    END IF;
    v_note := 'Remarked to ' || v_to || ' on ' || to_char(v_day, 'YYYY-MM-DD') || ' (retired in RLMS)';
    v_note_next := CASE
      WHEN v_old.update_needed_next_vcf IS NULL OR btrim(v_old.update_needed_next_vcf) = '' THEN v_note
      ELSE v_old.update_needed_next_vcf || E'\n' || v_note
    END;

    v_row := to_jsonb(v_old) - 'id' - 'created_at' - 'updated_at';
    v_row := v_row || jsonb_build_object(
      'reporting_marks', v_marks,
      'car_initial', v_marks,
      'car_number', v_num,
      'old_car_initial', coalesce(nullif(v_old.car_initial, ''), v_old.reporting_marks),
      'old_car_number', v_old.car_number,
      'active', true,
      'active_status', 'Active',
      'active_source', 'auto',
      'current_assignment_id', NULL
    );
    v_new_id := public.remark_insert_record('railcars', v_row);

    UPDATE public.railcars
       SET active = false,
           status = 'Off-Lease',
           active_status = 'Inactive',
           active_source = 'manual',
           update_needed_next_vcf = v_note_next
     WHERE id = v_id;

    PERFORM public.remark_capture(
      v_group, v_actor, v_id, v_id, 'railcars', v_id, 'update',
      jsonb_build_object(
        'active', v_old.active,
        'status', v_old.status,
        'active_status', v_old.active_status,
        'active_source', v_old.active_source,
        'update_needed_next_vcf', v_old.update_needed_next_vcf
      ),
      jsonb_build_object(
        'active', false,
        'status', 'Off-Lease',
        'active_status', 'Inactive',
        'active_source', 'manual',
        'update_needed_next_vcf', v_note_next
      ),
      jsonb_build_object('from', v_from, 'to', v_to, 'reason', v_reason, 'old_id', v_id, 'new_id', v_new_id)
    );

    FOR ah IN
      SELECT id, end_date, active
        FROM public.assignment_history
       WHERE railcar_id = v_id
         AND end_date IS NULL
       FOR UPDATE
    LOOP
      UPDATE public.assignment_history
         SET end_date = v_day,
             active = false
       WHERE id = ah.id;
      PERFORM public.remark_capture(
        v_group, v_actor, v_new_id, v_new_id, 'assignment_history', ah.id, 'update',
        jsonb_build_object('end_date', ah.end_date, 'active', ah.active),
        jsonb_build_object('end_date', v_day, 'active', false),
        jsonb_build_object('from', v_from, 'to', v_to, 'reason', v_reason, 'old_id', v_id, 'new_id', v_new_id)
      );
    END LOOP;

    SELECT a.id, to_jsonb(a) - 'id'
      INTO v_old_assign_id, v_asg
      FROM public.railcar_assignments a
     WHERE a.railcar_id = v_id
     FOR UPDATE;
    IF v_asg IS NOT NULL THEN
      v_asg := v_asg || jsonb_build_object('railcar_id', v_new_id);
      v_assign_id := public.remark_insert_record('railcar_assignments', v_asg);
      UPDATE public.railcars
         SET current_assignment_id = v_assign_id::text
       WHERE id = v_new_id;
      PERFORM public.remark_capture(
        v_group, v_actor, v_new_id, v_new_id, 'railcar_assignments', v_assign_id, 'insert',
        '{}'::jsonb,
        jsonb_build_object('railcar_id', v_new_id),
        jsonb_build_object('from', v_from, 'to', v_to, 'reason', v_reason, 'old_id', v_id, 'new_id', v_new_id)
      );
      PERFORM public.remark_capture(
        v_group, v_actor, v_new_id, v_new_id, 'railcars', v_new_id, 'update',
        jsonb_build_object('current_assignment_id', NULL),
        jsonb_build_object('current_assignment_id', v_assign_id::text),
        jsonb_build_object('from', v_from, 'to', v_to, 'reason', v_reason, 'old_id', v_id, 'new_id', v_new_id)
      );
      INSERT INTO public.assignment_history (
        railcar_id, to_rider_id, to_fleet_name, moved_at, moved_by, reason,
        rider_external_id, assignment_label, start_date, end_date, active
      )
      SELECT
        v_new_id, ra.rider_id, ra.fleet_name, now(), v_by,
        'Remark assignment copy',
        r.rider_external_id, r.assignment_label,
        v_day, NULL, true
      FROM public.railcar_assignments ra
      JOIN public.railcars r ON r.id = v_new_id
      WHERE ra.id = v_assign_id
      RETURNING id INTO v_hist_id;
      PERFORM public.remark_capture(
        v_group, v_actor, v_new_id, v_new_id, 'assignment_history', v_hist_id, 'insert',
        '{}'::jsonb,
        jsonb_build_object('railcar_id', v_new_id, 'active', true),
        jsonb_build_object('from', v_from, 'to', v_to, 'reason', v_reason, 'old_id', v_id, 'new_id', v_new_id)
      );
    END IF;

    PERFORM public.remark_repoint_railcar('program_cars', v_id, v_new_id, v_group, v_actor, v_id, v_new_id);
    PERFORM public.remark_repoint_railcar('car_commitments', v_id, v_new_id, v_group, v_actor, v_id, v_new_id);
    PERFORM public.remark_repoint_railcar('car_tags', v_id, v_new_id, v_group, v_actor, v_id, v_new_id);
    PERFORM public.remark_repoint_railcar('car_list_members', v_id, v_new_id, v_group, v_actor, v_id, v_new_id);

    FOR stop IN
      SELECT id, railcar_id, assignment_id
        FROM public.car_rent_stops
       WHERE railcar_id = v_id
       FOR UPDATE
    LOOP
      v_stop_assign := CASE
        WHEN v_old_assign_id IS NOT NULL AND stop.assignment_id IS NOT DISTINCT FROM v_old_assign_id THEN v_assign_id
        ELSE stop.assignment_id
      END;
      UPDATE public.car_rent_stops
         SET railcar_id = v_new_id,
             assignment_id = v_stop_assign
       WHERE id = stop.id;
      PERFORM public.remark_capture(
        v_group, v_actor, v_new_id, v_new_id, 'car_rent_stops', stop.id, 'update',
        jsonb_build_object('railcar_id', stop.railcar_id, 'assignment_id', stop.assignment_id),
        jsonb_build_object('railcar_id', v_new_id, 'assignment_id', v_stop_assign),
        jsonb_build_object('from', v_from, 'to', v_to, 'reason', v_reason, 'old_id', v_id, 'new_id', v_new_id)
      );
    END LOOP;

    FOR att IN
      SELECT id, entity_id
        FROM public.attachments
       WHERE entity_type = 'railcar'
         AND entity_id = v_id
       FOR UPDATE
    LOOP
      UPDATE public.attachments SET entity_id = v_new_id WHERE id = att.id;
      PERFORM public.remark_capture(
        v_group, v_actor, v_new_id, v_new_id, 'attachments', att.id, 'update',
        jsonb_build_object('entity_id', att.entity_id),
        jsonb_build_object('entity_id', v_new_id),
        jsonb_build_object('from', v_from, 'to', v_to, 'reason', v_reason, 'old_id', v_id, 'new_id', v_new_id)
      );
    END LOOP;

    INSERT INTO public.car_number_history (
      railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number,
      changed_at, changed_by, reason
    ) VALUES (
      v_new_id,
      coalesce(nullif(v_old.car_initial, ''), v_old.reporting_marks),
      v_old.car_number,
      v_marks,
      v_num,
      now(),
      v_by,
      v_reason || '; change_group ' || v_group::text
    ) RETURNING id INTO v_hist_id;
    PERFORM public.remark_capture(
      v_group, v_actor, v_new_id, v_new_id, 'car_number_history', v_hist_id, 'insert',
      '{}'::jsonb,
      jsonb_build_object(
        'railcar_id', v_new_id,
        'old_car_initial', coalesce(nullif(v_old.car_initial, ''), v_old.reporting_marks),
        'old_car_number', v_old.car_number,
        'new_car_initial', v_marks,
        'new_car_number', v_num
      ),
      jsonb_build_object('from', v_from, 'to', v_to, 'reason', v_reason, 'old_id', v_id, 'new_id', v_new_id)
    );

    PERFORM public.remark_capture(
      v_group, v_actor, v_new_id, v_new_id, 'railcars', v_new_id, 'insert',
      '{}'::jsonb,
      jsonb_build_object(
        'reporting_marks', v_marks,
        'car_initial', v_marks,
        'car_number', v_num,
        'active', true,
        'active_source', 'auto',
        'monthly_rent_per_car', v_old.monthly_rent_per_car,
        'entity', v_old.entity,
        'rider_external_id', v_old.rider_external_id,
        'lease_start_date', v_old.lease_start_date,
        'lease_end_date', v_old.lease_end_date
      ),
      jsonb_build_object('from', v_from, 'to', v_to, 'reason', v_reason, 'old_id', v_id, 'new_id', v_new_id)
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'old_id', v_id,
      'new_id', v_new_id,
      'id', v_new_id,
      'old_car_initial', coalesce(nullif(v_old.car_initial, ''), v_old.reporting_marks),
      'old_car_number', v_old.car_number,
      'new_car_initial', v_marks,
      'new_car_number', v_num,
      'from', v_from,
      'to', v_to,
      'reason', v_reason
    ));
  END LOOP;

  SELECT count(*) INTO n
    FROM public.railcars r
    JOIN jsonb_array_elements(p_items) AS it(value)
      ON r.reporting_marks = upper(btrim(it.value->>'reporting_marks'))
     AND r.car_number = lpad(btrim(it.value->>'car_number'), 6, '0')
   WHERE r.active IS TRUE
     AND r.id <> (it.value->>'id')::bigint;
  IF n <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'remark postcheck failed: % of %', n, jsonb_array_length(p_items);
  END IF;

  RETURN jsonb_build_object('ok', true, 'undoable', true, 'change_group', v_group, 'results', v_results);
END;
$fn$;

-- Old RPC names stay callable and run the same transaction.
CREATE OR REPLACE FUNCTION public.remark_railcars(
  p_items jsonb,
  p_reason text,
  p_changed_by text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT public.remark_railcars_apply(
    p_items,
    p_reason,
    p_changed_by,
    coalesce(nullif(btrim(p_changed_by), ''), 'system'),
    NULL
  );
$fn$;

CREATE OR REPLACE FUNCTION public.remark_railcars_in_place(
  p_items jsonb,
  p_reason text,
  p_changed_by text,
  p_actor text
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $fn$
  SELECT public.remark_railcars_apply(p_items, p_reason, p_changed_by, p_actor, NULL);
$fn$;

-- Row id of a child that points at p_id and is not logged in p_group.
-- Calls rlms_fk_outside_group first. That function raises for railcar
-- children; the handler then uses the same predicate on the railcar allowlist.
CREATE OR REPLACE FUNCTION public.remark_outside_row(
  p_table text,
  p_column text,
  p_id bigint,
  p_group uuid
) RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  hit boolean;
  found bigint;
  msg text;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    hit := public.rlms_fk_outside_group(p_table, p_column, p_id, p_group);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      IF msg NOT LIKE 'referenced-since:%' THEN
        RAISE;
      END IF;
      hit := NULL;
  END;
  IF hit IS FALSE THEN
    RETURN NULL;
  END IF;
  IF hit IS TRUE THEN
    EXECUTE format(
      'SELECT min(t.id) FROM public.%I t
        WHERE t.%I = $1
          AND NOT EXISTS (
            SELECT 1 FROM public.activity_log a
             WHERE a.change_group = $2
               AND a.table_name = %L
               AND a.row_pk = t.id
          )',
      p_table, p_column, p_table
    ) INTO found USING p_id, p_group;
    RETURN found;
  END IF;
  IF p_table = 'activity_log' AND p_column = 'railcar_id' THEN
    SELECT min(t.id) INTO found
      FROM public.activity_log t
     WHERE t.railcar_id = p_id
       AND t.change_group IS DISTINCT FROM p_group;
    RETURN found;
  END IF;
  IF p_table = 'attachments' AND p_column = 'entity_id' THEN
    SELECT min(t.id) INTO found
      FROM public.attachments t
     WHERE t.entity_type = 'railcar'
       AND t.entity_id = p_id
       AND NOT EXISTS (
         SELECT 1 FROM public.activity_log a
          WHERE a.change_group = p_group
            AND a.table_name = 'attachments'
            AND a.row_pk = t.id
       );
    RETURN found;
  END IF;
  IF p_table NOT IN (
    'program_cars', 'car_rent_stops', 'car_tags', 'car_list_members',
    'car_commitments', 'railcar_assignments', 'assignment_history',
    'car_number_history', 'car_status_history', 'railcar_ab_items',
    'dv_calculations', 'program_activity', 'rent_events'
  ) OR p_column NOT IN ('railcar_id', 'car_id') THEN
    RAISE EXCEPTION 'remark undo: table % column % is not checked', p_table, p_column;
  END IF;
  EXECUTE format(
    'SELECT min(t.id) FROM public.%I t
      WHERE t.%I = $1
        AND NOT EXISTS (
          SELECT 1 FROM public.activity_log a
           WHERE a.change_group = $2
             AND a.table_name = %L
             AND a.row_pk = t.id
        )',
    p_table, p_column, p_table
  ) INTO found USING p_id, p_group;
  RETURN found;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.remark_new_car_block_message(p_id bigint, p_group uuid)
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO public
AS $fn$
DECLARE
  spec record;
  found bigint;
BEGIN
  -- activity_log is not in this list. It is ON DELETE SET NULL, and a note
  -- saved with the remark is a later group that still points at the new id.
  -- Treating that as a block would make the remark impossible to undo.
  -- The group's own activity rows are re-pointed to the old id before delete.
  IF public.rlms_referenced_outside_group('railcars', p_id, p_group) THEN
    RETURN 'Undo refused: the new car was referenced after the remark.';
  END IF;
  FOR spec IN
    SELECT * FROM (VALUES
      ('rent_events', 'car_id', 'rent event'),
      ('railcar_assignments', 'railcar_id', 'assignment'),
      ('assignment_history', 'railcar_id', 'assignment history'),
      ('program_cars', 'railcar_id', 'a program membership'),
      ('car_rent_stops', 'railcar_id', 'a rent stop'),
      ('car_tags', 'railcar_id', 'a tag'),
      ('car_list_members', 'railcar_id', 'a list item'),
      ('car_commitments', 'railcar_id', 'a commitment'),
      ('car_number_history', 'railcar_id', 'car number history'),
      ('car_status_history', 'car_id', 'status history'),
      ('railcar_ab_items', 'railcar_id', 'an A/B item'),
      ('dv_calculations', 'railcar_id', 'a DV calculation'),
      ('program_activity', 'railcar_id', 'program activity'),
      ('attachments', 'entity_id', 'an attachment')
    ) AS t(tbl, col, label)
  LOOP
    found := public.remark_outside_row(spec.tbl, spec.col, p_id, p_group);
    IF found IS NULL THEN
      CONTINUE;
    END IF;
    IF spec.label = 'rent event' THEN
      RETURN 'Undo refused: a rent event is attached to the new car. Remark does not delete rent events.';
    ELSIF spec.label = 'assignment' THEN
      RETURN format(
        'Undo refused: an assignment was added on the new car after the remark (record %s). Undo will not delete it.',
        found
      );
    ELSIF spec.label = 'assignment history' THEN
      RETURN format(
        'Undo refused: assignment history was added on the new car after the remark (record %s). Undo will not delete it.',
        found
      );
    ELSE
      RETURN format(
        'Undo refused: %s on the new car is outside this change (record %s). Undo will not delete it.',
        spec.label, found
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn$;

-- Any remaining pointer, including rows this group logged. Used after those
-- rows have been moved or deleted, so a hit means delete would cascade.
CREATE OR REPLACE FUNCTION public.remark_remaining_ref_message(p_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO public
AS $fn$
DECLARE
  spec record;
  found bigint;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('rent_events', 'car_id', 'rent event'),
      ('railcar_assignments', 'railcar_id', 'assignment'),
      ('assignment_history', 'railcar_id', 'assignment history'),
      ('program_cars', 'railcar_id', 'a program membership'),
      ('car_rent_stops', 'railcar_id', 'a rent stop'),
      ('car_tags', 'railcar_id', 'a tag'),
      ('car_list_members', 'railcar_id', 'a list item'),
      ('car_commitments', 'railcar_id', 'a commitment'),
      ('car_number_history', 'railcar_id', 'car number history'),
      ('car_status_history', 'car_id', 'status history'),
      ('railcar_ab_items', 'railcar_id', 'an A/B item'),
      ('dv_calculations', 'railcar_id', 'a DV calculation'),
      ('program_activity', 'railcar_id', 'program activity'),
      ('attachments', 'entity_id', 'an attachment')
    ) AS t(tbl, col, label)
  LOOP
    IF spec.tbl = 'attachments' THEN
      SELECT min(t.id) INTO found
        FROM public.attachments t
       WHERE t.entity_type = 'railcar' AND t.entity_id = p_id;
    ELSE
      EXECUTE format('SELECT min(t.id) FROM public.%I t WHERE t.%I = $1', spec.tbl, spec.col)
        INTO found USING p_id;
    END IF;
    IF found IS NULL THEN
      CONTINUE;
    END IF;
    IF spec.label = 'rent event' THEN
      RETURN 'remark undo blocked: a rent event is attached to the new car. Remark does not delete rent events.';
    ELSIF spec.label = 'assignment history' THEN
      RETURN format(
        'remark undo blocked: assignment history on the new car (record %s) would be removed with the car. Undo will not delete it.',
        found
      );
    ELSIF spec.label = 'assignment' THEN
      RETURN format(
        'remark undo blocked: an assignment on the new car (record %s) would be removed with the car. Undo will not delete it.',
        found
      );
    ELSE
      RETURN format(
        'remark undo blocked: %s on the new car (record %s) would be removed with the car. Undo will not delete it.',
        spec.label, found
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rlms_undo_remark_group(p_group uuid, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public
AS $fn$
DECLARE
  rec record;
  cur jsonb;
  k text;
  undo_group uuid := gen_random_uuid();
  restored int := 0;
  hist_removed int := 0;
  conflicts jsonb := '[]'::jsonb;
  orig_actor text;
  oldest timestamptz;
  already int;
  non_ok int;
  op text;
  tbl text;
  pk bigint;
  new_ids bigint[];
  nid bigint;
  block_msg text;
BEGIN
  IF p_group IS NULL OR coalesce(btrim(p_actor), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_group_or_actor', 'status', 400);
  END IF;
  SELECT min(a.actor), min(a.occurred_at),
    count(*) FILTER (WHERE a.undone_at IS NOT NULL),
    count(*) FILTER (WHERE a.undoable IS NOT TRUE OR a.action IS DISTINCT FROM 'mark_change')
  INTO orig_actor, oldest, already, non_ok
  FROM public.activity_log a
  WHERE a.change_group = p_group;
  IF oldest IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'status', 404);
  END IF;
  IF already > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'already_undone', 'status', 409); END IF;
  IF non_ok > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'not_undoable', 'status', 400); END IF;
  IF orig_actor::text IS DISTINCT FROM p_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_actor', 'status', 403);
  END IF;
  IF oldest < now() - interval '24 hours' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired', 'status', 403);
  END IF;

  SELECT coalesce(array_agg(a.row_pk), ARRAY[]::bigint[])
    INTO new_ids
    FROM public.activity_log a
   WHERE a.change_group = p_group
     AND a.table_name = 'railcars'
     AND a.detail->>'op' = 'insert';
  IF coalesce(array_length(new_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_remark', 'status', 400);
  END IF;

  FOREACH nid IN ARRAY new_ids LOOP
    block_msg := public.remark_new_car_block_message(nid, p_group);
    IF block_msg IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'referenced_since',
        'status', 409,
        'message', block_msg
      );
    END IF;
  END LOOP;

  FOR rec IN SELECT * FROM public.activity_log WHERE change_group = p_group ORDER BY id DESC LOOP
    tbl := rec.table_name;
    pk := rec.row_pk;
    op := coalesce(rec.detail->>'op', '');
    IF tbl IS NULL OR pk IS NULL OR op NOT IN ('insert', 'update') THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'missing table_name or row_pk'
      ));
      CONTINUE;
    END IF;
    IF tbl NOT IN (
      'railcars', 'car_commitments', 'car_rent_stops', 'program_cars', 'railcar_assignments',
      'assignment_history', 'car_tags', 'car_list_members', 'attachments', 'car_number_history'
    ) THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'table not undoable'
      ));
      CONTINUE;
    END IF;
    IF op = 'insert' AND tbl = 'car_number_history' THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', tbl) INTO cur USING pk;
    IF cur IS NULL THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'row missing'
      ));
      CONTINUE;
    END IF;
    IF op = 'insert' AND tbl <> 'railcars' THEN
      CONTINUE;
    END IF;
    IF rec.after IS NOT NULL AND rec.after <> '{}'::jsonb THEN
      FOR k IN SELECT jsonb_object_keys(rec.after) LOOP
        IF NOT public.rlms_jsonb_key_matches(cur, rec.after, k) THEN
          conflicts := conflicts || jsonb_build_array(jsonb_build_object(
            'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', format('changed since (%s)', k)
          ));
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF jsonb_array_length(conflicts) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'status', 409, 'conflicts', conflicts);
  END IF;

  FOR rec IN
    SELECT * FROM public.activity_log
     WHERE change_group = p_group
       AND detail->>'op' = 'update'
     ORDER BY id DESC
  LOOP
    PERFORM public.rlms_apply_jsonb_patch(rec.table_name, rec.row_pk, rec.before);
    restored := restored + 1;
  END LOOP;

  FOR rec IN
    SELECT * FROM public.activity_log
     WHERE change_group = p_group
       AND detail->>'op' = 'insert'
       AND table_name IN ('railcar_assignments', 'assignment_history')
     ORDER BY id DESC
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE id = $1', rec.table_name) USING rec.row_pk;
    restored := restored + 1;
  END LOOP;

  DELETE FROM public.car_number_history h
   WHERE h.id IN (
     SELECT a.row_pk FROM public.activity_log a
      WHERE a.change_group = p_group AND a.table_name = 'car_number_history'
        AND a.row_pk IS NOT NULL
   );
  GET DIAGNOSTICS hist_removed = ROW_COUNT;

  UPDATE public.activity_log a
     SET railcar_id = (a.detail->>'old_id')::bigint
   WHERE a.change_group = p_group
     AND a.railcar_id = ANY (new_ids)
     AND coalesce(a.detail->>'old_id', '') ~ '^[0-9]+$';

  FOREACH nid IN ARRAY new_ids LOOP
    block_msg := public.remark_remaining_ref_message(nid);
    IF block_msg IS NOT NULL THEN
      RAISE EXCEPTION '%', block_msg;
    END IF;
  END LOOP;

  DELETE FROM public.railcars r WHERE r.id = ANY (new_ids);
  restored := restored + coalesce(array_length(new_ids, 1), 0);

  FOR rec IN SELECT * FROM public.activity_log WHERE change_group = p_group ORDER BY id DESC LOOP
    INSERT INTO public.activity_log (
      entity_type, entity_id, action, actor, railcar_id, detail, source, occurred_at,
      change_group, table_name, row_pk, before, after, undoable, undo_of
    ) VALUES (
      rec.entity_type, rec.entity_id, 'undo', p_actor, rec.railcar_id,
      jsonb_build_object('op', 'update', 'undid', rec.action, 'original_group', p_group::text, 'source', 'remark'),
      'undo', now(), undo_group, rec.table_name, rec.row_pk, rec.after, rec.before, false, rec.id
    );
  END LOOP;

  UPDATE public.activity_log
     SET undone_at = now(), undone_by = p_actor
   WHERE change_group = p_group;

  RETURN jsonb_build_object(
    'ok', true,
    'restored', restored,
    'history_removed', hist_removed,
    'undo_group', undo_group,
    'original_group', p_group
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.remark_capture(uuid, text, bigint, bigint, text, bigint, text, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_capture(uuid, text, bigint, bigint, text, bigint, text, jsonb, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_capture(uuid, text, bigint, bigint, text, bigint, text, jsonb, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.remark_insert_record(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_insert_record(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_insert_record(text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.remark_repoint_railcar(text, bigint, bigint, uuid, text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_repoint_railcar(text, bigint, bigint, uuid, text, bigint, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_repoint_railcar(text, bigint, bigint, uuid, text, bigint, bigint) TO service_role;

REVOKE ALL ON FUNCTION public.remark_railcars_apply(jsonb, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_railcars_apply(jsonb, text, text, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_railcars_apply(jsonb, text, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.remark_railcars(jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_railcars(jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_railcars(jsonb, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.remark_railcars_in_place(jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_railcars_in_place(jsonb, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_railcars_in_place(jsonb, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.remark_outside_row(text, text, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_outside_row(text, text, bigint, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_outside_row(text, text, bigint, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.remark_new_car_block_message(bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_new_car_block_message(bigint, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_new_car_block_message(bigint, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.remark_remaining_ref_message(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_remaining_ref_message(bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_remaining_ref_message(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.rlms_undo_remark_group(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rlms_undo_remark_group(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_undo_remark_group(uuid, text) TO service_role;

COMMENT ON FUNCTION public.remark_railcars_apply(jsonb, text, text, text, uuid) IS
  'Retire the current mark as an inactive row and insert the new mark as the active car. Copies lease columns. Moves programs, commitments, rent stops, tags, list membership, and railcar attachments. Does not write rent_events. One undoable change group.';

COMMENT ON FUNCTION public.rlms_undo_remark_group(uuid, text) IS
  'Undo one remark_railcars_apply change group. Refuses when a row outside the group references the new car. Deletes car_number_history by the logged row id only. Deletes only the railcar ids that remark inserted. Leaves rent_events rows unchanged. Calls rlms_referenced_outside_group and rlms_fk_outside_group. Does not replace them or rlms_undo_change_group.';

commit;
