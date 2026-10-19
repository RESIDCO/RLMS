-- Inactivate cars in one transaction.
-- Does not change existing rows until the function is called.
-- Closes an open assignment_history row only when asked. No other child table is written.
-- Only the status Inactive is applied here, and only to the ids passed in.
-- Undo uses the existing rlms_undo_change_group (railcars + assignment_history
-- patch, and a compensating car_status_history row). This file does not
-- replace that function.
-- Bruce applies this only after sign-off. It has not been applied by the change
-- that added the file.

CREATE OR REPLACE FUNCTION public.inactivate_railcars(
  p_ids jsonb,
  p_reason text,
  p_actor text,
  p_changed_by text,
  p_close_assignment boolean,
  p_end_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_ids bigint[];
  v_id bigint;
  v_reason text;
  v_actor text;
  v_by text;
  v_group uuid;
  v_car record;
  v_ah record;
  v_hist_id bigint;
  v_n int;
  v_closed int := 0;
  v_missing int;
  v_frozen int;
BEGIN
  IF p_ids IS NULL OR jsonb_typeof(p_ids) <> 'array' OR jsonb_array_length(p_ids) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No cars to inactivate');
  END IF;
  IF jsonb_array_length(p_ids) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'At most 500 cars per batch');
  END IF;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor := nullif(btrim(coalesce(p_actor, '')), '');
  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A reason is required');
  END IF;
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing actor');
  END IF;
  IF coalesce(p_close_assignment, false) AND p_end_date IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter an assignment end date');
  END IF;

  SELECT coalesce(array_agg(DISTINCT x.id), ARRAY[]::bigint[])
    INTO v_ids
    FROM (
      SELECT (value #>> '{}')::bigint AS id
        FROM jsonb_array_elements(p_ids)
    ) AS x
   WHERE x.id IS NOT NULL AND x.id > 0;
  IF coalesce(array_length(v_ids, 1), 0) <> jsonb_array_length(p_ids) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Each car id must be a positive number, once');
  END IF;

  PERFORM 1 FROM public.railcars WHERE id = ANY (v_ids) FOR UPDATE;
  SELECT count(*) INTO v_missing FROM unnest(v_ids) AS wanted(id)
   WHERE NOT EXISTS (SELECT 1 FROM public.railcars r WHERE r.id = wanted.id);
  IF v_missing > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Railcar not found');
  END IF;

  SELECT count(*) INTO v_frozen
    FROM public.railcars r
   WHERE r.id = ANY (v_ids)
     AND (r.active IS NOT TRUE OR btrim(coalesce(r.status, '')) = 'Inactive');
  IF v_frozen > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Already inactive cars are left unchanged');
  END IF;

  IF NOT coalesce(p_close_assignment, false) AND EXISTS (
    SELECT 1 FROM public.assignment_history ah
     WHERE ah.railcar_id = ANY (v_ids) AND ah.end_date IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'An open assignment is still on a car in this batch');
  END IF;

  v_group := gen_random_uuid();
  v_by := coalesce(nullif(btrim(p_changed_by), ''), v_actor);

  FOREACH v_id IN ARRAY v_ids
  LOOP
    SELECT id, status, active, active_status, active_source
      INTO v_car
      FROM public.railcars
     WHERE id = v_id;

    UPDATE public.railcars
       SET status = 'Inactive',
           active = false,
           active_status = 'Inactive',
           active_source = 'manual'
     WHERE id = v_id;

    INSERT INTO public.car_status_history (
      car_id, event_type, reason, created_by, from_status, to_status
    ) VALUES (
      v_id, 'marked_inactive', v_reason, v_by, v_car.status, 'Inactive'
    ) RETURNING id INTO v_hist_id;

    INSERT INTO public.activity_log (
      entity_type, entity_id, railcar_id, action, detail, actor, source, occurred_at,
      change_group, table_name, row_pk, before, after, undoable
    ) VALUES (
      'railcar', v_id, v_id, 'status_change',
      jsonb_build_object('op', 'update', 'from', v_car.status, 'to', 'Inactive', 'reason', v_reason),
      v_actor, 'ui', now(), v_group, 'railcars', v_id,
      jsonb_build_object(
        'status', v_car.status,
        'active', v_car.active,
        'active_status', v_car.active_status,
        'active_source', v_car.active_source
      ),
      jsonb_build_object(
        'status', 'Inactive',
        'active', false,
        'active_status', 'Inactive',
        'active_source', 'manual'
      ),
      true
    );

    INSERT INTO public.activity_log (
      entity_type, entity_id, railcar_id, action, detail, actor, source, occurred_at,
      change_group, table_name, row_pk, before, after, undoable
    ) VALUES (
      'railcar', v_id, v_id, 'status_change',
      jsonb_build_object(
        'op', 'insert',
        'event_type', 'marked_inactive',
        'from', v_car.status,
        'to', 'Inactive',
        'reason', v_reason
      ),
      v_actor, 'ui', now(), v_group, 'car_status_history', v_hist_id,
      '{}'::jsonb,
      jsonb_build_object(
        'car_id', v_id,
        'from_status', v_car.status,
        'to_status', 'Inactive',
        'event_type', 'marked_inactive',
        'reason', v_reason
      ),
      true
    );

    IF coalesce(p_close_assignment, false) THEN
      FOR v_ah IN
        SELECT id, end_date, active
          FROM public.assignment_history
         WHERE railcar_id = v_id AND end_date IS NULL
         ORDER BY id
         FOR UPDATE
      LOOP
        UPDATE public.assignment_history
           SET end_date = p_end_date,
               active = false
         WHERE id = v_ah.id;
        INSERT INTO public.activity_log (
          entity_type, entity_id, railcar_id, action, detail, actor, source, occurred_at,
          change_group, table_name, row_pk, before, after, undoable
        ) VALUES (
          'railcar', v_id, v_id, 'end_assignment',
          jsonb_build_object('op', 'update', 'reason', v_reason),
          v_actor, 'ui', now(), v_group, 'assignment_history', v_ah.id,
          jsonb_build_object('end_date', v_ah.end_date, 'active', v_ah.active),
          jsonb_build_object('end_date', p_end_date, 'active', false),
          true
        );
        v_closed := v_closed + 1;
      END LOOP;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n
    FROM public.railcars r
   WHERE r.id = ANY (v_ids)
     AND r.status = 'Inactive'
     AND r.active IS FALSE
     AND r.active_status = 'Inactive'
     AND r.active_source = 'manual';
  IF v_n <> coalesce(array_length(v_ids, 1), 0) THEN
    RAISE EXCEPTION 'inactivate postcheck failed: % of %', v_n, coalesce(array_length(v_ids, 1), 0);
  END IF;
  IF coalesce(p_close_assignment, false) AND EXISTS (
    SELECT 1 FROM public.assignment_history ah
     WHERE ah.railcar_id = ANY (v_ids) AND ah.end_date IS NULL
  ) THEN
    RAISE EXCEPTION 'inactivate postcheck failed: an assignment stayed open';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'change_group', v_group,
    'applied', coalesce(array_length(v_ids, 1), 0),
    'closed_assignments', v_closed
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.inactivate_railcars(jsonb, text, text, text, boolean, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inactivate_railcars(jsonb, text, text, text, boolean, date) TO service_role;
