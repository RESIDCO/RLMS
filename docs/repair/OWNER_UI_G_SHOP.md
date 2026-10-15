# Owner UI — Sub-section G: Shop portal + Railinc-style validation

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §G  
**Routes:** `/#/repair/shop` · `/#/repair/shop/events/:eventId` · `/#/repair/shop/estimates/:id`  
**Requires tip:** `9296477` (§F r3)

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

Covers: good file load; each hard-reject; each flag class; mixed wreck rejected; resubmit → rev 2 + diff; cross-shop 403; totals reconcile (integer cents).

## Open Q defaults (until Bruce answers)

| Q | Default |
|---|---|
| a) Shop withdraw submitted? | **YES** until owner review starts |
| b) Hand entry OR upload? | **BOTH** |
| c) Shop email recipients? | **LIST** (not single contact) |

Integer cents. Append-only findings. Repair schema only.
