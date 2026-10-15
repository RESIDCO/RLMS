# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **Wreck dual-track spec (docs only)** | Apply `rlms-phase1-owner-ui-wreck-spec.bundle`. Requires **`0c0be23`** (§D r5). Lands tip in bundle README. Spec: [OWNER_UI_WRECK.md](./OWNER_UI_WRECK.md) — Bruce’s six corrections WIN; `WRECK_DUAL_TRACK.md` folded (OM/FM cites, data model, JIC 4–10, settlement/rebill, clocks from shop arrival). **No wreck UI/APIs yet** — build after §D r5 sign-off. |
| **§D Estimate Review r5** | Apply `rlms-phase1-owner-ui-d-estimate-review-r5.bundle`. Requires **`f911faa`**. Lands tip in bundle README. (1) Lessee Loc/Qty/RJOB/QR/Description/CID via same `enrichLineFromRaw` as owner grid. (2) Gear → Reference Data admin: tabs, soft-retire/restore, audit, dry-run import, export. |
| **§D Estimate Review r4** | Prior: `rlms-phase1-owner-ui-d-estimate-review-r4.bundle`. Requires **`d864588`** → **`f911faa`**. Qualifier multi-path; header LOCK/EDIT/FREE; lessee token 403; cent reconcile; $0 Send block. |
| **§D Estimate Review r3** | Prior: `rlms-phase1-owner-ui-d-estimate-review-r3.bundle`. Requires **`2d987c9`** → **`d864588`**. Hover close; car# lock 409; money commas; send-lessee preview + local outbox. |
| **§D Estimate Review r2** | Prior: `rlms-phase1-owner-ui-d-estimate-review-r2.bundle`. Requires **`f853e48`** → **`2d987c9`**. Licensed AAR CSVs + `npm run repair:import-ref-data`. |
| **§D Estimate Review (initial)** | Prior: `rlms-phase1-owner-ui-d-estimate-review.bundle` → **`f853e48`**. |
| **§C Template fields + attach carry** | Prior / signed off: `rlms-phase1-owner-ui-c-template-fields.bundle` → **`468a9db`**. |
| **§C Copy BO template** | Prior: `rlms-phase1-owner-ui-c-copy-template.bundle` → **`8a9378e`**. |
| **§C Bad Orders r2** | Prior: `rlms-phase1-owner-ui-c-bad-orders-r2.bundle` → **`1b6e660`**. |
| **§C Bad Orders (initial)** | Prior: `rlms-phase1-owner-ui-c-bad-orders.bundle` → **`d4a2bfb`**. |
| **§B Shop map (part 3)** | Prior: `rlms-phase1-owner-ui-b-shop-map.bundle` → **`dd5acc7`**. |
| **§B railroads + Shop Profile** | Prior: `rlms-phase1-owner-ui-b-railroads-profile.bundle` → **`eeffc61`**. |
| **Seed idempotent** | Prior: `rlms-phase1-seed-estimates-idempotent.bundle` → **`00d13c9`**. |
| **Migrate view fix + §B shop fields** | Prior: `rlms-phase1-migrate-view-fix.bundle` → **`e99c935`**. |
| **§B Shop master + Entity** | Prior: `rlms-phase1-owner-ui-b-shops-entity.bundle` → **`2039b7f`**. |
| **§A final** | Prior: `rlms-phase1-owner-ui-a-final.bundle` → **`1f6aa47`**. |

If PC is on **`f911faa`**, apply §D **estimate-review-r5** first → **`0c0be23`**, then the **wreck-spec** docs bundle.  
If PC is already on **`0c0be23`** or prior wreck-spec tip **`9935a0f`**, apply **`rlms-phase1-owner-ui-wreck-spec.bundle`** next (replaced fold tip — see bundle README).  
**Wreck build** (UI/APIs) waits for §D r5 sign-off + Bruce acceptance of [OWNER_UI_WRECK.md](./OWNER_UI_WRECK.md).

---

## Owner UI — one screen at a time (2026-10-14)

| Sub-section | Deliverable | Status |
|---|---|---|
| **1** | Estimates History `/#/repair` (spec §A) | Done |
| **2** | Shop master (spec §B) + Entity/workspace + railroads + Shop Profile + Map | **Signed off** (`dd5acc7`) |
| **3** | Bad Orders `/#/repair/bad-orders` (spec §C) | **Signed off** (`468a9db`) |
| **4** | Estimate Review `/#/repair/estimates/:id` (spec §D) | **r5 tip** (awaiting Bruce sign-off) |
| **Wreck** | Dual-track wreck event (Rule 107 / Resp 3) — [OWNER_UI_WRECK.md](./OWNER_UI_WRECK.md) | **Spec folded** (docs-only tip; `WRECK_DUAL_TRACK` merged; build after §D r5 sign-off) |
| 5+ | Documents polish / Lessee, etc. | Parked |

