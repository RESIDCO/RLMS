-- CRM Bid P1.1. One transaction. Do not apply to live until Bruce says so.
-- Sorts after migrations/20261118_crm_bid_p1.sql.
--
-- Adds doc_category and opportunity_line_id on attachments.
-- Nullable, no default: the existing Lease Management rows stay NULL and the
-- table is not rewritten. doc_class is not touched.
--
-- The four undo functions are NOT modified. This file only asserts
-- md5(pg_get_functiondef(oid)) against the live post-Bid-P1 bodies.
-- No GRANT or REVOKE on attachments, and none on those four functions.
--
-- Post-Bid-P1 md5 (pg_get_functiondef), verified 19 Oct 2026:
--   rlms_apply_jsonb_patch          66be7d422ec47e8c711f83c8ca001c79
--   rlms_undo_change_group          fda2979bbd2d37e82c936b0abcdf8927
--   rlms_referenced_outside_group   ee76481bbbeb897c18d4f0349e9c0f2d
--   rlms_fk_outside_group           b997a1a457d73f865b29560eeef625a6

begin;

set local lock_timeout = '5s';

do $$ declare m text; begin
  select md5(pg_get_functiondef('public.rlms_apply_jsonb_patch(text,bigint,jsonb)'::regprocedure)) into m;
  if m <> '66be7d422ec47e8c711f83c8ca001c79' then raise exception 'apply_jsonb_patch md5 %', m; end if;
  select md5(pg_get_functiondef('public.rlms_undo_change_group(uuid,text)'::regprocedure)) into m;
  if m <> 'fda2979bbd2d37e82c936b0abcdf8927' then raise exception 'undo_change_group md5 %', m; end if;
  select md5(pg_get_functiondef('public.rlms_referenced_outside_group(text,bigint,uuid)'::regprocedure)) into m;
  if m <> 'ee76481bbbeb897c18d4f0349e9c0f2d' then raise exception 'referenced_outside_group md5 %', m; end if;
  select md5(pg_get_functiondef('public.rlms_fk_outside_group(text,text,bigint,uuid)'::regprocedure)) into m;
  if m <> 'b997a1a457d73f865b29560eeef625a6' then raise exception 'fk_outside_group md5 %', m; end if;
end $$;

create temp table bid_p11_guard (name text primary key, def text) on commit drop;
insert into bid_p11_guard (name, def)
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.attachments'::regclass
  and conname in ('attachments_source_module_check', 'attachments_entity_type_check');

alter table public.attachments add column doc_category text;
alter table public.attachments add column opportunity_line_id bigint
  references public.opportunity_lines(id) on delete restrict;

alter table public.attachments add constraint attachments_doc_category_check check (
  doc_category is null or (entity_type = 'opportunity' and doc_category in
  ('bid_sheet','drawings','inspection','correspondence','pricing','legal','other')));
alter table public.attachments add constraint attachments_opp_line_scope_check check (
  opportunity_line_id is null or entity_type = 'opportunity');

create function public.crm_attachment_line_matches() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.opportunity_line_id is not null and not exists (
       select 1 from public.opportunity_lines l
       where l.id = new.opportunity_line_id and l.opportunity_id = new.entity_id) then
    raise exception 'opportunity_line % is not on opportunity %', new.opportunity_line_id, new.entity_id;
  end if;
  return new;
end $$;

-- Trigger-only. Drop the default PUBLIC execute. service_role is the API
-- writer; without EXECUTE a pinned upload fails. No other grants change.
revoke execute on function public.crm_attachment_line_matches() from public, anon, authenticated;
grant execute on function public.crm_attachment_line_matches() to service_role;

-- Lease rows never reach this lookup. A pin on a non-opportunity row is
-- rejected by attachments_opp_line_scope_check. The WHEN clause keeps that
-- check as the error, instead of reporting "is not on opportunity".
create trigger trg_attachments_line_matches
  before insert or update of opportunity_line_id, entity_id
  on public.attachments
  for each row
  when (new.opportunity_line_id is not null and new.entity_type = 'opportunity')
  execute function public.crm_attachment_line_matches();

create index attachments_opp_line_idx on public.attachments (opportunity_line_id)
  where opportunity_line_id is not null;

do $$
declare
  r record;
  nowdef text;
  n bigint;
  timeout text;
begin
  if (select count(*) from bid_p11_guard) <> 2 then
    raise exception 'expected the two existing attachment checks before this migration';
  end if;
  for r in select * from bid_p11_guard loop
    select pg_get_constraintdef(oid) into nowdef
    from pg_constraint
    where conrelid = 'public.attachments'::regclass and conname = r.name;
    if nowdef is distinct from r.def then
      raise exception 'constraint % changed', r.name;
    end if;
  end loop;
  select count(*) into n from public.attachments
   where doc_category is not null or opportunity_line_id is not null;
  if n <> 0 then
    raise exception 'existing attachment rows were changed (%)', n;
  end if;
  timeout := current_setting('lock_timeout');
  if timeout not in ('5s', '5000ms') then
    raise exception 'lock_timeout is %', timeout;
  end if;
end $$;

commit;
