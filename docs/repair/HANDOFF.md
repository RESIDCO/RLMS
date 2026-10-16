# RLMS Repair Module — Handoff

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Status:** Still **draft**. Do not merge or deploy.

---

## Current tips

| Tip | Meaning |
|---|---|
| **§H Owner invoice review + shop payment** | Apply `rlms-phase1-owner-ui-h-invoice.bundle` on tip **`c5bad2a`** (§G r5). Invoice queue `/#/repair/invoices`, side-by-side review, Approve/Reject/Short-pay, payment batch CSV (no real ACH), Missed POD tile + Closed label. Smoke: `npm run repair:smoke-invoice`. Typecheck: `npm run repair:typecheck-client-invoice`. Spec: [OWNER_UI_H_INVOICE.md](./OWNER_UI_H_INVOICE.md). |
| **§G r5 One stored BO status** | Apply `rlms-phase1-owner-ui-g-shop-r5.bundle` on tip **`0a577f0`** (§G r4). `bo.status` + state machine; accept persists; flags only on estimates; compact timeline; seed via real transitions; tile counts = stored status. Smoke: `npm run repair:smoke-shop`. Typecheck: `npm run repair:typecheck-client-shop`. Spec: [OWNER_UI_G_SHOP.md](./OWNER_UI_G_SHOP.md). |
| **§G r4 Shop BO workflow + tiles + invoice** | Prior: `rlms-phase1-owner-ui-g-shop-r4.bundle` on tip **`cbff463`** → **`0a577f0`**. Signed shop link confirm→on hand→estimate→POD/complete→invoice; clickable status tiles; Closed requires accepted invoice. |
| **§G r3 Inputs / closed BO / seed** | Prior: `rlms-phase1-owner-ui-g-shop-r3.bundle` on tip **`bb837ae`** → **`cbff463`**. White inputs AA; closed reason + inconsistent-state block; smoke hide/clean; seed hard-fail DEMO 100001–100005; owner/MP read-only shop view; DEV banner production-gated. |
| **§G r2 Shop clarity + review aids** | Prior: `rlms-phase1-owner-ui-g-shop-r2.bundle` on tip **`85199a7`** → **`bb837ae`**. AA contrast; returnTo + breadcrumbs; BO dates/POD/timeline/flags/KPIs; line comments; seed + DEV role switcher. |
| **§G Shop portal + Railinc validation** | Prior: `rlms-phase1-owner-ui-g-shop.bundle` on tip **`9296477`** (§F r3) → **`85199a7`**. Shop portal (own mark); stub Railinc validator; local outbox; cross-shop 403. |
| **§F r3 Manual lessee decision** | Apply `rlms-phase1-owner-ui-f-lessee-r3.bundle` on tip **`d172911`** (§F r2). Owner/managing partner **Record lessee response** (Accept/Reject + proof .msg/.eml/PDF → Lessee Approval); closes link; clears overdue; badge Accepted (manual); undo (owner only). Smoke: `npm run repair:smoke-lessee`. Typecheck: `npm run repair:typecheck-client-lessee`. |
| **§F r2 Lessee fixes** | Prior: `rlms-phase1-owner-ui-f-lessee-r2.bundle` on tip **`fda2956`** → **`d172911`**. Accept/Reject never silent; owner 30s poll + no-store; BRC header/grid/sticky footer; Loc/WM/C/Resp hovers. |
| **§F Lessee screen** | Prior: `rlms-phase1-owner-ui-f-lessee.bundle` on tip **`81034cc`** → **`fda2956`**. Login-free signed link; Accept/Reject; 3 business days (≥72h); overdue never auto-approves. |
| **§E r2 BRC PDF + Lessee email** | Apply `rlms-phase1-owner-ui-e-brc-email.bundle` on tip **`73b9e3d`** (§E Document Viewer). Billing Repair Card PDF (owner/lessee/shop filters); customary Resp6 email (subject/To/CC/body table/attachments); local `.eml` outbox. Smoke: `npm run repair:smoke-brc-email`. Typecheck: `npm run repair:typecheck-client-brc-email`. |
| **§E Document Viewer** | Prior: `rlms-phase1-owner-ui-e-document-viewer.bundle` on tip **`ba5dc51`** → **`73b9e3d`**. File Attachments own-window from Estimate / BO / Wreck; left category list + right preview (image/PDF/500-byte/Office); filters; shop view-all non-voided + add-only; lessee granted-only; `owner_only` never to shop/lessee; bulk zip + Attach Send Lessee; required-docs checklist. Smoke: `npm run repair:smoke-documents`. Typecheck: `npm run repair:typecheck-client-documents`. |
| **Wreck DV / settlement panel** | Prior: `rlms-phase1-owner-ui-wreck-dv.bundle` on tip **`cfd1028`** → **`ba5dc51`**. Dollars money inputs ($ / commas → cents); gauge copy + bar; labor-rate citation. Smoke: `npm run repair:smoke-wreck`. |
| **Wreck hotfix (WorkspaceTitle)** | Prior: `rlms-phase1-owner-ui-wreck-hotfix.bundle` on tip **`dc704f1`** → **`cfd1028`**. Fixes blank Chrome: named `{ WorkspaceTitle }` import. |
| **Wreck dual-track BUILD** | Prior: `rlms-phase1-owner-ui-wreck.bundle`. Requires **`85856b6`** → **`dc704f1`**. Implements approved [OWNER_UI_WRECK.md](./OWNER_UI_WRECK.md). |
| **Wreck dual-track spec (docs)** | Prior: `rlms-phase1-owner-ui-wreck-spec.bundle`. Requires **`c8a7138`** → **`85856b6`**. Spec approved; §11 #1/#4/#10 DECIDED (Umler/manual inconsistent-tolerant; AAR quarterly labor rate; invoice # not on estimate / HARD REJECT final invoice). |
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

