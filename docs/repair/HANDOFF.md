# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **`a3a17a6`** (`a3a17a652f8d6a94592cd830a378c65a7ce9d2ff`) | Cents demo clean — step **[4] = 36732.04**. Bruce confirmed. Base for local-review-mode bundle. |
| **`60e380b`** | Optional docs-only UI runbook tip (if applied earlier). **Prefer** applying local-review-mode from **`a3a17a6`** (includes full runbook). |
| **Local-review tip** | After apply: see `docs/bundles/rlms-phase1-local-review-mode.README.txt`. |

Requires tip to apply local-review-mode bundle: **`a3a17a6`**.

---

## Bundle chain (recent → apply in order if PC is behind)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| 1 | `rlms-phase1-review-package.bundle` | lifecycle-06 base | walkthrough / checklist / demo docs + `repair:demo:local` |
| 2 | `rlms-phase1-demo-windows-fix.bundle` | review-package tip | Windows Node 22 / portable Postgres **5433** notes |
| 3 | `rlms-phase1-demo-migrate-totals.bundle` | `1adb3bf` | node-pg migrate + Resp 7 gap totals smoke → **`b29d0a5`** |
| 4 | `rlms-phase1-cents-handoff.bundle` | **`b29d0a5`** | integer-cents money + HANDOFF → **`a3a17a6`** |
| 5 | `rlms-phase1-ui-review-runbook.bundle` (optional) | **`a3a17a6`** | docs only → **`60e380b`** |
| 6 | **`rlms-phase1-local-review-mode.bundle`** (next) | **`a3a17a6`** | Windows `cross-env` + **LOCAL REVIEW MODE, no Supabase** + full UI runbook |

Store copies: `/cursor/stores/self/docs/bundles/` (Bruce pulls to `C:\Users\BruceHarbridge\rlms-push`).

---

## Next step (tonight)

**Phase 1 UI review on Windows** — no new features; **no production Supabase**.

1. Confirm tip `a3a17a6` (or pull cents bundle first if behind).
2. Apply **`rlms-phase1-local-review-mode.bundle`**.
3. Follow **[`PHASE1_UI_REVIEW_RUN.md`](./PHASE1_UI_REVIEW_RUN.md)**.

### Apply local-review-mode bundle

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect a3a17a6…
git bundle verify PATH\TO\rlms-phase1-local-review-mode.bundle
git pull PATH\TO\rlms-phase1-local-review-mode.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

### Quick local UI path (no Supabase)

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm run repair:demo:local
npm run repair:dev:local
# Banner: LOCAL REVIEW MODE, no Supabase
# App: http://127.0.0.1:5000
# Tokens: modules\repair\dev\demo-output\step-log.json → shopLink / lesseeLink
```

Screens: `/#/repair`, `/#/repair/e/<token>`, `/#/repair/lessee/<token>`, `/#/repair/estimates/<id>` — all without Supabase login.

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services, no production keys for UI review.
5. **Money** — integer cents (or Postgres `numeric`) for all repair amounts; never floating-point sums.

---

## Docs to use

| Doc | In-repo | Store mirror |
|---|---|---|
| **UI review runbook** | [`PHASE1_UI_REVIEW_RUN.md`](./PHASE1_UI_REVIEW_RUN.md) | `docs/phase1-ui-review-run.md` |
| Walkthrough | [`PHASE1_WALKTHROUGH.md`](./PHASE1_WALKTHROUGH.md) | `docs/phase1-walkthrough.md` |
| Review checklist | [`PHASE1_REVIEW_CHECKLIST.md`](./PHASE1_REVIEW_CHECKLIST.md) | `docs/phase1-review-checklist.md` |
| Windows demo | [`PHASE1_DEMO_WINDOWS.md`](./PHASE1_DEMO_WINDOWS.md) | `docs/phase1-demo-windows.md` |
| Module plan | — | `docs/rlms-repair-module-plan.md` |
| Open questions | — | `docs/open-questions.md` |

---

## Open items / questions

- **Bruce confirmed** demo step `[4]` = **`36732.04`** clean on tip `a3a17a6`.
- **Blocked previously:** `npm run dev` failed on Windows (`NODE_ENV=development`) and Supabase required at boot — fixed by local-review-mode bundle.
- Phase 1 polish still open (thin): invoice cover-sheet UI, Excel/PDF BRC export, richer Bill Summary — see plan / open-questions Manual_Gap leftovers.
- Phase 2: CROP/carMARQS (`POST /api/repair/phase2/crop-import` → 501 only).
- Q1 (VCF active sync) and Q2 (shop bank security) remain open in `open-questions.md`.

---

## Next planned slice

**Awaiting Bruce UI review feedback** — no further code slice until then.
