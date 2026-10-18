-- CRM Phase 1.1. Apply after 20261110_crm_p1.sql, before merge.
-- Does not alter riders, master_leases, railcar_assignments, attachments, or rent_events.
-- Does not add columns to riders or master_leases.
--
-- Recounted read-only on 18 Oct 2026 (project eweydhfduepaefshriar):
--   accounts 271 = client 165 + former 61 + prospect 2 + placeholder 43
--   unlinked companies 260 (259 with reporting marks), contacts 846 (734 on unlinked companies)
--   linked companies 37, opportunities 0
--
-- Pre-change live md5 (pg_get_functiondef), matched before this file was written:
--   rlms_apply_jsonb_patch  6487fa880a709f1e0fa5762154bd26b9
--   rlms_undo_change_group  f27e017089b260602c68f4095d7a762b
-- The function bodies below were copied from that live definition and then only the
-- Phase 1.1 entries were added.
--
-- v_crm_lessee_account has no is_client column (Phase 1 selects master_lease_id,
-- lessee, is_placeholder, account_id, company_id). The leased CTE inlines the
-- Phase 1 client rule used by the renewal generator: a current KPI assignment that
-- is on rent, not sold, fleet_status Leased, on a non-placeholder lessee, whose
-- rider passes isActiveRider (lifecycle active, or null with that on-rent car).
-- That predicate is 165 accounts. Georgia Pacific is former (lifecycle active,
-- zero on-rent Leased cars).
--
-- Placeholder names use the same rule as shared/lease-mgmt.ts isPlaceholderLessee
-- after 2357e06: btrim, then case-sensitive ^x[A-Z0-9&], or idle/available/unassigned
-- in any case. Xcel Energy and DTE stay in the picker. No second copy of the helper.

-- A) Optional flexibility fields (CRM-owned table)
alter table opportunities add column lessee_role text not null default 'lessee'
  check (lessee_role in ('lessee','sublessee'));
alter table opportunities add column tags text[] not null default '{}';
create index opportunities_tags_gin on opportunities using gin (tags);
alter table opportunities drop constraint opportunities_source_check;
alter table opportunities add constraint opportunities_source_check
  check (source in ('auto_expiry','manual','trinity','handoff','umler','referral','inbound'));
alter table opportunities add column referral_note text null;

-- A prospect company has to point at its account. The original check required
-- account_id to be null unless relationship_type = 'customer'. Broker is one of
-- the approved quick-create types.
alter table companies drop constraint companies_customer_requires_account;
alter table companies add constraint companies_customer_requires_account
  check (relationship_type <> 'customer' or account_id is not null);
alter table companies drop constraint companies_relationship_type_check;
alter table companies add constraint companies_relationship_type_check
  check (relationship_type = any (array['customer','prospect','lessor','railroad','vendor','unclassified','other','broker']));

-- B) Several contacts per opportunity
create table opportunity_contacts (
  id             bigserial primary key,
  opportunity_id bigint not null references opportunities(id) on delete cascade,
  contact_id     bigint not null references company_contacts(id) on delete cascade,
  role           text not null default 'contact'
                 check (role in ('primary','decision_maker','influencer','billing','contact')),
  created_at     timestamptz not null default now(),
  unique (opportunity_id, contact_id)
);
create index on opportunity_contacts (contact_id);

-- C) One search view for the picker (read-only).
-- email is extra so the API can match a contact address; it is not a response field.
-- The placeholder-name guard in each branch of v_crm_party_search (btrim, then
-- case-sensitive ^x[A-Z0-9&], or idle/available/unassigned in any case) must stay
-- in sync with isPlaceholderLessee in shared/lease-mgmt.ts.
create or replace view v_crm_party_search as
with lessee as (
  select ml.account_id,
         bool_or(not coalesce(ml.is_placeholder,false)) as has_real,
         bool_and(coalesce(ml.is_placeholder,false))    as all_ph
  from master_leases ml where ml.account_id is not null group by ml.account_id
), leased as (
  select distinct ml.account_id
  from v_rlms_kpi_car_rows k
  join riders r on r.id = k.rider_id
  join master_leases ml on ml.id = r.master_lease_id
  where k.on_rent is true
    and k.is_sold is not true
    and k.status_tag = 'Leased'
    and ml.account_id is not null
    and coalesce(ml.is_placeholder, false) = false
    and (
      r.lifecycle_status = 'active'
      or r.lifecycle_status is null
    )
)
select 'account'::text as entity, a.id as entity_id, a.id as account_id, co.id as company_id, null::bigint as contact_id,
       a.name as label,
       case when le.account_id is null then 'prospect'
            when a.id in (select account_id from leased) then 'client'
            else 'former' end as kind,
       co.reporting_marks, a.account_manager, null::text as email