If PC is on **`cfd1028`**, apply **`rlms-phase1-owner-ui-wreck-dv.bundle`** next (DV panel dollars/gauge/contrast).  
If PC is on **`dc704f1`**, apply hotfix → **`cfd1028`**, then the DV bundle.  
If PC is on **`85856b6`**, apply wreck build → hotfix → DV.  
If PC is on **`c8a7138`**, apply wreck-spec first → build + hotfix + DV.  
If still on **`f911faa`** / **`0c0be23`**, pull §D r5 + prior fold + wreck-spec first.

---

## Owner UI — one screen at a time (2026-10-14)

| Sub-section | Deliverable | Status |
|---|---|---|
| **1** | Estimates History `/#/repair` (spec §A) | Done |
| **2** | Shop master (spec §B) + Entity/workspace + railroads + Shop Profile + Map | **Signed off** (`dd5acc7`) |
| **3** | Bad Orders `/#/repair/bad-orders` (spec §C) | **Signed off** (`468a9db`) |
| **4** | Estimate Review `/#/repair/estimates/:id` (spec §D) | **r5 tip** (awaiting Bruce sign-off) |
| **Wreck** | Dual-track wreck event (Rule 107 / Resp 3) — [OWNER_UI_WRECK.md](./OWNER_UI_WRECK.md) | **BUILD + hotfix + DV panel** (`ba5dc51`) |
| **5 / §E** | Document Viewer (shot 03) + BRC PDF / Lessee email — [OWNER_UI_E_DOCUMENT_VIEWER.md](./OWNER_UI_E_DOCUMENT_VIEWER.md) | Apply `rlms-phase1-owner-ui-e-brc-email.bundle` on **`73b9e3d`** |
| **6 / §F** | Lessee screen — [OWNER_UI_F_LESSEE.md](./OWNER_UI_F_LESSEE.md) | Apply `rlms-phase1-owner-ui-f-lessee-r3.bundle` on **`d172911`** |
| **7 / §G** | Shop portal + Railinc validation (+ r2–r5) — [OWNER_UI_G_SHOP.md](./OWNER_UI_G_SHOP.md) | Apply `rlms-phase1-owner-ui-g-shop-r5.bundle` on **`0a577f0`** |
| **8 / §H** | Invoice review + shop payment — [OWNER_UI_H_INVOICE.md](./OWNER_UI_H_INVOICE.md) | Apply `rlms-phase1-owner-ui-h-invoice.bundle` on **`c5bad2a`** |

