# Owner UI — Sub-section 3: Bad Orders (`/#/repair/bad-orders`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §C (+ screenshot `06-bad-orders.png`)  
**Tip base:** `dd5acc75556c1a9990a2b2bd1f3f305831abaaca` (§B shop map — Bruce signed off)  
**Scope:** One-page Bad Orders (search + New BO + History), owner-managed Bad Order Reasons, status transitions, ContactsProvider seam for future RLMS Contacts. Estimate Review rebuild **not** in this slice.

---

## Layout (three parts)

1. **Search bar** — Shops (multi), Statuses (multi; default Queued / Accepted-Pending / Accepted-Working), Initials, Number, Date Range, Date Range Filter (B/O date, arrival, incident, yard arrival, created).
2. **New Bad Order** — form fields per OWNER_UI_SPEC §C + shot 06; Submit New → lifecycle **Queued**.
3. **Bad Order History** — grid with §A parity (drag columns, filter row, saved views, export, group-by, paging).

---

## Field notes

| Topic | Behavior |
|---|---|
| Shop | From shop master only; label **`Name (MARK) – City, ST`** when `shop_mark` set |
| Billing road | Optional; validated vs `repair.billing_roads`; override needs reason |
| **No Estimate ID** on BO | Use **DDCT Event ID** (`events.ddct_event_id`) |
| Reason | Owner-managed **Bad Order Reason** list (`repair.bo_rules`); Other requires keyed detail; rule-based may add optional detail |
| Multi Car | Paste/type list → one BO per car, shared `multi_car_group_id` |
| Allow Duplicates | Unchecked → block second **open** BO on same car |
| Documents | “No New Bad Order Documents” / “N documents”; attach on event after create (SDS / scope / photos); delete → VOIDED |
| Distribution | Plain email list only (no Resp 6 / lessee contact fields on BO) |
| Entity | Snapshot per car at create (`events.entity_code`); shown on form |

---

## Status transitions

```
Queued → Accepted-Pending (shop Acknowledge)
      → Declined (shop Decline Work; owner may reassign)
Accepted-Pending → Accepted-Working (estimate linked / load accepts BO)
Accepted-Working → Closed (estimate Approved)
```

Documented in OWNER_UI_SPEC §C4. History Estimate column links once an estimate exists.

---

## Admin — Bad Order Reasons

Route: `/#/repair/bo-reasons` (also linked from BO form).  
Add / activate / deactivate (soft). Seed only known RULE_1 / RULE_107 / OTHER — **do not invent** full AAR shopping-reason lists.

---

## Future integrations (not built)

- **ContactsProvider** interface (`modules/repair/providers/contacts.ts`) — local `repair.contacts` today.
- Nullable **`rlms_contact_id`** on `repair.contacts` for a later RLMS Contacts module link.
- Do **not** build the RLMS Contacts module in this slice.

---

## Local review

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect dd5acc7… before apply
# after pull of §C bundle:
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

`docs/bundles/rlms-phase1-owner-ui-c-bad-orders.bundle` — requires **`dd5acc7`**.
