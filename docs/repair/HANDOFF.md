# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **Migrate view fix + §B shop fields** | Apply `rlms-phase1-migrate-view-fix.bundle`. Requires **`2039b7f`**. Tracked migrations + shop mark / lines / caps / certs / Admin catalogs / top-level Shops nav. |
| **§B Shop master + Entity** | Prior: `rlms-phase1-owner-ui-b-shops-entity.bundle` → **`2039b7f`**. |
| **§A final** | Prior: `rlms-phase1-owner-ui-a-final.bundle` → **`1f6aa47`**. |

If PC is on **`1f6aa47`**, apply §B shops-entity first (lands `2039b7f`), then this migrate-view-fix bundle.

---

## Owner UI — one screen at a time (2026-10-14)

| Sub-section | Deliverable | Status |
|---|---|---|
| **1** | Estimates History `/#/repair` (spec §A) | Done |
| **2** | Shop master (spec §B) + Entity/workspace + optional fields | **Awaiting Bruce sign-off** (migrate fix + fields) |
| 3+ | Bad Orders, Estimate Review rebuild, etc. | Parked |

**Sub-specs:** [OWNER_UI_A_ESTIMATES_HISTORY.md](./OWNER_UI_A_ESTIMATES_HISTORY.md) · [OWNER_UI_B_SHOP_MASTER.md](./OWNER_UI_B_SHOP_MASTER.md)  
**Overall map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)

---

## Bundle chain (recent)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| N+5 | `rlms-phase1-owner-ui-b-shops-entity.bundle` | `1f6aa47` | → **`2039b7f`** |
| N+6 | **`rlms-phase1-migrate-view-fix.bundle`** | **`2039b7f`** | → **(see README)** |

---

## Apply migrate-view-fix (on tip `2039b7f`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect 2039b7f…
git bundle verify PATH\TO\rlms-phase1-migrate-view-fix.bundle
git pull PATH\TO\rlms-phase1-migrate-view-fix.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:seed:estimates-history
npm run repair:smoke-shop-entity
npm run repair:demo:local
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/shops
# http://127.0.0.1:5000/#/repair/admin
```

Expect: seed/smoke no longer die on `checkViewColumns`; tracked migrate skips applied files; **Shops** top-level nav (not under Reference); optional shop mark → BO label `Name (MARK) – City, ST`; Admin gear manages capability / car-type / cert catalogs.

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services.
5. **Money** — integer cents for all repair amounts; ≤2 decimals display.

---

## Open items

- **Bruce sign-off on §B** (including new optional fields) before Bad Orders (§C).
- Screenshots 02–06 available for later subsections.
- Full AAR Bad Order Reason list still incomplete (do not invent).
- Q1 / Q2 remain in open-questions.md.
