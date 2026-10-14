# Owner UI — Sub-section 1: Estimates History (`/#/repair`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §A  
**Screenshot:** `docs/repair/screenshots/01-estimates-history.png`  
**Tip base:** `cce5026` (§A contrast + sticky nav) → this final polish lands next tip  
**Scope:** This screen + module nav/theme shell. Estimate Review content unchanged (nav/theme shell only). Shop master, Bad Orders rebuild, and screens B–H are **out of scope**.

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

## Layout (match shot 01 + Bruce §A final)

| Region | Contents |
|---|---|
| **Module nav** | Sticky top bar: Bad Orders, Estimates, Outbound Dispos, Invoices, Reference, Help. **Assignments removed.** **Admin = gear icon at right end.** Light/dark toggle (per user) left of gear. Unbuilt → **coming soon** (not 404). |
| **Search** | Shop dropdown; Status multi; Initials; Number; Date Range (from–to); Date Range Filter field; Search + Reset |
| **Apply to Checked Estimates** | Approve · Get BRC · Excel · 500. **Validate removed** (validation runs on file intake → Issues?). **View Auto Approval Queue** hidden until auto-approval rules exist. **Tank Car Doc Complete** shown only when tenant tank-doc gate is ON (MG3 OFF for RESIDCO). |
| **Summary** | Estimates · # of cars · # of clients · Total Cost ($) · $ per estimate · $ per car · $ per client — integer **cents** math; ≤2 decimals display |
| **Grid chrome** | Paging · items/page · Export Grid · group-by · sort · **Columns** show/hide · drag handles to reorder · **filter row under headers** · column resize · Create Filter |
| **Row click** | Estimate link → existing `/#/repair/estimates/:id` |

### Contrast / theme

- **Light** (default): white / light-blue banding, dark text, AA+.
- **Dark** (nav toggle, per user): slate surfaces, light text, AA; **status cell fills keep dark text** so colors stay distinct.
- Inputs readable in both themes; bold right-aligned `$` totals; Shop **`Name – City, ST`**.

### Columns (shot 01 order — user-reorderable)

Select · Estimate · Status (colored) · **Entity** (MAIN/COAL/RPS — added with §B) · Total · Issues? · Attachment · Shop Name · Arrived At Yard · Approval Requested · Approved · Terminated · Action · Outbound Target · Outbound Date · Invoice # · Bad Order Reason · CTC · Assignment · Wreck? · Dispo Req'd · Lease Type · Resp 6 Email

Entity is filterable / groupable; Summary includes by-entity breakdown; Excel export includes Entity. Title bar shows **RESIDCO** (single workspace).

---

## Capabilities

| Capability | Behavior |
|---|---|
| Saved views | Named views store filters, sort, group-by, **column order / width / visibility / column filters** — per browser user. **Set as default** chooses which view opens next. Built-in Default action queue remains available. |
| Sort / filter / group | Per-column filter row; multi-status; shop / initials / number / date-field range; group-by |
| Column chrome | Drag handle reorder; resize; Columns menu show/hide |
| Paging | Items per page + First/Prev/Next/Last |
| Export Grid | Current filtered/sorted view (CSV / Excel) |
| Bulk Approve | Selected rows in approvable statuses → Approved |
| Get BRC | Detail export for selection |
| Excel / 500 | Grid Excel; AAR 500-byte export |

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

## Next

Entity column / RESIDCO workspace title ride with **§B Shop master** — see [OWNER_UI_B_SHOP_MASTER.md](./OWNER_UI_B_SHOP_MASTER.md).
