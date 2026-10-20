-- Down migration for CRM Bid P1.1.
-- Refuses, with counts, when any attachment uses doc_category or opportunity_line_id.
-- Does not modify the undo functions. Re-asserts their md5, then drops only
-- the objects this migration added. Lease Management rows are not updated.

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

do $$
declare
  categorized bigint;
  pinned bigint;
begin
  select count(*) into categorized from public.attachments where doc_category is not null;
  select count(*) into pinned from public.attachments where opportunity_line_id is not null;
  if categorized > 0 or pinned > 0 then
    raise exception 'down refused: % attachment row(s) have doc_category, % have opportunity_line_id', categorized, pinned;
  end if;
end $$;

drop trigger if exists trg_attachments_line_matches on public.attachments;
drop function if exists public.crm_attachment_line_matches();
drop index if exists public.attachments_opp_line_idx;
alter table public.attachments drop constraint if exists attachments_doc_category_check;
alter table public.attachments drop constraint if exists attachments_opp_line_scope_check;
alter table public.attachments drop column if exists opportunity_line_id;
alter table public.attachments drop column if exists doc_category;

commit;
