/* eslint-disable no-console */
/**
 * Applies CRM Bid P1 on a throwaway Postgres cluster.
 * Run: npx tsx server/crm-bid-migration.pg.test.ts
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

const PRE = {
  apply: "8cff44e553c452db18290122462d50a6",
  undo: "5acf178673e9592cb1d1eb3c02f54f0e",
  referenced: "91fff3b98ab02d49810a18093d9844cd",
  fk: "3586a575597e068254416993913a364a",
};
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

const root = mkdtempSync(join(tmpdir(), "bid-p1-pg-"));
const data = join(root, "data");
const sock = root;
const port = "55442";
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
  const data = lines.filter((row) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|DO|SET|RESET|TRUNCATE)\b/.test(row));
  return (data.length ? data : lines).join("\n");
}

function psqlFile(file: string): void {
  const res = run(bin("psql"), ["-h", sock, "-p", port, "-U", "postgres", "-d", "bid", "-v", "ON_ERROR_STOP=1", "-f", file]);
  if (res.status !== 0) throw new Error(res.stderr || res.stdout);
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

function md5s(): Record<keyof typeof PRE, string> {
  const read = (sig: string) => psql(`select md5(pg_get_functiondef('${sig}'::regprocedure))`);
  return {
    apply: read("public.rlms_apply_jsonb_patch(text,bigint,jsonb)"),
    undo: read("public.rlms_undo_change_group(uuid,text)"),
    referenced: read("public.rlms_referenced_outside_group(text,bigint,uuid)"),
    fk: read("public.rlms_fk_outside_group(text,text,bigint,uuid)"),
  };
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
  const before = md5s();
  ok(before.apply === PRE.apply, `pre apply md5 ${before.apply}`);
  ok(before.undo === PRE.undo, `pre undo md5 ${before.undo}`);
  ok(before.referenced === PRE.referenced, `pre referenced md5 ${before.referenced}`);
  ok(before.fk === PRE.fk, `pre fk md5 ${before.fk}`);

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
  const after = md5s();
  ok(after.apply === POST.apply, `post apply md5 ${after.apply}`);
  ok(after.undo === POST.undo, `post undo md5 ${after.undo}`);
  ok(after.referenced === POST.referenced, `post referenced md5 ${after.referenced}`);
  ok(after.fk === POST.fk, `post fk md5 ${after.fk}`);

  ok(psql("select relrowsecurity from pg_class where relname = 'opportunity_lines'") === "t", "RLS is on");
  ok(
    psql(`select count(*) from information_schema.role_table_grants where table_name = 'opportunity_lines' and grantee in ('anon','authenticated','PUBLIC')`) === "0",
    "no anon, authenticated, or public grants on opportunity_lines",
  );
  ok(psql("select has_function_privilege('anon', 'public.rlms_apply_jsonb_patch(text,bigint,jsonb)', 'execute')") === "t", "anon can still execute apply");
  ok(psql("select has_function_privilege('anon', 'public.rlms_undo_change_group(uuid,text)', 'execute')") === "f", "anon cannot execute undo");
  ok(psql("select has_function_privilege('anon', 'public.rlms_referenced_outside_group(text,bigint,uuid)', 'execute')") === "f", "anon cannot execute referenced");
  ok(psql("select has_function_privilege('authenticated', 'public.rlms_fk_outside_group(text,text,bigint,uuid)', 'execute')") === "f", "authenticated cannot execute fk");
  ok(psql("select prosecdef::text from pg_proc where proname = 'rlms_apply_jsonb_patch'") === "false", "apply stays invoker");
  ok(psql("select prosecdef::text from pg_proc where proname = 'rlms_undo_change_group'") === "true", "undo stays security definer");

  const sourceDef = psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'attachments_source_module_check'");
  for (const value of ["manual", "account_transitions", "lease_management", "programs", "contacts_directory", "lease_contracts", "crm"]) {
    ok(sourceDef.includes(`'${value}'`), `source module keeps ${value}`);
  }
  const entityDef = psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'attachments_entity_type_check'");
  ok(entityDef.includes("'opportunity'") && entityDef.includes("'company_contact'"), "entity types keep the live list and add opportunity");
  const activityDef = psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'activity_log_entity_type_check'");
  ok(activityDef.includes("'opportunity_contact'") && activityDef.includes("'opportunity_line'"), "activity types keep contacts and add lines");
  const stageDef = psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'opportunities_stage_check'");
  ok(stageDef.includes("'negotiating'") && stageDef.includes("'priced'") && stageDef.includes("'docs'"), "stage check is a superset");

  const purchaseCase = psqlFails("insert into opportunities (account_id, type, stage) values (1, 'Purchase', 'identified')");
  ok(/check constraint/i.test(purchaseCase), "title-case Purchase is rejected");
  const flavorCase = psqlFails("insert into opportunities (account_id, type, stage, flavor) values (1, 'renewal', 'identified', 'portfolio_bid')");
  ok(/flavor_purchase/i.test(flavorCase), "portfolio bid cannot be a renewal");

  const oppId = psql("insert into opportunities (account_id, type, stage, flavor, offering_name) values (1, 'purchase', 'identified', 'portfolio_bid', 'BFLX') returning id");
  psql(`
    insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable)
    values ('opportunity', ${oppId}, 'create_opportunity', 'bruce', '{"op":"insert"}'::jsonb, '11111111-1111-1111-1111-111111111111', 'opportunities', ${oppId}, '{}'::jsonb, '{"id":${oppId}}'::jsonb, true);
  `);
  const contactId = psql(`insert into opportunity_contacts (opportunity_id, contact_id) values (${oppId}, 5) returning id`);
  psql(`
    insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable)
    values ('opportunity_contact', ${contactId}, 'link_contact', 'bruce', '{"op":"insert"}'::jsonb, '22222222-2222-2222-2222-222222222222', 'opportunity_contacts', ${contactId}, '{}'::jsonb, '{"id":${contactId}}'::jsonb, true);
  `);
  const blockedByContact = psql("select rlms_undo_change_group('11111111-1111-1111-1111-111111111111', 'bruce')::text");
  ok(blockedByContact.includes("referenced_since"), "undo of an opportunity is blocked by another group's contact");

  psql(`delete from opportunity_contacts where id = ${contactId}`);
  psql("delete from activity_log where change_group = '22222222-2222-2222-2222-222222222222'");
  const lineId = psql(`insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count) values (${oppId}, 'X', 2) returning id`);
  psql(`
    insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable)
    values ('opportunity_line', ${lineId}, 'create_opportunity_line', 'bruce', '{"op":"insert"}'::jsonb, '33333333-3333-3333-3333-333333333333', 'opportunity_lines', ${lineId}, '{}'::jsonb, '{"id":${lineId}}'::jsonb, true);
  `);
  const blockedByLine = psql("select rlms_undo_change_group('11111111-1111-1111-1111-111111111111', 'bruce')::text");
  ok(blockedByLine.includes("referenced_since"), "undo of an opportunity is blocked by another group's line");

  psql(`delete from opportunity_lines where id = ${lineId}`);
  psql("delete from activity_log where change_group = '33333333-3333-3333-3333-333333333333'");
  const cleared = psql("select rlms_undo_change_group('11111111-1111-1111-1111-111111111111', 'bruce')::text");
  ok(cleared.includes('"ok": true') || cleared.includes('"ok":true'), "undo deletes the opportunity once nothing else points at it");
  ok(psql(`select count(*) from opportunities where id = ${oppId}`) === "0", "opportunity row is gone");

  const insertOpp = psql("insert into opportunities (account_id, type, stage) values (1, 'purchase', 'identified') returning id");
  const insertedLine = psql(`insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count, include_in_bid) values (${insertOpp}, 'Y', 4, true) returning id`);
  psql(`
    insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable)
    values ('opportunity_line', ${insertedLine}, 'create_opportunity_line', 'bruce', '{"op":"insert"}'::jsonb, '44444444-4444-4444-4444-444444444444', 'opportunity_lines', ${insertedLine}, '{}'::jsonb, '{"seller_deal_ref":"Y"}'::jsonb, true);
  `);
  const insertUndo = psql("select rlms_undo_change_group('44444444-4444-4444-4444-444444444444', 'bruce')::text");
  ok(insertUndo.includes('"ok": true') || insertUndo.includes('"ok":true'), "line insert undo runs");
  ok(psql(`select count(*) from opportunity_lines where id = ${insertedLine}`) === "0", "line insert undo deletes the row");

  const softOpp = psql("insert into opportunities (account_id, type, stage) values (1, 'purchase', 'identified') returning id");
  const softLine = psql(`insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count) values (${softOpp}, 'Z', 3) returning id`);
  psql(`update opportunity_lines set deleted_at = '2026-10-20 12:00:00+00' where id = ${softLine}`);
  psql(`
    insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable)
    select 'opportunity_line', id, 'delete_opportunity_line', 'bruce', '{"op":"update"}'::jsonb,
      '55555555-5555-5555-5555-555555555555', 'opportunity_lines', id,
      jsonb_build_object('deleted_at', null),
      jsonb_build_object('deleted_at', deleted_at),
      true
    from opportunity_lines where id = ${softLine};
  `);
  const softUndo = psql("select rlms_undo_change_group('55555555-5555-5555-5555-555555555555', 'bruce')::text");
  ok(softUndo.includes('"ok": true') || softUndo.includes('"ok":true'), "line soft-delete undo runs");
  ok(psql(`select deleted_at is null from opportunity_lines where id = ${softLine}`) === "t", "soft-delete undo clears deleted_at");

  const anonDenied = psqlFails("set role anon; select count(*) from opportunity_lines");
  ok(/permission denied/i.test(anonDenied), "anon cannot select opportunity_lines");
  psql(`set role service_role; insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count) values (${softOpp}, 'svc', 1); reset role`);
  ok(psql("select count(*) from opportunity_lines where seller_deal_ref = 'svc'") === "1", "service role can insert a line");

  const drifted = psqlFails(`
    begin;
    create or replace function public.rlms_apply_jsonb_patch(p_table text, p_id bigint, p_patch jsonb)
    returns void language plpgsql as $fn$ begin return; end $fn$;
    do $$ declare m text; begin
      select md5(pg_get_functiondef('public.rlms_apply_jsonb_patch(text,bigint,jsonb)'::regprocedure)) into m;
      if m <> '${PRE.apply}' then raise exception 'rlms_apply_jsonb_patch changed (%), regenerate', m; end if;
    end $$;
    commit;
  `);
  ok(drifted.includes("changed"), "md5 guard aborts when apply has drifted");
  ok(md5s().apply === POST.apply, "failed guard did not replace the live function");

  const refused = psqlFileFails(join(repo, "migrations/20261118_crm_bid_p1_down.sql"));
  ok(/opportunity_lines row/.test(refused), "down refuses while a line exists");
  ok(psql("select to_regclass('public.opportunity_lines')") === "opportunity_lines", "refused down leaves the table");

  psql(`
    delete from opportunity_lines;
    delete from activity_log where entity_type = 'opportunity_line';
    delete from attachments where entity_type = 'opportunity';
    update opportunities set
      flavor = null,
      outcome = null,
      bid_substage = null,
      seller_company_id = null,
      broker_company_id = null,
      offering_name = null,
      received_date = null,
      bid_due_prelim = null,
      bid_due_final = null,
      award_date = null,
      stage = case when stage = 'negotiating' then 'identified' else stage end;
  `);
  psqlFile(join(repo, "migrations/20261118_crm_bid_p1_down.sql"));
  const restored = md5s();
  ok(restored.apply === PRE.apply && restored.undo === PRE.undo, "down restores apply and undo");
  ok(restored.referenced === PRE.referenced && restored.fk === PRE.fk, "down restores referenced and fk");
  ok(psql("select to_regclass('public.opportunity_lines')") === "", "down drops opportunity_lines");
  ok(psql("select has_function_privilege('anon', 'public.rlms_apply_jsonb_patch(text,bigint,jsonb)', 'execute')") === "t", "down keeps anon execute on apply");
  ok(psql("select has_function_privilege('anon', 'public.rlms_undo_change_group(uuid,text)', 'execute')") === "f", "down keeps undo off anon");
} catch (err) {
  failed += 1;
  console.error("FAIL", err instanceof Error ? err.message : err);
} finally {
  run(bin("pg_ctl"), ["-D", data, "stop", "-m", "immediate"]);
  rmSync(root, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
