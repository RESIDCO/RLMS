# Owner UI — Sub-section 4: Estimate Review (`/#/repair/estimates/:id`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §D  
**Screenshots:** `02-estimate-review.png`, `04-update-responsibilities.png`, `05-responsibility-codes.png`, `03-file-attachments.png`  
**Tip base:** `2d987c92399ddb5a446de5554b068d9c8aeffb4e` (§D r2)  
**Round:** **r3** — hover close rules, car# lock, money thousands separators, Send Lessee preview + local outbox  
**Prior:** r2 — header pencils, attachments ACL, money `$`+cents, Component Id, AAR hover, splits, carry-forward, licensed ref-data  
**Scope:** Owner Estimate Review. Shop link + §C Bad Orders unchanged.

---

## Intent

Owner/reviewer opens an estimate from Estimates History and works it like repairSMART Estimate Review: dense header + line grid, approve / request revision / responsibilities / compare / export / issues / send lessee. Shop-only actions stay on the shop event link.

---

## Compact header — r2/r3

Always visible fields unchanged (Shop, Car, Estimate ID, Status, SPLC, Assignment, Entity, Road/DC, car type, dates, BO reason, Billing Category).

**Header edit UX:**

- Per-field ✎ on hover/focus beside editable values — never over the car number.
- **Edit header** opens More header detail + pencil/audit mode.
- **Car initial + car number are read-only** (🔒 + tooltip). API returns **409** on change. Wrong car → void estimate + shop resubmits under the correct car (audited).

**More header detail** — collapsible full Data File header groups. Pencil edits require reason + audit; after Approved → Adjustment for Approval (MG1).

---

## Line grid + money (r3)

Money cells show **`$` + thousands separators + 2 decimals** (e.g. `$36,732.04`) with **integer cents underneath**. Inputs still accept plain numbers.

Code hover: close on **mouseleave / blur / Esc**; **only one** tip open at a time. Unknown → **"Not in reference table"**.

**Component Id:** red flag when `repair.component_id_rules` requires CID and the line is blank.

---

## Owner actions ONLY

| Action | Behavior |
|---|---|
| **Approve** | → Approved (or approve Adjustment) |
| **Reject / Request Revision** | → Revision Requested; comment; notify shop |
| **Send Lessee Responsibility** | Full preview page `/#/repair/estimates/:id/send-lessee` (r3) |
| **Update Responsibilities** | Full page + splits / carry-forward / tax preview |
| **Rollback** | Rollback completed date (audited) when applicable |
| **Issues / comments** | Thread panel; per-line issue icon |
| **Export** | BRC Excel / PDF / 500-byte |
| **Review & Compare** | Any two revisions; added/removed/changed + totals delta |
| **N Document(s) found** | Document viewer in **new window** |

**Removed from owner D:** Submit for approval · setting completed / outbound date.

---

## Send Lessee (r3)

Route: `/#/repair/estimates/:id/send-lessee`

- Editable recipients (lessee contacts), subject, body
- Lessee-view render of Resp 6 lines
- Attachment picker: Estimate PDF (generated/previewable), 500-byte/CRB data file (previewable), gallery checkboxes (select all/none)
- Total selected size; Back/Cancel without sending
- Send + final confirm
- **Local review mode:** write `repair.email_outbox` only — UI shows **"Logged (not sent – local mode)"** (no real email)
- Send history kept on the estimate (outbox rows)

Shop is never CC’d.

---

## Update Responsibilities (shots 04 / 05)

Route: `/#/repair/estimates/:id/responsibilities`

- **Split** by % or fixed $ → **1a / 1b**; remainder cents on owner line; exact sum
- **Unsplit** before approval; **tax prorate**; **carry-forward** never auto-commits

---

## Documents viewer — permissions

| Role | Add | Recategorize | Void / remove |
|---|---|---|---|
| Owner / system manager / reviewer / admin | ✓ | ✓ | ✓ (VOIDED) |
| Shop | ✓ only | ✗ 403 | ✗ 403 |
| Viewer | View all gallery | — | — |

---

## Licensed AAR ref-data

Private: `modules/repair/ref-data/` (**never** public-serve). `npm run repair:import-ref-data`  
Verified: job codes **855** · qualifiers **639** · why-made **107** · categories **2170**.

---

## Local review

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm run repair:migrate:local
npm run repair:import-ref-data
npm run repair:smoke-estimate-review
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/estimates/<id>
# Send Lessee → preview → Log to outbox
```

---

## Next

Screen **E** document polish / Screen **F** Lessee when Bruce signs off §D r3.
