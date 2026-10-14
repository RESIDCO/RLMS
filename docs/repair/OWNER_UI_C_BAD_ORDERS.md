# Owner UI — Sub-section 3: Bad Orders (`/#/repair/bad-orders`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §C (+ screenshot `06-bad-orders.png`)  
**Tip base:** `d4a2bfbfc17e59590f7246358bdd27af56208f18` (§C initial Bad Orders)  
**Scope:** Round 2 polish — search multi-selects, required fields, shop map pick, staged Documents & Photos, Copy BO, Reasons admin (short name), rerunnable smoke.

---

## Layout (three parts)

1. **Search bar** — Shops / Statuses as searchable multi-selects (checkboxes, All, chips). Initials, Number, Date Range (fits at 1280px+), Date Range Filter.
2. **New Bad Order** — required fields marked `*`; Documents & Photos staged before submit; Shop searchable + **Pick on map**.
3. **Bad Order History** — §A parity grid; attachment count/icon opens document viewer; **Copy** per row + **Copy last**.

---

## Required vs optional (Submit validates inline)

| Required (*) | Optional |
|---|---|
| Car Initials | Reporting Road, D/C Road |
| Car Number **or** Multi Car list | STCC, Routing, Dest. City/State |
| Shop | Arrival Date, Last Contents |
| Bad Order Reason | Incident Date, Incident ID, DDCT Event ID |
| B/O Date, B/O City, B/O ST | Car Load, Cleaned, Travel On Own Wheels |
| | Is Wreck?, Wreck Est, Comments, Distribution list |
| | Documents & Photos (staged) |

**Removed from BO form:** Billing road / Billing override reason. Billing road comes from the **shop record**; corrections belong on the estimate header (pencil).

---

## Shop selection

- Searchable dropdown (`Name (MARK) – City, ST`)
- **Pick on map** → Shops map modal; click a pin to select

---

## Documents & Photos

Visible section on the form: drag-drop + Browse; categories **SDS / Scope of Work / Photograph / Other** + comment. Staged **before** Submit; uploaded with the created BO event(s). History: count + paperclip opens document viewer.

---

## Copy Bad Order

- **Copy** on each History row and **Copy last** on the form
- Prefills all fields **except** car number(s), dates, incident ID, and attachments
- Works with Multi Car (enables Multi Car; list left blank for program cars)

---

## Admin — Bad Order Reasons (`/#/repair/bo-reasons`)

- **Name** (required) + optional **Short name** + **Active** + **Sort order**
- Optional **Rule-based** flag with Rule 1 / Rule 107 / Other
- Seed only known RULE_1 / RULE_107 / OTHER — **do not invent** full AAR shopping-reason lists

---

## Status transitions

```
Queued → Accepted-Pending (shop Acknowledge)
      → Declined (shop Decline Work; owner may reassign)
Accepted-Pending → Accepted-Working (estimate linked / load accepts BO)
Accepted-Working → Closed (estimate Approved)
```

---

## Local review

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect d4a2bfb… before apply
# after pull of §C r2 bundle:
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:smoke-bad-orders
npm run repair:smoke-shop-entity
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/bad-orders
```

---

## Bundle

`docs/bundles/rlms-phase1-owner-ui-c-bad-orders-r2.bundle` — requires **`d4a2bfb`**.
