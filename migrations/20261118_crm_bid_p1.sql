-- CRM Bid P1. One transaction. Do not apply to live until Bruce says so.
-- Sorts after migrations/20261117_saved_view_pin_counts.sql.
-- Live newest migration on 2026-10-20 is 20261019212640 saved_view_pin_counts,
-- so this is 20261118 rather than the spec's 20261116 (that name would sort
-- before 20261117, which is already on master and already applied).
--
-- The security lockdown is paused and AM-1 (PR #27) is not merged. These
-- function bodies were copied from the live definitions (which match the
-- latest repo bodies in migrations/20261115_manage_columns.sql and
-- migrations/20261111_crm_p1_1.sql) on 2026-10-20. The md5 guard aborts if
-- live has drifted. Whichever of this migration or AM-1 lands second must
-- refresh its baselines.
--
-- Does not alter riders, master_leases, railcar_assignments, or rent_events.
-- No columns on riders or master_leases.
-- CREATE OR REPLACE keeps each function's existing owner, grants, and
-- security settings. This file does not revoke or re-grant those functions.
-- opportunity_lines is new: RLS on, no anon or authenticated grants.
--
-- Pre md5 (pg_get_functiondef), 2026-10-20:
--   rlms_apply_jsonb_patch          8cff44e553c452db18290122462d50a6
--   rlms_undo_change_group          5acf178673e9592cb1d1eb3c02f54f0e
--   rlms_referenced_outside_group   91fff3b98ab02d49810a18093d9844cd
--   rlms_fk_outside_group           3586a575597e068254416993913a364a
-- Snapshot: migrations/snapshots/20261118_pre.sql

begin;

do $$ declare m text; begin
  select md5(pg_get_functiondef('public.rlms_apply_jsonb_patch(text,bigint,jsonb)'::regprocedure)) into m;
  if m <> '8cff44e553c452db18290122462d50a6' then raise exception 'rlms_apply_jsonb_patch changed (%), regenerate', m; end if;
  select md5(pg_get_functiondef('public.rlms_undo_change_group(uuid,text)'::regprocedure)) into m;
  if m <> '5acf178673e9592cb1d1eb3c02f54f0e' then raise exception 'rlms_undo_change_group changed (%), regenerate', m; end if;
  select md5(pg_get_functiondef('public.rlms_referenced_outside_group(text,bigint,uuid)'::regprocedure)) into m;
  if m <> '91fff3b98ab02d49810a18093d9844cd' then raise exception 'rlms_referenced_outside_group changed (%), regenerate', m; end if;
  select md5(pg_get_functiondef('public.rlms_fk_outside_group(text,text,bigint,uuid)'::regprocedure)) into m;
  if m <> '3586a575597e068254416993913a364a' then raise exception 'rlms_fk_outside_group changed (%), regenerate', m; end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'opportunities' and column_name = 'expected_close'
  ) then
    raise exception 'opportunities.expected_close is missing; reuse it, do not add a close_date column';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'opportunities_type_check'
      and pg_get_constraintdef(oid) like '%''purchase''%'
      and pg_get_constraintdef(oid) not like '%''Purchase''%'
  ) then
    raise exception 'opportunities.type must allow lowercase purchase';
  end if;
end $$;

-- A) Opportunity columns. Close date reuses opportunities.expected_close.
alter table opportunities add column flavor text null check (flavor in ('portfolio_bid'));
alter table opportunities add column outcome text null check (outcome in ('won','lost','passed'));
alter table opportunities add column bid_substage text null check (bid_substage in ('inspection','final'));
alter table opportunities add column seller_company_id bigint null references companies(id);
alter table opportunities add column broker_company_id bigint null references companies(id);
alter table opportunities add column offering_name text null;
alter table opportunities add column received_date date null;
alter table opportunities add column bid_due_prelim date null;
alter table opportunities add column bid_due_final date null;
alter table opportunities add column award_date date null;
alter table opportunities add constraint passed_is_lost check (outcome is distinct from 'passed' or stage = 'lost');
alter table opportunities add constraint flavor_purchase check (flavor is null or type = 'purchase');
alter table opportunities add constraint bid_dates_order check (
  bid_due_final is null or bid_due_prelim is null or bid_due_final >= bid_due_prelim);
create index opportunities_flavor_stage on opportunities (flavor, stage) where flavor is not null;

-- Bid stages Shortlisted / Inspection / Final negotiation store stage 'negotiating',
-- which the live check did not allow. Every previous stage value is kept.
alter table opportunities drop constraint opportunities_stage_check;
alter table opportunities add constraint opportunities_stage_check
  check ((stage = ANY (ARRAY[
    'identified'::text,
    'qualified'::text,
    'priced'::text,
    'in_review'::text,
    'proposal'::text,
    'docs'::text,
    'negotiating'::text,
    'won'::text,
    'lost'::text
  ])));

