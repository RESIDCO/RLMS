# Owner UI — Sub-section 4: Estimate Review (`/#/repair/estimates/:id`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §D  
**Screenshots:** `02-estimate-review.png`, `04-update-responsibilities.png`, `05-responsibility-codes.png`, `03-file-attachments.png`  
**Tip base:** `d86458890085502c66f537cb4ec077b34f0df18a` (§D r3)  
**Round:** **r4** — qualifier multi-path lookup; header LOCK / EDIT+AUDIT / FREE; lessee signed token; cent reconciliation  
**Prior:** r3 — hover close, car# lock, money commas, Send Lessee preview + local outbox  
**Scope:** Owner Estimate Review. Shop link + §C Bad Orders unchanged.

---

## Intent

Owner/reviewer opens an estimate from Estimates History and works it like repairSMART Estimate Review: dense header + line grid, approve / request revision / responsibilities / compare / export / issues / send lessee. Shop-only actions stay on the shop event link.

---

## Header lock-down (r4)

`DATA_FILE_HEADER_FIELDS` modes — server **409** + UI 🔒 with reason:

| Mode | Fields |
|---|---|
| **LOCK** | Record format; billing/invoicing party mark; billed party; car initial/number; invoice #; account date YYMM; repairing party / **shop mark from shop master** (no billing-party fallback); shop invoice #; estimate ID; revision no.; BO link; entity snapshot; Railinc date stamps; resubmitted indicator; original invoice #/account date; machine-priceable; price-list currency. Wrong key → void + shop resubmit. |
| **EDIT + AUDIT** | Billing road override; source code; document ref / CBA; kind of car; load/empty; repair/outbound/completed dates; SPLC / expanded SPLC; facility type; defect card/JIC party+date; DDCT incident ID; AAR component ID. After Approved → Adjustment (MG1). |
| **FREE** | Notes; internal remarks; 100-byte user area; Format 6 contacts (BP contact still required). |

**Location on car** is **per-line only** (pos 109–111) — not a header field.

---

## Line grid + qualifier hover (r4)

Money: **`$` + thousands separators + 2 decimals** with **integer cents** underneath.

Qualifier / removed_qualifier lookup (`ref-lookup.ts`):

1. blank / `00` → **No qualifier**
2. job + qualifier in `ref_qualifiers`
3. letters-only, or job’s price-list qualifier is **VZ** → `ref_qualifier_generic` as **Car part: …**
4. numeric → job’s rule → every matching `ref_qualifier_charts` row as **Chart / Group X: …**
5. else **Not in reference table (valid for this job: …)**

No qualifier-only fallback on `ref_qualifiers`. **8000-series** = RESIDCO internal (`Repair_Categories.xlsx`). Demo seed **1898/11 → 14**.

---

## Owner actions ONLY

| Action | Behavior |
|---|---|
| **Approve** | → Approved (or approve Adjustment) |
| **Reject / Request Revision** | → Revision Requested; comment; notify shop |
| **Send Lessee Responsibility** | Preview `/#/repair/estimates/:id/send-lessee` — blocked on $0 or cent mismatch |
| **Update Responsibilities** | Full page + splits / carry-forward / tax preview |
| **Rollback** | Rollback completed date (audited) when applicable |
| **Issues / comments** | Thread panel; per-line issue icon |
| **Export** | BRC Excel / PDF / 500-byte |
| **Review & Compare** | Any two revisions; added/removed/changed + totals delta |
| **N Document(s) found** | Document viewer in **new window** |

**Removed from owner D:** Submit for approval · setting completed / outbound date.

---

## Send Lessee + lessee token (r4)

Route: `/#/repair/estimates/:id/send-lessee`

- Full Resp 6 line fields (item, loc, qty, C, AJOB/QA, WM, RJOB/QR, R, description, labor/mat/amount, CID)
- Header subset: car / BO / shop / dates
- PDF + 500-byte + gallery; local outbox **"Logged (not sent – local mode)"**
- **Reconcile** preview / PDF / data file / email to the **cent**; **$0 or mismatch blocks Send**
- Fix: Approve/Request-revision rows often have no lines — totals use latest revision **with lines** (c6d2b8a5-class $0.00 preview)

**Lessee approve URL:** signed, single-estimate, single-revision, **expiring** token scoped to Resp 6 + attachments picked on send. API checks token every call. New revision / resend **revokes** prior tokens. Smoke: other estimates / ungranted attachments → **403**.

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

Verified (r4): job codes **855** · qualifiers **1,259** · qualifier_generic **816** · qualifier_charts **304** · why-made **107** · categories **2,170**.

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

Screen **E** document polish / Screen **F** Lessee when Bruce signs off §D r4.
