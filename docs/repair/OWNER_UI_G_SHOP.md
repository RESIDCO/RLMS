# Owner UI — Sub-section G: Shop portal + Railinc-style validation

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §G  
**Routes:** `/#/repair/shop` · `/#/repair/shop/events/:eventId` · `/#/repair/shop/estimates/:id` · `/#/repair/e/:token`  
**Requires tip:** r3 tip (`cbff463`) for **r4**; r3 required `bb837ae` (§G r2)

## §G r4 — Shop BO signed-link workflow + status tiles + invoice upload

| Area | Behavior |
|---|---|
| **One signed shop link / BO** | Scoped to shop mark + BO; reusable until close (`ensureShopBoLink`). Page shows **next action** for current step. |
| **Confirm** | Accept assignment, or Decline with reason (owner notified via local outbox). Records who/when. |
| **On hand** | Arrival date/time required; optional yard/track note. Starts JIC/POD clocks. |
| **Estimate** | Existing 500-byte + photos/docs validate/submit. Draft = loaded not submitted. |
| **After approval** | Set POD, repair start, completed date. |
| **Invoice** | Upload final invoice **500-byte + PDF**; invoice # required. Validate vs approved estimate (totals + line/qty placeholder; hard reject / flag). Workflow: Invoice Submitted → Under Owner Review → Accepted / Rejected (line comments). Owner sees invoice read-only on Estimate Review. |
| **Status tiles** | Clickable filters: Awaiting Confirmation, Awaiting Arrival, On Hand / No Estimate, Draft, Submitted, Rejected, Adjustment for Approval, Approved / In Repair, Missed POD, Invoice Due, Invoice Submitted, Closed. |
| **Timeline** | Includes **Confirmed** and **On Hand**. **Closed requires accepted invoice**. |

```powershell
npm run repair:migrate:local
npm run repair:typecheck-client-shop
npm run repair:smoke-shop
```

## §G r3 — Inputs contrast, closed-BO clarity, seed fix

| Area | Behavior |
|---|---|
| **Form inputs AA** | Every input/select/date/textarea in shop portal: **white** bg, near-black text, placeholder ≥4.5:1 (`slate-600` on white), gray border, clear focus ring. No dark/black input fills (`shopAa.input` / `select` / `textarea`). Date pickers `color-scheme: light`. Smoke: placeholder contrast + axe forbids pale labels / dark fills. |
| **Closed BO clarity** | Shop home + BO detail: status timeline position + one-line reason e.g. `Closed: repair completed 10/14 and invoiced INV#### on 10/15` or `Closed: cancelled by owner (reason)`. Closed with open flags / missing completed / missing invoice → red **Inconsistent state**. State machine: `closeEvent` / `markBadOrderClosed` require completed + invoice + no blocking flags. |
| **Smoke residue** | Smoke shops/BOs tagged `is_smoke`; hidden from normal lists (unless `REPAIR_SHOW_SMOKE=1`). `npm run repair:clean-smoke-data` (local DB only). |
| **Seed hard-fail** | `repair:seed-shop-demo` drives real transitions; **exit 1** unless DEMO **100001** Open, **100002** Rejected w/ line comments, **100003** Approved w/ flags, **100004** Missed POD, **100005** Closed (completed+invoiced). IDs written to gitignored `modules/repair/dev/shop-demo-ids.local.json`. |
| **Owner/MP shop view** | Owner and managing partner open shop pages **read-only** (“Viewing as shop DS01”); mutations 403. Other shops / lessee still 403. |
| **DEV role banner** | Only when non-production (`!import.meta.env.PROD`) and local-review/dev. Production builds have no role switcher. |

```powershell
npm run repair:seed-shop-demo
npm run repair:typecheck-client-shop
npm run repair:smoke-shop
npm run repair:clean-smoke-data   # optional; local only
```

## §G r2 — Shop clarity + review aids

| Area | Behavior |
|---|---|
| **AA contrast** | Shop portal / BO / estimate / documents / admin labels ≥4.5:1 (`slate-700`+); values near-black. |
| **Navigation** | Breadcrumbs `Shop home > Bad Order <car> > Estimate rev N > Documents`. `← Back to <source>` via `returnTo` / `returnLabel`. |
| **BO lifecycle dates** | Arrival, Inspected, Estimate submitted, Owner approval, Repair start, POD, Completed, Released/Outbound. |
| **POD history** | Append-only: old → new, reason code + note, who, when. Missed POD reason **required** when today > POD and not released. |
| **Status timeline** | Open → … → Closed (Invoiced). Each step: meaning + who acts next. |
| **Flags panel** | What / line / blocks completion? / who clears. |
| **Shop KPIs** | Missed POD count; Avg days arrival → approval. |
| **Owner comments** | Per-line + estimate-level on reject/adjust. Resubmit `commentDiff` + owner resolve. |
| **Dev aids** | `npm run repair:seed-shop-demo` — Demo Shop **DS01**. DEV role switcher when local review (r3: production-gated). |

## Shop portal (shop role, own shop mark)

Scoped by `x-repair-shop-mark` (and optional `x-repair-shop-id`). Cross-shop → **403**. Owner/MP → **read-only** (r3).

| Surface | Behavior |
|---|---|
| Home | BOs assigned to shop (smoke hidden); estimates by status; search car; closed reason / inconsistent |
| BO detail | Car; **lessee hidden**; owner instructions; arrival; JIC; §E shop mode; lifecycle + closed clarity |
| Submit estimate | **Upload 500-byte** or **hand-entry** (shop write only) |
| Withdraw | While Submitted until owner review starts |
| Revisions | Resubmit after reject/adjustment → new revision + **diff** |
| Downloads | Shop BRC PDF + own data file (read-only roles may download) |

## Validation engine (stub Railinc)

Interface: `RailincValidator` in `modules/repair/services/railinc-validator.ts`.  
Default: **`StubRailincValidator`** — **no live Railinc calls**.

### Hard reject / Accept + flag

See r2 tables in prior HANDOFF; unchanged. Catalog in `repair.validation_rules`.

## Permissions

Shop never sees other shop’s data, lessee info, DV/settlement docs. Cross-shop → **403**. Owner/MP → read-only shop view for a chosen mark.

## Smoke / typecheck

```powershell
npm run repair:typecheck-client-shop
npm run repair:smoke-shop
```

Covers prior §G/r2 plus **r3**: input AA + placeholders, closed reason + inconsistent gate, smoke hide, owner/MP read-only, DEV banner PROD gate, seed hard-fail script checks.

Integer cents. Append-only findings. Repair schema only.
