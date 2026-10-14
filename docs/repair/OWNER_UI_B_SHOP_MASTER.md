# Owner UI — Sub-section 2: Shop master + Entity/workspace (`/#/repair/shops`)

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §B (+ entity/workspace riding with this slice)  
**Tip base:** `00d13c97bbce14164660db483ef8aa629293977b` (seed-idempotent; requires `e99c935`)  
**Scope:** Shop master screen, shop dropdown empty-until-created, **railroads** delivering lines (NARN), billing-road validation table (not shop list), Shop Profile read view, RESIDCO workspace title, entity tags on Estimates History + close. §C Bad Order rebuild **not** started beyond entity snapshot on existing BO create. **Map (part 3) not in this tip.**

---

## Shop master (OWNER_UI_SPEC §B)

**Route:** `/#/repair/shops` (top-level **Shops** nav, between Bad Orders and Estimates).  
**Profile:** `/#/repair/shops/:id` — click shop name → read-only Shop Profile; **Edit** opens form (`/#/repair/shops?edit=:id`). Grid **Edit** stays as shortcut.  
**Rule:** Shop dropdowns elsewhere are **EMPTY until at least one shop is created.** Do **not** seed shops from the payee / billing-road spreadsheet. Billing roads remain a separate lookup for optional mark validation.

### Create / edit form

| Field | Required | Notes |
|---|---|---|
| Legal name | Yes | Display; click name in grid → Shop Profile |
| City, State | Yes | State = 2 letters |
| SPLC | Yes | Location |
| Shop mark / AAR shop code | Optional | e.g. A084 → BO dropdown `Name (A084) – City, ST` |
| Mark / billing road | Optional | Validated against `repair.billing_roads` when provided |
| Delivering line(s) | Optional | Type-ahead multi-select vs **`repair.railroads`** (NARN). Manual entry allowed → `needs_review` |
| Shop capabilities | Optional | Multi-select; catalog under Admin gear |
| Car types accepted | Optional | Multi-select; catalog under Admin gear |
| AAR certifications | Optional | Repeatable rows (type, #, expiration); warn if expired or ≤60 days |
| Website, hours/notes | Optional | Free text |
| Attachments | Optional | W-9 / certificates / rate sheets; delete → VOIDED |
| Contacts | ≥0 | name, email, phone, role (profile: click-to-email / click-to-call) |
| Active | Yes | Deactivate hides from dropdowns; **never hard-delete** |

### Delivering lines vs billing roads

| Table | Purpose |
|---|---|
| `repair.railroads` | Operating railroads (Class I / regional / short line). Seeded from public-domain **USDOT/BTS NARN** owner + trackage-rights marks. Type-ahead: `"BP"` → `BPRR – Buffalo & Pittsburgh Railroad`. |
| `repair.billing_roads` | Backend billing-validation lookup only (optional shop mark / BO billing road). **Not** the delivering-line picker. |

Manual delivering marks (not in `railroads`) are saved with `manual_entry` + `needs_review`.

### Shop Profile (read mode)

Header (name, mark, city/ST, SPLC, billing road, active), delivering lines, capabilities, car types, certifications (expiry warnings), contacts, attachments, notes/hours, recent bad orders + estimates at that shop.

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
# http://127.0.0.1:5000/#/repair/shops
# http://127.0.0.1:5000/#/repair/shops/<id>   ← Shop Profile
# http://127.0.0.1:5000/#/repair
```

Expect: delivering lines type-ahead from railroads (not billing-road checkboxes); manual marks flagged for review; click shop name → profile; Edit → form; billing roads still validate optional mark field only.

---

## Next (do not start in this tip)

- **Shop map (part 3)** — separate follow-up bundle after this lands.
- After Bruce sign-off on §B → **Bad Orders** rebuild (OWNER_UI_SPEC §C).
