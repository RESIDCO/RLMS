# Phase 1 local demo — Windows (Bruce PC)

One automated walk of Phase 1 on **local Postgres** (free/dev). No Supabase branch, no paid services, no PAT required for the demo itself.

Push path for git bundles: `C:\Users\BruceHarbridge\rlms-push`  
Draft PR only: https://github.com/RESIDCO/RLMS/pull/2 — **do not merge/deploy**.

---

## Prerequisites

| Tool | Notes |
|---|---|
| **Node.js ≥ 20** | `node -v` |
| **npm** | ships with Node |
| **PostgreSQL 14+** | local install; `psql` on PATH |
| **Git** | for bundle pull into `rlms-push` |
| Repo at tip **`4963628`+** review package | apply `rlms-phase1-review-package.bundle` if not already on the commit |

Optional GUI: pgAdmin. Command line is enough.

---

## 1. Database (once)

In **PowerShell** or **cmd** (adjust password/port if yours differ):

```powershell
# Create role + database (run as postgres superuser once)
psql -U postgres -c "CREATE ROLE repairdev LOGIN PASSWORD 'repairdev';"
psql -U postgres -c "CREATE DATABASE rlms_repair_dev OWNER repairdev;"
```

If the role/DB already exist, skip. Confirm:

```powershell
psql "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev" -c "SELECT version();"
```

---

## 2. Repo + env

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD
# Expect 4963628 or a child commit that includes the review package

$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
# Optional:
# $env:REPAIR_DEMO_RESET = "0"          # keep existing repair schema (default drops + remigrates)
# $env:REPAIR_DEMO_OUT = "D:\tmp\repair-demo"
# $env:REPAIR_DEMO_ACCOUNT_MONTH = "2610"  # YYMM for CRIP filename

npm install
```

---

## 3. One-command demo

```powershell
npm run repair:demo:local
```

What it does:

1. Drops schema `repair` (unless `REPAIR_DEMO_RESET=0`)
2. Runs `npm run repair:migrate:local` (public stubs + all repair migrations)
3. Seeds **OFOX 528313** + uses `modules/repair/dev/reference/Sample_Shop_500byte_OFOX2609.txt`
4. Walks: BO → estimate load (**MULTI_CAR warning** → accept) → revision → approval → Resp 6 lessee link approve → completion + dispo → shop CRB invoice + pre-pay **APPROVED_FOR_ACH** → Ready to Close → close → monthly close → **CRIPYYMM** file
5. Bonus: void + restore on a companion estimate (retention)
6. Prints each step, status, shop/lessee links, and **dev adapter emails**
7. Writes:
   - `modules/repair/dev/demo-output/step-log.json`
   - `modules/repair/dev/demo-output/CRIP….txt` (account month in the name)

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

## 5. Apply the review-package bundle (if needed)

From a tree whose `HEAD` is **`4963628`**:

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD
# must be 496362844483cea5242dcdf368dece2860e72ecb

git bundle verify PATH\TO\rlms-phase1-review-package.bundle
git pull PATH\TO\rlms-phase1-review-package.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Keep the PR **draft**. Do not merge.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `psql` not found | Add Postgres `bin` to PATH; reopen shell |
| `DATABASE_URL` error | Set env var in the **same** shell before `npm run` |
| Migrate fails mid-file | Ensure DB is empty of conflicting objects; re-run with default reset |
| Port 5432 in use | Stop other Postgres or change URL port |
| Demo expects APA shop | Migrations seed shops; re-run migrate after reset |

---

## Safety reminders

- Point `DATABASE_URL` at **local** Postgres only  
- Never run repair migrations against production `rlms-residco`  
- No Supabase branch for this work  
- No merge / no deploy from this draft PR
