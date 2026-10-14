# Owner UI — Sub-section 1: Estimates History (`/#/repair`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §A  
**Screenshot:** `docs/repair/screenshots/01-estimates-history.png`  
**Tip base:** `3d1dd73` (Owner UI Spec Step 1)  
**Scope:** This screen only. Estimate Review (`/#/repair/estimates/:id`) is **unchanged**. Shop master, Bad Orders rebuild, and screens B–H are **out of scope**.

---

## Intent

Owner/reviewer landing is an **actionable Estimates History** grid (repairSMART Greeting / Estimates History). Clicking the **Estimate** (car initials + number) opens the existing estimate page.

---

## Default filter (actionable only)

Status multi-select defaults to:

- Awaiting Approval  
- Revision Requested  
- Adjustment for Approval  
- Awaiting Terminate  

**Hidden unless filtered in:** Approved, Completed, Terminated, Queued (shop-only), VOIDED, etc.  
Local review seeds ~15 estimates across statuses so the default queue and “filter in Approved” can both be tested.

---

## Layout (match shot 01)

| Region | Contents |
|---|---|
| **Search** | Shop dropdown; Status multi; Initials; Number; Date Range (from–to); Date Range Filter field (Ignore / Yard Arrival / Approval Requested / Approved / Outbound Target / Outbound Date / Created / Terminated); Search + Reset |
| **Apply to Checked Estimates** | Approve · Get BRC · Excel · 500 · Validate · View Auto Approval Queue · Tank Car Doc Complete count |
| **Summary** | Estimates · # of cars · # of clients · Total Cost ($) · $ per estimate · $ per car · $ per client — updates with filters (integer **cents** math; ≤2 decimals display) |
| **Grid chrome** | Paging · items/page · Export Grid · group-by drop zone · Create Filter |
| **Row click** | Estimate link → existing `/#/repair/estimates/:id` |

### Columns (shot 01 order)

Select · Estimate · Status (colored) · Total · Issues? · Attachment · Shop Name (Name – City, ST) · Arrived At Yard · Approval Requested · Approved · Terminated · Action · Outbound Target · Outbound Date · Invoice # · Bad Order Reason · CTC · Assignment · Wreck? · Dispo Req'd · Lease Type · Resp 6 Email

---

## Capabilities

| Capability | Behavior |
|---|---|
| Saved views | Named views (column set, filters, sort, group-by) — Default action queue + Save / Manage (per browser user in local review) |
| Sort / filter / group | Per-column; multi-status; shop / initials / number / date-field range |
| Paging | Items per page + First/Prev/Next/Last |
| Export Grid | Current filtered/sorted view (CSV / Excel) |
| Bulk Approve | Selected rows in approvable statuses → Approved |
| Get BRC | Detail export for selection |
| Excel / 500 / Validate | Grid Excel; AAR 500-byte export; Railinc validate on selection |

---

## Money

All totals use **integer cents** for arithmetic; display with ≤2 decimal places (e.g. `$19,266.52`).

---

## Local review

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm run repair:migrate:local
npm run repair:seed:estimates-history
npm run repair:dev:local
# open http://127.0.0.1:5000/#/repair
```

---

## Next (do not start)

After Bruce signs off this sub-section → **Shop master** (OWNER_UI_SPEC §B).
