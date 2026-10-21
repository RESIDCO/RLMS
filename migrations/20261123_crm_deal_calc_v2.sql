-- Deal Calculator v2. One transaction. Do not apply to live until Bruce says so.
-- Sorts after migrations/20261122_rider_lease_entity.sql.
-- Repo only. Do not apply to Supabase from this change.
-- Strip begin/commit before apply_migration.
--
-- No data changes. Per-type new-car costs are not seeded.
-- The four frozen undo functions are not modified.
--
-- md5 (pg_get_functiondef):
--   rlms_apply_jsonb_patch          66be7d422ec47e8c711f83c8ca001c79
--   rlms_undo_change_group          fda2979bbd2d37e82c936b0abcdf8927
--   rlms_referenced_outside_group   ee76481bbbeb897c18d4f0349e9c0f2d
--   rlms_fk_outside_group           b997a1a457d73f865b29560eeef625a6
--   rlms_undo_deal_calc_group p1    6d0fa2812a066a2242a893267fd72347
--   rlms_undo_deal_calc_group v2    79ff0afc077af1b807f4d4399698e514

begin;

set local lock_timeout = '5s';

do $$ declare m text; begin
  select md5(pg_get_functiondef('public.rlms_apply_jsonb_patch'::regproc)) into m;
  if m <> '66be7d422ec47e8c711f83c8ca001c79' then raise exception 'rlms_apply_jsonb_patch md5 %', m; end if;
  select md5(pg_get_functiondef('public.rlms_undo_change_group'::regproc)) into m;
  if m <> 'fda2979bbd2d37e82c936b0abcdf8927' then raise exception 'rlms_undo_change_group md5 %', m; end if;
  select md5(pg_get_functiondef('public.rlms_referenced_outside_group'::regproc)) into m;
  if m <> 'ee76481bbbeb897c18d4f0349e9c0f2d' then raise exception 'rlms_referenced_outside_group md5 %', m; end if;
  select md5(pg_get_functiondef('public.rlms_fk_outside_group'::regproc)) into m;
  if m <> 'b997a1a457d73f865b29560eeef625a6' then raise exception 'rlms_fk_outside_group md5 %', m; end if;
end $$;

do $$ declare m text; begin
  select md5(pg_get_functiondef('public.rlms_undo_deal_calc_group'::regproc)) into m;
  if m <> '6d0fa2812a066a2242a893267fd72347' then raise exception 'rlms_undo_deal_calc_group p1 md5 %', m; end if;
end $$;

alter table public.deal_calc_scenarios alter column opportunity_id drop not null;

alter table public.deal_calc_scenarios
  add constraint deal_calc_scenarios_line_needs_opp
  check (opportunity_line_id is null or opportunity_id is not null);

alter table public.deal_calc_scenarios
  add constraint deal_calc_scenarios_pin_needs_opp
  check (not is_pinned or opportunity_id is not null);

create index deal_calc_scenarios_updated_idx
  on public.deal_calc_scenarios (updated_at desc)
  where deleted_at is null;

create index deal_calc_scenarios_unlinked_idx
  on public.deal_calc_scenarios (updated_at desc)
  where opportunity_id is null and deleted_at is null;

