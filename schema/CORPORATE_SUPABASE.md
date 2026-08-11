# Corporate Supabase — RLMS

Created 2026-08-11 in org **RESIDCO Rail Industry Data Room**.

| | |
|---|---|
| Project name | `rlms-residco` |
| Project ref | `eweydhfduepaefshriar` |
| Region | `us-east-1` |
| Dashboard | https://supabase.com/dashboard/project/eweydhfduepaefshriar |
| API URL | `https://eweydhfduepaefshriar.supabase.co` |

**Isolated from UMLER** (`jtxyvjxmhuanvivmhimv`) — separate database, Auth, and API keys.

## Local secrets

Credentials are in gitignored `.env.local` at the repo root (anon, service_role, DB password, pooler `DATABASE_URL`). Do not commit that file.

On this network the direct host `db.<ref>.supabase.co` resolves to **IPv6 only**; use the **pooler** URL in `.env.local` for Node/`supabase db query`.

## Remaining cutover steps

1. **Live personal schema dump** — blocked here: personal project `qgdrgiqrkoyhvbakuqwo` is on a different Supabase account (403 with corporate token). Need either:
   - a personal-account access token, or
   - the personal project database password / connection string  
   Then run `script/export-schema.ps1 -Execute` (requires Docker Desktop for `supabase db dump`) or dump from the SQL editor and save under `schema/live_schema_YYYYMMDD.sql`.

2. **Apply exported schema** to `eweydhfduepaefshriar`, enable RLS, then apply `migrations/20260811_add_editor_role.sql`.

3. **Render** — still needs a corporate web service; wire env vars from `.env.local` + `VITE_API_BASE`.

4. Swap UMLER `RLMS_EXTERNAL_URL` once the corporate Render URL exists.

## Schema status (2026-08-11)

- Live personal schema exported (read-only) to `schema/live_schema_20260811.sql` + `schema/live_sequences_20260811.sql`.
- Applied to corporate project `eweydhfduepaefshriar` (23 public tables).
- Editor role check applied: `user_roles.role IN ('admin','editor','viewer')`.
- Personal instance was not wiped or modified beyond a password reset you performed.