from accounts a
left join lessee le on le.account_id = a.id
left join companies co on co.account_id = a.id and co.merged_into_id is null
where coalesce(le.all_ph,false) = false
  -- Must stay in sync with isPlaceholderLessee in shared/lease-mgmt.ts.
  and (le.account_id is not null or not (btrim(a.name) ~ '^x[A-Z0-9&]' or btrim(a.name) ~* '^(idle|available|unassigned)'))
union all
select 'company', c.id, null, c.id, null, c.name, 'company', c.reporting_marks, null, null::text
from companies c where c.account_id is null and c.merged_into_id is null
  -- Must stay in sync with isPlaceholderLessee in shared/lease-mgmt.ts.
  and not (btrim(c.name) ~ '^x[A-Z0-9&]' or btrim(c.name) ~* '^(idle|available|unassigned)')
union all
select 'contact', cc.id, c.account_id, c.id, cc.id, cc.name || ' — ' || c.name, 'contact', c.reporting_marks, null, cc.email
from company_contacts cc join companies c on c.id = cc.company_id
left join lessee le on le.account_id = c.account_id
where c.merged_into_id is null
  and (c.account_id is null or c.account_id not in (select account_id from lessee where all_ph))
  -- Must stay in sync with isPlaceholderLessee in shared/lease-mgmt.ts.
  and not (
    coalesce(le.has_real, false) = false
    and (btrim(c.name) ~ '^x[A-Z0-9&]' or btrim(c.name) ~* '^(idle|available|unassigned)')
  );
grant select on v_crm_party_search to authenticated, service_role;

