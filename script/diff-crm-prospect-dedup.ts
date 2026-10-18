/**
 * Read-only comparison of crm_prospect_dedup.
 * Prints the function body stored in master's migration (the text CREATE OR
 * REPLACE installs — the repo equivalent of pg_get_functiondef) versus the
 * AM-1 replacement. Does not connect to a database and does not execute SQL.
 *
 *   npx tsx script/diff-crm-prospect-dedup.ts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function extract(sql: string): string {
  const start = sql.indexOf("create or replace function public.crm_prospect_dedup");
  if (start < 0) throw new Error("crm_prospect_dedup not found");
  const end = sql.indexOf("$function$;", start);
  if (end < 0) throw new Error("function terminator not found");
  return sql.slice(start, end + "$function$;".length).trim() + "\n";
}

function unifiedDiff(before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), "am1-dedup-"));
  const left = join(dir, "master.sql");
  const right = join(dir, "am1.sql");
  writeFileSync(left, before);
  writeFileSync(right, after);
  const result = spawnSync("diff", ["-u", left, right], { encoding: "utf8" });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || "diff failed");
  }
  return (result.stdout || "(no difference)").replaceAll(left, "master migrations/20261111_crm_p1_1.sql").replaceAll(right, "AM-1 migrations/20261112_account_mgmt_am1.sql");
}

const master = extract(readFileSync(resolve("migrations/20261111_crm_p1_1.sql"), "utf8"));
const next = extract(readFileSync(resolve("migrations/20261112_account_mgmt_am1.sql"), "utf8"));

console.log("=== pg_get_functiondef equivalent: master's migrations/20261111_crm_p1_1.sql ===");
console.log(master);
console.log("=== pg_get_functiondef equivalent: AM-1 migrations/20261112_account_mgmt_am1.sql ===");
console.log(next);
console.log("=== diff ===");
console.log(unifiedDiff(master, next));
