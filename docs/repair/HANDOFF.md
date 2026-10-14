# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **`b29d0a5`** (`b29d0a530d5c88e2828790e00e7ac06b32076812`) | Remote PR tip **before** this cents/handoff slice (migrate via node-pg + CRIP/Resp 6/3 totals). Demo reran clean on this tip. |
| **`b90440c`** (`b90440c76fcc2a301ef08fb9a14069b573b2ec6f`) | Bundle tip after integer-cents fix + this HANDOFF (apply `rlms-phase1-cents-handoff.bundle` on `b29d0a5`). |

Requires tip to apply cents bundle: **`b29d0a5`**. Bundle lands **`b90440c`**.

---

## Bundle chain (recent → apply in order if PC is behind)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| 1 | `rlms-phase1-review-package.bundle` | lifecycle-06 base | walkthrough / checklist / demo docs + `repair:demo:local` |
| 2 | `rlms-phase1-demo-windows-fix.bundle` | review-package tip | Windows Node 22 / portable Postgres **5433** notes |
| 3 | `rlms-phase1-demo-migrate-totals.bundle` | `1adb3bf` | node-pg migrate + Resp 7 gap totals smoke → **`b29d0a5`** |
| 4 | **`rlms-phase1-cents-handoff.bundle`** (this) | **`b29d0a5`** | integer-cents money + this HANDOFF |

Older Phase 1 slices (pod/invoice, monthly close, CRB, inbound, Q18–Q20, estimate lifecycle 01–06) are already on the draft branch tip at `b29d0a5` when Bruce force-pushed the clean tip.

Store copies: `/cursor/stores/self/docs/bundles/` (Bruce pulls to `C:\Users\BruceHarbridge\rlms-push`).

---

## This slice — money / float fix

**Bug:** Demo step **[4]** logged `36732.04000000001` (sample OFOX2609 = **$36,732.04**).

**Where:** `estimate-load.ts` (and siblings) converted each line’s cents → dollars (`cents/100`) then **summed floats**. Same pattern in `estimates.ts`, `gap-lifecycle-06.ts`, revision compare sums.

**Fix:** `modules/repair/services/money.ts` — integer cents for parse/sum/compare; convert to dollars **once** for `numeric(14,2)` / display. Smoke: **no revision or line total may have more than 2 decimal places** (`assertAtMostTwoDecimals` in `repair:demo:local`).

Scope: **`modules/repair/` + `repair` schema only** (no host / client changes in this slice).

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path (`create_or_update_file`, `push_files`, `create_commit`, etc.). MCP mangled `demo-local.ts` and earlier `routes.ts`.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services.
5. **Money** — integer cents (or Postgres `numeric`) for all repair amounts; never floating-point sums.

### Apply this bundle (Windows)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect b29d0a5…
git bundle verify PATH\TO\rlms-phase1-cents-handoff.bundle
git pull PATH\TO\rlms-phase1-cents-handoff.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Rerun: `npm run repair:demo:local` (see Windows demo doc). Step `[4]` total must be `36732.04`, not `36732.04000000001`.

---

## Docs to use

| Doc | In-repo | Store mirror |
|---|---|---|
| Walkthrough | [`PHASE1_WALKTHROUGH.md`](./PHASE1_WALKTHROUGH.md) | `docs/phase1-walkthrough.md` |
| Review checklist | [`PHASE1_REVIEW_CHECKLIST.md`](./PHASE1_REVIEW_CHECKLIST.md) | `docs/phase1-review-checklist.md` |
| Windows demo | [`PHASE1_DEMO_WINDOWS.md`](./PHASE1_DEMO_WINDOWS.md) | `docs/phase1-demo-windows.md` |
| Module plan | — | `docs/rlms-repair-module-plan.md` |
| Open questions | — | `docs/open-questions.md` |

---

## Open items / questions

- Confirm demo step `[4]` / `[5]` totals print as **`36732.04`** after this bundle (no float residue).
- UI review / laptop restart — awaiting Bruce.
- Phase 1 polish still open (thin): invoice cover-sheet UI, Excel/PDF BRC export, richer Bill Summary — see plan / open-questions Manual_Gap leftovers.
- Phase 2: CROP/carMARQS (`POST /api/repair/phase2/crop-import` → 501 only).
- Q1 (VCF active sync) and Q2 (shop bank security) remain open in `open-questions.md`.

---

## Next planned slice

**Awaiting Bruce after laptop restart / UI review** — no further code slice scheduled until that feedback.
