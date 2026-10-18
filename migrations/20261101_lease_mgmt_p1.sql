-- Lease Management P1: rider lifecycle + lessee MLA fields + rollup views.
-- Additive only. Does not rewrite KPI views or rent_events.

ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS lifecycle_status text;
ALTER TABLE public.riders DROP CONSTRAINT IF EXISTS riders_lifecycle_status_check;
ALTER TABLE public.riders
  ADD CONSTRAINT riders_lifecycle_status_check
  CHECK (lifecycle_status IS NULL OR lifecycle_status IN ('active','off_lease_pending_remarketing','closed'));

ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS number_digits text;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS off_lease_at date;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS closed_at date;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS successor_rider_id integer REFERENCES public.riders(id);
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS merged_into_rider_id integer REFERENCES public.riders(id);
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS contract_doc_url text;
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS sublessee text;

ALTER TABLE public.railcar_assignments ADD COLUMN IF NOT EXISTS assignment_status text;
ALTER TABLE public.railcar_assignments DROP CONSTRAINT IF EXISTS ra_assignment_status_check;
ALTER TABLE public.railcar_assignments
  ADD CONSTRAINT ra_assignment_status_check
  CHECK (assignment_status IS NULL OR assignment_status IN ('on_lease','off_lease_pending_remarketing'));
ALTER TABLE public.railcar_assignments ADD COLUMN IF NOT EXISTS sublessee text;

ALTER TABLE public.master_leases ADD COLUMN IF NOT EXISTS mla_number text;
ALTER TABLE public.master_leases ADD COLUMN IF NOT EXISTS mla_doc_url text;
ALTER TABLE public.master_leases ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;
ALTER TABLE public.master_leases ADD COLUMN IF NOT EXISTS merged_into_id integer REFERENCES public.master_leases(id);

CREATE INDEX IF NOT EXISTS riders_number_digits_idx ON public.riders(number_digits);
CREATE INDEX IF NOT EXISTS riders_master_lease_idx ON public.riders(master_lease_id);
CREATE INDEX IF NOT EXISTS ra_rider_idx ON public.railcar_assignments(rider_id);

-- Metadata-only backfill. Never touches inactive cars or fleet_status.
UPDATE public.riders
SET number_digits = substring(coalesce(rider_name, '') from '^(?:OL|EA)(\d{4})$')
WHERE number_digits IS NULL
  AND coalesce(rider_name, '') ~ '^(OL|EA)[0-9]{4}$';

UPDATE public.riders r
SET lifecycle_status = CASE
  WHEN r.rider_name ~ '^OL' THEN 'active'
  WHEN r.rider_name ~ '^EA' THEN 'off_lease_pending_remarketing'
  ELSE r.lifecycle_status
END
WHERE r.lifecycle_status IS NULL
  AND (r.rider_name ~ '^OL' OR r.rider_name ~ '^EA')
  AND EXISTS (
    SELECT 1
    FROM public.railcar_assignments a
    JOIN public.railcars c ON c.id = a.railcar_id AND c.active = true
    WHERE a.rider_id = r.id
  );

UPDATE public.master_leases
SET is_placeholder = true
WHERE is_placeholder = false
  AND coalesce(lessee, lease_number, '') ~* '^(x|idle|available|unassigned)';

ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_entity_type_check;
ALTER TABLE public.activity_log
  ADD CONSTRAINT activity_log_entity_type_check
  CHECK (entity_type = ANY (ARRAY[
    'railcar'::text, 'rider'::text, 'program'::text, 'program_car'::text, 'master_lease'::text
  ]));

