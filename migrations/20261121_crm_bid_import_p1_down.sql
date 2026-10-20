-- Down migration for Bid Import P1. Refuse-only: free-text sources are
-- never remapped. Restores the live 7-value opportunities_source_check.
-- Does not modify the four undo functions.

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
  extras bigint;
begin
  select count(*) into extras from public.opportunities
    where source not in ('auto_expiry', 'manual', 'trinity', 'handoff', 'umler', 'referral', 'inbound');
  if extras > 0 then
    raise exception 'down refused: % opportunity source(s) are outside the 7 presets', extras;
  end if;
end $$;

drop trigger if exists opportunities_guard_auto_expiry on public.opportunities;
drop function if exists public.opportunities_guard_auto_expiry();

alter table public.opportunities drop constraint if exists opportunities_source_auto_expiry_check;
alter table public.opportunities drop constraint if exists opportunities_source_check;
alter table public.opportunities add constraint opportunities_source_check
  check (source in ('auto_expiry', 'manual', 'trinity', 'handoff', 'umler', 'referral', 'inbound'));

drop table if exists public.crm_bid_import_mappings;

commit;
