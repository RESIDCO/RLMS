# Owner UI — Sub-section 4: Estimate Review (`/#/repair/estimates/:id`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §D  
**Screenshots:** `02-estimate-review.png`, `04-update-responsibilities.png`, `05-responsibility-codes.png`, `03-file-attachments.png`  
**Tip base:** `f853e48b4c754c01c186312c02ebb4f713c61714` (§D initial)  
**Round:** **r2** — header pencils, attachments ACL, money `$`+cents, Component Id rules, AAR hover, splits, carry-forward, licensed ref-data import  
**Scope:** Owner Estimate Review rebuild + r2 polish. Shop link + §C Bad Orders unchanged.

---

## Intent

Owner/reviewer opens an estimate from Estimates History and works it like repairSMART Estimate Review: dense header + line grid, approve / request revision / responsibilities / compare / export / issues. Shop-only actions stay on the shop event link.

---

## Compact header (shot 02) — r2 layout

Always visible fields unchanged (Shop, Car, Estimate ID, Status, SPLC, Assignment, Entity, Road/DC, car type, dates, BO reason, Billing Category).

**r2 header edit UX (no pencil overlap on car #):**

- Per-field ✎ appears **on hover** (and focus) beside editable values — never absolutely positioned over the car number.
- Explicit **Edit header** button opens More header detail + pencil/audit mode.
- Works in light and dark; wraps cleanly at narrow widths.

**More header detail** — collapsible full Data File header groups. Pencil edits still require reason + audit; after Approved → Adjustment for Approval (MG1).

---

## Line grid + money (r2)

Columns unchanged. Money cells show **`$` + 2 decimals** with **integer cents underneath** (Labor / Material / Amount + totals).

Code cells (AJOB, QA, WM, Loc, C, R, RJOB, QR) show **hover help** from licensed `repair.ref_*` tables (category / sub-category when present). Unknown → **"Not in reference table"**.

**Component Id:** red flag when an active `repair.component_id_rules` row requires CID and the line is blank (review + FINAL/INVOICE validation). Admin-editable via API / CSV import.

---

## Owner actions ONLY

| Action | Behavior |
|---|---|
| **Approve** | → Approved (or approve Adjustment) |
| **Reject / Request Revision** | → Revision Requested; comment; notify shop |
| **Send Lessee Responsibility** | Resp 6 email (shop never CC’d) |
| **Update Responsibilities** | Full page (shots 04/05) + r2 splits / carry-forward / tax preview |
| **Rollback** | Rollback completed date (audited) when applicable |
| **Issues / comments** | Thread panel; per-line issue icon |
| **Export** | BRC Excel / PDF / 500-byte |
| **Review & Compare** | Pick any two revisions; side-by-side added/removed/changed + totals delta |
| **N Document(s) found** | Opens document viewer in **new window** (shot 03) |

**Removed from owner D:** Submit for approval · setting completed / outbound date.

---

## Update Responsibilities (shots 04 / 05) — r2

Route: `/#/repair/estimates/:id/responsibilities`

- Set / restore / summary unchanged.
- **Split** by **percentage** or **fixed $** → child lines **1a / 1b** linked (`split_group_id`); original preserved in history; **remainder cents on owner/original** line; exact sum.
- **Unsplit** checked groups before approval (audited).
- **Tax prorate preview** by responsibility share (exact cents).
- **Carry forward** from prior revision: fingerprint match; green UNCHANGED / amber CHANGED (hover diff) / blue NEW / Removed list; **Apply prior → R(New) only — never auto-commit**; audited.

---

## Documents viewer (shot 03) — r2 permissions

Route: `/#/repair/estimates/:id/documents` — `window.open`.

| Role | Add | Recategorize | Void / remove |
|---|---|---|---|
| Owner / system manager / reviewer / admin | ✓ | ✓ | ✓ (VOIDED, recoverable) |
| Shop | ✓ only | ✗ server 403 | ✗ server 403 (incl. own) |
| Viewer | View all gallery | — | — |

Every add / void / recategorize is **audited**. Viewer: thumbnail strip + **View all** fullscreen slideshow (next/prev + keyboard arrows).

---

## Licensed AAR ref-data (r2)

Private folder: `modules/repair/ref-data/` (**never** unauthenticated public serve).

```powershell
npm run repair:import-ref-data
```

Upserts by key; records edition/quarter/source/rule_page. Admin CSV/Excel uses the same path (`POST /api/repair/ref-data/import`).

**Verified full counts (Bruce pack 2026-10-14):** job codes **855** · qualifiers **639** · why-made **107** · categories **2170**.

---

## Theme / nav

Same sticky module nav + light/dark toggle as §A–§C (`RepairOwnerShell`).

---

## Local review

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm run repair:migrate:local
npm run repair:import-ref-data
npm run repair:smoke-estimate-review
npm run repair:smoke-bad-orders
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair
# open an Awaiting Approval estimate → Estimate Review
```

---

## Next

Screen **E** document polish / Screen **F** Lessee (mirrors D read-only) when Bruce signs off §D r2.
