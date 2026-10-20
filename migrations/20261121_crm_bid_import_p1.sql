-- Bid Import P1. One transaction. Do not apply to live until Bruce says so.
-- Sorts after migrations/20261120_crm_deal_calc_p1.sql.
-- Live newest migration on 2026-10-20 is 20261020144835 crm_deal_calc_p1.
--
-- Read-only checks on eweydhfduepaefshriar, 2026-10-20, after master 6262000:
--   opportunities_source_check = source IN (auto_expiry, manual, trinity,
--     handoff, umler, referral, inbound). One live row, source manual,
--     type purchase, rider_id null. It satisfies the new auto_expiry check.
--   No triggers on opportunities.
--   companies.id is bigint.
--   attachments_doc_category_check already allows bid_sheet.
--   attachments_source_module_check already allows crm.
--   activity_log_entity_type_check is left unchanged. crm_bid_import_mappings
--   is a convenience cache and is not change-captured.
--   The four undo functions are NOT modified. This file only asserts
--   md5(pg_get_functiondef(oid)):
--     rlms_apply_jsonb_patch          66be7d422ec47e8c711f83c8ca001c79
--     rlms_undo_change_group          fda2979bbd2d37e82c936b0abcdf8927
--     rlms_referenced_outside_group   ee76481bbbeb897c18d4f0349e9c0f2d
--     rlms_fk_outside_group           b997a1a457d73f865b29560eeef625a6

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

do $$ begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    raise exception 'public.set_updated_at() is missing';
  end if;
  if (
    select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'companies' and column_name = 'id'
  ) is distinct from 'bigint' then
    raise exception 'companies.id is not bigint';
  end if;
end $$;

alter table public.opportunities drop constraint opportunities_source_check;
alter table public.opportunities add constraint opportunities_source_check
  check (source = btrim(source) and length(source) between 1 and 60);
alter table public.opportunities add constraint opportunities_source_auto_expiry_check
  check (source <> 'auto_expiry' or (type = 'renewal' and rider_id is not null));

create function public.opportunities_guard_auto_expiry()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.source is distinct from new.source
     and (old.source = 'auto_expiry' or new.source = 'auto_expiry') then
    raise exception 'source cannot change to or from auto_expiry';
  end if;
  return new;
end $$;

revoke all on function public.opportunities_guard_auto_expiry() from public, anon, authenticated;
grant execute on function public.opportunities_guard_auto_expiry() to service_role;

create trigger opportunities_guard_auto_expiry
  before update of source on public.opportunities
  for each row execute function public.opportunities_guard_auto_expiry();

create table public.crm_bid_import_mappings (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  header_signature text not null,
  mapping jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index crm_bid_import_mappings_company_sig_uq
  on public.crm_bid_import_mappings(company_id, header_signature) where deleted_at is null;

create trigger crm_bid_import_mappings_set_updated_at
  before update on public.crm_bid_import_mappings
  for each row execute function public.set_updated_at();

alter table public.crm_bid_import_mappings enable row level security;

revoke all on public.crm_bid_import_mappings from anon, authenticated;
grant select, insert, update, delete on public.crm_bid_import_mappings to service_role;
grant usage, select on sequence public.crm_bid_import_mappings_id_seq to service_role;

commit;