**Sub-specs:** [OWNER_UI_A_ESTIMATES_HISTORY.md](./OWNER_UI_A_ESTIMATES_HISTORY.md) · [OWNER_UI_B_SHOP_MASTER.md](./OWNER_UI_B_SHOP_MASTER.md) · [OWNER_UI_C_BAD_ORDERS.md](./OWNER_UI_C_BAD_ORDERS.md) · [OWNER_UI_D_ESTIMATE_REVIEW.md](./OWNER_UI_D_ESTIMATE_REVIEW.md) · [OWNER_UI_WRECK.md](./OWNER_UI_WRECK.md) · [OWNER_UI_E_DOCUMENT_VIEWER.md](./OWNER_UI_E_DOCUMENT_VIEWER.md) · [OWNER_UI_F_LESSEE.md](./OWNER_UI_F_LESSEE.md) · [OWNER_UI_G_SHOP.md](./OWNER_UI_G_SHOP.md) · [OWNER_UI_H_INVOICE.md](./OWNER_UI_H_INVOICE.md)  
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
| N+19 | **`rlms-phase1-owner-ui-wreck-spec.bundle`** (§11 FF from c8a7138) | **`c8a7138`** | → **`85856b6`** |
| N+20 | **`rlms-phase1-owner-ui-wreck.bundle`** (approved build) | **`85856b6`** | → **`dc704f1`** |
| N+21 | `rlms-phase1-owner-ui-wreck-hotfix.bundle` (blank Chrome / WorkspaceTitle) | **`dc704f1`** | → **`cfd1028`** |
| N+22 | **`rlms-phase1-owner-ui-wreck-dv.bundle`** (DV panel dollars / gauge / contrast / labor citation) | **`cfd1028`** | → **`ba5dc51`** |
| N+23 | **`rlms-phase1-owner-ui-e-document-viewer.bundle`** (§E File Attachments) | **`ba5dc51`** | → **`73b9e3d`** |
| N+24 | **`rlms-phase1-owner-ui-e-brc-email.bundle`** (§E r2 BRC PDF + Lessee email) | **`73b9e3d`** | → **`81034cc`** |
| N+25 | **`rlms-phase1-owner-ui-f-lessee.bundle`** (§F Lessee screen) | **`81034cc`** | → **`fda2956`** |
| N+26 | **`rlms-phase1-owner-ui-f-lessee-r2.bundle`** (§F r2 Accept bug + readability + hovers) | **`fda2956`** | → **`d172911`** |
| N+27 | **`rlms-phase1-owner-ui-f-lessee-r3.bundle`** (§F r3 manual lessee decision) | **`d172911`** | → **`9296477`** |
| N+28 | **`rlms-phase1-owner-ui-g-shop.bundle`** (§G Shop portal + Railinc stub validation) | **`9296477`** | → **`85199a7`** |
| N+29 | **`rlms-phase1-owner-ui-g-shop-r2.bundle`** (§G r2 shop clarity + review aids) | **`85199a7`** | → **`bb837ae`** |
| N+30 | **`rlms-phase1-owner-ui-g-shop-r3.bundle`** (§G r3 inputs / closed BO / seed) | **`bb837ae`** | → **`cbff463`** |
| N+31 | **`rlms-phase1-owner-ui-g-shop-r4.bundle`** (§G r4 shop BO workflow + tiles + invoice) | **`cbff463`** | → **`0a577f0`** |
| N+32 | **`rlms-phase1-owner-ui-g-shop-r5.bundle`** (§G r5 one stored BO status) | **`0a577f0`** | → **`c5bad2a`** |
| N+33 | **`rlms-phase1-owner-ui-h-invoice.bundle`** (§H invoice review + payment) | **`c5bad2a`** | → **(see README)** |

---

## Apply §H Owner invoice review + shop payment (on tip `c5bad2a`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect c5bad2a…
git bundle verify PATH\TO\rlms-phase1-owner-ui-h-invoice.bundle
git pull PATH\TO\rlms-phase1-owner-ui-h-invoice.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:typecheck-client-invoice
npm run repair:smoke-invoice
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/invoices
```

---

## Apply §G r5 One stored BO status (on tip `0a577f0`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect 0a577f0…
git bundle verify PATH\TO\rlms-phase1-owner-ui-g-shop-r5.bundle
git pull PATH\TO\rlms-phase1-owner-ui-g-shop-r5.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:seed-shop-demo
npm run repair:typecheck-client-shop
npm run repair:smoke-shop
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/shop  (shop mark DS01)
# Accept DEMO 100001 via signed link → reopen shows Accepted – awaiting arrival
```

