-- Programs: global optional field defs, and the tracker-sync apply function.
-- Does not update program_cars, railcars, shops, user_column_prefs, or rent_events.
-- Safe to re-run. Bruce applies this only after sign-off. Down script:
-- migrations/20261113_program_global_optional_fields_down.sql
-- Runs after migrations/20261112_remark_in_place.sql. rlms_undo_change_group
-- keeps that function's car_number_history removal and adds shops,
-- user_column_prefs, and deletion of an empty sync-created program.

ALTER TABLE public.program_field_defs
  ALTER COLUMN category_id DROP NOT NULL;

ALTER TABLE public.program_field_defs
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.program_field_defs.category_id IS
  'NULL means the field is available on every program, including ones created later.';
COMMENT ON COLUMN public.program_field_defs.is_optional IS
  'Optional fields stay hidden on a new program until someone adds them from Columns.';

CREATE UNIQUE INDEX IF NOT EXISTS program_field_defs_global_field_uidx
  ON public.program_field_defs (field_key)
  WHERE category_id IS NULL;

INSERT INTO public.program_field_defs
  (category_id, field_key, label, field_type, section, sort_order, is_optional)
VALUES
  (NULL, 'gate_1_clearance', 'Gate 1 clearance', 'text', 'Optional', 1010, true),
  (NULL, 'gate_2_clearance', 'Gate 2 clearance', 'text', 'Optional', 1020, true),
  (NULL, 'gate_3_clearance', 'Gate 3 clearance', 'text', 'Optional', 1030, true),
  (NULL, 'cost_of_exterior_paint', 'Cost of exterior paint', 'currency', 'Optional', 1040, true),
  (NULL, 'cost_of_interior_paint', 'Cost of interior paint', 'currency', 'Optional', 1050, true),
  (NULL, 'cost_of_cleaning', 'Cost of cleaning', 'currency', 'Optional', 1060, true),
  (NULL, 'b_o_estimate_cost', 'B/O estimate cost', 'currency', 'Optional', 1070, true),
  (NULL, 'b_o_estimate_approved', 'B/O estimate approved', 'boolean', 'Optional', 1080, true),
  (NULL, 'nld_arrival_date', 'NLD arrival date', 'date', 'Optional', 1090, true),
  (NULL, 'pod_date', 'POD date', 'date', 'Optional', 1100, true),
  (NULL, 'completion_date', 'Completion date', 'date', 'Optional', 1110, true),
  (NULL, 'eol_date', 'EOL date', 'date', 'Optional', 1120, true),
  (NULL, 'billing_end_date', 'Billing end date', 'date', 'Optional', 1130, true),
  (NULL, 'brc_complete_date', 'BRC complete date', 'date', 'Optional', 1140, true),
  (NULL, 'operating_lease', 'Operating lease', 'text', 'Optional', 1150, true),
  (NULL, 'new_operating_lease', 'New operating lease', 'text', 'Optional', 1160, true),
  (NULL, 'previous_lease', 'Previous lease', 'text', 'Optional', 1170, true),
  (NULL, 'approval_request', 'Approval request', 'date', 'Optional', 1180, true),
  (NULL, 'original_code6_lessee_approval', 'Original Code 6 lessee approval', 'date', 'Optional', 1190, true),
  (NULL, 'final_code6_approval_request', 'Final Code 6 approval request', 'date', 'Optional', 1200, true),
  (NULL, 'final_code6_lessee_approval', 'Final Code 6 lessee approval', 'date', 'Optional', 1210, true),
  (NULL, 'cleaning_certificate_received', 'Cleaning certificate received', 'boolean', 'Optional', 1220, true),
  (NULL, 'umler_rights_granted', 'Umler rights granted', 'boolean', 'Optional', 1230, true),
  (NULL, 'remark_date', 'Remark date', 'date', 'Optional', 1240, true),
  (NULL, 'scrap_arrival_date', 'Scrap arrival date', 'date', 'Optional', 1250, true),
  (NULL, 'next_qual_due', 'Next qual due', 'date', 'Optional', 1260, true),
  (NULL, 'remark_material_ordered', 'Remark material ordered', 'text', 'Optional', 1270, true),
  (NULL, 'lessee', 'Lessee', 'text', 'Optional', 1280, true),
  (NULL, 'loaded_by_lessee', 'Loaded by lessee', 'text', 'Optional', 1290, true),
  (NULL, 'return_location', 'Return location', 'text', 'Optional', 1300, true),
  (NULL, 'settlement_amount', 'Settlement amount', 'currency', 'Optional', 1310, true)
