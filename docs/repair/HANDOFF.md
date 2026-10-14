# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **§A contrast + module nav** | Apply `rlms-phase1-owner-ui-a-contrast.bundle`. Requires **`bd049dc`**. Lands tip: see `docs/bundles/rlms-phase1-owner-ui-a-contrast.README.txt`. |
| **Sub-section 1 — Estimates History** | Apply `rlms-phase1-owner-ui-a-estimates.bundle` first if behind. Requires **`3d1dd73`**. Lands **`bd049dc`**. |
| **`3d1dd73`** | Owner UI Spec Step 1 (docs map A–H). Keep as overall map — build **one screen at a time**. |
| **`f4e65cc`** | UI review feedback code baseline (predecessor of 3d1dd73 docs). |

---

## Owner UI — one screen at a time (2026-10-14)

Bruce changed plan: **do not** build all of OWNER_UI_SPEC at once.

| Sub-section | Deliverable | Status |
|---|---|---|
| **1** | Estimates History `/#/repair` (spec §A) — grid + contrast/nav fixes | **Awaiting Bruce sign-off** (contrast/nav fix on tip after `bd049dc`) |
| **2** | Shop master (spec §B) | **Do not start** until Bruce signs off §A |
| 3+ | Bad Orders, Estimate Review rebuild, etc. | Parked |

**Screenshot:** `docs/repair/screenshots/01-estimates-history.png` (match for §A). Shots 02–06 are in the same folder for later subsections — do not build now.

**Sub-spec:** [OWNER_UI_A_ESTIMATES_HISTORY.md](./OWNER_UI_A_ESTIMATES_HISTORY.md)  
**Overall map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)

---

## Bundle chain (recent → apply in order if PC is behind)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| N | `rlms-phase1-ui-review-feedback.bundle` | `ac7148e` | → `f4e65cc` |
| N+1 | `rlms-phase1-owner-ui-spec.bundle` | `f4e65cc` | → `3d1dd73` |
| N+2 | `rlms-phase1-owner-ui-a-estimates.bundle` | `3d1dd73` | → `bd049dc` |
| N+3 | **`rlms-phase1-owner-ui-a-contrast.bundle`** | **`bd049dc`** | → contrast/nav tip (see README) |

Store copies: Project store `docs/bundles/` (Bruce pulls to `C:\Users\BruceHarbridge\rlms-push`).

---

## Apply §A contrast + nav bundle

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect bd049dc…
git bundle verify PATH\TO\rlms-phase1-owner-ui-a-contrast.bundle
git pull PATH\TO\rlms-phase1-owner-ui-a-contrast.bundle HEAD
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
npm run repair:dev:local
# open http://127.0.0.1:5000/#/repair
```

Expect: sticky repair module nav; legible dark text on light/banded rows; bold `$` totals; Shop as `Name – City, ST`; unbuilt nav links → coming soon (not error).

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services.
5. **Money** — integer cents for all repair amounts; ≤2 decimals display.

---

## Open items

- Bruce sign-off on §A (incl. contrast/nav) before Shop master (§B).
- Screenshots 02–06 available for later subsections.
- Full AAR Bad Order Reason list still incomplete (do not invent).
- Q1 / Q2 remain in open-questions.md.