---

## Apply §G r3 Inputs / closed BO / seed (on tip `bb837ae`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect bb837ae…
git bundle verify PATH\TO\rlms-phase1-owner-ui-g-shop-r3.bundle
git pull PATH\TO\rlms-phase1-owner-ui-g-shop-r3.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:seed-shop-demo
npm run repair:typecheck-client-shop
npm run repair:smoke-shop
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/shop  (shop mark DS01)
# Owner/MP via DEV banner → "Viewing as shop DS01" read-only
```

---

## Apply §G r2 Shop clarity (on tip `85199a7`) — prior

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect 85199a7…
git bundle verify PATH\TO\rlms-phase1-owner-ui-g-shop-r2.bundle
git pull PATH\TO\rlms-phase1-owner-ui-g-shop-r2.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:seed-shop-demo
npm run repair:typecheck-client-shop
npm run repair:smoke-shop
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/shop  (shop mark DS01 after seed)
```

---

## Apply §G Shop portal (on tip `9296477`) — prior

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect 9296477…
git bundle verify PATH\TO\rlms-phase1-owner-ui-g-shop.bundle
git pull PATH\TO\rlms-phase1-owner-ui-g-shop.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:typecheck-client-shop
npm run repair:smoke-shop
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/shop
```

---

## Apply §F r3 (on tip `d172911`)

```powershell
git rev-parse HEAD   # expect d172911…
git bundle verify PATH\TO\rlms-phase1-owner-ui-f-lessee-r3.bundle
git pull PATH\TO\rlms-phase1-owner-ui-f-lessee-r3.bundle HEAD
npm run repair:migrate:local
npm run repair:typecheck-client-lessee
npm run repair:smoke-lessee
```

---

## Apply §F r2 (on tip `fda2956`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect fda2956…
git bundle verify PATH\TO\rlms-phase1-owner-ui-f-lessee-r2.bundle
git pull PATH\TO\rlms-phase1-owner-ui-f-lessee-r2.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

## Apply §F Lessee screen (on tip `81034cc`) — prior

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect 81034cc…
git bundle verify PATH\TO\rlms-phase1-owner-ui-f-lessee.bundle
git pull PATH\TO\rlms-phase1-owner-ui-f-lessee.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:typecheck-client-lessee
npm run repair:smoke-lessee
npm run repair:dev:local
```

---

## Apply §E r2 BRC + Lessee email (on tip `73b9e3d`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect 73b9e3d…
git bundle verify PATH\TO\rlms-phase1-owner-ui-e-brc-email.bundle
git pull PATH\TO\rlms-phase1-owner-ui-e-brc-email.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:typecheck-client-brc-email
npm run repair:smoke-brc-email
npm run repair:dev:local
```

---

## Apply §E Document Viewer (on tip `ba5dc51`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect ba5dc51…
git bundle verify PATH\TO\rlms-phase1-owner-ui-e-document-viewer.bundle
git pull PATH\TO\rlms-phase1-owner-ui-e-document-viewer.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:typecheck-client-documents
npm run repair:smoke-documents
npm run repair:dev:local
```

---

## Apply wreck DV panel (on tip `cfd1028`)

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD   # expect cfd1028…
git bundle verify PATH\TO\rlms-phase1-owner-ui-wreck-dv.bundle
git pull PATH\TO\rlms-phase1-owner-ui-wreck-dv.bundle HEAD
git push -u origin cursor/repair-module-phase1-4199
```

If still on **`dc704f1`**, apply hotfix first → **`cfd1028`**, then this DV bundle.

Then:

```powershell
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
npm install
npm run repair:migrate:local
npm run repair:typecheck-client-wreck
npm run repair:smoke-wreck
npm run repair:dev:local
# http://127.0.0.1:5000/#/repair/wreck/<wreckEventId>
```

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
- **Wreck:** Spec approved; §11 #1/#4/#10 DECIDED. Build bundle on `85856b6` — see tip table.
- Screen E document polish / Screen F Lessee after §D sign-off.
