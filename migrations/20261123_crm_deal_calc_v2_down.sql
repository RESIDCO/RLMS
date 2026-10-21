-- Down migration for Deal Calculator v2.
-- Refuses, with a count, when any scenario has no opportunity. No auto-delete.
-- Drops the wrapper, the v2 checks and indexes, restores opportunity_id NOT NULL,
-- and recreates the p1 body of rlms_undo_deal_calc_group.
-- Strip begin/commit before apply_migration.
--
-- p1 rlms_undo_deal_calc_group md5: 6d0fa2812a066a2242a893267fd72347
-- v2 rlms_undo_deal_calc_group md5: 79ff0afc077af1b807f4d4399698e514

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

do $$ declare m text; n bigint; begin
  select md5(pg_get_functiondef('public.rlms_undo_deal_calc_group'::regproc)) into m;
  if m <> '79ff0afc077af1b807f4d4399698e514' then raise exception 'rlms_undo_deal_calc_group v2 md5 %', m; end if;
  select count(*) into n from public.deal_calc_scenarios where opportunity_id is null;
  if n > 0 then
    raise exception '% deal_calc_scenarios have no opportunity; link or delete them first', n;
  end if;
end $$;

drop function if exists public.rlms_undo_calc_create_opp(uuid, uuid, text);
drop function if exists public.rlms_create_opp_from_calc(text, uuid, uuid, jsonb, jsonb, bigint, jsonb);

alter table public.deal_calc_scenarios drop constraint if exists deal_calc_scenarios_line_needs_opp;
alter table public.deal_calc_scenarios drop constraint if exists deal_calc_scenarios_pin_needs_opp;
drop index if exists public.deal_calc_scenarios_updated_idx;
drop index if exists public.deal_calc_scenarios_unlinked_idx;

alter table public.deal_calc_scenarios alter column opportunity_id set not null;

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
      if tbl = 'deal_calc_scenarios' and patch ? 'is_pinned' and coalesce(patch->>'is_pinned', '') in ('true', 't') then
        select s.opportunity_id, s.opportunity_line_id, s.deleted_at
          into v_opp, v_line, v_deleted
        from public.deal_calc_scenarios s
        where s.id = pk;
        if patch ? 'deleted_at' then
          if patch->'deleted_at' = 'null'::jsonb then
            v_deleted := null;
          else
            v_deleted := (patch->>'deleted_at')::timestamptz;
          end if;
        end if;
        sibling := null;
        if v_deleted is null then
          select s.id into sibling
          from public.deal_calc_scenarios s
          where s.opportunity_id = v_opp
            and coalesce(s.opportunity_line_id, 0) = coalesce(v_line, 0)
            and s.is_pinned
            and s.deleted_at is null
            and s.id <> pk
          for update;
        end if;
        if v_deleted is not null or sibling is not null then
          patch := jsonb_set(patch, '{is_pinned}', 'false'::jsonb);
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

do $$
declare
  cfg text;
  m text;
begin
  select md5(pg_get_functiondef('public.rlms_undo_deal_calc_group'::regproc)) into m;
  if m <> '6d0fa2812a066a2242a893267fd72347' then raise exception 'rlms_undo_deal_calc_group p1 md5 %', m; end if;
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
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rlms_undo_deal_calc_group' and p.prosecdef
  ) then
    raise exception 'rlms_undo_deal_calc_group must be security definer';
  end if;
  if has_function_privilege('anon', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')
     or has_function_privilege('public', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute') then
    raise exception 'deal-calc undo is executable outside service_role';
  end if;
  if not has_function_privilege('service_role', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute') then
    raise exception 'service_role cannot execute rlms_undo_deal_calc_group';
  end if;
  if to_regprocedure('public.rlms_undo_calc_create_opp(uuid,uuid,text)') is not null then
    raise exception 'wrapper function still exists';
  end if;
  if to_regprocedure('public.rlms_create_opp_from_calc(text,uuid,uuid,jsonb,jsonb,bigint,jsonb)') is not null then
    raise exception 'create function still exists';
  end if;
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
