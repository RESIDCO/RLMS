-- Down for riders.entity. Does not modify the four undo functions.
-- Drops the column after restoring v_lease_rider_rollup to the Lease P1
-- shape. v_lease_lessee_rollup depends on that view, so it is dropped and
-- recreated. DROP removes its grant; the grant below only puts that SELECT
-- back. No other privileges change.

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

drop view public.v_lease_lessee_rollup;
drop view public.v_lease_rider_rollup;

create view public.v_lease_rider_rollup as
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
  end::int as ol_expiring_12mo
from public.riders rd
join public.master_leases ml on ml.id = rd.master_lease_id
left join public.railcar_assignments a on a.rider_id = rd.id
left join public.railcars c on c.id = a.railcar_id and c.active = true
group by rd.id, ml.id;

create view public.v_lease_lessee_rollup as
select
  ml.id as master_lease_id,
  coalesce(nullif(btrim(ml.lessee), ''), ml.lease_number) as lessee,
  ml.lease_number,
  ml.account_id,
  acc.account_manager,
  ml.mla_number,
  ml.mla_doc_url,
  ml.is_placeholder,
  ml.merged_into_id,
  coalesce(sum(rr.cars), 0)::int as cars,
  coalesce(sum(rr.on_rent), 0)::int as on_rent,
  coalesce(sum(rr.off_rent), 0)::int as off_rent,
  coalesce(sum(rr.monthly_rent), 0)::numeric as monthly_rent,
  count(*) filter (
    where coalesce(rr.lifecycle_status, case when rr.rider_name ~ '^OL' then 'active' end) = 'active'
      and rr.cars > 0
  )::int as ol_count,
  count(*) filter (
    where coalesce(rr.lifecycle_status, case when rr.rider_name ~ '^EA' then 'off_lease_pending_remarketing' end)
      = 'off_lease_pending_remarketing'
      and rr.cars > 0
  )::int as ea_count,
  min(rr.next_expiration) filter (where rr.cars > 0 and rr.on_rent > 0) as next_expiration,
  coalesce(sum(rr.cars_expiring_6mo), 0)::int as cars_expiring_6mo,
  coalesce(sum(rr.cars_expiring_12mo), 0)::int as cars_expiring_12mo,
  coalesce(sum(rr.ol_expiring_6mo), 0)::int as ols_expiring_6mo,
  coalesce(sum(rr.ol_expiring_12mo), 0)::int as ols_expiring_12mo
from public.master_leases ml
left join public.accounts acc on acc.id = ml.account_id
left join public.v_lease_rider_rollup rr on rr.master_lease_id = ml.id
group by ml.id, acc.account_manager;

grant select on public.v_lease_rider_rollup, public.v_lease_lessee_rollup to authenticated, service_role;

alter table public.riders drop constraint riders_entity_check;
alter table public.riders drop column entity;

commit;
