-- Down migration for Deal Calculator P1.
-- Refuses, with counts, when any scenario exists or any non-seed assumption
-- set exists. Does not modify the four undo functions. Re-asserts their md5,
-- then drops only the objects this migration added.

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

do $$
declare
  scenarios bigint;
  extras bigint;
  logged bigint;
begin
  select count(*) into scenarios from public.deal_calc_scenarios;
  select count(*) into extras from public.deal_calc_assumption_sets
    where not (name = 'Residco default 2026' and is_default and deleted_at is null and created_by = 'migration');
  select count(*) into logged from public.activity_log
    where entity_type in ('deal_calc_scenario','deal_calc_assumption_set');
  if scenarios > 0 or extras > 0 or logged > 0 then
    raise exception 'down refused: % scenario row(s), % non-seed assumption set(s), % change-log row(s)', scenarios, extras, logged;
  end if;
end $$;

drop trigger if exists trg_deal_calc_scenarios_line_matches on public.deal_calc_scenarios;
drop trigger if exists trg_deal_calc_scenarios_updated_at on public.deal_calc_scenarios;
drop trigger if exists trg_deal_calc_assumption_sets_updated_at on public.deal_calc_assumption_sets;
drop function if exists public.crm_calc_scenario_line_matches();
drop table if exists public.deal_calc_scenarios;
drop table if exists public.deal_calc_assumption_sets;

alter table public.activity_log drop constraint if exists activity_log_entity_type_check;
alter table public.activity_log add constraint activity_log_entity_type_check
  check ((entity_type = any (array[
    'railcar'::text,
    'rider'::text,
    'program'::text,
    'program_car'::text,
    'master_lease'::text,
    'account'::text,
    'opportunity'::text,
    'crm_activity'::text,
    'company'::text,
    'company_contact'::text,
    'opportunity_contact'::text,
    'opportunity_line'::text
  ])));

commit;