create or replace function public.rlms_undo_deal_calc_group(p_group uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  rec record;
  lock_rec record;
  cur jsonb;
  k text;
  op text;
  audit_op text;
  tbl text;
  pk bigint;
  patch jsonb;
  parts text[];
  col text;
  typ text;
  undo_group uuid := gen_random_uuid();
  restored int := 0;
  conflicts jsonb := '[]'::jsonb;
  orig_actor text;
  oldest timestamptz;
  already int;
  non_ok int;
  v_opp bigint;
  v_line bigint;
  v_deleted timestamptz;
  sibling bigint;
  v_touches_opp boolean := false;
  v_pinned boolean := false;
  v_sib_pinned boolean := false;
begin
  if p_group is null or coalesce(btrim(p_actor), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_group_or_actor', 'status', 400);
  end if;

  -- Lock the log rows before reading undone_at. Otherwise two undos of an
  -- insert-only group can both pass the check and each write an audit row.
  for lock_rec in
    select a.id
    from public.activity_log a
    where a.change_group = p_group
    order by a.id
    for update
  loop
    null;
  end loop;

  select min(a.actor), min(a.occurred_at),
    count(*) filter (where a.undone_at is not null),
    count(*) filter (where a.undoable is not true)
  into orig_actor, oldest, already, non_ok
  from public.activity_log a
  where a.change_group = p_group;

  if oldest is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'status', 404);
  end if;
  if already > 0 then
    return jsonb_build_object('ok', false, 'error', 'already_undone', 'status', 409);
  end if;
  if non_ok > 0 then
    return jsonb_build_object('ok', false, 'error', 'not_undoable', 'status', 400, 'message', 'Remarks and imports cannot be undone.');
  end if;
  if orig_actor::text is distinct from p_actor then
    return jsonb_build_object('ok', false, 'error', 'forbidden_actor', 'status', 403);
  end if;
  if oldest < now() - interval '24 hours' then
    return jsonb_build_object('ok', false, 'error', 'expired', 'status', 403);
  end if;

  if exists (
    select 1
    from public.activity_log a
    where a.change_group = p_group
      and (
        a.table_name is null
        or a.row_pk is null
        or a.table_name not in ('deal_calc_scenarios', 'deal_calc_assumption_sets')
      )
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_deal_calc_group',
      'status', 400,
      'message', 'undo refused: every row must be a deal calc table'
    );
  end if;

  for lock_rec in
    select distinct a.table_name, a.row_pk
    from public.activity_log a
    where a.change_group = p_group
    order by 1, 2
  loop
    execute format('select 1 from public.%I where id = $1 for update', lock_rec.table_name)
      using lock_rec.row_pk;
  end loop;

  for rec in
    select * from public.activity_log
    where change_group = p_group
    order by id desc
  loop
    tbl := rec.table_name;
    pk := rec.row_pk;
    op := coalesce(rec.detail->>'op', case
      when rec.before is null or rec.before = '{}'::jsonb then 'insert'
      when rec.after is null or rec.after = '{}'::jsonb then 'delete'
      else 'update'
    end);
    if op = 'insert' then
      continue;
    end if;
    execute format('select to_jsonb(t) from public.%I t where id = $1', tbl) into cur using pk;
    if cur is null and op = 'update' then
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'row missing'
      ));
      continue;
    end if;
    if rec.after is not null and rec.after <> '{}'::jsonb then
      for k in select jsonb_object_keys(rec.after) loop
        if not public.rlms_jsonb_key_matches(cur, rec.after, k) then
          conflicts := conflicts || jsonb_build_array(jsonb_build_object(
            'activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', format('changed since (%s)', k)
          ));
          exit;
        end if;
      end loop;
    end if;
  end loop;

  if jsonb_array_length(conflicts) > 0 then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'status', 409, 'conflicts', conflicts);
  end if;

  -- Restored opp/line come from the patch. A link undo that would re-pin
  -- beside a live pin returns conflict before any write. Pin-only groups
  -- (no opportunity_id key) keep the p1 demote and are not pre-checked.
  select exists (
    select 1
    from public.activity_log a
    where a.change_group = p_group
      and a.table_name = 'deal_calc_scenarios'
      and (
        coalesce(a.before, '{}'::jsonb) ? 'opportunity_id'
        or coalesce(a.after, '{}'::jsonb) ? 'opportunity_id'
      )
  ) into v_touches_opp;

  if v_touches_opp then
    for rec in
      select distinct a.row_pk as pk
      from public.activity_log a
      where a.change_group = p_group
        and a.table_name = 'deal_calc_scenarios'
      order by 1
    loop
      select s.opportunity_id, s.opportunity_line_id, s.deleted_at, s.is_pinned
        into v_opp, v_line, v_deleted, v_pinned
      from public.deal_calc_scenarios s
      where s.id = rec.pk;
      for lock_rec in
        select a.before
        from public.activity_log a
        where a.change_group = p_group
          and a.table_name = 'deal_calc_scenarios'
          and a.row_pk = rec.pk
        order by a.id desc
      loop
        if coalesce(lock_rec.before, '{}'::jsonb) ? 'opportunity_id' then
          if lock_rec.before->'opportunity_id' = 'null'::jsonb then v_opp := null;
          else v_opp := (lock_rec.before->>'opportunity_id')::bigint;
          end if;
        end if;
        if coalesce(lock_rec.before, '{}'::jsonb) ? 'opportunity_line_id' then
          if lock_rec.before->'opportunity_line_id' = 'null'::jsonb then v_line := null;
          else v_line := (lock_rec.before->>'opportunity_line_id')::bigint;
          end if;
        end if;
        if coalesce(lock_rec.before, '{}'::jsonb) ? 'deleted_at' then
          if lock_rec.before->'deleted_at' = 'null'::jsonb then v_deleted := null;
          else v_deleted := (lock_rec.before->>'deleted_at')::timestamptz;
          end if;
        end if;
        if coalesce(lock_rec.before, '{}'::jsonb) ? 'is_pinned' then
          v_pinned := coalesce(lock_rec.before->>'is_pinned', '') in ('true', 't');
        end if;
      end loop;
      if v_opp is not null and v_pinned and v_deleted is null then
        sibling := null;
        select s.id into sibling
        from public.deal_calc_scenarios s
        where s.opportunity_id = v_opp
          and coalesce(s.opportunity_line_id, 0) = coalesce(v_line, 0)
          and s.is_pinned
          and s.deleted_at is null
          and s.id <> rec.pk;
        if sibling is not null then
          select s.is_pinned into v_sib_pinned
          from public.deal_calc_scenarios s
          where s.id = sibling;
          for lock_rec in
            select a.before
            from public.activity_log a
            where a.change_group = p_group
              and a.table_name = 'deal_calc_scenarios'
              and a.row_pk = sibling
            order by a.id desc
          loop
            if coalesce(lock_rec.before, '{}'::jsonb) ? 'is_pinned' then
              v_sib_pinned := coalesce(lock_rec.before->>'is_pinned', '') in ('true', 't');
            end if;
            if coalesce(lock_rec.before, '{}'::jsonb) ? 'deleted_at'
               and lock_rec.before->'deleted_at' is distinct from 'null'::jsonb then
              v_sib_pinned := false;
            end if;
          end loop;
          if v_sib_pinned then
            return jsonb_build_object(
              'ok', false,
              'error', 'conflict',
              'status', 409,
              'message', 'pin slot taken',
              'conflicts', jsonb_build_array(jsonb_build_object(
                'table_name', 'deal_calc_scenarios',
                'row_pk', rec.pk,
                'reason', 'pin slot taken'
              ))
            );
          end if;
        end if;
      end if;
    end loop;
  end if;


  for rec in
    select * from public.activity_log
    where change_group = p_group
    order by id desc
  loop
    tbl := rec.table_name;
    pk := rec.row_pk;
    op := coalesce(rec.detail->>'op', case
      when rec.before is null or rec.before = '{}'::jsonb then 'insert'
      when rec.after is null or rec.after = '{}'::jsonb then 'delete'
      else 'update'
    end);
    if op = 'insert' then
      execute format('delete from public.%I where id = $1', tbl) using pk;
      audit_op := 'delete';
    else
      patch := coalesce(rec.before, '{}'::jsonb) - 'updated_at' - 'id';
      if tbl = 'deal_calc_scenarios' then
        select s.opportunity_id, s.opportunity_line_id, s.deleted_at
          into v_opp, v_line, v_deleted
        from public.deal_calc_scenarios s
        where s.id = pk;
        if patch ? 'opportunity_id' then
          if patch->'opportunity_id' = 'null'::jsonb then
            v_opp := null;
          else
            v_opp := (patch->>'opportunity_id')::bigint;
          end if;
        end if;
        if patch ? 'opportunity_line_id' then
          if patch->'opportunity_line_id' = 'null'::jsonb then
            v_line := null;
          else
            v_line := (patch->>'opportunity_line_id')::bigint;
          end if;
        end if;
        if patch ? 'deleted_at' then
          if patch->'deleted_at' = 'null'::jsonb then
            v_deleted := null;
          else
            v_deleted := (patch->>'deleted_at')::timestamptz;
          end if;
        end if;
        if v_opp is null then
          patch := jsonb_set(patch, '{is_pinned}', 'false'::jsonb);
          patch := jsonb_set(patch, '{opportunity_line_id}', 'null'::jsonb);
        elsif patch ? 'is_pinned' and coalesce(patch->>'is_pinned', '') in ('true', 't') and v_deleted is null then
          sibling := null;
          select s.id into sibling
          from public.deal_calc_scenarios s
          where s.opportunity_id = v_opp
            and coalesce(s.opportunity_line_id, 0) = coalesce(v_line, 0)
            and s.is_pinned
            and s.deleted_at is null
            and s.id <> pk
          for update;
          if sibling is not null and not v_touches_opp then
            patch := jsonb_set(patch, '{is_pinned}', 'false'::jsonb);
          end if;
        end if;
      end if;
      parts := array[]::text[];
      for col, typ in
        select a.attname, format_type(a.atttypid, a.atttypmod)
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = tbl
          and a.attnum > 0
          and not a.attisdropped
      loop
        if patch ? col and col not in ('id', 'updated_at') then
          if patch->col = 'null'::jsonb then
            parts := array_append(parts, format('%I = NULL', col));
          else
            parts := array_append(parts, format('%I = ($1->>%L)::%s', col, col, typ));
          end if;
        end if;
      end loop;
      if coalesce(array_length(parts, 1), 0) > 0 then
        execute format('update public.%I set %s where id = $2', tbl, array_to_string(parts, ', '))
          using patch, pk;
      end if;
      audit_op := 'update';
    end if;
    restored := restored + 1;
    insert into public.activity_log (
      entity_type, entity_id, action, actor, railcar_id, rider_id, detail, source, occurred_at,
      change_group, table_name, row_pk, before, after, undoable, undo_of
    ) values (
      rec.entity_type,
      rec.entity_id,
      'undo',
      p_actor,
      rec.railcar_id,
      rec.rider_id,
      jsonb_build_object('op', audit_op, 'undid', rec.action, 'original_group', p_group::text),
      'undo',
      now(),
      undo_group,
      rec.table_name,
      rec.row_pk,
      rec.after,
      rec.before,
      false,
      rec.id
    );
  end loop;

  update public.activity_log
     set undone_at = now(), undone_by = p_actor
   where change_group = p_group;

  return jsonb_build_object(
    'ok', true,
    'restored', restored,
    'undo_group', undo_group,
    'original_group', p_group
  );
