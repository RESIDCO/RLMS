# Phase 1 local demo — Windows (Bruce PC)

One automated walk of Phase 1 on **local Postgres** (free/dev). No Supabase branch, no paid services, no PAT required for the demo itself.

Push path for git bundles: `C:\Users\BruceHarbridge\rlms-push`  
Draft PR only: https://github.com/RESIDCO/RLMS/pull/2 — **do not merge/deploy**.

---

## Prerequisites

| Tool | Notes |
|---|---|
| **Node.js 22 LTS (recommended)** | Prefer Node **22 LTS** over Node 24 on Windows — see [Node / npm install](#node--npm-install-windows). `node -v` |
| **npm** | ships with Node |
| **PostgreSQL 14+** | Local install **or** portable no-admin binaries on port **5433** — see [Database](#1-database-once). **`psql` is not required for migrate/demo** (node-pg applies SQL) |
| **Git** | for bundle pull into `rlms-push` |
| Repo at tip **`1adb3bf`+** | apply `rlms-phase1-demo-migrate-totals.bundle` (requires `1adb3bf`) |

Optional GUI: pgAdmin. Command line is enough.

---

## Node / npm install (Windows)

Host RLMS lists `better-sqlite3` (native addon for host drizzle/sqlite tooling). **Nothing under `modules/repair` imports or requires `better-sqlite3`** — the repair demo and migrations use **`pg` + local Postgres only**. Confirmed by searching `modules/repair` (no matches for `better-sqlite3` / sqlite imports).

On **Node 24** Windows, `npm install` often fails building `better-sqlite3` (node-gyp; no prebuilt binary). Either:

**Option A — recommended:** install **Node 22 LTS**, then a normal install:

```powershell
node -v   # expect v22.x
npm install
```

**Option B — stay on Node 24:** skip native build scripts (repair demo does not need the native module):

```powershell
npm install --ignore-scripts
```

If you later need host drizzle/sqlite tooling, use Option A (Node 22) and a full `npm install`.

---

## 1. Database (once)

Pick **one** path below.

### Path A — existing Postgres (admin / default 5432)

If you already have a Postgres service and can create roles (superuser password + rights):

```powershell
# Create role + database (run as postgres superuser once)
psql -U postgres -c "CREATE ROLE repairdev LOGIN PASSWORD 'repairdev';"
psql -U postgres -c "CREATE DATABASE rlms_repair_dev OWNER repairdev;"
```

If the role/DB already exist, skip. Confirm:

```powershell
psql "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev" -c "SELECT version();"
```

Use:

```text
DATABASE_URL=postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev
```

### Path B — no-admin portable Postgres (port 5433)

Use when you have **no postgres admin password** and **no Windows admin rights**. Install binaries under your user profile, `initdb` with `repairdev` as superuser, listen on **5433**.

#### B1. Download + unpack (once)

1. Get **PostgreSQL Windows x86-64 binaries** (zip, not the installer) from EnterpriseDB’s binary download page, or any official-equivalent zip that includes `bin\initdb.exe`, `bin\pg_ctl.exe`, `bin\psql.exe`, `bin\postgres.exe`.
2. Unpack to a folder you own, e.g. `%USERPROFILE%\pgsql` or `%USERPROFILE%\pg-demo\pgsql`  
   (`C:\Users\BruceHarbridge\pgsql` or `C:\Users\BruceHarbridge\pg-demo\pgsql`).

```powershell
$PgRoot = "$env:USERPROFILE\pgsql"   # or "$env:USERPROFILE\pg-demo\pgsql"
$PgData = "$env:USERPROFILE\pgsql-data-repair"
$PgBin  = "$PgRoot\bin"
# After unpack, $PgBin\initdb.exe should exist
& "$PgBin\initdb.exe" -D $PgData -U repairdev -A password --pwprompt
# When prompted, set password: repairdev
```

Create the database and start on **5433**:

```powershell
$PgRoot = "$env:USERPROFILE\pgsql"   # or "$env:USERPROFILE\pg-demo\pgsql"
$PgData = "$env:USERPROFILE\pgsql-data-repair"
$PgBin  = "$PgRoot\bin"
# Optional: put bin on PATH for manual psql / pg_ctl convenience
$env:PATH = "$PgBin;$env:PATH"
# If you unpacked under pg-demo:
# $env:PATH = "$env:USERPROFILE\pg-demo\pgsql\bin;$env:PATH"

# First start (creates postmaster.pid); listen only on localhost:5433
& "$PgBin\pg_ctl.exe" -D $PgData -o "-p 5433 -h 127.0.0.1" -l "$env:USERPROFILE\pgsql-repair.log" start

# Create app database (repairdev is already superuser from initdb)
& "$PgBin\psql.exe" -h 127.0.0.1 -p 5433 -U repairdev -d postgres -c "CREATE DATABASE rlms_repair_dev OWNER repairdev;"
```

Confirm:

```powershell
& "$PgBin\psql.exe" "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev" -c "SELECT version();"
```

Use this URL for the rest of the demo:

```text
DATABASE_URL=postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev
```

#### B2. Start / stop (each session)

```powershell
$PgData = "$env:USERPROFILE\pgsql-data-repair"
$PgBin  = "$env:USERPROFILE\pgsql\bin"   # or "$env:USERPROFILE\pg-demo\pgsql\bin"

# Start
& "$PgBin\pg_ctl.exe" -D $PgData -o "-p 5433 -h 127.0.0.1" -l "$env:USERPROFILE\pgsql-repair.log" start

# Stop
& "$PgBin\pg_ctl.exe" -D $PgData stop
```

#### B3. Tear down (delete portable install)

```powershell
$PgData = "$env:USERPROFILE\pgsql-data-repair"
$PgBin  = "$env:USERPROFILE\pgsql\bin"
& "$PgBin\pg_ctl.exe" -D $PgData stop 2>$null
Remove-Item -Recurse -Force "$env:USERPROFILE\pgsql-data-repair" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:USERPROFILE\pgsql" -ErrorAction SilentlyContinue
Remove-Item -Force "$env:USERPROFILE\pgsql-repair.log" -ErrorAction SilentlyContinue
```

This removes only the user-profile portable copy. It does not touch any system Postgres service.

---

## 2. Repo + env

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD
# Expect 1adb3bf (Windows runbook) or a child that includes migrate-totals

# Path A (5432) or Path B (5433) — match the database you started:
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
# $env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
# Optional:
# $env:REPAIR_DEMO_RESET = "0"          # keep existing repair schema (default drops + remigrates)
# $env:REPAIR_DEMO_OUT = "D:\tmp\repair-demo"
# $env:REPAIR_DEMO_ACCOUNT_MONTH = "2610"  # YYMM for CRIP filename

# Node 22: npm install
# Node 24: npm install --ignore-scripts
npm install
```

### Migrate: no shell `$DATABASE_URL`, no `psql` required

`npm run repair:migrate:local` runs **`tsx modules/repair/dev/migrate-local.ts`**, which:

1. Reads `DATABASE_URL` / `REPAIR_DATABASE_URL` **inside TypeScript** (process.env)
2. Applies stubs + repair SQL files via **`node-postgres` (`pg`)** — no `psql`, no PATH, no cmd.exe expansion of `"$DATABASE_URL"`

The demo calls the same `migrateLocal()` helper directly (does not shell out to npm for migrate).

**Fallback (optional):** if you ever need the old psql path:

```powershell
$env:REPAIR_MIGRATE_USE_PSQL = "1"
# Prefer explicit binary (portable Postgres Path B):
$env:PSQL_PATH = "$env:USERPROFILE\pg-demo\pgsql\bin\psql.exe"
# Or: $env:PG_BIN = "$env:USERPROFILE\pg-demo\pgsql\bin"
# Or put bin on PATH:
# $env:PATH = "$env:USERPROFILE\pg-demo\pgsql\bin;$env:PATH"
npm run repair:migrate:local
```

The psql fallback still passes the connection URL as an **argv** string from TypeScript — it does **not** rely on shell `"$DATABASE_URL"` expansion.

**Bash-shell tip (legacy workaround — keep as last resort):** older package.json used `psql "$DATABASE_URL" …`, which fails under npm’s default cmd.exe on Windows. If you are on a tip **before** this migrate-totals fix and need that old script:

```powershell
$env:npm_config_script_shell = "C:\Program Files\Git\bin\bash.exe"
```

After this tip, you should **not** need that for `repair:migrate:local` / `repair:demo:local`.

---

## 3. One-command demo

```powershell
npm run repair:demo:local
```

What it does:

1. Drops schema `repair` (unless `REPAIR_DEMO_RESET=0`)
2. Runs migrate via **node-pg** (public stubs + all repair migrations)
3. Seeds **OFOX 528313** + uses `modules/repair/dev/reference/Sample_Shop_500byte_OFOX2609.txt`
4. Walks: BO → estimate load (**MULTI_CAR warning** → accept) → revision → approval → Resp 6 lessee link approve → completion + dispo → shop CRB invoice + pre-pay **APPROVED_FOR_ACH** → Ready to Close → close → monthly close → **CRIPYYMM** file
5. **Totals smoke:** approved estimate = full source-file total; CRIP export = Resp **6/3** rebillable lines only (see below)
6. Bonus: void + restore on a companion estimate (retention)
7. Prints each step, status, shop/lessee links, and **dev adapter emails**
8. Writes:
   - `modules/repair/dev/demo-output/step-log.json`
   - `modules/repair/dev/demo-output/CRIP….txt` (account month in the name)

### Totals: why export is not the full sample total

Sample file `Sample_Shop_500byte_OFOX2609.txt` totals **$36,732.04** (labor + material, all Format 1 lines).

| Slice | Lines | Labor ¢ | Material ¢ | Dollars |
|---|---:|---:|---:|---:|
| **Full source / approved estimate** | 123 | 3,230,125 | 443,079 | **$36,732.04** |
| **Resp 6 (lessee rebill)** — CRIP export | 98 | 3,059,350 | 305,475 | **$33,648.25** |
| **Resp 7 (Never Rebill)** — excluded | 25 | 170,775 | 137,604 | **$3,083.79** |

The **$3,083.79** gap is **Resp 7 Never Rebill**, not a parser drop. Monthly close exports only rebillable codes (**6** and **3**). The demo asserts:

- approved final estimate total = **source file total** ($36,732.04)
- CRIP export labor/material = **source Resp 6/3** = **approved estimate Resp 6/3 lines**

---

## 4. Manual UI (optional)

```powershell
npm run dev
```

Open (hash router):

- `/#/repair` — admin home / BO  
- Shop link printed by the demo: `/#/repair/e/<token>`  
- Lessee link: `/#/repair/lessee/<token>`  
- Estimate: `/#/repair/estimates/<id>`

Auth for admin pages still uses normal RLMS Supabase login when pointed at a real project; shop/lessee links are public. For API-only verification, the demo script is enough (no browser).

---

## 5. Apply bundles (if needed)

### Review package (if still on `4963628`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD
# must be 496362844483cea5242dcdf368dece2860e72ecb

git bundle verify PATH\TO\rlms-phase1-review-package.bundle
git pull PATH\TO\rlms-phase1-review-package.bundle HEAD
```

### Windows demo runbook fix (if still on `066cf3f`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD
# must be 066cf3f7b8c11aa2cf7b9f95d7c924b2ec5b69ba

git bundle verify PATH\TO\rlms-phase1-demo-windows-fix.bundle
git pull PATH\TO\rlms-phase1-demo-windows-fix.bundle HEAD
# lands 1adb3bf
```

### Migrate + totals fix (this package)

From tip **`1adb3bf`**:

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD
# must be 1adb3bf1aa1591c6ca39033a0ab119f9a1251d67

git bundle verify PATH\TO\rlms-phase1-demo-migrate-totals.bundle
git pull PATH\TO\rlms-phase1-demo-migrate-totals.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Keep the PR **draft**. Do not merge.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `better-sqlite3` / node-gyp build failure | Use **Node 22 LTS**, or `npm install --ignore-scripts` (repair demo does not need it) |
| `psql` not found | **Not needed for demo migrate** (node-pg). For manual `psql` / Path B setup: `$env:PATH = "$env:USERPROFILE\pg-demo\pgsql\bin;$env:PATH"` (or `%USERPROFILE%\pgsql\bin`) |
| Old tip: `psql` hits localhost as Windows user | Tip before migrate-totals: npm cmd does not expand `"$DATABASE_URL"`. Apply this bundle, **or** set `$env:npm_config_script_shell` to Git bash as last resort |
| `DATABASE_URL` error | Set env var in the **same** PowerShell before `npm run` |
| Migrate fails mid-file | Ensure DB is empty of conflicting objects; re-run with default reset |
| Port 5432 in use / no admin password | Use [Path B](#path-b--no-admin-portable-postgres-port-5433) on **5433** |
| Port 5433 already in use | Choose another free port in `-o "-p …"` and match `DATABASE_URL` |
| Demo expects APA shop | Migrations seed shops; re-run migrate after reset |
| `pg_ctl` start fails | Check `%USERPROFILE%\pgsql-repair.log`; ensure data dir was `initdb`'d with user `repairdev` |
| Export total ≠ $36,732.04 | Expected: export is Resp 6/3 only; $3,083.79 is Resp 7 Never Rebill — see [Totals](#totals-why-export-is-not-the-full-sample-total) |

---

## Safety reminders

- Point `DATABASE_URL` at **local** Postgres only  
- Never run repair migrations against production `rlms-residco`  
- No Supabase branch for this work  
- No merge / no deploy from this draft PR
