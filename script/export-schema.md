# Schema export (do not run against live until ready)

The checked-in `migrations/` folder is incomplete relative to the live personal
Supabase project (~21 migrations historically vs. a handful of files here).
Before corporate cutover, export the **live** schema and check it into
`schema/` so corporate apply starts from truth, not memory.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- Access to the personal Supabase project (read-only dump is enough)
- Project linked locally (`supabase link --project-ref <ref>`) **or** a
  database connection string with read access

## Commands (run manually — do not automate against production)

From the repo root:

```powershell
.\script\export-schema.ps1
```

Or equivalently:

```bash
# Schema + RLS policies (no data)
supabase db dump --schema-only -f schema/live_schema_YYYYMMDD.sql

# Optional: roles dump if your CLI version supports it
# supabase db dump --role-only -f schema/live_roles_YYYYMMDD.sql
```

Replace `YYYYMMDD` with today's date. Commit the resulting SQL under `schema/`
once reviewed.

## What this is for

1. Reconcile live schema vs. checked-in migrations
2. Seed the new corporate Supabase project at cutover
3. Audit RLS (`anon` / authenticated roles) before importing real fleet data

## Hard stop

**Do not execute these dumps as part of routine CI or agent automation against
the live personal instance** unless Bruce explicitly runs them. Export is
read-only but still touches production credentials.
