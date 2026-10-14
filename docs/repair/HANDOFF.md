# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **§C Bad Orders** | Apply `rlms-phase1-owner-ui-c-bad-orders.bundle`. Requires **`dd5acc7`**. Lands tip in bundle README. |
| **§B Shop map (part 3)** | Prior: `rlms-phase1-owner-ui-b-shop-map.bundle` → **`dd5acc7`**. |
| **§B railroads + Shop Profile** | Prior: `rlms-phase1-owner-ui-b-railroads-profile.bundle` → **`eeffc61`**. |
| **Seed idempotent** | Prior: `rlms-phase1-seed-estimates-idempotent.bundle` → **`00d13c9`**. |
| **Migrate view fix + §B shop fields** | Prior: `rlms-phase1-migrate-view-fix.bundle` → **`e99c935`**. |
| **§B Shop master + Entity** | Prior: `rlms-phase1-owner-ui-b-shops-entity.bundle` → **`2039b7f`**. |
| **§A final** | Prior: `rlms-phase1-owner-ui-a-final.bundle` → **`1f6aa47`**. |

If PC is on **`dd5acc7`**, apply this §C Bad Orders bundle next.

---

## Owner UI — one screen at a time (2026-10-14)

| Sub-section | Deliverable | Status |
|---|---|---|
| **1** | Estimates History `/#/repair` (spec §A) | Done |
| **2** | Shop master (spec §B) + Entity/workspace + railroads + Shop Profile + Map | **Signed off** (`dd5acc7`) |
| **3** | Bad Orders `/#/repair/bad-orders` (spec §C) | **In this tip** |
| 4+ | Estimate Review rebuild, etc. | Parked |

**Sub-specs:** [OWNER_UI_A_ESTIMATES_HISTORY.md](./OWNER_UI_A_ESTIMATES_HISTORY.md) · [OWNER_UI_B_SHOP_MASTER.md](./OWNER_UI_B_SHOP_MASTER.md) · [OWNER_UI_C_BAD_ORDERS.md](./OWNER_UI_C_BAD_ORDERS.md)  
**Overall map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)

---

## Bundle chain (recent)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| N+5 | `rlms-phase1-owner-ui-b-shops-entity.bundle` | `1f6aa47` | → **`2039b7f`** |
| N+6 | `rlms-phase1-migrate-view-fix.bundle` | `2039b7f` | → **`e99c935`** |
| N+7 | `rlms-phase1-seed-estimates-idempotent.bundle` | `e99c935` | → **`00d13c9`** |
| N+8 | `rlms-phase1-owner-ui-b-railroads-profile.bundle` | `00d13c9` | → **`eeffc61`** |
| N+9 | `rlms-phase1-owner-ui-b-shop-map.bundle` | `eeffc61` | → **`dd5acc7`** |
| N+10 | **`rlms-phase1-owner-ui-c-bad-orders.bundle`** | **`dd5acc7`** | → **`ef02d93`** |

---

## Future integrations

| Item | Status |
|---|---|
| **ContactsProvider** | Interface in `modules/repair/providers/contacts.ts` — **LocalContactsProvider** over `repair.contacts` today. Swap later for RLMS Contacts module. |
| **`rlms_contact_id`** | Nullable column on `repair.contacts` for future link. Do **not** build RLMS Contacts module now. |
| Shop contacts UI | Remains on Shop master; BO uses plain **distribution list** only. |

---

## Map data sources (free / local — documented 2026-10-14)

| Asset | Source | Date | Notes |
|---|---|---|---|
| Rail overlay | USDOT/BTS/FRA **NARN Lines** (public domain) | Queried 2026-10-14 | Dissolved by `RROWNER1`, simplified (~0.08° offset); `narn-lines-simplified.geojson.gz` (~0.6 MB gz, ~980 marks). US/CA/MX including short lines. Not truncated to CONUS; yard detail removed for size. See `modules/repair/data/NARN_LINES_SOURCE.md`. |
| Places geocode | **GeoNames** `cities5000` (CC-BY 4.0) | Downloaded 2026-10-14 | US/CA/MX only → `repair.places` (~10.6k). See `modules/repair/data/PLACES_SOURCE.md`. |
| Base tiles | OpenStreetMap | runtime | Free tile servers only |
| Optional tiles | OpenRailwayMap | runtime | Layer toggle; free tiles |

**No paid map API keys. No runtime geocoder calls.** Manual `lat_override` / `lng_override` on shop record wins over places.

---

## Apply Bad Orders §C (on tip `dd5acc7`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect dd5acc7…
git bundle verify PATH\TO\rlms-phase1-owner-ui-c-bad-orders.bundle
git pull PATH\TO\rlms-phase1-owner-ui-c-bad-orders.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:smoke-bad-orders
npm run repair:smoke-shop-entity
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/bad-orders
# http://127.0.0.1:5000/#/repair/bo-reasons
```

Expect: search + New Bad Order + History grid; shop labels with mark; DDCT Event ID (no Estimate ID on create); duplicate guard; entity snapshot; reasons admin; Queued → Accepted-Pending → Accepted-Working → Closed documented in sub-spec.

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services.
5. **Money** — integer cents for all repair amounts; ≤2 decimals display.

---

## Open items

- Screenshots 02–05 for later subsections (Estimate Review, attachments, responsibilities).
- Full AAR Bad Order Reason list still incomplete (do not invent) — admin-extensible via `/#/repair/bo-reasons`.
- Q1 / Q2 remain in open-questions.md.
