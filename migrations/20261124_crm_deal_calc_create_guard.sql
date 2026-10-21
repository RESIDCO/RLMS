-- Refuse reused change-group ids on create-opportunity-from-calc.
-- Repo only. Do not apply to Supabase from this change.
-- Strip begin/commit before apply_migration.
--
-- create or replace of rlms_create_opp_from_calc only. The four frozen
-- undo functions are not modified.
--
-- md5 (pg_get_functiondef) of rlms_create_opp_from_calc before this replace,
-- measured from the v2 body in migrations/20261123_crm_deal_calc_v2.sql:
--   4f82a1df36678f828ea814c8d622266f
-- md5 after this replace:
--   563be990e2a57cc71c98ae90d7a20248

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
  select md5(pg_get_functiondef('public.rlms_create_opp_from_calc(text,uuid,uuid,jsonb,jsonb,bigint,jsonb)'::regprocedure)) into m;
  if m <> '4f82a1df36678f828ea814c8d622266f' then raise exception 'rlms_create_opp_from_calc live md5 %', m; end if;
end $$;

create or replace function public.rlms_create_opp_from_calc(
  p_actor text,
  p_core_group uuid,
  p_calc_group uuid,
  p_opportunity jsonb,
  p_line jsonb,
  p_scenario_id bigint,
  p_scenario jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_opp public.opportunities;
  v_line public.opportunity_lines;
  v_scenario public.deal_calc_scenarios;
  v_old public.deal_calc_scenarios;
  v_line_id bigint := null;
  v_name text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_type text;
  v_flavor text;
  v_source text;
  v_snap jsonb;
begin
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'actor is required';
  end if;
  if p_core_group is null or p_calc_group is null or p_core_group = p_calc_group then
    raise exception 'change groups must be two different ids';
  end if;

  if exists (
    select 1
    from public.activity_log a
    where a.change_group in (p_core_group, p_calc_group)
  ) then
    raise exception 'change group already has activity';
  end if;
  if p_opportunity is null or jsonb_typeof(p_opportunity) <> 'object' then
    raise exception 'opportunity payload is required';
  end if;
  if p_scenario is null or jsonb_typeof(p_scenario) <> 'object' then
    raise exception 'scenario payload is required';
  end if;
  if nullif(p_opportunity->>'account_id', '') is null then
    raise exception 'account_id is required';
  end if;

  v_type := p_opportunity->>'type';
  if v_type not in ('renewal','relet','new_business','expansion','purchase','sale','sale_leaseback') then
    raise exception 'invalid opportunity type';
  end if;
  v_flavor := nullif(p_opportunity->>'flavor', '');
  if v_flavor is not null and (v_flavor <> 'portfolio_bid' or v_type <> 'purchase') then
    raise exception 'invalid opportunity flavor';
  end if;
  v_source := coalesce(nullif(p_opportunity->>'source', ''), 'manual');
  if v_source not in ('auto_expiry','manual','trinity','handoff','umler','referral','inbound') then
    raise exception 'invalid opportunity source';
  end if;

  if p_scenario_id is not null then
    select * into v_old
    from public.deal_calc_scenarios
    where id = p_scenario_id
    for update;
    if not found then
      raise exception 'scenario not found';
    end if;
    if v_old.deleted_at is not null then
      raise exception 'scenario not found';
    end if;
    if v_old.opportunity_id is not null then
      raise exception 'scenario is already linked';
    end if;
  end if;

  insert into public.opportunities (
    account_id, company_id, type, flavor, stage, source, owner,
    offering_name, car_count, car_type, expected_close, notes, created_by
  ) values (
    (p_opportunity->>'account_id')::bigint,
    nullif(p_opportunity->>'company_id', '')::bigint,
    v_type,
    v_flavor,
    coalesce(nullif(p_opportunity->>'stage', ''), 'identified'),
    v_source,
    nullif(p_opportunity->>'owner', ''),
    nullif(p_opportunity->>'offering_name', ''),
    nullif(p_opportunity->>'car_count', '')::int,
    nullif(p_opportunity->>'car_type', ''),
    nullif(p_opportunity->>'expected_close', '')::date,
    nullif(p_opportunity->>'notes', ''),
    coalesce(nullif(p_opportunity->>'created_by', ''), p_actor)
  ) returning * into v_opp;

  v_snap := to_jsonb(v_opp) - 'updated_at' - 'search_vector';
  insert into public.activity_log (
    entity_type, entity_id, action, actor, detail, source, occurred_at,
    change_group, table_name, row_pk, before, after, undoable
  ) values (
    'opportunity', v_opp.id, 'create_opportunity', p_actor,
    jsonb_build_object('op', 'insert', 'link_kind', 'calc_create_opp', 'linked_group', p_calc_group),
    'ui', now(), p_core_group, 'opportunities', v_opp.id,
    '{}'::jsonb, v_snap, true
  );

  if p_line is not null and jsonb_typeof(p_line) = 'object' then
    insert into public.opportunity_lines (
      opportunity_id, seller_deal_ref, car_type, aar_code, car_count,
      avg_build_year, lease_rate, lease_expiry, lessee_rating, notes
    ) values (
      v_opp.id,
      coalesce(nullif(p_line->>'seller_deal_ref', ''), '1'),
      nullif(p_line->>'car_type', ''),
      nullif(p_line->>'aar_code', ''),
      coalesce(nullif(p_line->>'car_count', '')::int, 0),
      nullif(p_line->>'avg_build_year', '')::int,
      nullif(p_line->>'lease_rate', '')::numeric,
      nullif(p_line->>'lease_expiry', '')::date,
      nullif(p_line->>'lessee_rating', ''),
      nullif(p_line->>'notes', '')
    ) returning * into v_line;
    v_line_id := v_line.id;
    v_snap := to_jsonb(v_line) - 'updated_at' - 'search_vector';
    insert into public.activity_log (
      entity_type, entity_id, action, actor, detail, source, occurred_at,
      change_group, table_name, row_pk, before, after, undoable
    ) values (
      'opportunity_line', v_line.id, 'create_opportunity_line', p_actor,
      jsonb_build_object('op', 'insert', 'link_kind', 'calc_create_opp', 'linked_group', p_calc_group),
      'ui', now(), p_core_group, 'opportunity_lines', v_line.id,
      '{}'::jsonb, v_snap, true
    );
  end if;

  v_name := nullif(btrim(coalesce(p_scenario->>'name', '')), '');
  if p_scenario_id is null then
    if v_name is null then
      raise exception 'name is required';
    end if;
    insert into public.deal_calc_scenarios (
      opportunity_id, opportunity_line_id, assumption_set_id, name, deal_type, method,
      post_lease_plan, calc_version, inputs, results, verdict, target_irr, stretch_irr,
      max_bid_per_car, wayne_bid_per_car, irr, npv, is_pinned, notes, created_by
    ) values (
      v_opp.id,
      v_line_id,
      nullif(p_scenario->>'assumption_set_id', '')::bigint,
      v_name,
      p_scenario->>'deal_type',
      p_scenario->>'method',
      coalesce(nullif(p_scenario->>'post_lease_plan', ''), 'sell'),
      coalesce(nullif(p_scenario->>'calc_version', ''), 'v2'),
      coalesce(p_scenario->'inputs', '{}'::jsonb),
      coalesce(p_scenario->'results', '{}'::jsonb),
      nullif(p_scenario->>'verdict', ''),
      coalesce(nullif(p_scenario->>'target_irr', '')::numeric, 0.105),
      coalesce(nullif(p_scenario->>'stretch_irr', '')::numeric, 0.090),
      nullif(p_scenario->>'max_bid_per_car', '')::numeric,
      nullif(p_scenario->>'wayne_bid_per_car', '')::numeric,
      nullif(p_scenario->>'irr', '')::numeric,
      nullif(p_scenario->>'npv', '')::numeric,
      false,
      nullif(p_scenario->>'notes', ''),
      coalesce(nullif(p_scenario->>'created_by', ''), p_actor)
    ) returning * into v_scenario;
    v_before := '{}'::jsonb;
    v_after := to_jsonb(v_scenario) - 'updated_at' - 'search_vector';
    insert into public.activity_log (
      entity_type, entity_id, action, actor, detail, source, occurred_at,
      change_group, table_name, row_pk, before, after, undoable
    ) values (
      'deal_calc_scenario', v_scenario.id, 'create_deal_calc_scenario', p_actor,
      jsonb_build_object(
        'op', 'insert', 'link_kind', 'calc_create_opp', 'linked_group', p_core_group, 'opportunity_id', v_opp.id
      ),
      'ui', now(), p_calc_group, 'deal_calc_scenarios', v_scenario.id,
      v_before, v_after, true
    );
  else
    if v_name is null then
      v_name := v_old.name;
    end if;
    update public.deal_calc_scenarios
       set opportunity_id = v_opp.id,
           opportunity_line_id = v_line_id,
           is_pinned = false,
           name = v_name
     where id = p_scenario_id
     returning * into v_scenario;
    if v_old.opportunity_id is distinct from v_scenario.opportunity_id then
      v_before := v_before || jsonb_build_object('opportunity_id', v_old.opportunity_id);
      v_after := v_after || jsonb_build_object('opportunity_id', v_scenario.opportunity_id);
    end if;
    if v_old.opportunity_line_id is distinct from v_scenario.opportunity_line_id then
      v_before := v_before || jsonb_build_object('opportunity_line_id', v_old.opportunity_line_id);
      v_after := v_after || jsonb_build_object('opportunity_line_id', v_scenario.opportunity_line_id);
    end if;
    if v_old.is_pinned is distinct from v_scenario.is_pinned then
      v_before := v_before || jsonb_build_object('is_pinned', v_old.is_pinned);
      v_after := v_after || jsonb_build_object('is_pinned', v_scenario.is_pinned);
    end if;
    if v_old.name is distinct from v_scenario.name then
      v_before := v_before || jsonb_build_object('name', v_old.name);
      v_after := v_after || jsonb_build_object('name', v_scenario.name);
    end if;
    insert into public.activity_log (
      entity_type, entity_id, action, actor, detail, source, occurred_at,
      change_group, table_name, row_pk, before, after, undoable
    ) values (
      'deal_calc_scenario', v_scenario.id, 'link_deal_calc_scenario', p_actor,
      jsonb_build_object(
        'op', 'update', 'link_kind', 'calc_create_opp', 'linked_group', p_core_group, 'opportunity_id', v_opp.id
      ),
      'ui', now(), p_calc_group, 'deal_calc_scenarios', v_scenario.id,
      v_before, v_after, true
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'opportunity', to_jsonb(v_opp) - 'updated_at' - 'search_vector',
    'opportunity_id', v_opp.id,
    'line_id', v_line_id,
    'scenario', to_jsonb(v_scenario) - 'updated_at' - 'search_vector',
    'change_group', p_calc_group,
    'core_group', p_core_group,
    'calc_group', p_calc_group
  );
end;
$function$;

revoke all on function public.rlms_create_opp_from_calc(text, uuid, uuid, jsonb, jsonb, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.rlms_create_opp_from_calc(text, uuid, uuid, jsonb, jsonb, bigint, jsonb) to service_role;

do $$
declare
  cfg text;
begin
  select proconfig::text into cfg from pg_proc where proname = 'rlms_create_opp_from_calc';
  if cfg is null or position('search_path=public, pg_temp' in cfg) = 0 then
    raise exception 'rlms_create_opp_from_calc search_path is %', cfg;
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rlms_create_opp_from_calc' and p.prosecdef
  ) then
    raise exception 'rlms_create_opp_from_calc must be security definer';
  end if;
  if has_function_privilege('anon', 'public.rlms_create_opp_from_calc(text,uuid,uuid,jsonb,jsonb,bigint,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.rlms_create_opp_from_calc(text,uuid,uuid,jsonb,jsonb,bigint,jsonb)', 'execute')
     or has_function_privilege('public', 'public.rlms_create_opp_from_calc(text,uuid,uuid,jsonb,jsonb,bigint,jsonb)', 'execute') then
    raise exception 'rlms_create_opp_from_calc is executable outside service_role';
  end if;
  if not has_function_privilege('service_role', 'public.rlms_create_opp_from_calc(text,uuid,uuid,jsonb,jsonb,bigint,jsonb)', 'execute') then
    raise exception 'service_role cannot execute rlms_create_opp_from_calc';
  end if;
  select md5(pg_get_functiondef('public.rlms_create_opp_from_calc(text,uuid,uuid,jsonb,jsonb,bigint,jsonb)'::regprocedure)) into cfg;
  if cfg <> '563be990e2a57cc71c98ae90d7a20248' then raise exception 'rlms_create_opp_from_calc md5 %', cfg; end if;
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