end;
$function$;



revoke all on function public.rlms_undo_deal_calc_group(uuid, text) from public, anon, authenticated;
grant execute on function public.rlms_undo_deal_calc_group(uuid, text) to service_role;

create or replace function public.rlms_undo_calc_create_opp(p_calc uuid, p_core uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
  v_err text;
  v_row record;
  v_cur jsonb;
  v_key text;
begin
  if p_calc is null or p_core is null or p_calc = p_core or coalesce(btrim(p_actor), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_link', 'status', 400);
  end if;

  perform 1
  from public.activity_log a
  where a.change_group in (p_calc, p_core)
  order by a.id
  for update;

  if not exists (select 1 from public.activity_log where change_group = p_calc)
     or not exists (select 1 from public.activity_log where change_group = p_core) then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'status', 404);
  end if;

  if exists (
    select 1
    from public.activity_log a
    where a.change_group = p_calc
      and (
        a.table_name is distinct from 'deal_calc_scenarios'
        or coalesce(a.detail->>'link_kind', '') <> 'calc_create_opp'
        or coalesce(a.detail->>'linked_group', '') is distinct from p_core::text
        or a.actor is distinct from p_actor
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_link', 'status', 400);
  end if;

  if exists (
    select 1
    from public.activity_log a
    where a.change_group = p_core
      and (
        a.table_name not in ('opportunities', 'opportunity_lines')
        or coalesce(a.detail->>'op', '') <> 'insert'
        or coalesce(a.detail->>'link_kind', '') <> 'calc_create_opp'
        or coalesce(a.detail->>'linked_group', '') is distinct from p_calc::text
        or a.actor is distinct from p_actor
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_link', 'status', 400);
  end if;

  -- Frozen rlms_undo_change_group skips the changed-since check for inserts and
  -- deletes the row anyway. An opportunity or line edited after creation has to
  -- refuse here, before either undo runs, so neither group changes.
  for v_row in
    select a.table_name, a.row_pk, a.after
    from public.activity_log a
    where a.change_group = p_core
      and coalesce(a.detail->>'op', '') = 'insert'
      and a.after is not null
      and a.after <> '{}'::jsonb
      and a.table_name in ('opportunities', 'opportunity_lines')
  loop
    execute format('select to_jsonb(t) from public.%I t where id = $1', v_row.table_name)
      into v_cur
      using v_row.row_pk;
    if v_cur is null then
      continue;
    end if;
    for v_key in select jsonb_object_keys(v_row.after) loop
      if not public.rlms_jsonb_key_matches(v_cur, v_row.after, v_key) then
        return jsonb_build_object(
          'ok', false,
          'error', 'conflict',
          'status', 409,
          'message', format('changed since (%s)', v_key)
        );
      end if;
    end loop;
  end loop;

  begin
    v_result := public.rlms_undo_deal_calc_group(p_calc, p_actor);
    if coalesce(v_result->>'ok', '') <> 'true' then
      raise exception 'WRAP_FAIL:%', v_result;
    end if;
    v_result := public.rlms_undo_change_group(p_core, p_actor);
    if coalesce(v_result->>'ok', '') <> 'true' then
      raise exception 'WRAP_FAIL:%', v_result;
    end if;
  exception
    when others then
      v_err := SQLERRM;
      if v_err like 'WRAP_FAIL:%' then
        return substring(v_err from 11)::jsonb;
      end if;
      raise;
  end;

  return jsonb_build_object('ok', true, 'calc_group', p_calc, 'core_group', p_core);
end;
$function$;

revoke all on function public.rlms_undo_calc_create_opp(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rlms_undo_calc_create_opp(uuid, uuid, text) to service_role;

do $$
declare
  cfg text;
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('deal_calc_assumption_sets','deal_calc_scenarios')
      and grantee in ('anon','authenticated','PUBLIC')
  ) then
    raise exception 'anon, authenticated, or public grants remain on deal calc tables';
  end if;
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('deal_calc_assumption_sets','deal_calc_scenarios')
      and c.relrowsecurity is not true
  ) then
    raise exception 'RLS is off on a deal calc table';
  end if;
  select proconfig::text into cfg from pg_proc where proname = 'rlms_undo_deal_calc_group';
  if cfg is null or position('search_path=public, pg_temp' in cfg) = 0 then
    raise exception 'rlms_undo_deal_calc_group search_path is %', cfg;
  end if;
  select proconfig::text into cfg from pg_proc where proname = 'rlms_undo_calc_create_opp';
  if cfg is null or position('search_path=public, pg_temp' in cfg) = 0 then
    raise exception 'rlms_undo_calc_create_opp search_path is %', cfg;
  end if;
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('rlms_undo_deal_calc_group', 'rlms_undo_calc_create_opp')
      and p.prosecdef is not true
  ) then
    raise exception 'deal-calc undo functions must be security definer';
  end if;
  if has_function_privilege('anon', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')
     or has_function_privilege('public', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.rlms_undo_calc_create_opp(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.rlms_undo_calc_create_opp(uuid,uuid,text)', 'execute')
     or has_function_privilege('public', 'public.rlms_undo_calc_create_opp(uuid,uuid,text)', 'execute') then
    raise exception 'deal-calc undo is executable outside service_role';
  end if;
  if not has_function_privilege('service_role', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.rlms_undo_calc_create_opp(uuid,uuid,text)', 'execute') then
    raise exception 'service_role cannot execute a deal-calc undo function';
  end if;
  select md5(pg_get_functiondef('public.rlms_undo_deal_calc_group'::regproc)) into cfg;
  if cfg <> '79ff0afc077af1b807f4d4399698e514' then raise exception 'rlms_undo_deal_calc_group v2 md5 %', cfg; end if;
end $$;

do $$ declare m text; begin
  select md5(pg_get_functiondef('public.rlms_apply_jsonb_patch'::regproc)) into m;
  if m <> '66be7d422ec47e8c711f83c8ca001c79' then raise exception 'rlms_apply_jsonb_patch md5 %', m; end if;
  select md5(pg_get_functiondef('public.rlms_undo_change_group'::regproc)) into m;
  if m <> 'fda2979bbd2d37e82c936b0abcdf8927' then raise exception 'rlms_undo_change_group md5 %', m; end if;
  select md5(pg_get_functiondef('public.rlms_referenced_outside_group'::regproc)) into m;
  if m <> 'ee76481bbbeb897c18d4f0349e9c0f2d' then raise exception 'rlms_referenced_outside_group md5 %', m; end if;
  select md5(pg_get_functiondef('public.rlms_fk_outside_group'::regproc)) into m;
  if m <> 'b997a1a457d73f865b29560eeef625a6' then raise exception 'rlms_fk_outside_group md5 %', m; end if;
end $$;

commit;
