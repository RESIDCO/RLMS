# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **§B Shop master + Entity** | Apply `rlms-phase1-owner-ui-b-shops-entity.bundle`. Requires **`1f6aa47`**. Lands tip after apply (see bundle README). |
| **§A final (nav + Estimates History polish)** | Prior: `rlms-phase1-owner-ui-a-final.bundle` → **`1f6aa47`**. |
| **§A contrast + module nav** | Prior: `rlms-phase1-owner-ui-a-contrast.bundle` → **`cce5026`**. |
| **`3d1dd73`** | Owner UI Spec Step 1 (docs map A–H). Keep as overall map — build **one screen at a time**. |

If PC is still on **`cce5026`**, apply `rlms-phase1-owner-ui-a-final.bundle` first (lands `1f6aa47`), then this §B bundle.

---

## Owner UI — one screen at a time (2026-10-14)

| Sub-section | Deliverable | Status |
|---|---|---|
| **1** | Estimates History `/#/repair` (spec §A) | Done (Entity column added with §B) |
| **2** | Shop master (spec §B) + Entity/workspace | **§B awaiting Bruce sign-off** |
| 3+ | Bad Orders, Estimate Review rebuild, etc. | Parked |

**Screenshot:** `docs/repair/screenshots/01-estimates-history.png` (§A). Shots 02–06 for later subsections.

**Sub-specs:** [OWNER_UI_A_ESTIMATES_HISTORY.md](./OWNER_UI_A_ESTIMATES_HISTORY.md) · [OWNER_UI_B_SHOP_MASTER.md](./OWNER_UI_B_SHOP_MASTER.md)  
**Overall map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)

---

## Bundle chain (recent → apply in order if PC is behind)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| N+3 | `rlms-phase1-owner-ui-a-contrast.bundle` | `bd049dc` | → **`cce5026`** |
| N+4 | `rlms-phase1-owner-ui-a-final.bundle` | **`cce5026`** | → **`1f6aa47`** |
| N+5 | **`rlms-phase1-owner-ui-b-shops-entity.bundle`** | **`1f6aa47`** | → **(see README)** |

Store copies: Project store `docs/bundles/` (Bruce pulls to `C:\Users\BruceHarbridge\rlms-push`).

---

## Apply §B bundle

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect 1f6aa47… (if cce5026, apply a-final first)
git bundle verify PATH\TO\rlms-phase1-owner-ui-b-shops-entity.bundle
git pull PATH\TO\rlms-phase1-owner-ui-b-shops-entity.bundle HEAD
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
# http://127.0.0.1:5000/#/repair
```

Expect: Shop Master empty-until-created; create form (legal name, city, ST, SPLC, optional mark vs billing roads, contacts, active); title bar **RESIDCO**; Estimates History **Entity** column + by-entity summary; sticky nav / light-dark kept from §A.

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services.
5. **Money** — integer cents for all repair amounts; ≤2 decimals display.

---

## Open items

- **Bruce sign-off on §B** before Bad Orders (§C).
- Screenshots 02–06 available for later subsections.
- Full AAR Bad Order Reason list still incomplete (do not invent).
- Q1 / Q2 remain in open-questions.md.
