# Owner UI — Sub-section 3: Bad Orders (`/#/repair/bad-orders`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §C (+ screenshot `06-bad-orders.png`)  
**Tip base:** `1b6e660c8740474ff48def4318b6ef57a28a05af` (§C Bad Orders r2)  
**Scope:** One-step **Start from previous BO** — replace Copy / Copy last with **New from existing…** + History **Use as template**.

---

## Layout (three parts)

1. **Search bar** — Shops / Statuses as searchable multi-selects (checkboxes, All, chips). Initials, Number, Date Range (fits at 1280px+), Date Range Filter.
2. **New Bad Order** — required fields marked `*`; Documents & Photos staged before submit; Shop searchable + **Pick on map**; **New from existing…** search at top of panel.
3. **Bad Order History** — §A parity grid; attachment count/icon opens document viewer; **Use as template** per row (fills form in place + scrolls to panel).

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

Visible section on the form: drag-drop + Browse; categories **SDS / Scope of Work / Photograph / Other** + comment. Staged **before** Submit; uploaded with the created BO event(s). History: count + paperclip opens document viewer. Never copied from a template.

---

## Start from previous BO (template)

- **Removed:** separate **Copy last** button and per-row **Copy** icon.
- **New from existing…** at top of New Bad Order — type car number, B/O date, shop, or reason → pick a past BO → form is **immediately filled in place**.
- History **Use as template** — same fill; scrolls to the New Bad Order panel.
- **Filled:** shop, reason + keyed detail, reporting/DC road, STCC, routing, dest city/state, last contents, car load, cleaned, travel on own wheels, comments, distribution list (plus B/O city/ST, wreck flags when present).
- **Left blank and highlighted for entry:** car initials/number (or Multi Car list), B/O date (defaults today), arrival date, incident date/ID, DDCT Event ID, attachments.
- Banner: **Filled from BO &lt;car&gt; &lt;date&gt; – Clear** (Clear resets the form).
- Submit works as normal (duplicate check unchanged). Multi Car: enables Multi Car when source was a group; list left blank.

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
git rev-parse HEAD   # expect 1b6e660… before apply
# after pull of copy-template bundle:
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

`docs/bundles/rlms-phase1-owner-ui-c-copy-template.bundle` — requires **`1b6e660`**.
