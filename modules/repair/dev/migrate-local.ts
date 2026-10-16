/**
 * Apply local public stubs + repair schema migrations via node-postgres.
 *
 * Avoids npm-on-Windows cmd.exe failing to expand `"$DATABASE_URL"` and
 * avoids requiring `psql` on PATH. Reads DATABASE_URL / REPAIR_DATABASE_URL
 * from the process environment inside TypeScript.
 *
 * Tracked runner: records each applied migration filename in
 * `repair.schema_migrations` and skips files already applied. Safe to call
 * from seed/smoke/demo on an already-migrated DB (no re-run of foundation
 * CREATE OR REPLACE VIEW that would drop columns).
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

/** Dev-only public stubs — always re-applied (idempotent IF NOT EXISTS / OR REPLACE). */
export const LOCAL_STUBS_SQL = "modules/repair/dev/local-public-stubs.sql";

/** Ordered repair schema migrations (tracked; skip when already applied). */
export const LOCAL_MIGRATE_SQL_FILES = [
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
  "modules/repair/migrations/20261014_repair_ui_review_feedback.sql",
  "modules/repair/migrations/20261014_repair_shop_master_entity.sql",
  "modules/repair/migrations/20261014_repair_shop_master_fields.sql",
  "modules/repair/migrations/20261014_repair_railroads.sql",
  "modules/repair/migrations/20261014_repair_shop_map.sql",
  "modules/repair/migrations/20261014_repair_bad_orders_c.sql",
  "modules/repair/migrations/20261014_repair_bad_orders_c_r2.sql",
  "modules/repair/migrations/20261014_repair_owner_ui_d.sql",
  "modules/repair/migrations/20261014_repair_owner_ui_d_r2.sql",
  "modules/repair/migrations/20261014_repair_owner_ui_d_r2b.sql",
  "modules/repair/migrations/20261014_repair_owner_ui_d_r3.sql",
  "modules/repair/migrations/20261014_repair_owner_ui_d_r4.sql",
  "modules/repair/migrations/20261014_repair_owner_ui_d_r5.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_wreck.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_wreck_dv.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_e_documents.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_e_brc_email.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_f_lessee.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_f_lessee_r3.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_g_shop.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_g_shop_r2.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_g_shop_r3.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_g_shop_r4.sql",
  "modules/repair/migrations/20261015_repair_owner_ui_g_shop_r5.sql",
  "modules/repair/migrations/20261016_repair_owner_ui_h_invoice.sql",
] as const;

/**
 * Probes for baseline-stamping a pre-tracking DB without marking unapplied
 * newer files as done. Stamp every file up through the highest passing probe.
 */
const MIGRATION_BASELINE_PROBES: Partial<Record<string, string>> = {
  "modules/repair/migrations/20261013_repair_schema_foundation.sql":
    `to_regclass('repair.tenants') IS NOT NULL`,
  "modules/repair/migrations/20261014_repair_shop_master_entity.sql": `
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'repair' AND table_name = 'shops' AND column_name = 'splc'
    )`,
  "modules/repair/migrations/20261014_repair_shop_master_fields.sql": `
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'repair' AND table_name = 'shops' AND column_name = 'shop_mark'
    )`,
  "modules/repair/migrations/20261014_repair_railroads.sql": `
    to_regclass('repair.railroads') IS NOT NULL`,
  "modules/repair/migrations/20261014_repair_shop_map.sql": `
    to_regclass('repair.places') IS NOT NULL`,
  "modules/repair/migrations/20261014_repair_bad_orders_c.sql": `
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'repair' AND table_name = 'bad_orders'
        AND column_name = 'stcc'
    )`,
  "modules/repair/migrations/20261014_repair_bad_orders_c_r2.sql": `
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'repair' AND table_name = 'bo_rules'
        AND column_name = 'short_name'
    )`,
};

