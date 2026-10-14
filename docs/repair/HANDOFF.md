# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **§B railroads + Shop Profile** | Apply `rlms-phase1-owner-ui-b-railroads-profile.bundle`. Requires **`00d13c9`** (seed-idempotent). Lands tip after apply (see bundle README). Delivering lines → NARN railroads type-ahead; Shop Profile read view. **No map yet.** |
| **Seed idempotent** | Prior: `rlms-phase1-seed-estimates-idempotent.bundle` → **`00d13c9`**. |
| **Migrate view fix + §B shop fields** | Prior: `rlms-phase1-migrate-view-fix.bundle` → **`e99c935`**. |
| **§B Shop master + Entity** | Prior: `rlms-phase1-owner-ui-b-shops-entity.bundle` → **`2039b7f`**. |
| **§A final** | Prior: `rlms-phase1-owner-ui-a-final.bundle` → **`1f6aa47`**. |

If PC is on **`e99c935`**, apply seed-idempotent first (lands `00d13c9`), then this railroads-profile bundle.  
If PC is still on **`2039b7f`**, apply migrate-view-fix → `e99c935`, then seed-idempotent → `00d13c9`, then railroads-profile.

---

## Owner UI — one screen at a time (2026-10-14)

| Sub-section | Deliverable | Status |
|---|---|---|
| **1** | Estimates History `/#/repair` (spec §A) | Done |
| **2** | Shop master (spec §B) + Entity/workspace + railroads delivering lines + Shop Profile | **Awaiting Bruce sign-off** |
| 2c | Shop map (part 3) | **Not started** — follow-up after this tip |
| 3+ | Bad Orders, Estimate Review rebuild, etc. | Parked |

**Sub-specs:** [OWNER_UI_A_ESTIMATES_HISTORY.md](./OWNER_UI_A_ESTIMATES_HISTORY.md) · [OWNER_UI_B_SHOP_MASTER.md](./OWNER_UI_B_SHOP_MASTER.md)  
**Overall map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)

---

## Bundle chain (recent)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| N+5 | `rlms-phase1-owner-ui-b-shops-entity.bundle` | `1f6aa47` | → **`2039b7f`** |
| N+6 | `rlms-phase1-migrate-view-fix.bundle` | `2039b7f` | → **`e99c935`** |
| N+7 | `rlms-phase1-seed-estimates-idempotent.bundle` | `e99c935` | → **`00d13c9`** |
| N+8 | **`rlms-phase1-owner-ui-b-railroads-profile.bundle`** | **`00d13c9`** | → **(see README)** |

---

## Apply railroads-profile (on tip `00d13c9`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect 00d13c9…
git bundle verify PATH\TO\rlms-phase1-owner-ui-b-railroads-profile.bundle
git pull PATH\TO\rlms-phase1-owner-ui-b-railroads-profile.bundle HEAD
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
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/shops
# http://127.0.0.1:5000/#/repair/shops/<uuid>
```

Expect: migrate seeds `repair.railroads` from NARN JSON; delivering lines type-ahead (not billing-road wall); manual marks flagged review; Shop Profile on name click; billing roads still validate optional mark only.

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services.
5. **Money** — integer cents for all repair amounts; ≤2 decimals display.

---

## Open items

- **Bruce sign-off on §B** (railroads + profile) before map (part 3) and Bad Orders (§C).
- Shop map (part 3) — separate follow-up bundle.
- Screenshots 02–06 available for later subsections.
- Full AAR Bad Order Reason list still incomplete (do not invent).
- Q1 / Q2 remain in open-questions.md.
