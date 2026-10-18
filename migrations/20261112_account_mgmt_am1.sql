-- AM-1: owners, My Book, tier and cadence, viewer activities, prospect dedup.
--
-- APPLY AFTER the security lockdown stages (A–D).
-- If this migration is applied first, the exact-ACL snapshot used by the
-- lockdown rollback must be retaken right after AM-1, before stage A.
--
-- Does not change rlms_apply_jsonb_patch, rlms_undo_change_group, rent_events,
-- or any v_lease_* view. The only riders/master_leases statement is the
-- status_tag comment below. No data UPDATE. rider_financial_summary is read
-- only: every row for the snapshot month is summed. Rows that look alike are
-- separate slices when they differ (for example by former_deal). Do not
-- collapse them and do not modify the table.

begin;

-- 1. Tier and cadence on accounts (CRM-owned).
alter table public.accounts
  add column if not exists tier text,
  add column if not exists touch_cadence_days integer;

alter table public.accounts drop constraint if exists accounts_tier_check;
alter table public.accounts add constraint accounts_tier_check
  check (tier is null or tier in ('track_1', 'track_2', 'track_3'));

alter table public.accounts drop constraint if exists accounts_touch_cadence_check;
alter table public.accounts add constraint accounts_touch_cadence_check
  check (touch_cadence_days is null or touch_cadence_days between 7 and 365);

comment on column public.accounts.tier is
  'CRM account tier from the handoff briefing Track 1/2/3. Set from Account 360 only. Importers never write.';
comment on column public.accounts.touch_cadence_days is
  'Override for touch cadence in days. NULL = tier default (track_1 30, track_2 60, track_3 90). CRM only.';

-- 2. Effective owner. handoff_pct is NOT stored here: shared/account-transitions.ts
-- handoffScoreParts counts the incoming AM, not (status = complete). The API
-- computes the percent in TypeScript from the flag columns below.
create or replace view public.v_account_owner_effective
with (security_invoker = true) as
select a.id as account_id,
       nullif(btrim(a.account_manager), '') as owner_of_record,
       case when t.status = 'open' then nullif(btrim(t.to_account_manager), '') end as incoming_owner,
       coalesce(
         case when t.status = 'open' then nullif(btrim(t.to_account_manager), '') end,
         nullif(btrim(a.account_manager), '')
       ) as effective_owner,
       t.id as handoff_id,
       t.status as handoff_status,
       nullif(btrim(t.to_account_manager), '') as to_account_manager,
       t.meeting_scheduled,
       t.communication_completed,
       t.briefing_form_completed
from public.accounts a
left join public.account_transition_records t on t.account_id = a.id;

-- 3. Rent roll. Sum every rider_financial_summary slice for the latest
-- snapshot (car_type / entity / former_deal and the rest).
-- rider_financial_summary.rider_id is the rider NAME (for example OL1919),
-- not riders.id. Joining on riders.id::text sums every account to 0.
-- Import names with no riders row (Oct 2026: EA2312, OL1816, OL2611) are
-- returned with account_id null so they are not dropped.
create or replace view public.v_account_rent_roll
with (security_invoker = true) as
with snap as (
  select max(snapshot_month) as m from public.rider_financial_summary
),
acct_riders as (
  select distinct ml.account_id, r.rider_name
  from public.riders r
  join public.master_leases ml on ml.id = r.master_lease_id
  where ml.account_id is not null
    and coalesce(ml.is_placeholder, false) = false
    and nullif(btrim(r.rider_name), '') is not null
),
matched as (
  select ar.account_id,
         (select m from snap) as snapshot_month,
         coalesce(sum(f.monthly_rent_total), 0)::numeric as monthly_rent_total,
         count(distinct f.rider_id) as riders_in_import,
         count(distinct ar.rider_name) filter (where f.rider_id is null) as riders_without_summary,
         null::text as unmatched_rider_name
  from acct_riders ar
  left join public.rider_financial_summary f
    on f.rider_id = ar.rider_name
   and f.snapshot_month = (select m from snap)
  group by ar.account_id
),
unmatched as (
  select null::bigint as account_id,
         (select m from snap) as snapshot_month,
         coalesce(sum(f.monthly_rent_total), 0)::numeric as monthly_rent_total,
         count(*)::bigint as riders_in_import,
         0::bigint as riders_without_summary,
         f.rider_id as unmatched_rider_name
  from public.rider_financial_summary f
  where f.snapshot_month = (select m from snap)
    and not exists (
      select 1 from public.riders r where r.rider_name = f.rider_id
    )
  group by f.rider_id
)
select * from matched
union all
select * from unmatched;

