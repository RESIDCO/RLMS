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

That script:

1. Applies `modules/repair/dev/local-public-stubs.sql` (dev-only public stubs for an empty local DB — never against prod)
2. Applies every file in this folder in date/name order (foundation → events → catalog → seeds → POD/invoice → ready-to-close → monthly close → CRB billing rules → inbound invoice audit → Q18–Q20 invoice rules → estimate load → statuses/BO → collab/tank → ops grid)

Do **not** create a Supabase branch. Do **not** run these via drizzle-kit (`drizzle.config.ts` points at sqlite `./migrations` for host tooling and is unrelated).

## Isolation notes

| File | Touches |
|---|---|
| `20261013_repair_schema_foundation.sql` | `CREATE SCHEMA repair`; repair tables; `repair.cars_ref` **view** that *reads* `public.railcars` / `public.v_valid_export_rows` (no public DDL) |
| All other `*_repair_*.sql` | `repair.*` tables/data only |

Host RLMS migrations remain under repo-root `migrations/` (unchanged by the repair module).