CREATE OR REPLACE VIEW public.v_lease_rider_rollup AS
SELECT
  rd.id AS rider_id,
  rd.master_lease_id,
  rd.rider_name,
  rd.schedule_number,
  rd.number_digits,
  rd.lifecycle_status,
  rd.effective_date,
  rd.expiration_date,
  rd.owner_entity,
  rd.sublessee,
  rd.contract_doc_url,
  rd.successor_rider_id,
  rd.merged_into_rider_id,
  rd.off_lease_at,
  rd.closed_at,
  rd.monthly_rent_per_car AS rider_rent_per_car,
  ml.lessee,
  ml.lease_number,
  ml.is_placeholder,
  ml.merged_into_id AS lessee_merged_into_id,
  count(c.id)::int AS cars,
  count(*) FILTER (WHERE c.fleet_status = 'Leased')::int AS on_rent,
  count(*) FILTER (WHERE c.id IS NOT NULL AND c.fleet_status IS DISTINCT FROM 'Leased')::int AS off_rent,
  coalesce(sum(
    CASE WHEN c.fleet_status = 'Leased'
      THEN coalesce(c.monthly_rent_per_car, rd.monthly_rent_per_car, 0)
      ELSE 0 END
  ), 0)::numeric AS monthly_rent,
  rd.expiration_date AS next_expiration,
  count(*) FILTER (
    WHERE c.fleet_status = 'Leased'
      AND rd.expiration_date IS NOT NULL
      AND rd.expiration_date <= (current_date + interval '6 months')
  )::int AS cars_expiring_6mo,
  count(*) FILTER (
    WHERE c.fleet_status = 'Leased'
      AND rd.expiration_date IS NOT NULL
      AND rd.expiration_date <= (current_date + interval '12 months')
  )::int AS cars_expiring_12mo,
  CASE
    WHEN rd.expiration_date IS NOT NULL
      AND rd.expiration_date <= (current_date + interval '6 months')
      AND count(*) FILTER (WHERE c.fleet_status = 'Leased') > 0
    THEN 1 ELSE 0
  END::int AS ol_expiring_6mo,
  CASE
    WHEN rd.expiration_date IS NOT NULL
      AND rd.expiration_date <= (current_date + interval '12 months')
      AND count(*) FILTER (WHERE c.fleet_status = 'Leased') > 0
    THEN 1 ELSE 0
  END::int AS ol_expiring_12mo
FROM public.riders rd
JOIN public.master_leases ml ON ml.id = rd.master_lease_id
LEFT JOIN public.railcar_assignments a ON a.rider_id = rd.id
LEFT JOIN public.railcars c ON c.id = a.railcar_id AND c.active = true
GROUP BY rd.id, ml.id;

CREATE OR REPLACE VIEW public.v_lease_lessee_rollup AS
SELECT
  ml.id AS master_lease_id,
  coalesce(nullif(btrim(ml.lessee), ''), ml.lease_number) AS lessee,
  ml.lease_number,
  ml.account_id,
  acc.account_manager,
  ml.mla_number,
  ml.mla_doc_url,
  ml.is_placeholder,
  ml.merged_into_id,
  coalesce(sum(rr.cars), 0)::int AS cars,
  coalesce(sum(rr.on_rent), 0)::int AS on_rent,
  coalesce(sum(rr.off_rent), 0)::int AS off_rent,
  coalesce(sum(rr.monthly_rent), 0)::numeric AS monthly_rent,
  count(*) FILTER (
    WHERE coalesce(rr.lifecycle_status, CASE WHEN rr.rider_name ~ '^OL' THEN 'active' END) = 'active'
      AND rr.cars > 0
  )::int AS ol_count,
  count(*) FILTER (
    WHERE coalesce(rr.lifecycle_status, CASE WHEN rr.rider_name ~ '^EA' THEN 'off_lease_pending_remarketing' END)
      = 'off_lease_pending_remarketing'
      AND rr.cars > 0
  )::int AS ea_count,
  min(rr.next_expiration) FILTER (WHERE rr.cars > 0 AND rr.on_rent > 0) AS next_expiration,
  coalesce(sum(rr.cars_expiring_6mo), 0)::int AS cars_expiring_6mo,
  coalesce(sum(rr.cars_expiring_12mo), 0)::int AS cars_expiring_12mo,
  coalesce(sum(rr.ol_expiring_6mo), 0)::int AS ols_expiring_6mo,
  coalesce(sum(rr.ol_expiring_12mo), 0)::int AS ols_expiring_12mo
FROM public.master_leases ml
LEFT JOIN public.accounts acc ON acc.id = ml.account_id
LEFT JOIN public.v_lease_rider_rollup rr ON rr.master_lease_id = ml.id
GROUP BY ml.id, acc.account_manager;

