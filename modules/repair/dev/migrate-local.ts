/**
 * Apply local public stubs + repair schema migrations via node-postgres.
 *
 * Avoids npm-on-Windows cmd.exe failing to expand `"$DATABASE_URL"` and
 * avoids requiring `psql` on PATH. Reads DATABASE_URL / REPAIR_DATABASE_URL
 * from the process environment inside TypeScript.
 *
 * Optional fallback (unused by default): set REPAIR_MIGRATE_USE_PSQL=1 and
 * optionally PSQL_PATH or PG_BIN to shell out to psql with an explicit
 * connection string argument (still no shell variable expansion).
 *
 * Run: npm run repair:migrate:local
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

/** Same ordered list previously passed to `psql -f …` in package.json. */
export const LOCAL_MIGRATE_SQL_FILES = [
  "modules/repair/dev/local-public-stubs.sql",
  "modules/repair/migrations/20261013_repair_schema_foundation.sql",
  "modules/repair/migrations/20261013_repair_schema_events.sql",
  "modules/repair/migrations/20261014_repair_catalog_and_aar.sql",
  "modules/repair/migrations/20261014_repair_seed_shops.sql",
  "modules/repair/migrations/20261014_repair_seed_categories.sql",
  "modules/repair/migrations/20261014_repair_seed_why_made.sql",
  "modules/repair/migrations/20261014_repair_resp_names_and_doc_filename.sql",
  "modules/repair/migrations/20261014_repair_pod_invoice_contacts.sql",
  "modules/repair/migrations/20261014_repair_ready_to_close.sql",
  "modules/repair/migrations/20261014_repair_monthly_close.sql",
  "modules/repair/migrations/20261014_repair_crb_billing_rules.sql",
  "modules/repair/migrations/20261014_repair_inbound_invoice_audit.sql",
  "modules/repair/migrations/20261014_repair_invoice_q18_q20.sql",
  "modules/repair/migrations/20261014_repair_estimate_load.sql",
  "modules/repair/migrations/20261014_repair_statuses_bo.sql",
  "modules/repair/migrations/20261014_repair_collab_tank.sql",
  "modules/repair/migrations/20261014_repair_ops_grid.sql",
  "modules/repair/migrations/20261014_repair_estimate_lifecycle_05.sql",
  "modules/repair/migrations/20261014_repair_estimate_lifecycle_06.sql",
] as const;

export function resolveDatabaseUrl(): string {
  const url =
    process.env.DATABASE_URL?.trim() ||
    process.env.REPAIR_DATABASE_URL?.trim() ||
    "";
  if (!url) {
    throw new Error(
      "Set DATABASE_URL (or REPAIR_DATABASE_URL) before repair:migrate:local",
    );
  }
  return url;
}

/** Resolve psql.exe from PSQL_PATH, PG_BIN, or PATH (fallback path only). */
export function resolvePsqlBinary(): string {
  const explicit = process.env.PSQL_PATH?.trim();
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`PSQL_PATH not found: ${explicit}`);
    }
    return explicit;
  }
  const binDir = process.env.PG_BIN?.trim();
  if (binDir) {
    const win = join(binDir, "psql.exe");
    const nix = join(binDir, "psql");
    if (existsSync(win)) return win;
    if (existsSync(nix)) return nix;
    throw new Error(`PG_BIN has no psql binary: ${binDir}`);
  }
  return "psql";
}

async function applySqlViaPg(databaseUrl: string, files: readonly string[]) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const rel of files) {
      const abs = join(repoRoot, rel);
      if (!existsSync(abs)) {
        throw new Error(`Migration file missing: ${rel}`);
      }
      const sql = readFileSync(abs, "utf8");
      process.stdout.write(`  apply ${rel} … `);
      await client.query(sql);
      console.log("ok");
    }
  } finally {
    await client.end();
  }
}

function applySqlViaPsql(databaseUrl: string, files: readonly string[]) {
  const psql = resolvePsqlBinary();
  const args = ["-v", "ON_ERROR_STOP=1", databaseUrl];
  for (const rel of files) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      throw new Error(`Migration file missing: ${rel}`);
    }
    args.push("-f", abs);
  }
  console.log(`  psql binary: ${psql}`);
  const result = spawnSync(psql, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    // Pass connection URL as argv — never rely on shell `$DATABASE_URL` expansion.
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`psql exited with status ${result.status}`);
  }
}

/**
 * Apply stubs + repair migrations. Prefer node-pg (no psql / PATH needed).
 * Set REPAIR_MIGRATE_USE_PSQL=1 to force the psql argv fallback.
 */
export async function migrateLocal(opts?: {
  databaseUrl?: string;
  usePsql?: boolean;
}): Promise<void> {
  const databaseUrl = opts?.databaseUrl ?? resolveDatabaseUrl();
  const usePsql =
    opts?.usePsql === true ||
    process.env.REPAIR_MIGRATE_USE_PSQL === "1" ||
    process.env.REPAIR_MIGRATE_USE_PSQL === "true";

  console.log(
    usePsql
      ? "repair:migrate:local — psql fallback (explicit connection argv)"
      : "repair:migrate:local — node-pg (no shell expansion, no psql required)",
  );
  console.log(
    `  target: ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`,
  );

  if (usePsql) {
    applySqlViaPsql(databaseUrl, LOCAL_MIGRATE_SQL_FILES);
  } else {
    await applySqlViaPg(databaseUrl, LOCAL_MIGRATE_SQL_FILES);
  }
  console.log("repair:migrate:local complete");
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  migrateLocal().catch((err) => {
    console.error("repair:migrate:local failed:", err);
    process.exit(1);
  });
}
