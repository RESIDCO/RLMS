# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **`f4e65cc`** (`f4e65cc1fe96aa2cb1349229b2fe0462176f7463`) | UI review feedback tip. **Requires tip** for owner-UI-spec docs bundle. |
| **`ac7148e`** (`ac7148e911d17f8af206ce35567277fa93e9511d`) | Local-review-mode (predecessor of f4e65cc). |

Owner-UI-spec docs tip after applying `rlms-phase1-owner-ui-spec.bundle`: see `docs/bundles/rlms-phase1-owner-ui-spec.README.txt` (pin commit).

---

## Owner UI RESET — Step 1 (2026-10-14)

**STOP feature adds.** Bruce ordered an owner UI reset.

| Step | Deliverable | Status |
|---|---|---|
| **1** | Spec: `docs/repair/OWNER_UI_SPEC.md` + bundle `rlms-phase1-owner-ui-spec.bundle` | **Awaiting Bruce approval** |
| **2** | Implement screens A–H per approved spec | **Blocked until Step 1 approved** |

Screenshots `01`–`06` (estimates history, estimate review, file attachments, update responsibilities, responsibility codes, bad orders) — **awaiting screenshot attachment** in store/uploads. Spec maps from Manual_Gap_Review + tip field sets; Bruce can mark gaps when shots attach.

**Do not invent** unmarked AAR Bad Order Reason lists.

---

## Bundle chain (recent → apply in order if PC is behind)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| … | (earlier chain through cents + local-review-mode + ui-review-feedback) | … | … |
| N | **`rlms-phase1-ui-review-feedback.bundle`** | **`ac7148e`** | → **`f4e65cc`** |
| N+1 | **`rlms-phase1-owner-ui-spec.bundle`** | **`f4e65cc`** | → docs tip (see README) |

Store copies: Project store `docs/bundles/` (Bruce pulls to `C:\Users\BruceHarbridge\rlms-push`).

---

## Apply owner-UI-spec bundle (docs only — no product code)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect f4e65cc…
git bundle verify PATH\TO\rlms-phase1-owner-ui-spec.bundle
git pull PATH\TO\rlms-phase1-owner-ui-spec.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then open: `docs\repair\OWNER_UI_SPEC.md`

---

## Prior slice — Phase 1 UI review feedback (parked)

Parked under feature freeze. Tip `f4e65cc` remains the code baseline until Step 2 is approved.

### Gap (AAR / Bad Order Reason seed)
Store had no full repairSMART reason dropdown capture. Spec uses owner-managed Bad Order Reason list + Other; seed only known entries — admins add the rest.

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services, no production keys for UI review.
5. **Money** — integer cents (or Postgres `numeric`) for all repair amounts; never floating-point sums.

---

## Open items / questions

- Screenshots 01–06 attachment for field-by-field mark-up against OWNER_UI_SPEC.
- Full repairSMART Bad Order Reason list still needed from capture or Bruce export (do not invent).
- Q1 (VCF active sync) and Q2 (shop bank security) remain open in `open-questions.md`.
- Phase 2: CROP/carMARQS (`POST /api/repair/phase2/crop-import` → 501 only).
- **Step 2 blocked** until Bruce approves OWNER_UI_SPEC.
