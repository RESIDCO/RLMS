/* eslint-disable no-console */
/**
 * Applies Deal Calculator P1 on a throwaway Postgres cluster.
 * Run: npx tsx server/crm-deal-calc-migration.pg.test.ts
 *
 * Does not touch the live Supabase project.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PG_BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/15/bin"].find((dir) =>
  existsSync(join(dir, "initdb")),
);

const POST = {
  apply: "66be7d422ec47e8c711f83c8ca001c79",
  undo: "fda2979bbd2d37e82c936b0abcdf8927",
  referenced: "ee76481bbbeb897c18d4f0349e9c0f2d",
  fk: "b997a1a457d73f865b29560eeef625a6",
};

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", label);
  }
}

if (!PG_BIN) {
  console.error("FAIL postgres binaries not found");
  process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), "deal-calc-pg-"));
const data = join(root, "data");
const sock = root;
const port = "55462";
const repo = join(import.meta.dirname, "..");

function bin(name: string): string {
  return join(PG_BIN!, name);
}

function run(cmd: string, args: string[], input?: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { encoding: "utf8", input });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function psql(sql: string, database = "bid"): string {
  const res = run(bin("psql"), ["-h", sock, "-p", port, "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql]);
  if (res.status !== 0) throw new Error(res.stderr || res.stdout);
  const lines = res.stdout.split("\n").map((row) => row.trim()).filter(Boolean);
  const body = lines.filter((row) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|DO|SET|RESET|TRUNCATE)\b/.test(row));
  return (body.length ? body : lines).join("\n");
}

function psqlFile(file: string): void {
  const res = run(bin("psql"), ["-h", sock, "-p", port, "-U", "postgres", "-d", "bid", "-v", "ON_ERROR_STOP=1", "-f", file]);
  if (res.status !== 0) throw new Error(`${file}\n${res.stderr || res.stdout}`);
}

function psqlFails(sql: string): string {
  const res = run(bin("psql"), ["-h", sock, "-p", port, "-U", "postgres", "-d", "bid", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  if (res.status === 0) throw new Error(`expected failure, got ${res.stdout}`);
  return `${res.stderr}\n${res.stdout}`;
}

function psqlFileFails(file: string): string {
  const res = run(bin("psql"), ["-h", sock, "-p", port, "-U", "postgres", "-d", "bid", "-v", "ON_ERROR_STOP=1", "-f", file]);
  if (res.status === 0) throw new Error(`expected failure, got ${res.stdout}`);
  return `${res.stderr}\n${res.stdout}`;
}

function md5s(): Record<keyof typeof POST, string> {
  const read = (name: string) => psql(`select md5(pg_get_functiondef('public.${name}'::regproc))`);
  return { apply: read("rlms_apply_jsonb_patch"), undo: read("rlms_undo_change_group"), referenced: read("rlms_referenced_outside_group"), fk: read("rlms_fk_outside_group") };
}

try {
  const init = run(bin("initdb"), ["-D", data, "--username=postgres", "--auth=trust", "--no-sync"]);
  if (init.status !== 0) throw new Error(init.stderr || init.stdout);
  const start = run(bin("pg_ctl"), ["-D", data, "-o", `-p ${port} -k ${sock} -c listen_addresses=`, "-l", join(root, "log"), "start"]);
  if (start.status !== 0) throw new Error(start.stderr || start.stdout);
  psql("create database bid", "postgres");
  psql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create function public.set_updated_at() returns trigger language plpgsql as $fn$
    begin
      new.updated_at = now();
      return new;
    end
    $fn$;
    create function public.rlms_jsonb_key_matches(cur jsonb, expected jsonb, k text) returns boolean
    language sql immutable as $fn$
      select case
        when expected is null or not (expected ? k) then true
        when expected -> k = 'null'::jsonb then cur -> k is null or cur -> k = 'null'::jsonb or coalesce(cur ->> k, '') = ''
        when jsonb_typeof(expected -> k) = 'boolean' then coalesce(cur ->> k, '') in (
          case when (expected ->> k)::boolean then 'true' else 'false' end,
          case when (expected ->> k)::boolean then 't' else 'f' end
        )
        else coalesce(left(cur ->> k, 10), '') is not distinct from coalesce(left(expected ->> k, 10), '')
          or coalesce(cur ->> k, '') is not distinct from coalesce(expected ->> k, '')
      end;
    $fn$;
    create table public.companies (id bigserial primary key, name text);
    create table public.opportunities (
      id bigserial primary key,
      account_id bigint not null,
      type text not null,
      stage text not null default 'identified',
      expected_close date,
      loss_reason text,
      constraint opportunities_type_check check (type in ('renewal','relet','new_business','expansion','purchase','sale','sale_leaseback')),
      constraint opportunities_stage_check check (stage in ('identified','qualified','priced','in_review','proposal','docs','won','lost')),
      constraint lost_needs_reason check (stage <> 'lost' or loss_reason is not null)
    );
    create table public.opportunity_contacts (
      id bigserial primary key,
      opportunity_id bigint not null references public.opportunities(id),
      contact_id bigint
    );
    create table public.attachments (
      id bigserial primary key,
      entity_type text not null,
      entity_id bigint not null,
      source_module text,
      doc_class text,
      file_name text,
      constraint attachments_source_module_check check (source_module = any (array['manual','account_transitions','lease_management','programs','contacts_directory','lease_contracts']::text[])),
      constraint attachments_entity_type_check check (entity_type = any (array['master_lease','rider','railcar','account','company','company_contact']::text[]))
    );
    create table public.activity_log (
      id bigserial primary key,
      entity_type text not null,
      entity_id bigint not null,
      railcar_id bigint,
      rider_id bigint,
      action text not null,
      detail jsonb not null default '{}'::jsonb,
      actor text,
      source text not null default 'ui',
      occurred_at timestamptz not null default now(),
      change_group uuid,
      table_name text,
      row_pk bigint,
      before jsonb,
      after jsonb,
      undoable boolean not null default true,
      undo_of bigint,
      undone_at timestamptz,
      undone_by text,
      constraint activity_log_entity_type_check check (entity_type = any (array[
        'railcar','rider','program','program_car','master_lease','account','opportunity','crm_activity','company','company_contact','opportunity_contact'
      ]::text[]))
    );
    create table public.car_number_history (
      id bigserial primary key,
      railcar_id bigint,
      reason text
    );
  `);
  psqlFile(join(repo, "migrations/snapshots/20261118_pre.sql"));
  psql(`
    grant execute on function public.rlms_apply_jsonb_patch(text,bigint,jsonb) to anon, authenticated, service_role;
    revoke all on function public.rlms_undo_change_group(uuid,text) from public, anon, authenticated;
    revoke all on function public.rlms_referenced_outside_group(text,bigint,uuid) from public, anon, authenticated;
    revoke all on function public.rlms_fk_outside_group(text,text,bigint,uuid) from public, anon, authenticated;
    grant execute on function public.rlms_undo_change_group(uuid,text) to service_role;
    grant execute on function public.rlms_referenced_outside_group(text,bigint,uuid) to service_role;
    grant execute on function public.rlms_fk_outside_group(text,text,bigint,uuid) to service_role;
  `);
  psqlFile(join(repo, "migrations/20261118_crm_bid_p1.sql"));
  psqlFile(join(repo, "migrations/20261119_crm_bid_p1_1.sql"));
  const before = md5s();
  ok(before.apply === POST.apply && before.undo === POST.undo && before.referenced === POST.referenced && before.fk === POST.fk, "baseline undo md5 matches the guard");

  const drifted = psqlFails(`
    begin;
    create or replace function public.rlms_apply_jsonb_patch(p_table text, p_id bigint, p_patch jsonb)
    returns void language plpgsql as $fn$ begin return; end $fn$;
    do $$ declare m text; begin
      select md5(pg_get_functiondef('public.rlms_apply_jsonb_patch'::regproc)) into m;
      if m <> '${POST.apply}' then raise exception 'rlms_apply_jsonb_patch md5 %', m; end if;
    end $$;
    commit;
  `);
  ok(/rlms_apply_jsonb_patch md5/.test(drifted), "md5 guard raises on the wrong baseline");
  ok(md5s().apply === POST.apply, "failed guard did not replace the live function");

  psqlFile(join(repo, "migrations/20261120_crm_deal_calc_p1.sql"));
  const after = md5s();
  ok(after.apply === POST.apply && after.undo === POST.undo && after.referenced === POST.referenced && after.fk === POST.fk, "undo functions are unchanged after the migration");
  ok(psql("select relrowsecurity::text from pg_class where relname = 'deal_calc_scenarios'") === "true", "scenarios RLS is on");
  ok(psql("select relrowsecurity::text from pg_class where relname = 'deal_calc_assumption_sets'") === "true", "assumption sets RLS is on");
  ok(psql("select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('deal_calc_assumption_sets','deal_calc_scenarios') and grantee in ('anon','authenticated','PUBLIC')") === "0", "no anon, authenticated, or public table grants");
  ok(psql("select has_sequence_privilege('anon', 'public.deal_calc_scenarios_id_seq', 'USAGE')") === "f", "anon has no sequence usage");
  ok(psql("select has_sequence_privilege('authenticated', 'public.deal_calc_assumption_sets_id_seq', 'USAGE')") === "f", "authenticated has no sequence usage");
  ok(psql("select has_sequence_privilege('service_role', 'public.deal_calc_scenarios_id_seq', 'USAGE')") === "t", "service_role can use the scenario sequence");
  ok(psql("select has_sequence_privilege('service_role', 'public.deal_calc_assumption_sets_id_seq', 'SELECT')") === "t", "service_role can select the assumption sequence");
  const proconfig = psql("select proconfig::text from pg_proc where proname = 'crm_calc_scenario_line_matches'");
  ok(proconfig.includes("search_path=public, pg_temp"), `search_path is public, pg_temp (${proconfig})`);
  ok(psql("select has_function_privilege('anon', 'public.crm_calc_scenario_line_matches()', 'execute')") === "f", "anon cannot execute the trigger function");
  ok(psql("select has_function_privilege('authenticated', 'public.crm_calc_scenario_line_matches()', 'execute')") === "f", "authenticated cannot execute the trigger function");
  ok(psql("select has_function_privilege('public', 'public.crm_calc_scenario_line_matches()', 'execute')") === "f", "public cannot execute the trigger function");
  ok(psql("select has_function_privilege('service_role', 'public.crm_calc_scenario_line_matches()', 'execute')") === "t", "service_role can execute the trigger function");
  ok(psql("select count(*) from deal_calc_assumption_sets where is_default and deleted_at is null and name = 'Residco default 2026'") === "1", "one seeded default");
  const secondDefault = psqlFails("insert into deal_calc_assumption_sets (name, is_default, inputs) values ('Other', true, '{}'::jsonb)");
  ok(/duplicate key|unique/i.test(secondDefault), "a second default assumption set is rejected");

  const oppA = psql("insert into opportunities (account_id, type, stage, flavor) values (1, 'purchase', 'proposal', 'portfolio_bid') returning id");
  const oppB = psql("insert into opportunities (account_id, type, stage, flavor) values (1, 'purchase', 'proposal', 'portfolio_bid') returning id");
  const lineA = psql(`insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count) values (${oppA}, '1', 98) returning id`);
  const lineB = psql(`insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count) values (${oppB}, '2', 4) returning id`);
  const seed = psql("select id from deal_calc_assumption_sets where is_default");
  const mismatch = psqlFails(`insert into deal_calc_scenarios (opportunity_id, opportunity_line_id, assumption_set_id, name, deal_type, method, calc_version, inputs, results) values (${oppA}, ${lineB}, ${seed}, 'bad', 'portfolio_bid', 'both', 'dc-1.0.0', '{}'::jsonb, '{}'::jsonb)`);
  ok(/is not on opportunity/.test(mismatch), "trigger rejects a line from another opportunity");
  const pinnedDeleted = psqlFails(`insert into deal_calc_scenarios (opportunity_id, name, deal_type, method, calc_version, inputs, results, is_pinned, deleted_at) values (${oppA}, 'gone', 'portfolio_bid', 'cash_flow', 'dc-1.0.0', '{}'::jsonb, '{}'::jsonb, true, now())`);
  ok(/deal_calc_scenarios_deleted_unpinned|check constraint/i.test(pinnedDeleted), "a deleted row cannot stay pinned");
  const scenario = psql(`insert into deal_calc_scenarios (opportunity_id, opportunity_line_id, assumption_set_id, name, deal_type, method, calc_version, inputs, results, is_pinned) values (${oppA}, ${lineA}, ${seed}, 'Deal 1', 'portfolio_bid', 'both', 'dc-1.0.0', '{}'::jsonb, '{}'::jsonb, true) returning id`);
  ok(psql(`select count(*) from deal_calc_scenarios where id = ${scenario}`) === "1", "a matching line can be saved");
  ok(/restrict|foreign key/i.test(psqlFails(`delete from opportunities where id = ${oppA}`)), "deleting the opportunity is RESTRICT");
  ok(/restrict|foreign key/i.test(psqlFails(`delete from opportunity_lines where id = ${lineA}`)), "deleting the line is RESTRICT");
  ok(/restrict|foreign key/i.test(psqlFails(`delete from deal_calc_assumption_sets where id = ${seed}`)), "deleting the assumption set is RESTRICT");

  const undoCfg = psql("select proconfig::text from pg_proc where proname = 'rlms_undo_deal_calc_group'");
  ok(undoCfg.includes("search_path=public, pg_temp"), `deal-calc undo search_path is public, pg_temp (${undoCfg})`);
  ok(psql("select prosecdef::text from pg_proc where proname = 'rlms_undo_deal_calc_group'") === "true", "deal-calc undo is security definer");
  ok(psql("select has_function_privilege('anon', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')") === "f", "anon cannot execute deal-calc undo");
  ok(psql("select has_function_privilege('authenticated', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')") === "f", "authenticated cannot execute deal-calc undo");
  ok(psql("select has_function_privilege('public', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')") === "f", "public cannot execute deal-calc undo");
  ok(psql("select has_function_privilege('service_role', 'public.rlms_undo_deal_calc_group(uuid,text)', 'execute')") === "t", "service_role can execute deal-calc undo");

  const mixed = psql("select gen_random_uuid()");
  psql(`insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, undoable) values ('opportunity', ${oppA}, 'update', 'tester', '{"op":"update"}'::jsonb, '${mixed}', 'opportunities', ${oppA}, true)`);
  ok(psql(`select public.rlms_undo_deal_calc_group('${mixed}'::uuid, 'tester')->>'error'`) === "not_deal_calc_group", "a group that is not entirely deal calc is refused");

  // Newer row renames the set; older row deletes it. Newest-first applies the
  // rename, then the delete hits the scenario FK. A partial commit would leave
  // the name as Extra.
  const extraSet = psql("insert into deal_calc_assumption_sets (name, is_default, inputs, created_by) values ('Renamed', false, '{}'::jsonb, 'test') returning id");
  const fkGroup = psql("select gen_random_uuid()");
  psql(`insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable) values ('deal_calc_assumption_set', ${extraSet}, 'create_deal_calc_assumption_set', 'tester', '{"op":"insert"}'::jsonb, '${fkGroup}', 'deal_calc_assumption_sets', ${extraSet}, null, '{"name":"Renamed"}'::jsonb, true)`);
  psql(`insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable) values ('deal_calc_assumption_set', ${extraSet}, 'update_deal_calc_assumption_set', 'tester', '{"op":"update"}'::jsonb, '${fkGroup}', 'deal_calc_assumption_sets', ${extraSet}, '{"name":"Extra"}'::jsonb, '{"name":"Renamed"}'::jsonb, true)`);
  const blocker = psql(`insert into deal_calc_scenarios (opportunity_id, assumption_set_id, name, deal_type, method, calc_version, inputs, results) values (${oppA}, ${extraSet}, 'uses extra', 'portfolio_bid', 'cash_flow', 'dc-1.0.0', '{}'::jsonb, '{}'::jsonb) returning id`);
  const rolledBack = psqlFails(`select public.rlms_undo_deal_calc_group('${fkGroup}'::uuid, 'tester')`);
  ok(/foreign key|violates/i.test(rolledBack), "undo of an in-use assumption set fails on the scenario FK");
  ok(psql(`select name from deal_calc_assumption_sets where id = ${extraSet}`) === "Renamed", "the rename inside the failed undo rolls back");
  ok(psql(`select count(*) from deal_calc_assumption_sets where id = ${extraSet}`) === "1", "the assumption set is still present");
  ok(psql(`select count(*) from activity_log where change_group = '${fkGroup}' and undone_at is not null`) === "0", "the failed undo does not mark the group undone");
  ok(psql("select count(*) from activity_log where source = 'undo'") === "0", "the failed undo leaves no audit row");

  const inserted = psql(`insert into deal_calc_scenarios (opportunity_id, name, deal_type, method, calc_version, inputs, results) values (${oppA}, 'Undo me', 'portfolio_bid', 'cash_flow', 'dc-1.0.0', '{}'::jsonb, '{}'::jsonb) returning id`);
  const insertGroup = psql("select gen_random_uuid()");
  psql(`insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable) values ('deal_calc_scenario', ${inserted}, 'create_deal_calc_scenario', 'tester', '{"op":"insert"}'::jsonb, '${insertGroup}', 'deal_calc_scenarios', ${inserted}, null, '{"name":"Undo me"}'::jsonb, true)`);
  ok(psql(`select public.rlms_undo_deal_calc_group('${insertGroup}'::uuid, 'tester')->>'ok'`) === "true", "undo of a scenario insert succeeds");
  ok(psql(`select count(*) from deal_calc_scenarios where id = ${inserted}`) === "0", "undo of an insert deletes the scenario");
  ok(psql(`select detail->>'op' from activity_log where source = 'undo' and table_name = 'deal_calc_scenarios' and row_pk = ${inserted}`) === "delete", "undo of an insert labels the audit row delete");

  const unpinned = psql(`insert into deal_calc_scenarios (opportunity_id, opportunity_line_id, name, deal_type, method, calc_version, inputs, results, is_pinned) values (${oppA}, ${lineA}, 'other', 'portfolio_bid', 'cash_flow', 'dc-1.0.0', '{}'::jsonb, '{}'::jsonb, false) returning id`);
  const pinGroup = psql("select gen_random_uuid()");
  psql(`insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable) values ('deal_calc_scenario', ${unpinned}, 'update_deal_calc_scenario', 'tester', '{"op":"update"}'::jsonb, '${pinGroup}', 'deal_calc_scenarios', ${unpinned}, '{"is_pinned":true}'::jsonb, '{"is_pinned":false}'::jsonb, true)`);
  ok(psql(`select public.rlms_undo_deal_calc_group('${pinGroup}'::uuid, 'tester')->>'ok'`) === "true", "undo that would re-pin beside a live pin succeeds");
  ok(psql(`select is_pinned from deal_calc_scenarios where id = ${unpinned}`) === "f", "a restored row stays unpinned when the pin slot is taken");
  ok(psql(`select is_pinned from deal_calc_scenarios where id = ${scenario}`) === "t", "the live pin is left in place");

  psql(`delete from deal_calc_scenarios where id in (${blocker}, ${unpinned})`);
  psql(`delete from deal_calc_assumption_sets where id = ${extraSet}`);
  psql("delete from activity_log where entity_type in ('deal_calc_scenario','deal_calc_assumption_set') or source = 'undo' or change_group = '" + mixed + "'");

  const refused = psqlFileFails(join(repo, "migrations/20261120_crm_deal_calc_p1_down.sql"));
  ok(/down refused:/.test(refused), "down refuses, with counts, when a scenario exists");
  ok(psql("select to_regclass('public.deal_calc_scenarios')") === "deal_calc_scenarios", "refused down leaves the table");

  psql(`delete from deal_calc_scenarios where id = ${scenario}`);
  psql("insert into deal_calc_assumption_sets (name, is_default, inputs, created_by) values ('Extra', false, '{}'::jsonb, 'test')");
  const refusedExtra = psqlFileFails(join(repo, "migrations/20261120_crm_deal_calc_p1_down.sql"));
  ok(/down refused:/.test(refusedExtra), "down refuses a non-seed assumption set");
  psql("delete from deal_calc_assumption_sets where name = 'Extra'");
  psqlFile(join(repo, "migrations/20261120_crm_deal_calc_p1_down.sql"));
  const restored = md5s();
  ok(restored.apply === POST.apply && restored.undo === POST.undo && restored.referenced === POST.referenced && restored.fk === POST.fk, "down leaves the undo functions in place");
  ok(psql("select to_regclass('public.deal_calc_scenarios')") === "", "down drops scenarios");
  ok(psql("select to_regclass('public.deal_calc_assumption_sets')") === "", "down drops assumption sets");
  ok(psql("select count(*) from pg_proc where proname = 'crm_calc_scenario_line_matches'") === "0", "down drops the trigger function");
  ok(psql("select count(*) from pg_proc where proname = 'rlms_undo_deal_calc_group'") === "0", "down drops the deal-calc undo function");
  ok(!psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'activity_log_entity_type_check'").includes("deal_calc_scenario"), "down restores the activity check without the new types");
} catch (err) {
  failed += 1;
  console.error("FAIL", err instanceof Error ? err.message : err);
} finally {
  run(bin("pg_ctl"), ["-D", data, "stop", "-m", "immediate"]);
  rmSync(root, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