CREATE OR REPLACE VIEW public.v_lease_issue_ea_on_rent AS
SELECT
  c.id AS railcar_id,
  btrim(coalesce(c.reporting_marks, '')) || ' ' || btrim(coalesce(c.car_number, '')) AS car,
  rd.rider_name AS ea_code,
  rd.id AS rider_id,
  ml.lessee AS rider_lessee,
  c.lessee_name AS car_lessee,
  c.fleet_status,
  c.monthly_rent_per_car,
  c.lease_end_date,
  ml.id AS master_lease_id,
  CASE WHEN rd.rider_name ~ '^EA1503' OR rd.number_digits = '1503' THEN true ELSE false END AS exclude_washington_penn
FROM public.railcars c
JOIN public.railcar_assignments a ON a.railcar_id = c.id
JOIN public.riders rd ON rd.id = a.rider_id
JOIN public.master_leases ml ON ml.id = rd.master_lease_id
WHERE c.active = true
  AND c.fleet_status = 'Leased'
  AND (
    rd.lifecycle_status = 'off_lease_pending_remarketing'
    OR coalesce(rd.rider_name, '') ~ '^EA'
  );

CREATE OR REPLACE VIEW public.v_lease_issue_unlinked AS
SELECT
  c.id AS railcar_id,
  btrim(coalesce(c.reporting_marks, '')) || ' ' || btrim(coalesce(c.car_number, '')) AS car,
  c.fleet_status,
  c.rider_external_id AS car_says_ol,
  c.lessee_name,
  rd.id AS proposed_rider_id,
  ml.lessee AS rider_lessee,
  ml.id AS master_lease_id
FROM public.railcars c
LEFT JOIN public.railcar_assignments a ON a.railcar_id = c.id
LEFT JOIN public.riders rd ON rd.rider_name = c.rider_external_id
LEFT JOIN public.master_leases ml ON ml.id = rd.master_lease_id
WHERE c.active = true
  AND a.id IS NULL;

CREATE OR REPLACE VIEW public.v_lease_issue_lessee_mismatch AS
SELECT
  c.id AS railcar_id,
  btrim(coalesce(c.reporting_marks, '')) || ' ' || btrim(coalesce(c.car_number, '')) AS car,
  c.lessee_name AS car_lessee,
  ml.lessee AS rider_lessee,
  rd.rider_name,
  rd.id AS rider_id,
  ml.id AS master_lease_id,
  coalesce(a.sublessee, rd.sublessee) AS sublessee
FROM public.railcars c
JOIN public.railcar_assignments a ON a.railcar_id = c.id
JOIN public.riders rd ON rd.id = a.rider_id
JOIN public.master_leases ml ON ml.id = rd.master_lease_id
WHERE c.active = true
  AND lower(btrim(coalesce(c.lessee_name, ''))) IS DISTINCT FROM lower(btrim(coalesce(ml.lessee, ml.lease_number, '')));

CREATE OR REPLACE VIEW public.v_lease_issue_dup_lessees AS
SELECT
  lower(split_part(btrim(coalesce(ml.lessee, ml.lease_number, '')), ' ', 1)) AS k,
  ml.id AS master_lease_id,
  coalesce(ml.lessee, ml.lease_number) AS lessee,
  ml.account_id,
  (
    SELECT count(*)::int
    FROM public.railcar_assignments a
    JOIN public.riders rd ON rd.id = a.rider_id
    JOIN public.railcars c ON c.id = a.railcar_id AND c.active = true
    WHERE rd.master_lease_id = ml.id
  ) AS active_cars
FROM public.master_leases ml
WHERE lower(split_part(btrim(coalesce(ml.lessee, ml.lease_number, '')), ' ', 1)) IN (
  SELECT lower(split_part(btrim(coalesce(lessee, lease_number, '')), ' ', 1))
  FROM public.master_leases
  WHERE btrim(coalesce(lessee, lease_number, '')) <> ''
  GROUP BY 1
  HAVING count(*) > 1
);

CREATE OR REPLACE VIEW public.v_lease_issue_nonstandard AS
SELECT
  rd.id AS rider_id,
  rd.rider_name,
  ml.lessee,
  ml.id AS master_lease_id,
  rd.lifecycle_status,
  count(c.id)::int AS active_cars
FROM public.riders rd
JOIN public.master_leases ml ON ml.id = rd.master_lease_id
LEFT JOIN public.railcar_assignments a ON a.rider_id = rd.id
LEFT JOIN public.railcars c ON c.id = a.railcar_id AND c.active = true
WHERE coalesce(rd.rider_name, '') !~ '^(OL|EA)[0-9]{4}$'
GROUP BY rd.id, ml.id, ml.lessee;