-- 4. Grants match the lockdown. Safe before or after it.
revoke all on public.v_account_owner_effective, public.v_account_rent_roll from public, anon, authenticated;
grant select on public.v_account_owner_effective, public.v_account_rent_roll to service_role;

-- 5. Deprecate riders.status_tag. Comment only. No drop, no type change.
comment on column public.riders.status_tag is
  'DEPRECATED (AM-1, Oct 2026). Unused (0 rows). Replaced by CRM account-level health. Do not write. Column kept; do not drop.';

-- 6. crm_prospect_dedup: accounts, then companies, then at most 5 UMLER
-- owner groups. Same signature and return type. search_path matches stage D
-- so create or replace does not wipe it.
create or replace function public.crm_prospect_dedup(p_name text, p_marks text[] default '{}')
returns table (source text, id bigint, label text, kind text, reason text, reporting_marks text[])
language sql stable
set search_path = public, extensions, pg_temp
as $function$
  with marks as (
    select coalesce(array_agg(distinct upper(btrim(m))), '{}'::text[]) as arr
    from unnest(coalesce(p_marks, '{}'::text[])) m where btrim(m) <> ''
  ),
  name as (select btrim(coalesce(p_name, '')) as raw),
  party as (
    select case v.entity when 'account' then 1 else 2 end as src_rank,
           v.entity as source, v.entity_id as id, v.label, v.kind,
           exists (select 1 from unnest(coalesce(v.reporting_marks, '{}'::text[])) m, marks
                   where upper(btrim(m)) = any (marks.arr)) as mark_hit,
           case when name.raw <> '' then similarity(v.label, name.raw) else 0 end as sim,
           v.reporting_marks
    from v_crm_party_search v cross join name cross join marks
    where v.entity in ('account','company')
      and ((name.raw <> '' and similarity(v.label, name.raw) >= 0.4)
           or (cardinality(marks.arr) > 0 and exists (
                 select 1 from unnest(coalesce(v.reporting_marks, '{}'::text[])) m
                 where upper(btrim(m)) = any (marks.arr))))
  ),
  umler_hits as (
    select coalesce(nullif(btrim(u.owner_group), ''), nullif(btrim(u.umler_owner), ''), u.reporting_mark) as grp,
           u.id, u.reporting_mark,
           (upper(btrim(u.reporting_mark)) = any (marks.arr)) as mark_hit,
           greatest(similarity(coalesce(u.owner_group, ''), name.raw),
                    similarity(coalesce(u.umler_owner, ''), name.raw)) as sim
    from crm_umler_owner_ref u cross join name cross join marks
    where (name.raw <> '' and similarity(coalesce(u.owner_group, ''), name.raw) >= 0.4)
       or (name.raw <> '' and similarity(coalesce(u.umler_owner, ''), name.raw) >= 0.4)
       or (cardinality(marks.arr) > 0 and upper(btrim(u.reporting_mark)) = any (marks.arr))
  ),
  umler as (
    select 3 as src_rank, 'umler'::text as source, min(id) as id, grp as label, null::text as kind,
           bool_or(mark_hit) as mark_hit, max(sim) as sim,
           array_agg(distinct reporting_mark order by reporting_mark)
             filter (where reporting_mark is not null) as reporting_marks
    from umler_hits group by grp
    order by bool_or(mark_hit) desc, max(sim) desc, grp asc
    limit 5
  ),
  all_hits as (
    select src_rank, source, id, label, kind, mark_hit, sim, reporting_marks from party
    union all
    select src_rank, source, id, label, kind, mark_hit, sim, coalesce(reporting_marks, '{}') from umler
  )
  select source, id, label, kind,
         case when mark_hit then 'Reporting mark' else 'Similar name' end,
         coalesce(reporting_marks, '{}'::text[])
  from all_hits
  order by src_rank asc, mark_hit desc, sim desc, label asc, id asc
  limit 20;
$function$;

commit;