-- B) Deal lines. Soft delete. Opportunities are never hard-deleted, so no cascade.
create table opportunity_lines (
  id                   bigserial primary key,
  opportunity_id       bigint not null references opportunities(id) on delete restrict,
  seller_deal_ref      text not null,
  lessee_desc          text null,
  lessee_rating        text null,
  lessee_country       text null,
  aar_code             text null,
  car_type             text null,
  equipment_desc       text null,
  car_count            int  not null default 0 check (car_count >= 0),
  avg_build_year       int  null,
  commodity            text null,
  lease_rate           numeric(12,2) null,
  lease_expiry         date null,
  purchase_option      boolean null,
  include_in_bid       boolean not null default true,
  exclude_reason       text null,
  prelim_price_per_car numeric(14,2) null,
  final_price_per_car  numeric(14,2) null,
  outcome              text null check (outcome in ('won','lost','passed','withdrawn')),
  market_price_per_car numeric(14,2) null,
  winner_company_id    bigint null references companies(id),
  loss_reason          text null,
  notes                text null,
  sort_order           int not null default 0,
  deleted_at           timestamptz null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint line_excluded_reason check (include_in_bid or exclude_reason is not null),
  constraint line_lost_reason check (outcome is distinct from 'lost' or loss_reason is not null)
);
create unique index opportunity_lines_ref_live on opportunity_lines (opportunity_id, seller_deal_ref) where deleted_at is null;
create index opportunity_lines_live_idx on opportunity_lines (opportunity_id) where deleted_at is null;
create trigger opportunity_lines_updated_at before update on opportunity_lines
  for each row execute function public.set_updated_at();
alter table opportunity_lines enable row level security;
revoke all on opportunity_lines from public, anon, authenticated;
grant all on opportunity_lines to service_role;
-- No policy for anon or authenticated. service_role on Supabase bypasses RLS;
-- this policy also lets a service role without BYPASSRLS read and write.
create policy opportunity_lines_service_role on opportunity_lines
  for all to service_role
  using (true)
  with check (true);
revoke all on sequence opportunity_lines_id_seq from public, anon, authenticated;
grant usage, select on sequence opportunity_lines_id_seq to service_role;

-- C) Attachments. Lists are the live values captured 2026-10-20, plus the new value.
alter table attachments drop constraint attachments_source_module_check;
alter table attachments add constraint attachments_source_module_check
  check ((source_module = ANY (ARRAY[
    'manual'::text,
    'account_transitions'::text,
    'lease_management'::text,
    'programs'::text,
    'contacts_directory'::text,
    'lease_contracts'::text,
    'crm'::text
  ])));
alter table attachments drop constraint attachments_entity_type_check;
alter table attachments add constraint attachments_entity_type_check
  check ((entity_type = ANY (ARRAY[
    'master_lease'::text,
    'rider'::text,
    'railcar'::text,
    'account'::text,
    'company'::text,
    'company_contact'::text,
    'opportunity'::text
  ])));

-- D) activity_log. All 11 live values, plus opportunity_line.
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
    'opportunity_contact'::text,
    'opportunity_line'::text
  ])));