CREATE OR REPLACE VIEW public.v_lease_issue_past_exp AS
SELECT
  rd.id AS rider_id,
  rd.rider_name,
  ml.lessee,
  ml.id AS master_lease_id,
  rd.expiration_date,
  count(c.id)::int AS on_rent_cars
FROM public.riders rd
JOIN public.master_leases ml ON ml.id = rd.master_lease_id
JOIN public.railcar_assignments a ON a.rider_id = rd.id
JOIN public.railcars c ON c.id = a.railcar_id AND c.active = true AND c.fleet_status = 'Leased'
WHERE rd.expiration_date IS NOT NULL
  AND rd.expiration_date < current_date
GROUP BY rd.id, ml.id, ml.lessee;

CREATE OR REPLACE VIEW public.v_lease_issue_rent_mismatch AS
SELECT
  c.id AS railcar_id,
  btrim(coalesce(c.reporting_marks, '')) || ' ' || btrim(coalesce(c.car_number, '')) AS car,
  rd.rider_name,
  c.monthly_rent_per_car AS car_rent,
  rd.monthly_rent_per_car AS rider_rent,
  ml.id AS master_lease_id
FROM public.railcars c
JOIN public.railcar_assignments a ON a.railcar_id = c.id
JOIN public.riders rd ON rd.id = a.rider_id
JOIN public.master_leases ml ON ml.id = rd.master_lease_id
WHERE c.active = true
  AND c.monthly_rent_per_car IS NOT NULL
  AND rd.monthly_rent_per_car IS NOT NULL
  AND c.monthly_rent_per_car IS DISTINCT FROM rd.monthly_rent_per_car;

CREATE OR REPLACE VIEW public.v_lease_issue_placeholder AS
SELECT
  ml.id AS master_lease_id,
  coalesce(ml.lessee, ml.lease_number) AS lessee,
  count(c.id)::int AS active_cars
FROM public.master_leases ml
JOIN public.riders rd ON rd.master_lease_id = ml.id
JOIN public.railcar_assignments a ON a.rider_id = rd.id
JOIN public.railcars c ON c.id = a.railcar_id AND c.active = true
WHERE ml.is_placeholder = true
GROUP BY ml.id;

