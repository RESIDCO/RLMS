# Repair schema migrations (local Postgres only)

These SQL files create/alter objects in the **`repair` schema only**.
They must **not** be applied to production Supabase (`rlms-residco`) or mixed into
host `migrations/` apply workflows.

## How / when to apply

**Local Postgres only for now.**

```bash
export DATABASE_URL=postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev
export REPAIR_LOCAL_DB=1
npm run repair:migrate:local
```

That script (`modules/repair/dev/migrate-local.ts`):

1. Always applies `modules/repair/dev/local-public-stubs.sql` (dev-only public stubs for an empty local DB — never against prod; idempotent)
2. Tracks applied files in `repair.schema_migrations` and **skips** already-applied migrations (seed/smoke/demo call the same runner safely)
3. On a pre-tracking DB that already has foundation + shop_master (`shops.splc`), baselines the table so nothing re-runs
4. Applies pending files in date/name order (foundation → … → shop_master_entity)
5. View DDL uses `DROP VIEW IF EXISTS … CASCADE` then `CREATE VIEW` so column lists can change without `checkViewColumns` errors

`REPAIR_MIGRATE_FORCE=1` re-applies all tracked migrations (still DROP+CREATE for views).

Do **not** create a Supabase branch. Do **not** run these via drizzle-kit (`drizzle.config.ts` points at sqlite `./migrations` for host tooling and is unrelated).

## Isolation notes

| File | Touches |
|---|---|
| `20261013_repair_schema_foundation.sql` | `CREATE SCHEMA repair`; repair tables; `repair.cars_ref` **view** that *reads* `public.railcars` / `public.v_valid_export_rows` (no public DDL) |
| All other `*_repair_*.sql` | `repair.*` tables/data only |

Host RLMS migrations remain under repo-root `migrations/` (unchanged by the repair module).
