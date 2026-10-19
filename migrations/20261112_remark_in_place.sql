-- In-place remark tool. Does not replace remark_railcars (retire-and-create),
-- which the car-detail dialog and POST /api/railcars/bulk-change-number still call.
-- This function keeps the railcar id. It updates reporting_marks, car_initial,
-- car_number, and old_car_*, then writes one car_number_history row and one
-- undoable activity_log mark_change row per car, all under one change_group.
-- Active cars only. It does never touch rent_events.

CREATE OR REPLACE FUNCTION public.remark_railcars_in_place(
  p_items jsonb,
  p_reason text,
  p_changed_by text,
  p_actor text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  item jsonb;
  v_id bigint;
  v_old_marks text;
  v_old_num text;
  v_marks text;
  v_num text;
  v_target_key text;
  v_seen_targets text[] := ARRAY[]::text[];
  v_seen_ids bigint[] := ARRAY[]::bigint[];
  v_conflicts jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_old record;
  v_hit record;
  v_group uuid;
  v_reason text;
  v_hist_reason text;
  v_from text;
  v_to text;
  v_cur_mark text;
  n int;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No cars to remark');
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'At most 500 cars per batch');
  END IF;
  IF coalesce(btrim(p_actor), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing actor');
  END IF;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    v_reason := 'Remark in place';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_id := (item->>'id')::bigint;
    v_old_marks := upper(btrim(coalesce(item->>'old_reporting_marks', '')));
    v_old_num := btrim(coalesce(item->>'old_car_number', ''));
    v_marks := upper(btrim(coalesce(item->>'reporting_marks', '')));
    v_num := btrim(coalesce(item->>'car_number', ''));

    IF v_id IS NULL OR v_id <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Each item needs a railcar id');
    END IF;
    IF v_id = ANY (v_seen_ids) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'The same car appears twice in this batch');
    END IF;
    v_seen_ids := array_append(v_seen_ids, v_id);
    IF v_marks = '' OR v_old_marks = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Enter a mark and number (e.g. OFOX 310100)');
    END IF;
    IF v_num !~ '^[0-9]{1,6}$' OR v_old_num !~ '^[0-9]{1,6}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Car number must be digits only (up to 6 digits).');
    END IF;
    v_num := lpad(v_num, 6, '0');
    v_old_num := lpad(v_old_num, 6, '0');
    v_target_key := v_marks || '|' || v_num;
    IF v_target_key = ANY (v_seen_targets) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Two cars in this batch target the same mark and number');
    END IF;
    v_seen_targets := array_append(v_seen_targets, v_target_key);

    SELECT id, reporting_marks, car_initial, car_number, old_car_initial, old_car_number, active
      INTO v_old
      FROM public.railcars
     WHERE id = v_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Railcar not found');
    END IF;
    IF v_old.active IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Inactive cars are skipped and never changed');
    END IF;
    v_cur_mark := upper(btrim(coalesce(nullif(v_old.reporting_marks, ''), v_old.car_initial, '')));
    IF v_cur_mark IS DISTINCT FROM v_old_marks OR v_old.car_number IS DISTINCT FROM v_old_num THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Car identity changed since preview');
    END IF;
    IF v_cur_mark = v_marks AND v_old.car_number = v_num THEN
      RETURN jsonb_build_object('ok', false, 'error', 'New mark/number is the same as the current value');
    END IF;

    SELECT id, reporting_marks, car_number, status, fleet_status, active
      INTO v_hit
      FROM public.railcars
     WHERE reporting_marks = v_marks
       AND car_number = v_num
       AND id <> v_id
     FOR UPDATE;
    IF FOUND THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'source_id', v_id,
        'id', v_hit.id,
        'reporting_marks', v_hit.reporting_marks,
        'car_number', v_hit.car_number,
        'status', v_hit.status,
        'fleet_status', v_hit.fleet_status,
        'active', v_hit.active
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'conflicts', v_conflicts);
  END IF;

  v_group := gen_random_uuid();
  v_hist_reason := v_reason || '; change_group ' || v_group::text;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_id := (item->>'id')::bigint;
    v_old_marks := upper(btrim(item->>'old_reporting_marks'));
    v_old_num := lpad(btrim(item->>'old_car_number'), 6, '0');
    v_marks := upper(btrim(item->>'reporting_marks'));
    v_num := lpad(btrim(item->>'car_number'), 6, '0');

    SELECT id, reporting_marks, car_initial, car_number, old_car_initial, old_car_number
      INTO v_old
      FROM public.railcars
     WHERE id = v_id;

    v_from := v_old_marks || ' ' || v_old_num;
    v_to := v_marks || ' ' || v_num;

    UPDATE public.railcars
       SET reporting_marks = v_marks,
           car_initial = v_marks,
           car_number = v_num,
           old_car_initial = v_old_marks,
           old_car_number = v_old_num
     WHERE id = v_id;

    INSERT INTO public.car_number_history (
      railcar_id, old_car_initial, old_car_number, new_car_initial, new_car_number,
      changed_at, changed_by, reason
    ) VALUES (
      v_id, v_old_marks, v_old_num, v_marks, v_num,
      now(), coalesce(nullif(btrim(p_changed_by), ''), p_actor), v_hist_reason
    );

    INSERT INTO public.activity_log (
      entity_type, entity_id, railcar_id, action, detail, actor, source, occurred_at,
      change_group, table_name, row_pk, before, after, undoable
    ) VALUES (
      'railcar', v_id, v_id, 'mark_change',
      jsonb_build_object('op', 'update', 'from', v_from, 'to', v_to, 'reason', v_reason),
      p_actor, 'ui', now(), v_group, 'railcars', v_id,
      jsonb_build_object(
        'reporting_marks', v_old.reporting_marks,
        'car_initial', v_old.car_initial,
        'car_number', v_old.car_number,
        'old_car_initial', v_old.old_car_initial,
        'old_car_number', v_old.old_car_number
      ),
      jsonb_build_object(
        'reporting_marks', v_marks,
        'car_initial', v_marks,
        'car_number', v_num,
        'old_car_initial', v_old_marks,
        'old_car_number', v_old_num
      ),
      true
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'from', v_from, 'to', v_to
    ));
  END LOOP;

  -- `item` is the loop variable above. Alias the set or Postgres raises
  -- "column reference item is ambiguous" and the whole apply rolls back.
  SELECT count(*) INTO n
    FROM public.railcars r
    JOIN jsonb_array_elements(p_items) AS it(value) ON r.id = (it.value->>'id')::bigint
   WHERE r.reporting_marks = upper(btrim(it.value->>'reporting_marks'))
     AND r.car_number = lpad(btrim(it.value->>'car_number'), 6, '0')
     AND r.active IS TRUE;
  IF n <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'remark in place postcheck failed: % of %', n, jsonb_array_length(p_items);
  END IF;

  RETURN jsonb_build_object('ok', true, 'change_group', v_group, 'results', v_results);