GRANT SELECT ON public.v_lease_rider_rollup, public.v_lease_lessee_rollup,
  public.v_lease_issue_ea_on_rent, public.v_lease_issue_unlinked,
  public.v_lease_issue_lessee_mismatch, public.v_lease_issue_dup_lessees,
  public.v_lease_issue_nonstandard, public.v_lease_issue_past_exp,
  public.v_lease_issue_rent_mismatch, public.v_lease_issue_placeholder
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rlms_apply_jsonb_patch(p_table text, p_id bigint, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
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
    'riders', 'master_leases'
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
$$;

CREATE OR REPLACE FUNCTION public.rlms_undo_change_group(p_group uuid, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  rec record;
  cur jsonb;
  k text;
  undo_group uuid := gen_random_uuid();
  restored int := 0;
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
  IF already > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_undone', 'status', 409);
  END IF;
  IF non_ok > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_undoable', 'status', 400,
      'message', 'Remarks and imports cannot be undone.');
  END IF;
  IF orig_actor::text IS DISTINCT FROM p_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_actor', 'status', 403);
  END IF;
  IF oldest < now() - interval '24 hours' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired', 'status', 403);
  END IF;

  FOR rec IN
    SELECT * FROM public.activity_log
    WHERE change_group = p_group
    ORDER BY id DESC
  LOOP
    tbl := rec.table_name;
    pk := rec.row_pk;
    IF tbl IS NULL OR pk IS NULL THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'missing table_name or row_pk'
      ));
      CONTINUE;
    END IF;
    IF tbl NOT IN (
      'railcars', 'car_commitments', 'car_rent_stops', 'program_cars',
      'program_car_milestones', 'programs', 'railcar_assignments',
      'assignment_history', 'car_status_history', 'car_tags', 'car_lists', 'car_list_members',
      'riders', 'master_leases'
    ) THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'table not undoable'
      ));
      CONTINUE;
    END IF;

    op := coalesce(rec.detail->>'op', CASE
      WHEN rec.before IS NULL OR rec.before = '{}'::jsonb THEN 'insert'
      WHEN rec.after IS NULL OR rec.after = '{}'::jsonb THEN 'delete'
      ELSE 'update'
    END);

    IF tbl = 'car_status_history' AND op = 'insert' THEN
      CONTINUE;
    END IF;

    IF op <> 'insert' THEN
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', tbl) INTO cur USING pk;
      IF cur IS NULL AND op = 'update' THEN
        conflicts := conflicts || jsonb_build_array(jsonb_build_object(
          'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'row missing'
        ));
        CONTINUE;
      END IF;
      IF rec.after IS NOT NULL AND rec.after <> '{}'::jsonb THEN
        FOR k IN SELECT jsonb_object_keys(rec.after)
        LOOP
          IF NOT public.rlms_jsonb_key_matches(cur, rec.after, k) THEN
            conflicts := conflicts || jsonb_build_array(jsonb_build_object(
              'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', format('changed since (%s)', k)
            ));
            EXIT;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  IF jsonb_array_length(conflicts) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'status', 409, 'conflicts', conflicts);
  END IF;

  FOR rec IN
    SELECT * FROM public.activity_log
    WHERE change_group = p_group
    ORDER BY id DESC
  LOOP
    tbl := rec.table_name;
    pk := rec.row_pk;
    op := coalesce(rec.detail->>'op', CASE
      WHEN rec.before IS NULL OR rec.before = '{}'::jsonb THEN 'insert'
      WHEN rec.after IS NULL OR rec.after = '{}'::jsonb THEN 'delete'
      ELSE 'update'
    END);

    IF tbl = 'car_status_history' AND op = 'insert' THEN
      INSERT INTO public.car_status_history (car_id, event_type, reason, created_by, from_status, to_status)
      VALUES (
        coalesce((rec.after->>'car_id')::bigint, rec.railcar_id),
        'undo',
        'undo change_group',
        p_actor,
        rec.after->>'to_status',
        rec.after->>'from_status'
      );
      restored := restored + 1;
    ELSIF op = 'insert' THEN
      IF tbl = 'car_commitments' THEN
        UPDATE public.car_commitments SET cleared_at = now() WHERE id = pk AND cleared_at IS NULL;
      ELSIF tbl = 'program_cars' THEN
        UPDATE public.program_cars SET exited_date = CURRENT_DATE WHERE id = pk AND exited_date IS NULL;
      ELSIF tbl IN ('program_car_milestones', 'car_rent_stops', 'car_tags', 'car_list_members') THEN
        EXECUTE format('DELETE FROM public.%I WHERE id = $1', tbl) USING pk;
      ELSIF tbl = 'railcars' THEN
        NULL;
      ELSE
        PERFORM public.rlms_apply_jsonb_patch(tbl, pk, rec.before);
      END IF;
      restored := restored + 1;
    ELSIF op = 'delete' THEN
      IF tbl = 'car_commitments' THEN
        UPDATE public.car_commitments SET cleared_at = NULL WHERE id = pk;
      ELSIF tbl = 'program_cars' THEN
        UPDATE public.program_cars SET exited_date = NULL WHERE id = pk;
      ELSE
        PERFORM public.rlms_apply_jsonb_patch(tbl, pk, rec.before);
      END IF;
      restored := restored + 1;
    ELSE
      PERFORM public.rlms_apply_jsonb_patch(tbl, pk, rec.before);
      restored := restored + 1;
    END IF;

    INSERT INTO public.activity_log (
      entity_type, entity_id, action, actor, railcar_id, rider_id, detail, source,
      occurred_at, change_group, table_name, row_pk, before, after, undoable, undo_of
    ) VALUES (
      rec.entity_type, rec.entity_id, 'undo', p_actor, rec.railcar_id, rec.rider_id,
      jsonb_build_object('op', 'update', 'undid', rec.action, 'original_group', p_group::text),
      'undo', now(), undo_group, rec.table_name, rec.row_pk, rec.after, rec.before,
      false, rec.id
    );
  END LOOP;

  UPDATE public.activity_log
  SET undone_at = now(), undone_by = p_actor
  WHERE change_group = p_group;

  RETURN jsonb_build_object(
    'ok', true,
    'restored', restored,
    'undo_group', undo_group,
    'original_group', p_group
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rlms_undo_change_group(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_undo_change_group(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rlms_apply_jsonb_patch(text, bigint, jsonb) TO service_role;