/** Full ordered list previously passed to `psql -f …` (stubs + migrations). */
export const LOCAL_MIGRATE_ALL_FILES = [
  LOCAL_STUBS_SQL,
  ...LOCAL_MIGRATE_SQL_FILES,
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

async function ensureSchemaMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS repair`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS repair.schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Pre-tracking DBs (Bruce PC after migrate:local through shop_master) have the
 * full schema but an empty schema_migrations table. Stamp every file up through
 * the highest passing probe so seed/smoke skip already-applied SQL, while still
 * applying newer files (e.g. shop_master_fields) that are not yet present.
 *
 * Force re-apply with REPAIR_MIGRATE_FORCE=1 (ignores tracking; still uses
 * DROP VIEW safety in SQL).
 */
async function baselineStampIfNeeded(
  client: pg.Client,
  files: readonly string[],
): Promise<number> {
  const countRes = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM repair.schema_migrations`,
  );
  if (Number(countRes.rows[0]?.n ?? 0) > 0) return 0;

  let maxApplied = -1;
  for (let i = 0; i < files.length; i++) {
    const sql = MIGRATION_BASELINE_PROBES[files[i]];
    if (!sql) continue;
    const probe = await client.query<{ ok: boolean }>(
      `SELECT (${sql}) AS ok`,
    );
    if (probe.rows[0]?.ok) maxApplied = i;
  }
  if (maxApplied < 0) return 0;

  let stamped = 0;
  for (let i = 0; i <= maxApplied; i++) {
    await client.query(
      `INSERT INTO repair.schema_migrations (filename) VALUES ($1)
       ON CONFLICT (filename) DO NOTHING`,
      [files[i]],
    );
    stamped += 1;
  }
  console.log(
    `  baseline: stamped ${stamped} migration(s) already present (through ${files[maxApplied]})`,
  );
  return stamped;
}

async function appliedSet(client: pg.Client): Promise<Set<string>> {
  const res = await client.query<{ filename: string }>(
    `SELECT filename FROM repair.schema_migrations`,
  );
  return new Set(res.rows.map((r) => r.filename));
}

async function applyOneSql(
  client: pg.Client,
  rel: string,
): Promise<void> {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) {
    throw new Error(`Migration file missing: ${rel}`);
  }
  const sql = readFileSync(abs, "utf8");
  process.stdout.write(`  apply ${rel} … `);
  await client.query(sql);
  console.log("ok");
}

async function applySqlViaPg(databaseUrl: string, files: readonly string[]) {
  const force =
    process.env.REPAIR_MIGRATE_FORCE === "1" ||
    process.env.REPAIR_MIGRATE_FORCE === "true";

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Stubs always (idempotent public helpers for empty local DB).
    await applyOneSql(client, LOCAL_STUBS_SQL);

    await ensureSchemaMigrationsTable(client);
    if (!force) {
      await baselineStampIfNeeded(client, files);
    }

    const done = force ? new Set<string>() : await appliedSet(client);
    let applied = 0;
    let skipped = 0;

    for (const rel of files) {
      if (done.has(rel)) {
        console.log(`  skip  ${rel} (already applied)`);
        skipped += 1;
        continue;
      }
      await applyOneSql(client, rel);
      await client.query(
        `INSERT INTO repair.schema_migrations (filename) VALUES ($1)
         ON CONFLICT (filename) DO NOTHING`,
        [rel],
      );
      applied += 1;
    }

    console.log(
      force
        ? `  summary: force-applied ${applied} migration(s)`
        : `  summary: applied ${applied}, skipped ${skipped}`,
    );
  } finally {
    await client.end();
  }
}

function applySqlViaPsql(databaseUrl: string, files: readonly string[]) {
  // psql fallback: no tracking (legacy). Prefer node-pg path.
  console.warn(
    "  warning: psql fallback re-applies all files (no schema_migrations tracking). Prefer node-pg.",
  );
  const psql = resolvePsqlBinary();
  const all = [LOCAL_STUBS_SQL, ...files];
  const args = ["-v", "ON_ERROR_STOP=1", databaseUrl];
  for (const rel of all) {
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
 * Set REPAIR_MIGRATE_FORCE=1 to re-apply all tracked migrations (node-pg only).
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
      : "repair:migrate:local — node-pg tracked (skip already-applied)",
  );
  console.log(
    `  target: ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`,
  );

  if (usePsql) {
    applySqlViaPsql(databaseUrl, LOCAL_MIGRATE_SQL_FILES);
  } else {
    await applySqlViaPg(databaseUrl, LOCAL_MIGRATE_SQL_FILES);
  }

  // NARN operating-railroad seed (idempotent UPSERT) — after table exists
  try {
    const { seedRailroadsFromNarn } = await import("../services/railroads");
    const seeded = await seedRailroadsFromNarn();
    console.log(
      `  railroads seed: inserted ${seeded.inserted}, updated ${seeded.updated} (of ${seeded.total})`,
    );
  } catch (err) {
    console.warn(
      "  railroads seed skipped:",
      err instanceof Error ? err.message : err,
    );
  }

  // GeoNames US/CA/MX places seed (idempotent UPSERT) — shop map geocode
  try {
    const { seedPlacesFromBundle } = await import("../services/places");
    const places = await seedPlacesFromBundle();
    console.log(
      `  places seed: inserted ${places.inserted}, updated ${places.updated} (of ${places.total})`,
    );
  } catch (err) {
    console.warn(
      "  places seed skipped:",
      err instanceof Error ? err.message : err,
    );
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
