# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **`ac7148e`** (`ac7148e911d17f8af206ce35567277fa93e9511d`) | Local-review-mode (Windows `cross-env` + **LOCAL REVIEW MODE, no Supabase**). **Requires** tip for UI-review-feedback bundle. |
| **** () | UI review feedback (BO rules, header pencil, lessee layout). Apply `rlms-phase1-ui-review-feedback.bundle` on **ac7148e**. |

Requires tip to apply UI-review-feedback bundle: **`ac7148e`**.

---

## Bundle chain (recent → apply in order if PC is behind)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| … | (earlier chain through cents + local-review-mode) | … | … |
| N | **`rlms-phase1-local-review-mode.bundle`** | **`a3a17a6`** | → **** |
| N+1 | **`rlms-phase1-ui-review-feedback.bundle`** | **`ac7148e`** | → **** |

Store copies: `/cursor/stores/self/docs/bundles/` (Bruce pulls to `C:\Users\BruceHarbridge\rlms-push`).

---

## This slice — Phase 1 UI review feedback (2026-10-14)

### Bad Order screen
- **BO rule** dropdown from `repair.bo_rules` (code + description + active); admins can add.
- Seeded **RULE_1**, **RULE_107**, **OTHER** (+ manual text). Full repairSMART AAR shopping-reason list was **not** in store captures — **do not invent**; admins add more as needed (gap documented below).
- Shop dropdown: **"Name – City, ST"** (`shops.city` / `shops.state` / `billing_road`).
- **Billing road** auto-fill from shop; override requires **reason**.
- **Attachments** on BO (same `repair.documents` storage; delete → **VOIDED**, never purged).
- Removed Resp 6 / lessee contact fields from BO; notifications use plain **distribution list**.

### Internal estimate review
- Data File **header** (full Format-1 header block) on every estimate.
- **Pencil editor** per header field (reason required; audit old→new, user, time).
- After Approved → **Adjustment** path (MG1).

### Shop URL (`/#/repair/e/:token`)
- **No changes.**

### Lessee estimate (`/#/repair/lessee/:token`)
- Same layout/field set as internal (header, all lines, totals, attachments).
- Read-only except approve/dispute **own** responsibility lines (Resp 6).
- Pencil / admin controls hidden.

### Verified
- `npm run repair:demo:local` — all 14 steps; step **[4] = 36732.04**
- `npm run repair:smoke-ui-review` — BO rules, shop City/ST, billing auto-fill, BO attachments VOIDED, audited header edit, ≤2 decimals

### Gap (AAR rule seed)
Store had no crawl screenshot / export of the full repairSMART BO reason/rule dropdown. Seeded only **RULE_1**, **RULE_107**, and **OTHER** (from prior UI + Manual_Gap / Railinc references). Bruce/admins can add the remaining list via **Admin — add BO rule** without a code deploy.

---

## Apply UI-review-feedback bundle

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect ac7148e…
git bundle verify PATH\TO\rlms-phase1-ui-review-feedback.bundle
git pull PATH\TO\rlms-phase1-ui-review-feedback.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:demo:local
npm run repair:smoke-ui-review
npm run repair:dev:local
```

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services, no production keys for UI review.
5. **Money** — integer cents (or Postgres `numeric`) for all repair amounts; never floating-point sums.

---

## Open items / questions

- Full repairSMART BO rule / shopping-reason list still needed from capture or Bruce export to expand `repair.bo_rules` seed.
- Q1 (VCF active sync) and Q2 (shop bank security) remain open in `open-questions.md`.
- Phase 2: CROP/carMARQS (`POST /api/repair/phase2/crop-import` → 501 only).