-- Ranked picker search. Service role only; the API is the caller.
create or replace function public.crm_search_parties(p_q text, p_limit int default 20)
returns table (
  entity text,
  entity_id bigint,
  account_id bigint,
  company_id bigint,
  contact_id bigint,
  label text,
  kind text,
  reporting_marks text[],
  account_manager text
)
language sql
stable
as $function$
  with q as (
    select
      btrim(coalesce(p_q, '')) as raw,
      upper(btrim(coalesce(p_q, ''))) as mark,
      replace(replace(replace(btrim(coalesce(p_q, '')), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') as esc
  )
  select v.entity, v.entity_id, v.account_id, v.company_id, v.contact_id, v.label, v.kind, v.reporting_marks, v.account_manager
  from v_crm_party_search v
  cross join q
  where q.raw = ''
     or v.label ilike '%' || q.esc || '%' escape '\'
     or (q.raw <> '' and similarity(v.label, q.raw) > 0.2)
     or (
       q.mark <> ''
       and exists (
         select 1 from unnest(coalesce(v.reporting_marks, '{}'::text[])) m
         where upper(btrim(m)) = q.mark
       )
     )
     or (v.email is not null and q.raw <> '' and v.email ilike q.esc escape '\')
  order by
    case v.kind
      when 'client' then 1
      when 'prospect' then 2
      when 'former' then 3
      when 'company' then 4
      when 'contact' then 5
      else 6
    end,
    greatest(
      similarity(v.label, q.raw),
      case
        when q.mark <> '' and exists (
          select 1 from unnest(coalesce(v.reporting_marks, '{}'::text[])) m
          where upper(btrim(m)) = q.mark
        ) then 1
        else 0
      end,
      case when v.email is not null and q.raw <> '' and v.email ilike q.esc escape '\' then 1 else 0 end
    ) desc,
    v.label
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$function$;

revoke all on function public.crm_search_parties(text, int) from public, anon, authenticated;
grant execute on function public.crm_search_parties(text, int) to service_role;

-- D) UMLER owner reference (read-only snapshot, CRM-owned). Filled by script/load_crm_umler_owner_ref.py.
-- Created before crm_prospect_dedup: LANGUAGE sql is parsed at CREATE time.
create table crm_umler_owner_ref (
  id bigserial primary key,
  reporting_mark text not null,
  owner_group    text null,
  umler_owner    text null,
  owner_segment  text null,
  car_count      int  null,
  snapshot_at    date not null,
  unique (reporting_mark)
);
create index on crm_umler_owner_ref using gin (owner_group gin_trgm_ops);
grant select, insert, update, delete on public.crm_umler_owner_ref to service_role;
grant usage, select on sequence public.crm_umler_owner_ref_id_seq to service_role;

create or replace function public.crm_prospect_dedup(p_name text, p_marks text[] default '{}')
returns table (
  source text,
  id bigint,
  label text,
  kind text,
  reason text,
  reporting_marks text[]
)
language sql
stable
as $function$
  with marks as (
    select coalesce(array_agg(distinct upper(btrim(m))), '{}'::text[]) as arr
    from unnest(coalesce(p_marks, '{}'::text[])) m
    where btrim(m) <> ''
  ),
  name as (
    select btrim(coalesce(p_name, '')) as raw
  )
  select * from (
    select 'account'::text as source, v.entity_id as id, v.label, v.kind,
           case
             when exists (
               select 1 from unnest(coalesce(v.reporting_marks, '{}'::text[])) m, marks
               where upper(btrim(m)) = any (marks.arr)
             ) then 'Reporting mark'
             else 'Similar name'
           end as reason,
           v.reporting_marks
    from v_crm_party_search v
    cross join name
    cross join marks
    where v.entity = 'account'
      and (
        (name.raw <> '' and similarity(v.label, name.raw) >= 0.4)
        or (
          cardinality(marks.arr) > 0
          and exists (
            select 1 from unnest(coalesce(v.reporting_marks, '{}'::text[])) m
            where upper(btrim(m)) = any (marks.arr)
          )
        )
      )
    union all
    select 'company', v.entity_id, v.label, v.kind,
           case
             when exists (
               select 1 from unnest(coalesce(v.reporting_marks, '{}'::text[])) m, marks
               where upper(btrim(m)) = any (marks.arr)
             ) then 'Reporting mark'
             else 'Similar name'
           end,
           v.reporting_marks
    from v_crm_party_search v
    cross join name
    cross join marks
    where v.entity = 'company'
      and (
        (name.raw <> '' and similarity(v.label, name.raw) >= 0.4)
        or (
          cardinality(marks.arr) > 0
          and exists (
            select 1 from unnest(coalesce(v.reporting_marks, '{}'::text[])) m
            where upper(btrim(m)) = any (marks.arr)
          )
        )
      )
    union all
    select 'umler', u.id, coalesce(nullif(btrim(u.owner_group), ''), nullif(btrim(u.umler_owner), ''), u.reporting_mark),
           null::text,
           case when upper(btrim(u.reporting_mark)) = any (marks.arr) then 'Reporting mark' else 'Similar name' end,
           case when u.reporting_mark is null then '{}'::text[] else array[u.reporting_mark] end
    from crm_umler_owner_ref u
    cross join name
    cross join marks
    where (name.raw <> '' and similarity(coalesce(u.owner_group, ''), name.raw) >= 0.4)
       or (name.raw <> '' and similarity(coalesce(u.umler_owner, ''), name.raw) >= 0.4)
       or (cardinality(marks.arr) > 0 and upper(btrim(u.reporting_mark)) = any (marks.arr))
  ) hits
  limit 20;
$function$;

revoke all on function public.crm_prospect_dedup(text, text[]) from public, anon, authenticated;
grant execute on function public.crm_prospect_dedup(text, text[]) to service_role;

-- E) Change capture.
-- Referenced-since: an insert undo of accounts, companies, or company_contacts
-- refuses when a row outside this change group points at it. There is no
-- public.contacts table; company_contacts and contact_lease_links are the
-- contact references. Same-group rows (the company and opportunity created
-- with the account) are ignored so a combined quick-create can still undo.
create or replace function public.rlms_fk_outside_group(
  p_table text,
  p_column text,
  p_id bigint,
  p_group uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  hit boolean;
begin
  if p_id is null then
    return false;
  end if;
  if p_table not in (
    'master_leases', 'account_transition_records', 'companies', 'crm_activities',
    'opportunities', 'programs', 'company_contacts', 'company_fleet_stats',
    'company_products', 'contact_company_dedup_candidates', 'contact_lease_links',
    'opportunity_contacts'
  ) then
    raise exception 'referenced-since: table % is not checked', p_table;
  end if;
  if p_column not in (
    'account_id', 'company_id', 'contact_id', 'company_contact_id',
    'family_parent_id', 'merged_into_id', 'agent_home_company_id',
    'company_id_a', 'company_id_b'
  ) then
    raise exception 'referenced-since: column % is not checked', p_column;
  end if;
  execute format(
    'select exists (
       select 1 from public.%I t
       where t.%I = $1
         and not exists (
           select 1 from public.activity_log a
           where a.change_group = $2
             and a.table_name = %L
             and a.row_pk = t.id
         )
     )',
    p_table, p_column, p_table
  ) into hit using p_id, p_group;
  return coalesce(hit, false);
end;
$function$;

create or replace function public.rlms_referenced_outside_group(
  p_table text,
  p_id bigint,
  p_group uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_table = 'accounts' then
    return public.rlms_fk_outside_group('master_leases', 'account_id', p_id, p_group)
      or public.rlms_fk_outside_group('account_transition_records', 'account_id', p_id, p_group)
      or public.rlms_fk_outside_group('companies', 'account_id', p_id, p_group)
      or public.rlms_fk_outside_group('crm_activities', 'account_id', p_id, p_group)
      or public.rlms_fk_outside_group('opportunities', 'account_id', p_id, p_group)
      or public.rlms_fk_outside_group('programs', 'account_id', p_id, p_group);
  elsif p_table = 'companies' then
    return public.rlms_fk_outside_group('companies', 'family_parent_id', p_id, p_group)
      or public.rlms_fk_outside_group('companies', 'merged_into_id', p_id, p_group)
      or public.rlms_fk_outside_group('company_contacts', 'company_id', p_id, p_group)
      or public.rlms_fk_outside_group('company_contacts', 'agent_home_company_id', p_id, p_group)
      or public.rlms_fk_outside_group('company_fleet_stats', 'company_id', p_id, p_group)
      or public.rlms_fk_outside_group('company_products', 'company_id', p_id, p_group)
      or public.rlms_fk_outside_group('contact_company_dedup_candidates', 'agent_home_company_id', p_id, p_group)
      or public.rlms_fk_outside_group('contact_company_dedup_candidates', 'company_id_a', p_id, p_group)
      or public.rlms_fk_outside_group('contact_company_dedup_candidates', 'company_id_b', p_id, p_group)
      or public.rlms_fk_outside_group('contact_lease_links', 'company_id', p_id, p_group)
      or public.rlms_fk_outside_group('crm_activities', 'company_id', p_id, p_group)
      or public.rlms_fk_outside_group('opportunities', 'company_id', p_id, p_group);
  elsif p_table = 'company_contacts' then
    return public.rlms_fk_outside_group('contact_company_dedup_candidates', 'company_contact_id', p_id, p_group)
      or public.rlms_fk_outside_group('contact_lease_links', 'company_contact_id', p_id, p_group)
      or public.rlms_fk_outside_group('crm_activities', 'contact_id', p_id, p_group)
      or public.rlms_fk_outside_group('opportunity_contacts', 'contact_id', p_id, p_group);
  end if;
  return false;
end;
$function$;

revoke all on function public.rlms_fk_outside_group(text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.rlms_referenced_outside_group(text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.rlms_fk_outside_group(text, text, bigint, uuid) to service_role;
grant execute on function public.rlms_referenced_outside_group(text, bigint, uuid) to service_role;

-- activity_log entity types. Live check kept every earlier value.
alter table activity_log drop constraint activity_log_entity_type_check;
alter table activity_log add constraint activity_log_entity_type_check
  check ((entity_type = ANY (ARRAY[
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
    'opportunity_contact'::text
  ])));

CREATE OR REPLACE FUNCTION public.rlms_apply_jsonb_patch(p_table text, p_id bigint, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  stmt text;
  col text;
  typ text;
  parts text[] := ARRAY[]::text[];
BEGIN
  IF p_patch IS NULL OR p_patch = '{}'::jsonb THEN
    RETURN;
  END IF;
  IF p_table NOT IN (
    'railcars', 'car_commitments', 'car_rent_stops', 'program_cars',
    'program_car_milestones', 'programs', 'railcar_assignments',
    'assignment_history', 'car_tags', 'car_lists', 'car_list_members',
    'riders', 'master_leases', 'attachments', 'opportunities', 'crm_activities',
    'accounts', 'companies', 'company_contacts', 'opportunity_contacts'
  ) THEN
    RAISE EXCEPTION 'undo: table % is not patchable', p_table;
  END IF;
  FOR col, typ IN
    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = p_table AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF p_patch ? col THEN
      IF p_patch -> col = 'null'::jsonb THEN
        parts := array_append(parts, format('%I = NULL', col));
      ELSE
        parts := array_append(parts, format('%I = ($1->>%L)::%s', col, col, typ));
      END IF;
    END IF;
  END LOOP;
  IF coalesce(array_length(parts, 1), 0) = 0 THEN
    RETURN;
  END IF;
  stmt := format('UPDATE public.%I SET %s WHERE id = $2', p_table, array_to_string(parts, ', '));
  EXECUTE stmt USING p_patch, p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rlms_undo_change_group(p_group uuid, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec record;
  cur jsonb;
  k text;
  undo_group uuid := gen_random_uuid();
  restored int := 0;
  conflicts jsonb := '[]'::jsonb;
  orig_actor text;
  oldest timestamptz;
  already int;
  non_ok int;
  op text;
  tbl text;
  pk bigint;
BEGIN
  IF p_group IS NULL OR coalesce(btrim(p_actor), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_group_or_actor', 'status', 400);
  END IF;
  SELECT min(a.actor), min(a.occurred_at),
    count(*) FILTER (WHERE a.undone_at IS NOT NULL),
    count(*) FILTER (WHERE a.undoable IS NOT TRUE)
  INTO orig_actor, oldest, already, non_ok
  FROM public.activity_log a
  WHERE a.change_group = p_group;
  IF oldest IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found', 'status', 404);
  END IF;
  IF already > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'already_undone', 'status', 409); END IF;
  IF non_ok > 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'not_undoable', 'status', 400, 'message', 'Remarks and imports cannot be undone.'); END IF;
  IF orig_actor::text IS DISTINCT FROM p_actor THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden_actor', 'status', 403); END IF;
  IF oldest < now() - interval '24 hours' THEN RETURN jsonb_build_object('ok', false, 'error', 'expired', 'status', 403); END IF;
  FOR rec IN SELECT * FROM public.activity_log WHERE change_group = p_group ORDER BY id DESC LOOP
    tbl := rec.table_name; pk := rec.row_pk;
    IF tbl IS NULL OR pk IS NULL THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'missing table_name or row_pk'));
      CONTINUE;
    END IF;
    IF tbl NOT IN ('railcars', 'car_commitments', 'car_rent_stops', 'program_cars', 'program_car_milestones', 'programs', 'railcar_assignments', 'assignment_history', 'car_status_history', 'car_tags', 'car_lists', 'car_list_members', 'riders', 'master_leases', 'attachments', 'opportunities', 'crm_activities', 'accounts', 'companies', 'company_contacts', 'opportunity_contacts') THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'table not undoable'));
      CONTINUE;
    END IF;
    op := coalesce(rec.detail->>'op', CASE WHEN rec.before IS NULL OR rec.before = '{}'::jsonb THEN 'insert' WHEN rec.after IS NULL OR rec.after = '{}'::jsonb THEN 'delete' ELSE 'update' END);
    IF op = 'insert' AND tbl IN ('accounts', 'companies', 'company_contacts') THEN
      IF public.rlms_referenced_outside_group(tbl, pk, p_group) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'referenced_since', 'status', 409, 'message', 'referenced since');
      END IF;
    END IF;
    IF tbl = 'car_status_history' AND op = 'insert' THEN CONTINUE; END IF;
    IF op <> 'insert' THEN
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', tbl) INTO cur USING pk;
      IF cur IS NULL AND op = 'update' THEN
        conflicts := conflicts || jsonb_build_array(jsonb_build_object('activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'row missing'));
        CONTINUE;
      END IF;
      IF rec.after IS NOT NULL AND rec.after <> '{}'::jsonb THEN
        FOR k IN SELECT jsonb_object_keys(rec.after) LOOP
          IF NOT public.rlms_jsonb_key_matches(cur, rec.after, k) THEN
            conflicts := conflicts || jsonb_build_array(jsonb_build_object('activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', format('changed since (%s)', k)));
            EXIT;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
  IF jsonb_array_length(conflicts) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'status', 409, 'conflicts', conflicts);
  END IF;
  FOR rec IN SELECT * FROM public.activity_log WHERE change_group = p_group ORDER BY id DESC LOOP
    tbl := rec.table_name; pk := rec.row_pk;
    op := coalesce(rec.detail->>'op', CASE WHEN rec.before IS NULL OR rec.before = '{}'::jsonb THEN 'insert' WHEN rec.after IS NULL OR rec.after = '{}'::jsonb THEN 'delete' ELSE 'update' END);
    IF tbl = 'car_status_history' AND op = 'insert' THEN
      INSERT INTO public.car_status_history (car_id, event_type, reason, created_by, from_status, to_status)
      VALUES (coalesce((rec.after->>'car_id')::bigint, rec.railcar_id), 'undo', 'undo change_group', p_actor, rec.after->>'to_status', rec.after->>'from_status');
      restored := restored + 1;
    ELSIF op = 'insert' THEN
      IF tbl = 'car_commitments' THEN UPDATE public.car_commitments SET cleared_at = now() WHERE id = pk AND cleared_at IS NULL;
      ELSIF tbl = 'program_cars' THEN UPDATE public.program_cars SET exited_date = CURRENT_DATE WHERE id = pk AND exited_date IS NULL;
      ELSIF tbl IN ('program_car_milestones', 'car_rent_stops', 'car_tags', 'car_list_members', 'attachments', 'opportunities', 'crm_activities', 'accounts', 'companies', 'company_contacts', 'opportunity_contacts') THEN EXECUTE format('DELETE FROM public.%I WHERE id = $1', tbl) USING pk;
      ELSIF tbl = 'railcars' THEN NULL;
      ELSE PERFORM public.rlms_apply_jsonb_patch(tbl, pk, rec.before);
      END IF;
      restored := restored + 1;
    ELSIF op = 'delete' THEN
      IF tbl = 'car_commitments' THEN UPDATE public.car_commitments SET cleared_at = NULL WHERE id = pk;
      ELSIF tbl = 'program_cars' THEN UPDATE public.program_cars SET exited_date = NULL WHERE id = pk;
      ELSE PERFORM public.rlms_apply_jsonb_patch(tbl, pk, rec.before);
      END IF;
      restored := restored + 1;
    ELSE
      PERFORM public.rlms_apply_jsonb_patch(tbl, pk, rec.before);
      restored := restored + 1;
    END IF;
    INSERT INTO public.activity_log (entity_type, entity_id, action, actor, railcar_id, rider_id, detail, source, occurred_at, change_group, table_name, row_pk, before, after, undoable, undo_of)
    VALUES (rec.entity_type, rec.entity_id, 'undo', p_actor, rec.railcar_id, rec.rider_id, jsonb_build_object('op', 'update', 'undid', rec.action, 'original_group', p_group::text), 'undo', now(), undo_group, rec.table_name, rec.row_pk, rec.after, rec.before, false, rec.id);
  END LOOP;
  UPDATE public.activity_log SET undone_at = now(), undone_by = p_actor WHERE change_group = p_group;
  RETURN jsonb_build_object('ok', true, 'restored', restored, 'undo_group', undo_group, 'original_group', p_group);
END;
$function$;

REVOKE ALL ON FUNCTION public.rlms_undo_change_group(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rlms_undo_change_group(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rlms_apply_jsonb_patch(text, bigint, jsonb) TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_contacts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.opportunity_contacts_id_seq TO service_role;
