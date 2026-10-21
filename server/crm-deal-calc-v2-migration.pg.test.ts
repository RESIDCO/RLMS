/* eslint-disable no-console */
/**
 * Applies Deal Calculator v2 on a throwaway Postgres cluster.
 * Run: npx tsx server/crm-deal-calc-v2-migration.pg.test.ts
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

const root = mkdtempSync(join(tmpdir(), "deal-calc-v2-pg-"));
const data = join(root, "data");
const sock = root;
const port = "55463";
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

  const p1Undo = "6d0fa2812a066a2242a893267fd72347";
  const v2Undo = "79ff0afc077af1b807f4d4399698e514";
  ok(psql("select md5(pg_get_functiondef('public.rlms_undo_deal_calc_group'::regproc))") === p1Undo, "p1 deal-calc undo md5 matches the recorded source");
  psqlFile(join(repo, "migrations/20261123_crm_deal_calc_v2.sql"));
  const after = md5s();
  ok(after.apply === POST.apply && after.undo === POST.undo && after.referenced === POST.referenced && after.fk === POST.fk, "frozen undo md5s are unchanged");
  ok(psql("select md5(pg_get_functiondef('public.rlms_undo_deal_calc_group'::regproc))") === v2Undo, "v2 deal-calc undo md5 matches the migration");
  ok(psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'deal_calc_scenarios_line_needs_opp'").includes("opportunity_id"), "line requires an opportunity");
  ok(psql("select pg_get_constraintdef(oid) from pg_constraint where conname = 'deal_calc_scenarios_pin_needs_opp'").includes("is_pinned"), "a pin requires an opportunity");
  ok(psql("select to_regclass('public.deal_calc_scenarios_updated_idx')") === "deal_calc_scenarios_updated_idx", "updated index exists");
  ok(psql("select to_regclass('public.deal_calc_scenarios_unlinked_idx')") === "deal_calc_scenarios_unlinked_idx", "unlinked index exists");
  ok(psql("select has_function_privilege('anon', 'public.rlms_undo_calc_create_opp(uuid,uuid,text)', 'execute')") === "f", "anon cannot execute the wrapper");
  ok(psql("select has_function_privilege('authenticated', 'public.rlms_undo_calc_create_opp(uuid,uuid,text)', 'execute')") === "f", "authenticated cannot execute the wrapper");
  ok(psql("select has_function_privilege('public', 'public.rlms_undo_calc_create_opp(uuid,uuid,text)', 'execute')") === "f", "public cannot execute the wrapper");
  ok(psql("select has_function_privilege('service_role', 'public.rlms_undo_calc_create_opp(uuid,uuid,text)', 'execute')") === "t", "service_role can execute the wrapper");
  ok(psql("select prosecdef::text from pg_proc where proname = 'rlms_undo_calc_create_opp'") === "true", "wrapper is security definer");

  const opp = psql("insert into opportunities (account_id, type, stage, flavor, offering_name) values (1, 'purchase', 'proposal', 'portfolio_bid', 'Linked') returning id");
  const line = psql(`insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count) values (${opp}, '1', 4) returning id`);
  const unlinked = psql("insert into deal_calc_scenarios (opportunity_id, name, deal_type, method, calc_version, inputs, results) values (null, 'Loose', 'fleet_purchase', 'cash_flow', 'v2', '{}'::jsonb, '{}'::jsonb) returning id");
  ok(psql(`select opportunity_id is null from deal_calc_scenarios where id = ${unlinked}`) === "t", "a scenario can be saved with no opportunity");
  ok(/line_needs_opp|check constraint|is not on opportunity/i.test(psqlFails(`insert into deal_calc_scenarios (opportunity_id, opportunity_line_id, name, deal_type, method, calc_version, inputs, results) values (null, ${line}, 'bad', 'fleet_purchase', 'cash_flow', 'v2', '{}'::jsonb, '{}'::jsonb)`)), "a line without an opportunity is refused");
  ok(/pin_needs_opp|check constraint/i.test(psqlFails("insert into deal_calc_scenarios (opportunity_id, name, deal_type, method, calc_version, inputs, results, is_pinned) values (null, 'pinned', 'fleet_purchase', 'cash_flow', 'v2', '{}'::jsonb, '{}'::jsonb, true)")), "an unlinked scenario cannot be pinned");

  function act(entity: string, id: string, action: string, detail: string, group: string, table: string, pk: string, beforeSql: string, afterSql: string, actor = "tester") {
    psql(`insert into activity_log (entity_type, entity_id, action, actor, detail, change_group, table_name, row_pk, before, after, undoable) values ('${entity}', ${id}, '${action}', '${actor}', ${detail}::jsonb, '${group}', '${table}', ${pk}, ${beforeSql}, ${afterSql}, true)`);
  }

  const linkGroup = psql("select gen_random_uuid()");
  psql(`update deal_calc_scenarios set opportunity_id = ${opp}, opportunity_line_id = null, is_pinned = false where id = ${unlinked}`);
  act("deal_calc_scenario", unlinked, "link_deal_calc_scenario", `'{"op":"update"}'`, linkGroup, "deal_calc_scenarios", unlinked, `'{"opportunity_id": null, "is_pinned": false}'`, `jsonb_build_object('opportunity_id', ${opp}::bigint, 'is_pinned', false)`);
  ok(psql(`select public.rlms_undo_deal_calc_group('${linkGroup}'::uuid, 'tester')->>'ok'`) === "true", "undo of a link succeeds");
  ok(psql(`select opportunity_id is null and is_pinned = false from deal_calc_scenarios where id = ${unlinked}`) === "t", "undo of a link restores a null opportunity and no pin");

  psql(`update deal_calc_scenarios set opportunity_id = ${opp}, is_pinned = true where id = ${unlinked}`);
  const unlinkGroup = psql("select gen_random_uuid()");
  psql(`update deal_calc_scenarios set is_pinned = false, opportunity_id = null where id = ${unlinked}`);
  act("deal_calc_scenario", unlinked, "unpin_deal_calc_scenario", `'{"op":"update"}'`, unlinkGroup, "deal_calc_scenarios", unlinked, `'{"is_pinned": true}'`, `'{"is_pinned": false}'`);
  act("deal_calc_scenario", unlinked, "unlink_deal_calc_scenario", `'{"op":"update"}'`, unlinkGroup, "deal_calc_scenarios", unlinked, `jsonb_build_object('opportunity_id', ${opp}::bigint)`, `'{"opportunity_id": null}'`);
  ok(psql(`select public.rlms_undo_deal_calc_group('${unlinkGroup}'::uuid, 'tester')->>'ok'`) === "true", "undo of an unlink succeeds");
  ok(psql(`select opportunity_id = ${opp} and is_pinned from deal_calc_scenarios where id = ${unlinked}`) === "t", "undo of an unlink restores the link and the pin");

  const other = psql(`insert into deal_calc_scenarios (opportunity_id, name, deal_type, method, calc_version, inputs, results, is_pinned) values (${opp}, 'Holder', 'fleet_purchase', 'cash_flow', 'v2', '{}'::jsonb, '{}'::jsonb, false) returning id`);
  psql(`update deal_calc_scenarios set is_pinned = false, opportunity_id = null where id = ${unlinked}`);
  const takenGroup = psql("select gen_random_uuid()");
  act("deal_calc_scenario", unlinked, "unpin_deal_calc_scenario", `'{"op":"update"}'`, takenGroup, "deal_calc_scenarios", unlinked, `'{"is_pinned": true}'`, `'{"is_pinned": false}'`);
  act("deal_calc_scenario", unlinked, "unlink_deal_calc_scenario", `'{"op":"update"}'`, takenGroup, "deal_calc_scenarios", unlinked, `jsonb_build_object('opportunity_id', ${opp}::bigint)`, `'{"opportunity_id": null}'`);
  psql(`update deal_calc_scenarios set is_pinned = true where id = ${other}`);
  const taken = psql(`select public.rlms_undo_deal_calc_group('${takenGroup}'::uuid, 'tester')->>'error'`);
  ok(taken === "conflict", `undo of a link when the pin slot is taken is a conflict (${taken})`);
  ok(psql(`select opportunity_id is null and is_pinned = false from deal_calc_scenarios where id = ${unlinked}`) === "t", "the conflict leaves the scenario unlinked");
  ok(psql(`select is_pinned from deal_calc_scenarios where id = ${other}`) === "t", "the live pin stays");
  ok(psql(`select count(*) from activity_log where change_group = '${takenGroup}' and undone_at is not null`) === "0", "the conflict does not mark the group undone");

  psql(`update deal_calc_scenarios set opportunity_id = ${opp}, is_pinned = true, deleted_at = null where id = ${other}`);
  psql(`update deal_calc_scenarios set is_pinned = false, deleted_at = timestamptz '2026-10-21 00:00:00+00' where id = ${other}`);
  const deleteAfter = psql(`select jsonb_build_object('deleted_at', deleted_at)::text from deal_calc_scenarios where id = ${other}`);
  const deleteGroup = psql("select gen_random_uuid()");
  act("deal_calc_scenario", other, "unpin_deal_calc_scenario", `'{"op":"update"}'`, deleteGroup, "deal_calc_scenarios", other, `'{"is_pinned": true}'`, `'{"is_pinned": false}'`);
  act("deal_calc_scenario", other, "delete_deal_calc_scenario", `'{"op":"update"}'`, deleteGroup, "deal_calc_scenarios", other, `'{"deleted_at": null}'`, `'${deleteAfter}'::jsonb`);
  ok(psql(`select public.rlms_undo_deal_calc_group('${deleteGroup}'::uuid, 'tester')->>'ok'`) === "true", "undo of a pinned soft-delete succeeds");
  ok(psql(`select deleted_at is null and is_pinned from deal_calc_scenarios where id = ${other}`) === "t", "the pinned scenario is restored");

  const pinOnly = psql(`insert into deal_calc_scenarios (opportunity_id, name, deal_type, method, calc_version, inputs, results, is_pinned) values (${opp}, 'Plain', 'fleet_purchase', 'cash_flow', 'v2', '{}'::jsonb, '{}'::jsonb, false) returning id`);
  const pinGroup = psql("select gen_random_uuid()");
  act("deal_calc_scenario", pinOnly, "update_deal_calc_scenario", `'{"op":"update"}'`, pinGroup, "deal_calc_scenarios", pinOnly, `'{"is_pinned": true}'`, `'{"is_pinned": false}'`);
  ok(psql(`select public.rlms_undo_deal_calc_group('${pinGroup}'::uuid, 'tester')->>'ok'`) === "true", "a pin-only undo beside a live pin succeeds");
  ok(psql(`select is_pinned from deal_calc_scenarios where id = ${pinOnly}`) === "f", "the pin-only undo demotes instead of erroring");

  function pair(name: string, scenarioId: string | null) {
    const core = psql("select gen_random_uuid()");
    const calc = psql("select gen_random_uuid()");
    const createdOpp = psql(`insert into opportunities (account_id, type, stage, flavor, offering_name) values (1, 'purchase', 'proposal', 'portfolio_bid', '${name}') returning id`);
    const createdLine = psql(`insert into opportunity_lines (opportunity_id, seller_deal_ref, car_count) values (${createdOpp}, '1', 2) returning id`);
    const detailCore = `'{"op":"insert","link_kind":"calc_create_opp","linked_group":"${calc}"}'`;
    const detailCalc = `'{"op":"${scenarioId ? "update" : "insert"}","link_kind":"calc_create_opp","linked_group":"${core}"}'`;
    act("opportunity", createdOpp, "create_opportunity", detailCore, core, "opportunities", createdOpp, "null", `jsonb_build_object('offering_name', '${name}')`);
    act("opportunity_line", createdLine, "create_opportunity_line", detailCore, core, "opportunity_lines", createdLine, "null", `'{"seller_deal_ref":"1"}'`);
    let sid = scenarioId;
    if (!sid) {
      sid = psql(`insert into deal_calc_scenarios (opportunity_id, opportunity_line_id, name, deal_type, method, calc_version, inputs, results) values (${createdOpp}, ${createdLine}, '${name}', 'fleet_purchase', 'cash_flow', 'v2', '{}'::jsonb, '{}'::jsonb) returning id`);
      act("deal_calc_scenario", sid, "create_deal_calc_scenario", detailCalc, calc, "deal_calc_scenarios", sid, "null", `jsonb_build_object('name', '${name}')`);
    } else {
      psql(`update deal_calc_scenarios set opportunity_id = ${createdOpp}, opportunity_line_id = ${createdLine}, is_pinned = false where id = ${sid}`);
      act("deal_calc_scenario", sid, "link_deal_calc_scenario", detailCalc, calc, "deal_calc_scenarios", sid, `'{"opportunity_id": null, "opportunity_line_id": null, "is_pinned": false}'`, `jsonb_build_object('opportunity_id', ${createdOpp}::bigint, 'opportunity_line_id', ${createdLine}::bigint, 'is_pinned', false)`);
    }
    return { core, calc, createdOpp, createdLine, sid };
  }

  const fresh = pair("Created", null);
  const undone = psql(`select public.rlms_undo_calc_create_opp('${fresh.calc}'::uuid, '${fresh.core}'::uuid, 'tester')`);
  ok(undone.includes('"ok": true') || undone.includes('"ok":true'), `wrapper undo of a new scenario succeeds (${undone})`);
  ok(psql(`select count(*) from deal_calc_scenarios where id = ${fresh.sid}`) === "0", "the scenario is gone");
  ok(psql(`select count(*) from opportunity_lines where id = ${fresh.createdLine}`) === "0", "the line is gone");
  ok(psql(`select count(*) from opportunities where id = ${fresh.createdOpp}`) === "0", "the opportunity is gone");
  const order = psql(`select table_name from activity_log where source = 'undo' and undo_of in (select id from activity_log where change_group in ('${fresh.calc}', '${fresh.core}')) order by id`);
  ok(order === "deal_calc_scenarios\nopportunity_lines\nopportunities", `undo order is scenario, line, opportunity (${order.replaceAll("\n", ",")})`);
  ok(psql(`select count(*) from activity_log where change_group in ('${fresh.calc}', '${fresh.core}') and undone_at is null`) === "0", "both groups are marked undone");
  ok(psql(`select public.rlms_undo_calc_create_opp('${fresh.calc}'::uuid, '${fresh.core}'::uuid, 'tester')->>'error'`) === "already_undone", "a second wrapper call is already_undone");

  const existing = psql("insert into deal_calc_scenarios (opportunity_id, name, deal_type, method, calc_version, inputs, results, is_pinned) values (null, 'Existing', 'fleet_purchase', 'cash_flow', 'v2', '{}'::jsonb, '{}'::jsonb, false) returning id");
  const linked = pair("Linked existing", existing);
  ok(psql(`select public.rlms_undo_calc_create_opp('${linked.calc}'::uuid, '${linked.core}'::uuid, 'tester')->>'ok'`) === "true", "wrapper undo of a linked existing scenario succeeds");
  ok(psql(`select opportunity_id is null and is_pinned = false from deal_calc_scenarios where id = ${existing}`) === "t", "the scenario is restored unlinked and unpinned");
  ok(psql(`select count(*) from opportunities where id = ${linked.createdOpp}`) === "0", "the created opportunity is deleted");
  ok(psql(`select count(*) from opportunity_lines where id = ${linked.createdLine}`) === "0", "the created line is deleted");

  const edited = pair("Edit me", null);
  psql(`update opportunities set offering_name = 'Changed' where id = ${edited.createdOpp}`);
  const conflict = psql(`select public.rlms_undo_calc_create_opp('${edited.calc}'::uuid, '${edited.core}'::uuid, 'tester')->>'error'`);
  ok(conflict === "conflict", `an edit after creation is a conflict (${conflict})`);
  ok(psql(`select count(*) from deal_calc_scenarios where id = ${edited.sid}`) === "1", "the conflict keeps the scenario");
  ok(psql(`select offering_name from opportunities where id = ${edited.createdOpp}`) === "Changed", "the conflict keeps the edit");
  ok(psql(`select count(*) from activity_log where change_group = '${edited.calc}' and undone_at is not null`) === "0", "the scenario group is not marked undone");
  ok(psql(`select count(*) from activity_log where source = 'undo' and undo_of in (select id from activity_log where change_group in ('${edited.calc}', '${edited.core}'))`) === "0", "the conflict leaves no undo audit rows");

  const outside = pair("Outside", null);
  const contact = psql(`insert into opportunity_contacts (opportunity_id, contact_id) values (${outside.createdOpp}, 1) returning id`);
  const contactGroup = psql("select gen_random_uuid()");
  act("opportunity_contact", contact, "create_opportunity_contact", `'{"op":"insert"}'`, contactGroup, "opportunity_contacts", contact, "null", `'{"contact_id": 1}'`);
  const referenced = psql(`select public.rlms_undo_calc_create_opp('${outside.calc}'::uuid, '${outside.core}'::uuid, 'tester')->>'error'`);
  ok(referenced === "referenced_since", `an outside contact is referenced_since (${referenced})`);
  ok(psql(`select count(*) from deal_calc_scenarios where id = ${outside.sid}`) === "1", "referenced_since keeps the scenario");
  ok(psql(`select count(*) from opportunities where id = ${outside.createdOpp}`) === "1", "referenced_since keeps the opportunity");
  ok(psql(`select count(*) from activity_log where change_group = '${outside.calc}' and undone_at is not null`) === "0", "referenced_since does not mark the scenario group undone");

  const direct = pair("Direct", null);
  const directErr = psqlFails(`select public.rlms_undo_change_group('${direct.core}'::uuid, 'tester')`);
  ok(/foreign key|restrict|violates/i.test(directErr), `direct generic undo of group C fails (${directErr.split("\n")[0]})`);
  ok(psql(`select opportunity_id = ${direct.createdOpp} from deal_calc_scenarios where id = ${direct.sid}`) === "t", "the failed generic undo leaves the scenario linked");
  ok(psql(`select count(*) from activity_log where change_group = '${direct.core}' and undone_at is not null`) === "0", "the failed generic undo does not mark group C undone");

  const filed = pair("Filed", null);
  psql("alter table public.attachments drop constraint attachments_entity_type_check");
  psql("alter table public.attachments add constraint attachments_entity_type_check check (entity_type = any (array['master_lease','rider','railcar','account','company','company_contact','opportunity']::text[]))");
  const fileId = psql(`insert into attachments (entity_type, entity_id, opportunity_line_id, file_name, source_module) values ('opportunity', ${filed.createdOpp}, ${filed.createdLine}, 'bid.pdf', 'manual') returning id`);
  const blocked = psql(`select exists (select 1 from attachments f where f.id = ${fileId} and f.opportunity_line_id = ${filed.createdLine} and not exists (select 1 from activity_log a where a.change_group = '${filed.core}' and a.table_name = 'attachments' and a.row_pk = f.id))`);
  ok(blocked === "t", "a file on the created line is outside the group");
  ok(psql(`select count(*) from activity_log where change_group = '${filed.calc}' and undone_at is not null`) === "0", "the file check refuses before anything is undone");

  function bad(label: string, mutate: (core: string, calc: string) => void) {
    const core = psql("select gen_random_uuid()");
    const calc = psql("select gen_random_uuid()");
    act("opportunity", "1", "create_opportunity", `'{"op":"insert","link_kind":"calc_create_opp","linked_group":"${calc}"}'`, core, "opportunities", "1", "null", `'{"offering_name":"x"}'`);
    act("deal_calc_scenario", "1", "create_deal_calc_scenario", `'{"op":"insert","link_kind":"calc_create_opp","linked_group":"${core}"}'`, calc, "deal_calc_scenarios", "1", "null", `'{"name":"x"}'`);
    mutate(core, calc);
    const error = psql(`select public.rlms_undo_calc_create_opp('${calc}'::uuid, '${core}'::uuid, 'tester')->>'error'`);
    ok(error === "invalid_link", `${label} is invalid_link (${error})`);
    ok(psql(`select count(*) from activity_log where change_group in ('${calc}', '${core}') and undone_at is not null`) === "0", `${label} changes nothing`);
  }
  bad("wrong linked_group", (core) => {
    psql(`update activity_log set detail = jsonb_set(detail, '{linked_group}', '"not-the-other"') where change_group = '${core}'`);
  });
  bad("wrong link_kind", (core) => {
    psql(`update activity_log set detail = jsonb_set(detail, '{link_kind}', '"other"') where change_group = '${core}'`);
  });
  bad("extra table", (_core, calc) => {
    act("company", "1", "create_company", `'{"op":"insert","link_kind":"calc_create_opp","linked_group":"${_core}"}'`, calc, "companies", "1", "null", `'{"name":"x"}'`);
  });
  bad("different actor", (core) => {
    psql(`update activity_log set actor = 'someone-else' where change_group = '${core}'`);
  });

  const loose = psql("insert into deal_calc_scenarios (opportunity_id, name, deal_type, method, calc_version, inputs, results) values (null, 'Stay', 'fleet_purchase', 'cash_flow', 'v2', '{}'::jsonb, '{}'::jsonb) returning id");
  const refused = psqlFileFails(join(repo, "migrations/20261123_crm_deal_calc_v2_down.sql"));
  ok(/deal_calc_scenarios have no opportunity/.test(refused), `down refuses null opportunities (${refused.split("\n").find((line) => line.includes("opportunity")) ?? refused.slice(0, 180)})`);
  ok(psql(`select count(*) from deal_calc_scenarios where id = ${loose}`) === "1", "the refused down deletes nothing");
  psql("delete from deal_calc_scenarios where opportunity_id is null");
  psqlFile(join(repo, "migrations/20261123_crm_deal_calc_v2_down.sql"));
  const restored = md5s();
  ok(restored.apply === POST.apply && restored.undo === POST.undo && restored.referenced === POST.referenced && restored.fk === POST.fk, "down leaves the frozen functions unchanged");
  ok(psql("select md5(pg_get_functiondef('public.rlms_undo_deal_calc_group'::regproc))") === p1Undo, "down restores the p1 deal-calc undo md5");
  ok(psql("select to_regprocedure('public.rlms_undo_calc_create_opp(uuid,uuid,text)')") === "", "down drops the wrapper");
  ok(psql("select count(*) from pg_constraint where conname in ('deal_calc_scenarios_line_needs_opp', 'deal_calc_scenarios_pin_needs_opp')") === "0", "down drops the v2 checks");
  ok(/not-null|not null/i.test(psqlFails("insert into deal_calc_scenarios (opportunity_id, name, deal_type, method, calc_version, inputs, results) values (null, 'nope', 'fleet_purchase', 'cash_flow', 'v2', '{}'::jsonb, '{}'::jsonb)")), "opportunity_id is not null again");
} catch (err) {
  failed += 1;
  console.error("FAIL", err instanceof Error ? err.message : err);
} finally {
  run(bin("pg_ctl"), ["-D", data, "stop", "-m", "immediate"]);
  rmSync(root, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