END;
$fn$;

REVOKE ALL ON FUNCTION public.remark_railcars_in_place(jsonb, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remark_railcars_in_place(jsonb, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remark_railcars_in_place(jsonb, text, text, text) TO service_role;

COMMENT ON FUNCTION public.remark_railcars_in_place(jsonb, text, text, text) IS
  'Rename a railcar in place (same id). Active cars only. Writes car_number_history and one undoable mark_change activity row per car under a single change_group. Does not call remark_railcars.';

-- VCF alias matching and prior-mark resolve look up history by the old mark and number.
CREATE INDEX IF NOT EXISTS idx_car_number_history_old_mark_number
  ON public.car_number_history (old_car_initial, old_car_number);

-- Undo still restores railcars from activity_log.before. Also delete the
-- car_number_history rows whose reason names this change_group (the marker
-- written above, and by the 2026-10-19 KCS->OFOX apply).
CREATE OR REPLACE FUNCTION public.rlms_undo_change_group(p_group uuid, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
BEGIN
  IF p_group IS NULL OR coalesce(btrim(p_actor), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_group_or_actor', 'status', 400);
  END IF;
  SELECT min(a.actor), min(a.occurred_at),
    count(*) FILTER (WHERE a.undone_at IS NOT NULL),
    count(*) FILTER (WHERE a.undoable IS NOT TRUE)
  INTO orig_actor, oldest, already, non_ok
  FROM public.activity_log a
  WHERE a.change_group = p_group;
  IF oldest IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'status', 404);
  END IF;
  IF already > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'already_undone', 'status', 409); END IF;
  IF non_ok > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'not_undoable', 'status', 400, 'message', 'Remarks and imports cannot be undone.'); END IF;
  IF orig_actor::text IS DISTINCT FROM p_actor THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden_actor', 'status', 403); END IF;
  IF oldest < now() - interval '24 hours' THEN RETURN jsonb_build_object('ok', false, 'error', 'expired', 'status', 403); END IF;
  FOR rec IN SELECT * FROM public.activity_log WHERE change_group = p_group ORDER BY id DESC LOOP
    tbl := rec.table_name; pk := rec.row_pk;
    IF tbl IS NULL OR pk IS NULL THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'missing table_name or row_pk'));
      CONTINUE;
    END IF;
    IF tbl NOT IN ('railcars', 'car_commitments', 'car_rent_stops', 'program_cars', 'program_car_milestones', 'programs', 'railcar_assignments', 'assignment_history', 'car_status_history', 'car_tags', 'car_lists', 'car_list_members', 'riders', 'master_leases', 'attachments', 'opportunities', 'crm_activities', 'accounts', 'companies', 'company_contacts', 'opportunity_contacts') THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'table not undoable'));
      CONTINUE;
    END IF;
    op := coalesce(rec.detail->>'op', CASE WHEN rec.before IS NULL OR rec.before = '{}'::jsonb THEN 'insert' WHEN rec.after IS NULL OR rec.after = '{}'::jsonb THEN 'delete' ELSE 'update' END);
    IF op = 'insert' AND tbl IN ('accounts', 'companies', 'company_contacts') THEN
      IF public.rlms_referenced_outside_group(tbl, pk, p_group) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'referenced_since', 'status', 409, 'message', 'referenced since');
      END IF;
    END IF;
    IF tbl = 'car_status_history' AND op = 'insert' THEN CONTINUE; END IF;
    IF op <> 'insert' THEN
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', tbl) INTO cur USING pk;
      IF cur IS NULL AND op = 'update' THEN
        conflicts := conflicts || jsonb_build_array(jsonb_build_object('activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'row missing'));
        CONTINUE;
      END IF;
      IF rec.after IS NOT NULL AND rec.after <> '{}'::jsonb THEN
        FOR k IN SELECT jsonb_object_keys(rec.after) LOOP
          IF NOT public.rlms_jsonb_key_matches(cur, rec.after, k) THEN
            conflicts := conflicts || jsonb_build_array(jsonb_build_object('activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', format('changed since (%s)', k)));
            EXIT;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
  IF jsonb_array_length(conflicts) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'status', 409, 'conflicts', conflicts);
  END IF;
  FOR rec IN SELECT * FROM public.activity_log WHERE change_group = p_group ORDER BY id DESC LOOP
    tbl := rec.table_name; pk := rec.row_pk;
    op := coalesce(rec.detail->>'op', CASE WHEN rec.before IS NULL OR rec.before = '{}'::jsonb THEN 'insert' WHEN rec.after IS NULL OR rec.after = '{}'::jsonb THEN 'delete' ELSE 'update' END);
    IF tbl = 'car_status_history' AND op = 'insert' THEN
      INSERT INTO public.car_status_history (car_id, event_type, reason, created_by, from_status, to_status)
      VALUES (coalesce((rec.after->>'car_id')::bigint, rec.railcar_id), 'undo', 'undo change_group', p_actor, rec.after->>'to_status', rec.after->>'from_status');
      restored := restored + 1;
    ELSIF op = 'insert' THEN
      IF tbl = 'car_commitments' THEN UPDATE public.car_commitments SET cleared_at = now() WHERE id = pk AND cleared_at IS NULL;
      ELSIF tbl = 'program_cars' THEN UPDATE public.program_cars SET exited_date = CURRENT_DATE WHERE id = pk AND exited_date IS NULL;
      ELSIF tbl IN ('program_car_milestones', 'car_rent_stops', 'car_tags', 'car_list_members', 'attachments', 'opportunities', 'crm_activities', 'accounts', 'companies', 'company_contacts', 'opportunity_contacts') THEN EXECUTE format('DELETE FROM public.%I WHERE id = $1', tbl) USING pk;
      ELSIF tbl = 'railcars' THEN NULL;
      ELSE PERFORM public.rlms_apply_jsonb_patch(tbl, pk, rec.before);
      END IF;
      restored := restored + 1;
    ELSIF op = 'delete' THEN
      IF tbl = 'car_commitments' THEN UPDATE public.car_commitments SET cleared_at = NULL WHERE id = pk;
      ELSIF tbl = 'program_cars' THEN UPDATE public.program_cars SET exited_date = NULL WHERE id = pk;
      ELSE PERFORM public.rlms_apply_jsonb_patch(tbl, pk, rec.before);
      END IF;
      restored := restored + 1;
    ELSE
      PERFORM public.rlms_apply_jsonb_patch(tbl, pk, rec.before);
      restored := restored + 1;
    END IF;
    INSERT INTO public.activity_log (entity_type, entity_id, action, actor, railcar_id, rider_id, detail, source, occurred_at, change_group, table_name, row_pk, before, after, undoable, undo_of)
    VALUES (rec.entity_type, rec.entity_id, 'undo', p_actor, rec.railcar_id, rec.rider_id, jsonb_build_object('op', 'update', 'undid', rec.action, 'original_group', p_group::text), 'undo', now(), undo_group, rec.table_name, rec.row_pk, rec.after, rec.before, false, rec.id);
  END LOOP;

  DELETE FROM public.car_number_history AS h
   WHERE h.reason LIKE '%change_group ' || p_group::text
     AND h.railcar_id IN (
       SELECT a.railcar_id
         FROM public.activity_log AS a
        WHERE a.change_group = p_group
          AND a.railcar_id IS NOT NULL
     );
  GET DIAGNOSTICS hist_removed = ROW_COUNT;

  UPDATE public.activity_log SET undone_at = now(), undone_by = p_actor WHERE change_group = p_group;
  RETURN jsonb_build_object(
    'ok', true,
    'restored', restored,
    'history_removed', hist_removed,
    'undo_group', undo_group,
    'original_group', p_group
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rlms_undo_change_group(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_undo_change_group(uuid, text) TO service_role;
