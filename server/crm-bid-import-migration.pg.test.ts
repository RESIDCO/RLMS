/* eslint-disable no-console */
/**
 * Applies Bid Import P1 on a throwaway Postgres cluster.
 * Run: npx tsx server/crm-bid-import-migration.pg.test.ts
 *
 * Does not touch the live Supabase project.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const root = mkdtempSync(join(tmpdir(), "bid-import-pg-"));
const data = join(root, "data");
const sock = root;
const port = "55471";
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

function waitUntil(sql: string, want: string, label: string, ms = 15000): void {
  const deadline = Date.now() + ms;
  let last = "";
  while (Date.now() < deadline) {
    last = psql(sql);
    if (last === want) return;
    spawnSync("sleep", ["0.05"]);
  }
  throw new Error(`${label}: saw ${JSON.stringify(last)}`);
}

function waitPid(pid: number, ms = 20000): void {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout?.trim() ?? "";
    if (stat === "" || stat.startsWith("Z")) return;
    spawnSync("sleep", ["0.05"]);
  }
  const activity = psql("select pid || '|' || coalesce(state,'') || '|' || coalesce(wait_event_type,'') || '|' || coalesce(wait_event,'') || '|' || left(replace(query, E'\\n', ' '), 160) from pg_stat_activity where datname = 'bid' and pid <> pg_backend_pid()");
  spawnSync("kill", ["-9", String(pid)]);
  throw new Error(`pid ${pid} still running\n${activity}`);
}

function psqlBackground(file: string): { pid: number; out: string; err: string } {
  const out = `${file}.out`;
  const err = `${file}.err`;
  const child = spawn(bin("psql"), ["-h", sock, "-p", port, "-U", "postgres", "-d", "bid", "-v", "ON_ERROR_STOP=1", "-tA", "-f", file], {
    stdio: ["ignore", openSync(out, "w"), openSync(err, "w")],
    detached: true,
  });
  child.unref();
  if (!child.pid) throw new Error(`psql did not start for ${file}`);
  return { pid: child.pid, out, err };
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


  psqlFile(join(repo, "migrations/20261120_crm_deal_calc_p1.sql"));
  psql(`
    alter table public.opportunities add column if not exists source text not null default 'manual';
    alter table public.opportunities add column if not exists rider_id bigint;
    alter table public.opportunities drop constraint if exists opportunities_source_check;
    alter table public.opportunities add constraint opportunities_source_check
      check (source in ('auto_expiry','manual','trinity','handoff','umler','referral','inbound'));
  `);
  psqlFile(join(repo, "migrations/20261121_crm_bid_import_p1.sql"));
  const after = md5s();
  ok(after.apply === POST.apply && after.undo === POST.undo && after.referenced === POST.referenced && after.fk === POST.fk, "undo functions are unchanged");
  ok(psql("select relrowsecurity::text from pg_class where relname = 'crm_bid_import_mappings'") === "true", "mapping table RLS is on");
  ok(psql("select count(*) from pg_policies where tablename = 'crm_bid_import_mappings'") === "0", "mapping table has no policies");
  ok(psql("select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'crm_bid_import_mappings' and grantee in ('anon','authenticated')") === "0", "anon and authenticated have no mapping grants");
  ok(psql("select has_table_privilege('service_role', 'public.crm_bid_import_mappings', 'SELECT')") === "t", "service_role can select mappings");
  const guard = psql("select proconfig::text || '|' || prosecdef::text from pg_proc where proname = 'opportunities_guard_auto_expiry'");
  ok(guard.includes("search_path=public, pg_temp") && guard.endsWith("|false"), `auto_expiry guard is invoker with a pinned search_path (${guard})`);
  ok(psql("select pg_get_triggerdef(oid) from pg_trigger where tgname = 'opportunities_guard_auto_expiry'").includes("BEFORE UPDATE OF source"), "the guard is before update of source");
  const manual = psql("insert into opportunities (account_id, type, stage, flavor) values (1, 'purchase', 'qualified', 'portfolio_bid') returning id");
  const free = psql("insert into opportunities (account_id, type, stage, source) values (1, 'purchase', 'identified', 'Broker book') returning id");
  ok(/check|auto_expiry/i.test(psqlFails("insert into opportunities (account_id, type, stage, source) values (1, 'purchase', 'identified', 'auto_expiry')")), "auto_expiry on a purchase is rejected");
  ok(/check|source/i.test(psqlFails("insert into opportunities (account_id, type, stage, source) values (1, 'purchase', 'identified', ' manual')")), "untrimmed source is rejected");
  ok(/check|source/i.test(psqlFails(`insert into opportunities (account_id, type, stage, source) values (1, 'purchase', 'identified', '${"x".repeat(61)}')`)), "a 61 character source is rejected");
  const renewal = psql("insert into opportunities (account_id, type, stage, source, rider_id) values (1, 'renewal', 'identified', 'auto_expiry', 42) returning id");
  psql(`update opportunities set source = 'auto_expiry' where id = ${renewal}`);
  ok(psql(`select source from opportunities where id = ${renewal}`) === "auto_expiry", "rewriting the same auto_expiry value is allowed");
  ok(/auto_expiry/i.test(psqlFails(`update opportunities set source = 'manual' where id = ${renewal}`)), "changing auto_expiry to manual is rejected");
  ok(/auto_expiry/i.test(psqlFails(`update opportunities set source = 'auto_expiry' where id = ${manual}`)), "changing manual to auto_expiry is rejected");
  const refused = psqlFileFails(join(repo, "migrations/20261121_crm_bid_import_p1_down.sql"));
  ok(/down refused:/.test(refused), "down refuses while a free-text source exists");
  ok(psql("select to_regclass('public.crm_bid_import_mappings')") === "crm_bid_import_mappings", "refused down leaves the mapping table");
  psql(`update opportunities set source = 'manual' where id = ${free}`);
  psqlFile(join(repo, "migrations/20261121_crm_bid_import_p1_down.sql"));
  const restored = md5s();
  ok(restored.apply === POST.apply && restored.undo === POST.undo && restored.referenced === POST.referenced && restored.fk === POST.fk, "down leaves the undo functions in place");
  const check = psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'opportunities_source_check'");
  ok(check.includes("auto_expiry") && check.includes("inbound") && !/length\s*\(/i.test(check), `down restores the 7-value source check (${check})`);
  ok(psql("select to_regclass('public.crm_bid_import_mappings')") === "", "down drops the mapping table");
  ok(psql("select count(*) from pg_proc where proname = 'opportunities_guard_auto_expiry'") === "0", "down drops the guard function");
  ok(psql("select count(*) from pg_trigger where tgname = 'opportunities_guard_auto_expiry'") === "0", "down drops the guard trigger");
} catch (err) {
  failed += 1;
  console.error("FAIL", err instanceof Error ? err.message : err);
} finally {
  run(bin("pg_ctl"), ["-D", data, "stop", "-m", "immediate"]);
  rmSync(root, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
