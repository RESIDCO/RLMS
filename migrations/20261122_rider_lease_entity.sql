-- Lease-level riders.entity. One transaction. Do not apply to live until Bruce says so.
-- Sorts after migrations/20261121_crm_bid_import_p1.sql.
--
-- riders.owner_entity is the legal owner and is not changed.
-- riders.entity uses the same three values as railcars.entity:
--   Main, Rail Partners Select, Coal. Null stays allowed for existing riders.
--
-- The four undo functions are NOT modified. rlms_apply_jsonb_patch patches
-- whatever columns exist on an allowlisted table, so a new riders column is
-- undoable without a function change. This file only asserts
-- md5(pg_get_functiondef(oid)):
--   rlms_apply_jsonb_patch          66be7d422ec47e8c711f83c8ca001c79
--   rlms_undo_change_group          fda2979bbd2d37e82c936b0abcdf8927
--   rlms_referenced_outside_group   ee76481bbbeb897c18d4f0349e9c0f2d
--   rlms_fk_outside_group           b997a1a457d73f865b29560eeef625a6
--
-- Grants: adding a column needs no new GRANT. Table privileges
-- (pg_class.relacl) cover every column, including columns added later.
-- Column privileges (pg_attribute.attacl) would not. This migration refuses
-- to add the column if any riders column already has its own ACL, and it
-- issues no GRANT or REVOKE. Replacing v_lease_rider_rollup keeps that
-- view's existing SELECT grant; the new output column is covered by it.

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
  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'riders'
      and a.attnum > 0
      and not a.attisdropped
      and a.attacl is not null
  ) then
    raise exception 'riders has column-level privileges; a new column would need its own grants';
  end if;
  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'v_lease_rider_rollup'
      and a.attnum > 0
      and not a.attisdropped
      and a.attname = 'entity'
  ) then
    raise exception 'v_lease_rider_rollup already has an entity column';
  end if;
end $$;

alter table public.riders add column entity text;

alter table public.riders add constraint riders_entity_check
  check (entity is null or entity in ('Main', 'Rail Partners Select', 'Coal'));

comment on column public.riders.entity is
  'Lease-level fleet entity (Main, Rail Partners Select, Coal), same values as railcars.entity. Null until set. Not the legal owner; that remains riders.owner_entity.';

-- Lease P1 view, plus entity appended. Existing columns stay in place so
-- CREATE OR REPLACE is valid and v_lease_lessee_rollup does not need a rebuild.
create or replace view public.v_lease_rider_rollup as
select
  rd.id as rider_id,
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
  rd.monthly_rent_per_car as rider_rent_per_car,
  ml.lessee,
  ml.lease_number,
  ml.is_placeholder,
  ml.merged_into_id as lessee_merged_into_id,
  count(c.id)::int as cars,
  count(*) filter (where c.fleet_status = 'Leased')::int as on_rent,
  count(*) filter (where c.id is not null and c.fleet_status is distinct from 'Leased')::int as off_rent,
  coalesce(sum(
    case when c.fleet_status = 'Leased'
      then coalesce(c.monthly_rent_per_car, rd.monthly_rent_per_car, 0)
      else 0 end
  ), 0)::numeric as monthly_rent,
  rd.expiration_date as next_expiration,
  count(*) filter (
    where c.fleet_status = 'Leased'
      and rd.expiration_date is not null
      and rd.expiration_date <= (current_date + interval '6 months')
  )::int as cars_expiring_6mo,
  count(*) filter (
    where c.fleet_status = 'Leased'
      and rd.expiration_date is not null
      and rd.expiration_date <= (current_date + interval '12 months')
  )::int as cars_expiring_12mo,
  case
    when rd.expiration_date is not null
      and rd.expiration_date <= (current_date + interval '6 months')
      and count(*) filter (where c.fleet_status = 'Leased') > 0
    then 1 else 0
  end::int as ol_expiring_6mo,
  case
    when rd.expiration_date is not null
      and rd.expiration_date <= (current_date + interval '12 months')
      and count(*) filter (where c.fleet_status = 'Leased') > 0
    then 1 else 0
  end::int as ol_expiring_12mo,
  rd.entity
from public.riders rd
join public.master_leases ml on ml.id = rd.master_lease_id
left join public.railcar_assignments a on a.rider_id = rd.id
left join public.railcars c on c.id = a.railcar_id and c.active = true
group by rd.id, ml.id;

commit;
