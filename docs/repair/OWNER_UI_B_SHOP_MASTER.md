# Owner UI — Sub-section 2: Shop master + Entity/workspace (`/#/repair/shops`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §B (+ entity/workspace riding with this slice)  
**Tip base:** `1f6aa475ed05c03609e0d7c70605d8c30cba4ace` (§A final)  
**Scope:** Shop master screen, shop dropdown empty-until-created, billing-road validation table (not shop list), RESIDCO workspace title, entity tags on Estimates History + close. §C Bad Order rebuild **not** started beyond entity snapshot on existing BO create.

---

## Shop master (OWNER_UI_SPEC §B)

**Route:** `/#/repair/shops` (top-level **Shops** nav, between Bad Orders and Estimates).  
**Rule:** Shop dropdowns elsewhere are **EMPTY until at least one shop is created.** Do **not** seed shops from the payee / billing-road spreadsheet. Billing roads remain a separate lookup for optional mark validation.

### Create / edit form

| Field | Required | Notes |
|---|---|---|
| Legal name | Yes | Display |
| City, State | Yes | State = 2 letters |
| SPLC | Yes | Location |
| Shop mark / AAR shop code | Optional | e.g. A084 → BO dropdown `Name (A084) – City, ST` |
| Mark / billing road | Optional | Validated against `repair.billing_roads` when provided |
| Delivering line(s) | Optional | Multi-select railroad marks vs billing-road table |
| Shop capabilities | Optional | Multi-select; catalog under Admin gear |
| Car types accepted | Optional | Multi-select; catalog under Admin gear |
| AAR certifications | Optional | Repeatable rows (type, #, expiration); warn if expired or ≤60 days |
| Website, hours/notes | Optional | Free text |
| Attachments | Optional | W-9 / certificates / rate sheets; delete → VOIDED |
| Contacts | ≥0 | name, email, phone, role |
| Active | Yes | Deactivate hides from dropdowns; **never hard-delete** |

### Behavior

- Shops are permanent and linked to the owner tenant/workspace.
- Deactivate only (soft). No hard deletes.
- Nav: top-level **Shops** (removed from Reference). BO reasons / Billing roads stay under Reference.
- Admin (gear) manages capability / car-type / cert-type lists so they can grow.
- Former `seed:payee-list` rows are soft-removed from shop master and copied into `repair.billing_roads`.
- Grid search covers mark, delivering lines, capabilities, car types.

---

## Entity / workspace (rides with §B)

1. **Single workspace** — title bar shows **`RESIDCO`** only (not per-entity logins). Covers MAIN / COAL / RPS.
2. **Entity tags** — per-owner configurable (`repair.owner_entity_tags`). RESIDCO defaults: MAIN / COAL / RPS from `railcars.entity` (`Main` → MAIN, `Coal` → COAL, `Rail Partners Select` → RPS). Match `car_initial` + zero-padded `car_number`. Local/demo uses stub `public.railcars.entity`.
3. **Snapshot** at BO / estimate create onto the event (and estimate). Carried to invoice, estimate lines, CRIP/billing lines, rebuttal. Warn in Estimates History when the car's current entity later differs. Admin can correct with reason + append-only audit (`ENTITY_CORRECTED`).
4. **Estimates History** — **Entity** column (filterable, groupable, Excel export). Summary includes **By entity** breakdown (integer cents).
5. **Monthly close** — totals/exports expose **entity subtotals** for inbound shop payments, rebills (Resp 6/3), and Resp 7.

---

## Local review

```powershell
cd C:\Users\BruceHarbridge\rlms-push
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:seed:estimates-history
npm run repair:smoke-shop-entity
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/shops   ← empty until create
# http://127.0.0.1:5000/#/repair         ← Entity column + RESIDCO title
```

Expect: shop list empty (or only shops you create / seed creates for EH demo); create shop form validates optional mark vs billing roads; Estimates History shows Entity + by-entity summary; title bar **RESIDCO :: …**.

---

## Next (do not start)

After Bruce sign-off on §B → **Bad Orders** rebuild (OWNER_UI_SPEC §C).
