-- READ ONLY. Propose riders.entity for Bruce to sign off.
-- Do not apply. No INSERT, UPDATE, DELETE, or change capture.
-- After sign-off, the apply step is a separate change-capture write.
--
--   psql "$DATABASE_URL" --csv -f script/preview_rider_entity.sql
--
-- Scope: riders whose name starts with OL, EA, or FL.
-- Active cars only (railcars.active). Inactive cars are ignored.
-- A rider's cars are the active cars whose latest railcar_assignments row
-- (assigned_at, then id) points at that rider.
-- proposed_entity is set only when every one of those cars has the same
-- non-null entity. No active cars, mixed entities, or a blank car entity
-- leave proposed_entity NULL.

with latest_assignment as (
  select distinct on (a.railcar_id)
    a.railcar_id,
    a.rider_id,
    c.entity as car_entity
  from public.railcar_assignments a
  join public.railcars c on c.id = a.railcar_id
  where c.active is true
  order by a.railcar_id, a.assigned_at desc nulls last, a.id desc
),
per_rider as (
  select
    rider_id,
    count(*)::int as active_cars,
    count(distinct car_entity) filter (where car_entity is not null)::int as distinct_car_entities,
    count(*) filter (where car_entity is null)::int as null_entity_cars,
    min(car_entity) as any_entity
  from latest_assignment
  group by rider_id
)
select
  r.id as rider_id,
  r.rider_name,
  r.entity as current_entity,
  case
    when coalesce(p.active_cars, 0) = 0 then null
    when p.null_entity_cars = 0 and p.distinct_car_entities = 1 then p.any_entity
    else null
  end as proposed_entity,
  coalesce(p.active_cars, 0) as active_car_count,
  coalesce(p.distinct_car_entities, 0) as distinct_car_entities,
  coalesce(p.null_entity_cars, 0) as null_entity_cars,
  case
    when coalesce(p.active_cars, 0) = 0 then 'no_active_cars'
    when p.null_entity_cars = 0 and p.distinct_car_entities = 1 then 'unanimous'
    when p.null_entity_cars > 0 and p.distinct_car_entities <= 1 then 'blank_car_entity'
    else 'mixed'
  end as proposal
from public.riders r
left join per_rider p on p.rider_id = r.id
where coalesce(r.rider_name, '') ~* '^(OL|EA|FL)'
order by r.rider_name, r.id;
