# Scheduled: Row Level Security (corporate Supabase)

**Status:** Not started — do not enable RLS until policies are designed and tested.

**App-layer note (2026-08-13):** Express now requires a valid Supabase Bearer session on every `/api/*` route (`server/auth.ts`). That stops anonymous HTTP downloads of fleet data. It does **not** replace RLS — the service/anon keys can still hit Postgres directly until RLS is designed.

## Why this is separate
RLS is disabled on all ~23 corporate tables (`railcars`, `rider_financial_summary`, `assignment_history`, …). The service/anon API key alone can read/write any row. Flipping RLS on with no policies will break the app.

## Scope (own workstream)
1. Inventory every table and current client/server access paths (Edge Functions, Express with service role, browser anon).
2. Define Admin / Editor / Viewer capabilities per table (read / insert / update / delete).
3. Author policies; stage behind a feature flag or non-prod project first.
4. Verify login + role still works for Dashboard, Registry, Import, Move Cars, Lease Management.
5. Only then enable RLS in production.

## Do not
- Bundle this with Dashboard KPI or Sold/Idle work.
- Enable RLS “to be safe” without matching policies.
