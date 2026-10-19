-- Programs: manage columns (add, rename, retire, restore).
-- Sorts after migrations/20261114_inactivate_railcars.sql.
-- Does not read or write rent_events. Does not delete program_field_defs.
-- Safe to re-run. Bruce applies this in the Supabase SQL editor.
-- Down script: migrations/20261115_manage_columns_down.sql
--
-- rlms_undo_change_group is the live definition from
-- migrations/20261113_program_global_optional_fields.sql (itself the
-- remark-in-place function plus shops, shared column prefs, and empty
-- sync-created programs). The only additions are the program_field_defs
-- allowlist entry and insert-undo, which sets retired_at instead of DELETE.
-- rlms_apply_jsonb_patch is that same migration's live definition, plus
-- program_field_defs on its allowlist. Rename, retire, and restore undo
-- through the patch function. Without that entry they raise
-- 'undo: table program_field_defs is not patchable'.
-- rlms_program_car_is_program_done is the live definition from
-- migrations/20261030_railcars_workbench.sql with one removal:
-- `rc.active IS NOT TRUE`. A fleet-inactive car stays in the program.
-- scrapped_at, the complete checkbox, outcome_reached_at, and a
-- program-done milestone still count.

ALTER TABLE public.program_field_defs
  ADD COLUMN IF NOT EXISTS program_id bigint REFERENCES public.programs(id) ON DELETE CASCADE;

ALTER TABLE public.program_field_defs
  ADD COLUMN IF NOT EXISTS retired_at timestamptz;

COMMENT ON COLUMN public.program_field_defs.program_id IS
  'Set when the column belongs to one program. NULL with category_id NULL is a global optional field, available on programs created later and hidden until added from Columns.';
COMMENT ON COLUMN public.program_field_defs.retired_at IS
  'Set when the column is retired. The row and custom_fields values stay. NULL means the column is active.';

ALTER TABLE public.program_field_defs
  DROP CONSTRAINT IF EXISTS program_field_defs_scope_check;
ALTER TABLE public.program_field_defs
  ADD CONSTRAINT program_field_defs_scope_check
  CHECK (program_id IS NULL OR category_id IS NULL);

