# Owner UI — Sub-section 4: Estimate Review (`/#/repair/estimates/:id`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §D  
**Screenshots:** `02-estimate-review.png`, `04-update-responsibilities.png`, `05-responsibility-codes.png`, `03-file-attachments.png`  
**Tip base:** `468a9db8034b56570710bdd0182425dcfc364c83` (§C signed off)  
**Scope:** Owner Estimate Review rebuild — compact header, RS line grid, owner-only actions, Update Responsibilities, Review & Compare, documents viewer (new window). Shop link + §C Bad Orders unchanged.

---

## Intent

Owner/reviewer opens an estimate from Estimates History and works it like repairSMART Estimate Review: dense header + line grid, approve / request revision / responsibilities / compare / export / issues. Shop-only actions stay on the shop event link.

---

## Compact header (shot 02)

Always visible:

| Field | Notes |
|---|---|
| Shop | `Name (MARK) – City, ST` |
| Car | Initials + number (title) |
| Estimate ID | Header `documentReference` (fallback car+repair date) |
| Status | Display name |
| SPLC | Code (+ city when known) |
| Assignment / lessee | From `cars_ref` / assignment |
| Entity | MAIN / COAL / RPS snapshot |
| Road / DC Road | Header / event |
| Car type / Kind of car | Event + header |
| Created / Account / Approval reqd / Approved | Dates |
| Repair / Yard arrival / Target / Outbound | Dates (outbound **display only** — owner does not set) |
| Bad Order Reason | Link to BO when present |
| Billing Category | Editable dropdown + save |

**More header detail** — collapsible full Data File header groups (Parties / Invoice / Car / Dates·Location / DDCT / Notes).

**Pencil ✎** — per-field edit; **reason required**; audit old→new, user, time. After Approved → Adjustment for Approval (MG1).

---

## Line grid columns (shot 02)

Issue/comment icon · Item · Loc · Qnty · C · AJOB · QA · Description · WM · RJOB · QR · R · Labor · Material · Amount · Component Id · 500 (raw) · PM

Totals row: Labor / Material / Amount (integer **cents** math; ≤2 decimal display).

Loc / Qnty / RJOB / QR / Description / PM derived from `raw_line` via App. G layout when not stored as columns.

---

## Owner actions ONLY

| Action | Behavior |
|---|---|
| **Approve** | → Approved (or approve Adjustment) |
| **Reject / Request Revision** | → Revision Requested; comment; notify shop |
| **Send Lessee Responsibility** | Resp 6 email (shop never CC’d) |
| **Update Responsibilities** | Full page (shots 04/05) |
| **Rollback** | Rollback completed date (audited) when applicable |
| **Issues / comments** | Thread panel; per-line issue icon |
| **Export** | BRC Excel / PDF / 500-byte |
| **Review & Compare** | Pick any two revisions; side-by-side added/removed/changed + totals delta |
| **N Document(s) found** | Opens document viewer in **new window** (shot 03) |

**Removed from owner D:** Submit for approval · setting completed / outbound date.

---

## Update Responsibilities (shots 04 / 05)

Route: `/#/repair/estimates/:id/responsibilities`

- Set Responsibility Code → **Set Checked Lines** (codes: 1 Owners, 2 Handling Line, 4 Capital Program, 5 Lease Return, 6 Rebill, 7 No Rebill, 8 Preventive Maintenance, 9 HM216 — from `repair.responsibility_codes`)
- Restore from Previous revision → **Restore Unset Lines**
- Split Line Items by **Percentage** → **Split Selected**
- Responsible Party dropdown
- Grid: checkbox · Line · Loc · Qnty · C · AJOB · QA · Description · WM · RJOB · QR · **R (Cur)** · **R (New)** · Labor · Material · Amount
- **Reset values** / **Submit values**
- Footer: summary by code + **Recalculate**

Submit creates an append-only revision (no hard deletes). Money stays integer cents.

---

## Documents viewer (shot 03)

Route: `/#/repair/estimates/:id/documents` — opened with `window.open` (new window).

Layout: header (car / BO reason / Estimate / statuses) · Apply to checked · Add files · grid (view / save / name / type / category / loaded by / date / size / comment / del→VOIDED) · Close / Download.

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
npm run repair:smoke-estimate-review
npm run repair:smoke-bad-orders
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair
# open an Awaiting Approval estimate → Estimate Review
```

---

## Next

Screen **E** document polish / Screen **F** Lessee (mirrors D read-only) when Bruce signs off §D.
