# Owner UI — Sub-section G: Shop portal + Railinc-style validation

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §G  
**Routes:** `/#/repair/shop` · `/#/repair/shop/events/:eventId` · `/#/repair/shop/estimates/:id`  
**Requires tip:** `85199a7` (§G initial) for **r2**; prior initial required `9296477` (§F r3)

## §G r2 — Shop clarity + review aids

| Area | Behavior |
|---|---|
| **AA contrast** | Shop portal / BO / estimate / documents / admin labels ≥4.5:1 (`slate-700`+); values near-black. Smoke checks tokens + forbids pale `slate-400/500` on shop pages. |
| **Navigation** | Breadcrumbs `Shop home > Bad Order <car> > Estimate rev N > Documents`. Documents + drill-ins: `← Back to <source>` via `returnTo` / `returnLabel` (fallback: browser history). |
| **BO lifecycle dates** | Arrival, Inspected, Estimate submitted, Owner approval, Repair start, POD, Completed, Released/Outbound. Shop edits: arrival, POD (reason on change), missed POD reason, completed/outbound. Owner edits all. Audited. |
| **POD history** | Append-only: old → new, reason code + note, who, when. Missed POD reason **required** when today > POD and not released. Codes in Reference Data (`missed_pod_reasons`). |
| **Status timeline** | Open → Estimate Pending → Under Owner Review → Rejected/Adjustment → Approved → In Repair → Completed → Closed (Invoiced). Each step: meaning + who acts next. Closed only after completed + invoice. |
| **Flags panel** | What / line / blocks completion? / who clears. Approved + open blocking flags: “Approved – N flags block completion/invoicing”. |
| **Shop KPIs** | Missed POD count; Avg days arrival → approval. |
| **Owner comments** | Per-line + estimate-level on reject/adjust. Shop sees inline under lines (line#+code); empty → “no change requested”. Outbox lists by line; shop BRC PDF comments by line#. Resubmit `commentDiff` + owner resolve. |
| **Dev aids** | `npm run repair:seed-shop-demo` — Demo Shop **DS01**, OPEN BO, samples under `modules/repair/dev/shop-samples/`, Rejected/Approved+flags/Missed POD/Closed. DEV role switcher banner (Owner / MP / Shop / Lessee) when local review. |

```powershell
npm run repair:seed-shop-demo
npm run repair:typecheck-client-shop
npm run repair:smoke-shop
```

## Shop portal (shop role, own shop mark)

Scoped by `x-repair-shop-mark` (and optional `x-repair-shop-id`). Cross-shop → **403**.

| Surface | Behavior |
|---|---|
| Home | BOs assigned to shop; estimates by status (Draft, Submitted, Rejected, Adjustment for Approval, Approved, Completed); search car initial/number |
| BO detail | Car; **lessee hidden**; owner instructions; arrival date; JIC clock for wrecks; §E viewer **shop mode** (view+add, never void) |
| Submit estimate | **Upload 500-byte** or **hand-entry grid** (open-Q default **b: BOTH**); parse preview (header+lines); validate; submit |
| Withdraw | Allowed while Submitted (**AWAITING_APPROVAL**) until owner review starts (open-Q default **a**) |
| Revisions | Resubmit after reject/adjustment → new revision + **diff** vs prior |
| Downloads | Shop BRC PDF (no DV/internal) + own data file |

## Validation engine (stub Railinc)

Interface: `RailincValidator` in `modules/repair/services/railinc-validator.ts`.  
Default: **`StubRailincValidator`** — **no live Railinc calls**. Swap later via `getRailincValidator()` / `REPAIR_RAILINC_VALIDATOR=live` when a Live client exists.

### Hard reject (file not loaded) {#hard-reject}

| Code | Rule |
|---|---|
| `BAD_SOURCE_CODE` | Invalid/missing Detail Source |
| `UNPARSEABLE` | Bad parse / length ≠ 500 |
| `MISSING_CRITICAL_HEADER` | Car initial/number, billing party, or shop mark blank |
| `PRICE_NOT_CURRENT` | Job pricing not current for account-date quarter (when price master row exists) |
| `CAR_NOT_IN_VCF` | Car not in VCF |
| `MIXED_WRECK` | Mixed Resp 3 / non-3 file |

### Accept + flag {#accept-flag}

| Code | Rule |
|---|---|
| `MISSING_CID` | Missing CID — blocks completed date / invoicing; owner/MP clear only |
| `UNKNOWN_QUALIFIER` | Unknown qualifier/code (when ref table populated) |
| `QTY_PRICE_OFF_TABLE` | Qty/price off table |
| `MISSING_INVOICE_NO` | Flag on estimate; **HARD REJECT** on final invoice |
| `UNPRICED_LABOR_RATE` | Unpriced not at quarterly AAR labor rate |

Every rule: `code`, `message`, `severity`, `ref_link` — catalog in `repair.validation_rules` (Reference Data admin). Results stored per revision (`estimate_validation_runs` / `estimate_validation_findings`); shown to shop on submit and owner in Estimate Review / `GET …/validation`.

## Notifications (local outbox only)

Types: `ESTIMATE_RECEIVED`, `ESTIMATE_REJECTED` (with reasons), `ESTIMATE_ADJUSTMENT_REQUESTED`, `ESTIMATE_APPROVED`.  
Shop recipients = **email LIST** (`shops.portal_notify_emails` + shop contacts + default inbox) — open-Q default **c**. Writes `repair.email_outbox` + `notifications_log` (never real SMTP).

## Permissions

Shop never sees other shop’s data, lessee info, DV/settlement docs. Cross-shop and foreign estimate → **403**.

## Smoke / typecheck

```powershell
npm run repair:typecheck-client-shop
npm run repair:smoke-shop
```

Covers: good file load; each hard-reject; each flag class; mixed wreck rejected; resubmit → rev 2 + diff; cross-shop 403; totals reconcile (integer cents); **r2** AA/axe, returnTo, POD reason+history, missed POD, timeline, line comments, commentDiff+resolve, role-switcher 403s.

## Open Q defaults (until Bruce answers)

| Q | Default |
|---|---|
| a) Shop withdraw submitted? | **YES** until owner review starts |
| b) Hand entry OR upload? | **BOTH** |
| c) Shop email recipients? | **LIST** (not single contact) |

Integer cents. Append-only findings. Repair schema only.