-- Superset: the new definition must still name every live value.
do $superset$
declare
  def text;
  item text;
  source_live text[] := array['manual','account_transitions','lease_management','programs','contacts_directory','lease_contracts'];
  entity_live text[] := array['master_lease','rider','railcar','account','company','company_contact'];
  activity_live text[] := array['railcar','rider','program','program_car','master_lease','account','opportunity','crm_activity','company','company_contact','opportunity_contact'];
  stage_live text[] := array['identified','qualified','priced','in_review','proposal','docs','won','lost'];
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'attachments_source_module_check';
  foreach item in array source_live loop
    if position('''' || item || '''' in def) = 0 then
      raise exception 'attachments_source_module_check lost live value %', item;
    end if;
  end loop;
  if position('''crm''' in def) = 0 then raise exception 'attachments_source_module_check missing crm'; end if;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'attachments_entity_type_check';
  foreach item in array entity_live loop
    if position('''' || item || '''' in def) = 0 then
      raise exception 'attachments_entity_type_check lost live value %', item;
    end if;
  end loop;
  if position('''opportunity''' in def) = 0 then raise exception 'attachments_entity_type_check missing opportunity'; end if;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'activity_log_entity_type_check';
  foreach item in array activity_live loop
    if position('''' || item || '''' in def) = 0 then
      raise exception 'activity_log_entity_type_check lost live value %', item;
    end if;
  end loop;
  if position('''opportunity_line''' in def) = 0 then raise exception 'activity_log_entity_type_check missing opportunity_line'; end if;

  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'opportunities_stage_check';
  foreach item in array stage_live loop
    if position('''' || item || '''' in def) = 0 then
      raise exception 'opportunities_stage_check lost live value %', item;
    end if;
  end loop;
  if position('''negotiating''' in def) = 0 then raise exception 'opportunities_stage_check missing negotiating'; end if;

  if exists (
    select 1 from attachments
    where source_module is not null
      and source_module not in ('manual','account_transitions','lease_management','programs','contacts_directory','lease_contracts','crm')
  ) then
    raise exception 'source_module list lost a live value';
  end if;
  if exists (
    select 1 from attachments
    where entity_type not in ('master_lease','rider','railcar','account','company','company_contact','opportunity')
  ) then
    raise exception 'entity_type list lost a live value';
  end if;
end
$superset$;

-- E) Undo hooks. Bodies copied from the snapshot, then only the bid entries were added.
-- No GRANT or REVOKE on these functions: existing privileges stay as they are.

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
    'accounts', 'companies', 'company_contacts', 'opportunity_contacts',
    'shops', 'user_column_prefs', 'program_field_defs', 'opportunity_lines'
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
  hist_removed int := 0;
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
    IF tbl NOT IN ('railcars', 'car_commitments', 'car_rent_stops', 'program_cars', 'program_car_milestones', 'programs', 'railcar_assignments', 'assignment_history', 'car_status_history', 'car_tags', 'car_lists', 'car_list_members', 'riders', 'master_leases', 'attachments', 'opportunities', 'crm_activities', 'accounts', 'companies', 'company_contacts', 'opportunity_contacts', 'shops', 'user_column_prefs', 'program_field_defs', 'opportunity_lines') THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('activity_id', rec.id, 'table_name', tbl, 'row_pk', pk, 'reason', 'table not undoable'));
      CONTINUE;
    END IF;
    op := coalesce(rec.detail->>'op', CASE WHEN rec.before IS NULL OR rec.before = '{}'::jsonb THEN 'insert' WHEN rec.after IS NULL OR rec.after = '{}'::jsonb THEN 'delete' ELSE 'update' END);
    IF op = 'insert' AND tbl IN ('accounts', 'companies', 'company_contacts', 'opportunities') THEN
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
    ELSIF op = 'insert' AND tbl = 'program_field_defs' THEN
      UPDATE public.program_field_defs
         SET retired_at = COALESCE(retired_at, now())
       WHERE id = pk;
      restored := restored + 1;
    ELSIF op = 'insert' AND tbl = 'programs' AND coalesce(rec.detail->>'source', '') = 'program_tracker_sync' THEN
      IF EXISTS (SELECT 1 FROM public.program_cars c WHERE c.program_id = pk) THEN
        RAISE EXCEPTION 'undo: program % still has cars', pk;
      END IF;
      DELETE FROM public.programs WHERE id = pk;
      restored := restored + 1;
    ELSIF op = 'insert' THEN
      IF tbl = 'car_commitments' THEN UPDATE public.car_commitments SET cleared_at = now() WHERE id = pk AND cleared_at IS NULL;
      ELSIF tbl = 'program_cars' THEN UPDATE public.program_cars SET exited_date = CURRENT_DATE WHERE id = pk AND exited_date IS NULL;
      ELSIF tbl IN ('program_car_milestones', 'car_rent_stops', 'car_tags', 'car_list_members', 'attachments', 'opportunities', 'crm_activities', 'accounts', 'companies', 'company_contacts', 'opportunity_contacts', 'shops', 'user_column_prefs', 'opportunity_lines') THEN EXECUTE format('DELETE FROM public.%I WHERE id = $1', tbl) USING pk;
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

  DELETE FROM public.car_number_history AS h
   WHERE h.reason LIKE '%change_group ' || p_group::text
     AND h.railcar_id IN (
       SELECT a.railcar_id
         FROM public.activity_log AS a
        WHERE a.change_group = p_group
          AND a.railcar_id IS NOT NULL
     );
  GET DIAGNOSTICS hist_removed = ROW_COUNT;

  UPDATE public.activity_log SET undone_at = now(), undone_by = p_actor WHERE change_group = p_group;
  RETURN jsonb_build_object(
    'ok', true,
    'restored', restored,
    'history_removed', hist_removed,
    'undo_group', undo_group,
    'original_group', p_group
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rlms_referenced_outside_group(p_table text, p_id bigint, p_group uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  elsif p_table = 'opportunities' then
    return public.rlms_fk_outside_group('opportunity_lines', 'opportunity_id', p_id, p_group)
      or public.rlms_fk_outside_group('opportunity_contacts', 'opportunity_id', p_id, p_group);
  end if;
  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rlms_fk_outside_group(p_table text, p_column text, p_id bigint, p_group uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'opportunity_contacts', 'opportunity_lines'
  ) then
    raise exception 'referenced-since: table % is not checked', p_table;
  end if;
  if p_column not in (
    'account_id', 'company_id', 'contact_id', 'company_contact_id',
    'family_parent_id', 'merged_into_id', 'agent_home_company_id',
    'company_id_a', 'company_id_b', 'opportunity_id'
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

commit;