**Sub-specs:** [OWNER_UI_A_ESTIMATES_HISTORY.md](./OWNER_UI_A_ESTIMATES_HISTORY.md) · [OWNER_UI_B_SHOP_MASTER.md](./OWNER_UI_B_SHOP_MASTER.md) · [OWNER_UI_C_BAD_ORDERS.md](./OWNER_UI_C_BAD_ORDERS.md) · [OWNER_UI_D_ESTIMATE_REVIEW.md](./OWNER_UI_D_ESTIMATE_REVIEW.md) · [OWNER_UI_WRECK.md](./OWNER_UI_WRECK.md)  
**Overall map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)

---

## Bundle chain (recent)

| Order | Bundle | Requires | Lands |
|---|---|---|---|
| N+9 | `rlms-phase1-owner-ui-b-shop-map.bundle` | `eeffc61` | → **`dd5acc7`** |
| N+10 | `rlms-phase1-owner-ui-c-bad-orders.bundle` | `dd5acc7` | → **`d4a2bfb`** |
| N+11 | `rlms-phase1-owner-ui-c-bad-orders-r2.bundle` | `d4a2bfb` | → **`1b6e660`** |
| N+12 | `rlms-phase1-owner-ui-c-copy-template.bundle` | `1b6e660` | → **`8a9378e`** |
| N+13 | `rlms-phase1-owner-ui-c-template-fields.bundle` | `8a9378e` | → **`468a9db`** |
| N+14 | `rlms-phase1-owner-ui-d-estimate-review.bundle` | `468a9db` | → **`f853e48`** |
| N+15 | `rlms-phase1-owner-ui-d-estimate-review-r2.bundle` | `f853e48` | → **`2d987c9`** |
| N+16 | `rlms-phase1-owner-ui-d-estimate-review-r3.bundle` | `2d987c9` | → **`d864588`** |
| N+17 | `rlms-phase1-owner-ui-d-estimate-review-r4.bundle` | `d864588` | → **`f911faa`** |
| N+18 | `rlms-phase1-owner-ui-d-estimate-review-r5.bundle` | `f911faa` | → **`0c0be23`** |
| N+19 | **`rlms-phase1-owner-ui-wreck-spec.bundle`** (replaced — fold) | **`0c0be23`** | → **(see README)** |

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

## Apply §D Estimate Review r3 (on tip `2d987c9`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect 2d987c9…
git bundle verify PATH\TO\rlms-phase1-owner-ui-d-estimate-review-r3.bundle
git pull PATH\TO\rlms-phase1-owner-ui-d-estimate-review-r3.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:import-ref-data
npm run repair:smoke-estimate-review
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/estimates/<id>
# Car# lock · $36,732.04 commas · hover leave/Esc · Send Lessee preview → outbox
```

Expect: car edit **409**; money thousands separators; hover tips not stuck; Send Lessee builds PDF+data+attachments → **"Logged (not sent – local mode)"**.

**Licensed AAR:** `modules/repair/ref-data/` (private — never public-serve).

---

## Delivery rules (permanent)

1. **Draft PR only** — no merge, no deploy.
2. **Bundles only** — write under `docs/bundles/` (and Project store mirrors). **Never** push to `RESIDCO/RLMS` via GitHub MCP or any cloud path.
3. **Bruce pushes** from `C:\Users\BruceHarbridge\rlms-push` after `git pull` of the bundle.
4. **Local Postgres only** — no Supabase branch, no paid services.
5. **Money** — integer cents for all repair amounts; ≤2 decimals display.

---

## Open items

- Full AAR Bad Order Reason list still incomplete (do not invent) — admin-extensible via `/#/repair/bo-reasons`.
- Q1 / Q2 remain in open-questions.md.
- **Wreck:** `WRECK_DUAL_TRACK.md` folded into [OWNER_UI_WRECK.md](./OWNER_UI_WRECK.md). Remaining `OPEN:` — JIC Standard vs Alternate / who sends; settle warn %; quarterly CSV source; Q18 vs Resp 3 invoice #; rebill party; unpriced labor table; Canadian taxes; short-pay queue; lessee 6/7; Send Lessee wreck portion; flag UI taxonomy; calendar vs business days.
- Screen E document polish / Screen F Lessee after §D sign-off (wreck build may intercalate per Bruce).
