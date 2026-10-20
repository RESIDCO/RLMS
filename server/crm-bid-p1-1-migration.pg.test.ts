/* eslint-disable no-console */
/**
 * Applies CRM Bid P1.1 on a throwaway Postgres cluster.
 * Run: npx tsx server/crm-bid-p1-1-migration.pg.test.ts
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

const root = mkdtempSync(join(tmpdir(), "bid-p11-pg-"));
const data = join(root, "data");
const sock = root;
const port = "55451";
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

function md5s(): Record<keyof typeof POST, string> {
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

  psql(`
    insert into attachments (entity_type, entity_id, source_module, doc_class, file_name) values
      ('rider', 11, 'lease_contracts', 'likely_executed', 'OL1.pdf'),
      ('rider', 12, 'lease_contracts', 'likely_executed', 'OL2.pdf');
  `);
  const beforeSource = psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'attachments_source_module_check'");
  const beforeEntity = psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'attachments_entity_type_check'");
  const beforeRows = psql("select id || '|' || entity_type || '|' || entity_id || '|' || coalesce(doc_class,'') || '|' || coalesce(file_name,'') from attachments order by id");

  const drifted = psqlFails(`
    begin;
    create or replace function public.rlms_apply_jsonb_patch(p_table text, p_id bigint, p_patch jsonb)
    returns void language plpgsql as $fn$ begin return; end $fn$;
    do $$ declare m text; begin
      select md5(pg_get_functiondef('public.rlms_apply_jsonb_patch(text,bigint,jsonb)'::regprocedure)) into m;
      if m <> '${POST.apply}' then raise exception 'apply_jsonb_patch md5 %', m; end if;
    end $$;
    commit;
  `);
  ok(/apply_jsonb_patch md5/.test(drifted), "md5 guard raises on the wrong baseline");
  ok(md5s().apply === POST.apply, "failed guard did not replace the live function");

  psqlFile(join(repo, "migrations/20261119_crm_bid_p1_1.sql"));
  const after = md5s();
  ok(after.apply === POST.apply && after.undo === POST.undo, "undo functions are unchanged");
  ok(after.referenced === POST.referenced && after.fk === POST.fk, "referenced and fk functions are unchanged");
  ok(psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'attachments_source_module_check'") === beforeSource, "source module check is byte-identical");
  ok(psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'attachments_entity_type_check'") === beforeEntity, "entity type check is byte-identical");
  ok(psql("select id || '|' || entity_type || '|' || entity_id || '|' || coalesce(doc_class,'') || '|' || coalesce(file_name,'') from attachments order by id") === beforeRows, "existing rows are unchanged");
  ok(psql("select count(*) from attachments where doc_category is not null or opportunity_line_id is not null") === "0", "new columns are null on existing rows");
  ok(psql("select doc_class from attachments order by id") === "likely_executed\nlikely_executed", "doc_class values stay likely_executed");

  const proconfig = psql("select proconfig::text from pg_proc where proname = 'crm_attachment_line_matches'");
  ok(proconfig.includes("search_path=public, pg_temp"), `search_path is public, pg_temp (${proconfig})`);
  const body = psql("select pg_get_functiondef('public.crm_attachment_line_matches()'::regprocedure)");
  ok(body.includes("public.opportunity_lines"), "trigger function schema-qualifies opportunity_lines");
  ok(psql("select has_function_privilege('anon', 'public.crm_attachment_line_matches()', 'execute')") === "f", "anon cannot execute the trigger function");
  ok(psql("select has_function_privilege('authenticated', 'public.crm_attachment_line_matches()', 'execute')") === "f", "authenticated cannot execute the trigger function");
  ok(psql("select has_function_privilege('public', 'public.crm_attachment_line_matches()', 'execute')") === "f", "public cannot execute the trigger function");
  ok(psql("select has_function_privilege('service_role', 'public.crm_attachment_line_matches()', 'execute')") === "t", "service_role can execute the trigger function");
  ok(psql("select has_function_privilege('anon', 'public.rlms_apply_jsonb_patch(text,bigint,jsonb)', 'execute')") === "t", "anon can still execute apply");
  ok(psql("select has_function_privilege('anon', 'public.rlms_undo_change_group(uuid,text)', 'execute')") === "f", "anon still cannot execute undo");

  const riderCategory = psqlFails("insert into attachments (entity_type, entity_id, source_module, doc_category) values ('rider', 11, 'lease_contracts', 'legal')");
  ok(/check constraint/i.test(riderCategory), "doc_category on a rider row is rejected");
  const riderLine = psqlFails("insert into attachments (entity_type, entity_id, source_module, opportunity_line_id) values ('rider', 11, 'lease_contracts', 1)");
  ok(/check constraint/i.test(riderLine), "opportunity_line_id on a non-opportunity row is rejected");

  const oppA = psql("insert into opportunities (account_id, type, stage, flavor) values (1, 'purchase', 'identified', 'portfolio_bid') returning id");
  const oppB = psql("insert into opportunities (account_id, type, stage, flavor) values (1, 'purchase', 'identified', 'portfolio_bid') returning id");
  const lineA = psql(`insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count) values (${oppA}, '7', 3) returning id`);
  const lineB = psql(`insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count) values (${oppB}, '8', 1) returning id`);
  const mismatch = psqlFails(`insert into attachments (entity_type, entity_id, source_module, doc_category, opportunity_line_id) values ('opportunity', ${oppA}, 'crm', 'drawings', ${lineB})`);
  ok(/is not on opportunity/.test(mismatch), "a line from another offering is rejected");
  const pinned = psql(`insert into attachments (entity_type, entity_id, source_module, doc_category, opportunity_line_id, file_name) values ('opportunity', ${oppA}, 'crm', 'bid_sheet', ${lineA}, 'cars.xlsx') returning id`);
  psql(`update opportunity_lines set deleted_at = '2026-10-20 12:00:00+00' where id = ${lineA}`);
  ok(psql(`select count(*) from attachments where opportunity_line_id = ${lineA}`) === "1", "soft-deleting a line keeps its files listed");
  const hardDelete = psqlFails(`delete from opportunity_lines where id = ${lineA}`);
  ok(/restrict|foreign key/i.test(hardDelete), "a pinned line cannot be hard-deleted");

  psql("grant insert, select on attachments to service_role");
  psql("grant usage, select on sequence attachments_id_seq to service_role");
  psql(`set role service_role; insert into attachments (entity_type, entity_id, source_module, doc_category, opportunity_line_id) values ('opportunity', ${oppB}, 'crm', 'other', ${lineB}); reset role`);
  ok(psql(`select count(*) from attachments where opportunity_line_id = ${lineB}`) === "1", "service_role can pin a file");
  psql("grant insert on attachments to anon");
  const anonDenied = psqlFails(`set role anon; insert into attachments (entity_type, entity_id, source_module, doc_category, opportunity_line_id) values ('opportunity', ${oppB}, 'crm', 'other', ${lineB});`);
  ok(/permission denied/i.test(anonDenied), "anon cannot fire the trigger function");

  const refused = psqlFileFails(join(repo, "migrations/20261119_crm_bid_p1_1_down.sql"));
  ok(/down refused: .*doc_category/.test(refused), "down refuses, with counts, when bid file data exists");
  ok(psql("select column_name from information_schema.columns where table_name = 'attachments' and column_name = 'doc_category'") === "doc_category", "refused down leaves the column");

  psql("delete from attachments where doc_category is not null or opportunity_line_id is not null");
  psqlFile(join(repo, "migrations/20261119_crm_bid_p1_1_down.sql"));
  const restored = md5s();
  ok(restored.apply === POST.apply && restored.undo === POST.undo && restored.fk === POST.fk, "down leaves the undo functions in place");
  ok(psql("select count(*) from information_schema.columns where table_name = 'attachments' and column_name in ('doc_category','opportunity_line_id')") === "0", "down drops the new columns");
  ok(psql("select count(*) from attachments where entity_type = 'rider' and doc_class = 'likely_executed'") === "2", "down leaves the lease rows");
  ok(psql("select to_regclass('public.attachments_opp_line_idx')") === "", "down drops the index");
  ok(psql("select count(*) from pg_proc where proname = 'crm_attachment_line_matches'") === "0", "down drops the trigger function");
} catch (err) {
  failed += 1;
  console.error("FAIL", err instanceof Error ? err.message : err);
} finally {
  run(bin("pg_ctl"), ["-D", data, "stop", "-m", "immediate"]);
  rmSync(root, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