ON CONFLICT (field_key) WHERE category_id IS NULL DO NOTHING;

-- One change_group. Set-based update of active program_cars only.
-- Refuses the whole apply if any car went inactive or drifted since preview.
-- Never reads or writes rent_events.
CREATE OR REPLACE FUNCTION public.rlms_apply_program_tracker_sync(
  p_token uuid,
  p_actor text,
  p_signed_off_by text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  snap jsonb;
  grp uuid := gen_random_uuid();
  shop jsonb;
  layout jsonb;
  created jsonb;
  shop_name text;
  shop_id bigint;
  n_shops int := 0;
  n_cars int := 0;
  n_layouts int := 0;
  n_programs int := 0;
  updated int := 0;
  pref_id bigint;
  pref_before jsonb;
  v_list_key text;
  v_view_name text;
  new_name text;
  new_program_id bigint;
  actor_uuid uuid;
BEGIN
  IF p_token IS NULL OR coalesce(btrim(p_actor), '') = '' OR coalesce(btrim(p_signed_off_by), '') = '' THEN
    RAISE EXCEPTION 'token, actor, and signed_off_by are required';
  END IF;
  IF p_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    actor_uuid := p_actor::uuid;
  END IF;

  SELECT t.snapshot INTO snap
  FROM public.rlms_preview_tokens t
  WHERE t.token = p_token
    AND t.kind = 'program_tracker_sync'
    AND t.expires_at > now();
  IF snap IS NULL THEN
    RAISE EXCEPTION 'preview expired or missing';
  END IF;
  IF snap ? 'rent_events' THEN
    RAISE EXCEPTION 'rent_events are out of scope';
  END IF;

  FOR shop IN SELECT value FROM jsonb_array_elements(coalesce(snap->'shops', '[]'::jsonb))
  LOOP
    shop_name := btrim(shop->>'name');
    IF shop_name = '' THEN CONTINUE; END IF;
    SELECT s.id INTO shop_id
    FROM public.shops s
    WHERE lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')) = lower(regexp_replace(shop_name, '\s+', ' ', 'g'))
    LIMIT 1;
    IF shop_id IS NULL THEN
      INSERT INTO public.shops (name) VALUES (shop_name) RETURNING id INTO shop_id;
      INSERT INTO public.activity_log (
        entity_type, entity_id, action, actor, detail, source, occurred_at,
        change_group, table_name, row_pk, before, after, undoable
      ) VALUES (
        'program', coalesce((shop->>'program_id')::bigint, shop_id), 'shop_created', p_actor,
        jsonb_build_object('op', 'insert', 'source', 'program_tracker_sync', 'signed_off_by', p_signed_off_by),
        'program_tracker_sync', now(), grp, 'shops', shop_id,
        '{}'::jsonb, jsonb_build_object('id', shop_id, 'name', shop_name), true
      );
      n_shops := n_shops + 1;
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS _pts_cars;
  CREATE TEMP TABLE _pts_cars ON COMMIT DROP AS
  SELECT
    (x->>'program_car_id')::bigint AS program_car_id,
    (x->>'program_id')::bigint AS program_id,
    (x->>'railcar_id')::bigint AS railcar_id,
    CASE WHEN x->'expect'->'status' IS NULL OR x->'expect'->'status' = 'null'::jsonb THEN NULL ELSE x->'expect'->>'status' END AS expect_status,
    CASE WHEN x->'expect'->'shop_id' IS NULL OR x->'expect'->'shop_id' = 'null'::jsonb THEN NULL ELSE (x->'expect'->>'shop_id')::bigint END AS expect_shop_id,
    COALESCE(x->'expect'->'custom_fields', '{}'::jsonb) AS expect_cf,
    COALESCE((x->'expect'->>'active')::boolean, false) AS expect_active,
    COALESCE((x->>'set_status')::boolean, false) AS set_status,
    CASE WHEN x->'status' IS NULL OR jsonb_typeof(x->'status') = 'null' THEN NULL ELSE x->>'status' END AS new_status,
    COALESCE((x->>'set_shop')::boolean, false) AS set_shop,
    CASE WHEN x->'shop_id' IS NULL OR jsonb_typeof(x->'shop_id') = 'null' OR x->>'shop_id' = '' THEN NULL ELSE (x->>'shop_id')::bigint END AS new_shop_id,
    NULLIF(btrim(x->>'shop_name'), '') AS shop_name,
    COALESCE(x->'custom_patch', '{}'::jsonb) AS custom_patch,
    COALESCE(x->'fields', '{}'::jsonb) AS fields,
    NULL::jsonb AS new_cf
  FROM jsonb_array_elements(coalesce(snap->'cars', '[]'::jsonb)) AS x;

  UPDATE _pts_cars s
  SET new_shop_id = sh.id
  FROM public.shops sh
  WHERE s.set_shop
    AND s.shop_name IS NOT NULL
    AND lower(regexp_replace(btrim(sh.name), '\s+', ' ', 'g')) = lower(regexp_replace(s.shop_name, '\s+', ' ', 'g'));

  IF EXISTS (
    SELECT 1 FROM _pts_cars s
    WHERE s.set_shop AND s.shop_name IS NOT NULL AND s.new_shop_id IS NULL
  ) THEN
    RAISE EXCEPTION 'shop name in the preview is not a shop record';
  END IF;

  PERFORM 1
  FROM public.program_cars pc
  WHERE pc.id IN (SELECT program_car_id FROM _pts_cars)
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM _pts_cars s
    LEFT JOIN public.program_cars pc ON pc.id = s.program_car_id
    LEFT JOIN public.railcars r ON r.id = pc.railcar_id
    WHERE pc.id IS NULL
      OR r.active IS NOT TRUE
      OR s.expect_active IS NOT TRUE
      OR pc.exited_date IS NOT NULL
      OR pc.program_id IS DISTINCT FROM s.program_id
      OR pc.railcar_id IS DISTINCT FROM s.railcar_id
      OR pc.status IS DISTINCT FROM s.expect_status
      OR pc.shop_id IS DISTINCT FROM s.expect_shop_id
      OR COALESCE(pc.custom_fields, '{}'::jsonb) IS DISTINCT FROM COALESCE(s.expect_cf, '{}'::jsonb)
  ) THEN
    RAISE EXCEPTION 'program tracker sync failed closed: inactive car or RLMS changed since preview';
  END IF;

  UPDATE _pts_cars s
  SET new_cf = (
    SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    FROM jsonb_each(COALESCE(s.expect_cf, '{}'::jsonb) || COALESCE(s.custom_patch, '{}'::jsonb)) AS e
    WHERE jsonb_typeof(e.value) <> 'null'
  );

  UPDATE public.program_cars pc
  SET
    custom_fields = s.new_cf,
    status = CASE WHEN s.set_status THEN s.new_status ELSE pc.status END,
    shop_id = CASE WHEN s.set_shop THEN s.new_shop_id ELSE pc.shop_id END
  FROM _pts_cars s
  WHERE pc.id = s.program_car_id
    AND EXISTS (
      SELECT 1 FROM public.railcars r
      WHERE r.id = pc.railcar_id AND r.active IS TRUE
    );
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated IS DISTINCT FROM (SELECT count(*) FROM _pts_cars) THEN
    RAISE EXCEPTION 'program tracker sync updated % cars, expected %', updated, (SELECT count(*) FROM _pts_cars);
  END IF;
  n_cars := updated;

  INSERT INTO public.activity_log (
    entity_type, entity_id, action, actor, railcar_id, detail, source, occurred_at,
    change_group, table_name, row_pk, before, after, undoable
  )
  SELECT
    'program_car',
    s.program_car_id,
    'program_tracker_sync',
    p_actor,
    s.railcar_id,
    jsonb_build_object('op', 'update', 'source', 'program_tracker_sync', 'signed_off_by', p_signed_off_by),
    'program_tracker_sync',
    now(),
    grp,
    'program_cars',
    s.program_car_id,
    jsonb_build_object(
      'custom_fields', COALESCE(s.expect_cf, '{}'::jsonb),
      'status', CASE WHEN s.expect_status IS NULL THEN 'null'::jsonb ELSE to_jsonb(s.expect_status) END,
      'shop_id', CASE WHEN s.expect_shop_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(s.expect_shop_id) END
    ),
    jsonb_build_object(
      'custom_fields', COALESCE(s.new_cf, '{}'::jsonb),
      'status', CASE WHEN NOT s.set_status THEN CASE WHEN s.expect_status IS NULL THEN 'null'::jsonb ELSE to_jsonb(s.expect_status) END
                    WHEN s.new_status IS NULL THEN 'null'::jsonb ELSE to_jsonb(s.new_status) END,
      'shop_id', CASE WHEN NOT s.set_shop THEN CASE WHEN s.expect_shop_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(s.expect_shop_id) END
                   WHEN s.new_shop_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(s.new_shop_id) END
    ),
    true
  FROM _pts_cars s;

  INSERT INTO public.program_activity (program_id, program_car_id, railcar_id, action, detail, actor)
  SELECT
    s.program_id,
    s.program_car_id,
    s.railcar_id,
    'tracker_sync',
    jsonb_build_object('fields', s.fields, 'change_group', grp::text, 'source', 'program_tracker_sync', 'signed_off_by', p_signed_off_by),
    actor_uuid
  FROM _pts_cars s;

  FOR layout IN SELECT value FROM jsonb_array_elements(coalesce(snap->'layouts', '[]'::jsonb))
  LOOP
    IF actor_uuid IS NULL THEN
      RAISE EXCEPTION 'column layouts need an actor uuid';
    END IF;
    v_list_key := btrim(layout->>'list_key');
    v_view_name := coalesce(nullif(btrim(layout->>'view_name'), ''), 'Tracker order');
    SELECT p.id, to_jsonb(p) INTO pref_id, pref_before
    FROM public.user_column_prefs p
    WHERE p.list_key = v_list_key AND p.view_name = v_view_name AND p.is_shared IS TRUE
    ORDER BY p.id
    LIMIT 1;
    UPDATE public.user_column_prefs
    SET is_default = false
    WHERE list_key = v_list_key AND is_shared IS TRUE AND is_default IS TRUE AND id IS DISTINCT FROM pref_id;
    IF pref_id IS NULL THEN
      INSERT INTO public.user_column_prefs (user_id, page, list_key, view_name, is_default, is_shared, visible_cols, updated_at)
      VALUES (actor_uuid, 'program_cars', v_list_key, v_view_name, true, true, COALESCE(layout->'visible_cols', '{}'::jsonb), now())
      RETURNING id INTO pref_id;
      INSERT INTO public.activity_log (
        entity_type, entity_id, action, actor, detail, source, occurred_at,
        change_group, table_name, row_pk, before, after, undoable
      ) VALUES (
        'program', coalesce((layout->>'program_id')::bigint, 0), 'program_column_layout', p_actor,
        jsonb_build_object('op', 'insert', 'source', 'program_tracker_sync'),
        'program_tracker_sync', now(), grp, 'user_column_prefs', pref_id,
        '{}'::jsonb,
        jsonb_build_object('id', pref_id, 'list_key', v_list_key, 'view_name', v_view_name, 'is_shared', true, 'is_default', true, 'page', 'program_cars', 'visible_cols', COALESCE(layout->'visible_cols', '{}'::jsonb)),
        true
      );
    ELSE
      UPDATE public.user_column_prefs
      SET visible_cols = COALESCE(layout->'visible_cols', '{}'::jsonb),
          is_default = true,
          is_shared = true,
          page = 'program_cars',
          updated_at = now()
      WHERE id = pref_id;
      INSERT INTO public.activity_log (
        entity_type, entity_id, action, actor, detail, source, occurred_at,
        change_group, table_name, row_pk, before, after, undoable
      ) VALUES (
        'program', coalesce((layout->>'program_id')::bigint, 0), 'program_column_layout', p_actor,
        jsonb_build_object('op', 'update', 'source', 'program_tracker_sync'),
        'program_tracker_sync', now(), grp, 'user_column_prefs', pref_id,
        jsonb_build_object('visible_cols', pref_before->'visible_cols', 'is_default', pref_before->'is_default', 'is_shared', true, 'view_name', v_view_name, 'list_key', v_list_key),
        jsonb_build_object('visible_cols', COALESCE(layout->'visible_cols', '{}'::jsonb), 'is_default', true, 'is_shared', true, 'view_name', v_view_name, 'list_key', v_list_key),
        true
      );
    END IF;
    n_layouts := n_layouts + 1;
  END LOOP;

  FOR created IN SELECT value FROM jsonb_array_elements(coalesce(snap->'programs_to_create', '[]'::jsonb))
  LOOP
    new_name := btrim(created->>'name');
    IF new_name = '' THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.programs p WHERE lower(btrim(p.name)) = lower(new_name)) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.programs (name, status, lifecycle, opened_date, description)
    VALUES (new_name, 'open', 'active', CURRENT_DATE, NULLIF(btrim(created->>'description'), ''))
    RETURNING id INTO new_program_id;
    INSERT INTO public.activity_log (
      entity_type, entity_id, action, actor, detail, source, occurred_at,
      change_group, table_name, row_pk, before, after, undoable
    ) VALUES (
      'program', new_program_id, 'program_created', p_actor,
      jsonb_build_object('op', 'insert', 'source', 'program_tracker_sync', 'signed_off_by', p_signed_off_by),
      'program_tracker_sync', now(), grp, 'programs', new_program_id,
      '{}'::jsonb,
      jsonb_build_object('id', new_program_id, 'name', new_name, 'status', 'open', 'lifecycle', 'active'),
      true
    );
    n_programs := n_programs + 1;
  END LOOP;

  DELETE FROM public.rlms_preview_tokens WHERE token = p_token;

  RETURN jsonb_build_object(
    'ok', true,
    'change_group', grp,
    'cars', n_cars,
    'shops', n_shops,
    'layouts', n_layouts,
    'programs_created', n_programs,
    'signed_off_by', p_signed_off_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rlms_apply_program_tracker_sync(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_apply_program_tracker_sync(uuid, text, text) TO service_role;

-- Undo may restore program_cars, delete shops and shared column prefs created by the sync,
-- and delete a program the sync created when it still has no cars.
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
    'shops', 'user_column_prefs'
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
    IF tbl NOT IN ('railcars', 'car_commitments', 'car_rent_stops', 'program_cars', 'program_car_milestones', 'programs', 'railcar_assignments', 'assignment_history', 'car_status_history', 'car_tags', 'car_lists', 'car_list_members', 'riders', 'master_leases', 'attachments', 'opportunities', 'crm_activities', 'accounts', 'companies', 'company_contacts', 'opportunity_contacts', 'shops', 'user_column_prefs') THEN
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

