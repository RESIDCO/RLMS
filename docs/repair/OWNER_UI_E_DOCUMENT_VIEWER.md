# Owner UI — Sub-section E: Document Viewer + BRC / Lessee email

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §E  
**Screenshot:** `03-file-attachments.png`  
**Tip base (viewer):** `ba5dc510271980f2d409a9425e945fca7e9b09b2`  
**Tip base (BRC + email r2):** `73b9e3d4bb9d9aca3150bca0b9147d860e401a59`  
**Bundles:** `rlms-phase1-owner-ui-e-document-viewer.bundle` → `rlms-phase1-owner-ui-e-brc-email.bundle`

---

## Intent

One **File Attachments** window (shot 03) opened from Estimate Review, Bad Orders, or Wreck — scoped to that record. Photos, PDFs, 500-byte data files, and Office docs share the same viewer.

| Entry | Route |
|---|---|
| Estimate Review “N Document(s) found” | `/#/repair/estimates/:id/documents` |
| Bad Order History paperclip | `/#/repair/events/:eventId/documents` |
| Wreck “Open File Attachments” | `/#/repair/wreck/:wreckEventId/documents` |

---

## Layout (shot 03 + §E)

1. **Header** — car, reason, Bad Order ID, Estimate, status  
2. **Required-docs checklist** — missing items flagged  
3. **Filters** — category, uploader (shop/owner/lessee), date range, file-name search; owner “Show voided”  
4. **Apply to Checked / Add File(s)** — category + comment (shot 03)  
5. **Left** — category tabs (Photos, Estimate PDF, Data files (500-byte), Invoice, SDS, Scope of work, JIC, DDCT, Other) + grid (checkbox, view, save, name, type, category, loaded by/role, date, size, rev, comment, void); source tag `From BO <car> <date>` when linked  
6. **Right preview**
   - Image — zoom / rotate  
   - PDF — inline iframe (page nav via browser PDF UI)  
   - 500-byte — decoded field grid + raw toggle  
   - Office — download only  
7. **Footer** — Close · Download zip · Attach to Send Lessee (owner)

---

## Permissions (server-side)

| Role | View | Add | Recategorize / Void / Restore |
|---|---|---|---|
| Owner / system manager / reviewer / admin | All (voided via toggle) | ✓ | ✓ |
| Shop | **All non-voided** on its records (incl. owner uploads) **except `owner_only`** | ✓ | ✗ **403** |
| Lessee | **Granted ids only** (never `owner_only`) | — | — |

- DV / settlement / owner-only docs: `documents.owner_only = true` — never to shop or lessee.  
- Voided = `lifecycle_status = VOIDED` + `deleted_at` (append-only; never purge).  
- Downloads (single / zip / send-lessee attach) audited in `repair.document_download_audit`.

---

## Required docs

| Record | Rule |
|---|---|
| Wreck | JIC photos **4–10** (`jic_photo` / photo category) |
| Any with `bo_rules.requires_sds` | At least one SDS |

---

## Billing Repair Card PDF (r2)

Portrait letter, clean sans, light gridlines. Same template for **owner / lessee / shop** — only the line filter changes.

| Audience | Lines |
|---|---|
| Owner | All (incl. internal / DV) |
| Lessee | Granted Resp 6 only |
| Shop | Exclude internal (8000-series) and DV settlement |

- Title: `<Entity/Workspace> Estimate – Billing Repair Card` + shop city/ST  
- Header 4-col label:value grid (Estimate ID, Status, Invoice, Assignment, Car…, Road/DC/SPLC, dates)  
- Line table: Line, Loc, Qty, C, AJOB, QA, Description, WM, RJOB, QR, Resp, Amount (+ Component ID when any line has one)  
- Split notes in description; money right-aligned with commas + 2dp; totals row bold; headers repeat on page breaks  
- Footer: `Page X of Y` · Generated … ET · `Estimate <car> <created> Current Revision N`  
- APIs: `GET /api/repair/estimates/:id/brc-pdf?audience=` · `POST /api/repair/estimates/brc-export` with `format=pdf`

---

## Lessee responsibility email (r2)

Customary RepairSMART message wired into Send Lessee (`/#/repair/estimates/:id/send-lessee`).

| Field | Value |
|---|---|
| Subject | `Responsibility Items <car initial> <car number>` (leading zeros dropped, e.g. AEX 22881) |
| To | Lessee contacts from lease / contact bank |
| CC | Owner reviewer (sender) + shop contact |
| From | System address (`tenants.settings.systemFromEmail`) |
| Reply-To | Owner reviewer (threads to owner) |

Body: logo/workspace, **Contract Shop System Message** banner, 2-col table (Category / Equipment / Dollar Amount / Client / User / Description), signed **Review / Approve** button, response window default **48h** (`lesseeResponseHours`).

Attachments (totals agree to the cent):

- `<CAR><estimateNo>_Resp6.pdf` — BRC filtered to lessee lines  
- `<CAR><estimateNo>_Resp6Byte500.txt` — matching 500-byte  
- Selected photos/docs from gallery  

**Local mode:** never sends; writes `.eml` under `modules/repair/dev/email-outbox/` (+ `repair.email_outbox.eml_path`).

---

## APIs

| Method | Path |
|---|---|
| GET | `/api/repair/documents/viewer?estimateId=\|eventId=\|wreckEventId=` |
| GET | `/api/repair/documents/:id/content?role=` (ACL) |
| GET | `/api/repair/documents/:id/aar-preview` |
| POST | `/api/repair/documents/zip` |
| POST | `/api/repair/documents/attach-send-lessee` |
| POST | `/api/repair/documents/:id/owner-only` |
| GET | `/api/repair/estimates/:id/brc-pdf?audience=owner\|lessee\|shop` |
| GET | `/api/repair/estimates/:id/send-lessee` |
| POST | `/api/repair/estimates/:id/send-lessee` |

---

## Local review

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:typecheck-client-brc-email
npm run repair:smoke-brc-email
npm run repair:dev:local
# Estimate Review → Get BRC PDF (owner/lessee/shop)
# Estimate Review → Send Lessee Responsibility → preview table + .eml outbox
```

Integer cents elsewhere. Local Postgres. Append-only / VOIDED. Repair schema only. Draft PR — bundles only; no merge/deploy.
