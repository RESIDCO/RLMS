# Owner UI — Sub-section E: Document Viewer

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §E  
**Screenshot:** `03-file-attachments.png`  
**Tip base:** `ba5dc510271980f2d409a9425e945fca7e9b09b2` (wreck DV panel)  
**Bundle:** `rlms-phase1-owner-ui-e-document-viewer.bundle`

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

## APIs

| Method | Path |
|---|---|
| GET | `/api/repair/documents/viewer?estimateId=\|eventId=\|wreckEventId=` |
| GET | `/api/repair/documents/:id/content?role=` (ACL) |
| GET | `/api/repair/documents/:id/aar-preview` |
| POST | `/api/repair/documents/zip` |
| POST | `/api/repair/documents/attach-send-lessee` |
| POST | `/api/repair/documents/:id/owner-only` |
| POST | `/api/repair/e/:token/documents/:id/soft-delete` → **403** |
| POST | `/api/repair/e/:token/documents/:id/recategorize` → **403** |

---

## Local review

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:typecheck-client-documents
npm run repair:smoke-documents
npm run repair:dev:local
# Open estimate / BO / wreck → File Attachments window
```

Integer cents elsewhere. Local Postgres. Append-only / VOIDED. Repair schema only. Draft PR — bundles only; no merge/deploy.