DROP INDEX IF EXISTS public.program_field_defs_global_field_uidx;
CREATE UNIQUE INDEX program_field_defs_global_field_uidx
  ON public.program_field_defs (field_key)
  WHERE category_id IS NULL AND program_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS program_field_defs_program_field_uidx
  ON public.program_field_defs (program_id, field_key)
  WHERE program_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.rlms_apply_jsonb_patch(p_table text, p_id bigint, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  stmt text;
  col text;
  typ text;
  parts text[] := ARRAY[]::text[];
BEGIN
  IF p_patch IS NULL OR p_patch = '{}'::jsonb THEN
    RETURN;
  END IF;
  IF p_table NOT IN (
    'railcars', 'car_commitments', 'car_rent_stops', 'program_cars',
    'program_car_milestones', 'programs', 'railcar_assignments',
    'assignment_history', 'car_tags', 'car_lists', 'car_list_members',
    'riders', 'master_leases', 'attachments', 'opportunities', 'crm_activities',
    'accounts', 'companies', 'company_contacts', 'opportunity_contacts',
    'shops', 'user_column_prefs', 'program_field_defs'
  ) THEN
    RAISE EXCEPTION 'undo: table % is not patchable', p_table;
  END IF;
  FOR col, typ IN
    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = p_table AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF p_patch ? col THEN
      IF p_patch -> col = 'null'::jsonb THEN
        parts := array_append(parts, format('%I = NULL', col));
      ELSE
        parts := array_append(parts, format('%I = ($1->>%L)::%s', col, col, typ));
      END IF;
    END IF;
  END LOOP;
  IF coalesce(array_length(parts, 1), 0) = 0 THEN
    RETURN;
  END IF;
  stmt := format('UPDATE public.%I SET %s WHERE id = $2', p_table, array_to_string(parts, ', '));
  EXECUTE stmt USING p_patch, p_id;
END;
$function$;

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
    IF tbl NOT IN ('railcars', 'car_commitments', 'car_rent_stops', 'program_cars', 'program_car_milestones', 'programs', 'railcar_assignments', 'assignment_history', 'car_status_history', 'car_tags', 'car_lists', 'car_list_members', 'riders', 'master_leases', 'attachments', 'opportunities', 'crm_activities', 'accounts', 'companies', 'company_contacts', 'opportunity_contacts', 'shops', 'user_column_prefs', 'program_field_defs') THEN
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
    ELSIF op = 'insert' AND tbl = 'program_field_defs' THEN
      UPDATE public.program_field_defs
         SET retired_at = COALESCE(retired_at, now())
       WHERE id = pk;
      restored := restored + 1;
    ELSIF op = 'insert' AND tbl = 'programs' AND coalesce(rec.detail->>'source', '') = 'program_tracker_sync' THEN
      IF EXISTS (SELECT 1 FROM public.program_cars c WHERE c.program_id = pk) THEN
        RAISE EXCEPTION 'undo: program % still has cars', pk;
      END IF;
      DELETE FROM public.programs WHERE id = pk;
      restored := restored + 1;
    ELSIF op = 'insert' THEN
      IF tbl = 'car_commitments' THEN UPDATE public.car_commitments SET cleared_at = now() WHERE id = pk AND cleared_at IS NULL;
      ELSIF tbl = 'program_cars' THEN UPDATE public.program_cars SET exited_date = CURRENT_DATE WHERE id = pk AND exited_date IS NULL;
      ELSIF tbl IN ('program_car_milestones', 'car_rent_stops', 'car_tags', 'car_list_members', 'attachments', 'opportunities', 'crm_activities', 'accounts', 'companies', 'company_contacts', 'opportunity_contacts', 'shops', 'user_column_prefs') THEN EXECUTE format('DELETE FROM public.%I WHERE id = $1', tbl) USING pk;
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
GRANT EXECUTE ON FUNCTION public.rlms_apply_jsonb_patch(text, bigint, jsonb) TO service_role;

-- Global optional date. Hidden until someone adds it from Columns.
-- Not part of the default program column order.
INSERT INTO public.program_field_defs
  (category_id, program_id, field_key, label, field_type, section, sort_order, is_optional)
SELECT NULL, NULL, 'trace_date_ran', 'Trace date ran', 'date', 'Optional', 1320, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.program_field_defs
  WHERE field_key = 'trace_date_ran' AND category_id IS NULL AND program_id IS NULL
);

-- Live body from 20261030_railcars_workbench.sql, minus rc.active IS NOT TRUE.
CREATE OR REPLACE FUNCTION public.rlms_program_car_is_program_done(p_program_car_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT
      rc.scrapped_at IS NOT NULL
      OR pc.outcome_reached_at IS NOT NULL
      OR COALESCE(pc.custom_fields->>'__complete', '') IN ('true', 't', '1')
      OR EXISTS (
        SELECT 1
        FROM public.program_car_milestones m
        WHERE m.program_car_id = pc.id
          AND lower(btrim(m.milestone)) IN ('on rent', 'scrapped', 'sold', 'stored')
      )
      OR lower(btrim(COALESCE(pc.milestone, ''))) IN ('on rent', 'scrapped', 'sold', 'stored')
    FROM public.program_cars pc
    JOIN public.railcars rc ON rc.id = pc.railcar_id
    WHERE pc.id = p_program_car_id
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.rlms_program_car_is_program_done(bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.rlms_program_car_is_program_done(bigint) IS
  'Program done: scrapped_at, Complete checkbox / outcome_reached_at, or trail/latest milestone On rent/Scrapped/Sold/Stored. Fleet inactive does not count.';
