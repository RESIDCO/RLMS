# Owner UI — Sub-section H: Invoice review + shop payment

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)  
**Routes:** `/#/repair/invoices` · `/#/repair/invoices/:id` · `/#/repair/payments`  
**Requires tip:** `ebf9400` (§H) → r2 FF

## Defaults (open Q)

| Q | Decision |
|---|---|
| Tolerance | Both **$** and **%** — default **$0 / 0%** (per entity, `*` row) |
| Payment terms | **Net 30** from invoice approval |
| AP export | **Generic CSV** placeholder (documented columns; no accounting API) |

## Owner invoice queue

Every **Invoice Submitted** (and later payment statuses): car, shop, invoice no., invoice date, amount, approved estimate amount, difference ($ and %), flags, age days.  
Filters: shop, status, age, amount over estimate.

## Invoice review

- Side-by-side **APPROVED** estimate revision vs invoice lines.
- Match: **line number** first, then **job code + location + qualifier** fallback.
- Identical invoice → **0** differences (no `LINE_ADDED` / `LINE_REMOVED`).
- Highlight: added / removed / qty-price changed / not on approved estimate.
- Validation (same engine): AAR pricing current for account date, invoice no. required, CID flags cleared, totals reconcile to the cent.
- Within tolerance → **Approve** enabled. Over → owner/MP approval with reason.
- Actions (audited): **Approve**, **Reject** with line comments (back to shop), **Short-pay** (lesser amount, reason per line).
- Resp split: owner vs lessee (6) vs damaging road (3) — rebill queued **Rebill pending** (next phase).

## Shop payment `/#/repair/payments`

- Approve → **Payable**, due date = approval + net terms.
- Payables list with checkboxes → **Create batch** → **Download CSV / Mark exported** → **Record paid** (ISO date + check/ACH ref).
- Batch history with drill-in.
- CSV columns: `batch_no,invoice_no,shop_mark,car,amount_dollars,amount_cents,due_date,short_pay_cents,currency`
  - Dates: **ISO YYYY-MM-DD** (with year)
  - Money: **2 decimals, no $**
- CSV also written to `modules/repair/dev/exports/payment-outbox/` (gitignored).
- Statuses: Payable → In Batch → Exported → Paid. Short-paid shown via `short_pay_cents`.
- Shop sees own invoice status + paid date/ref only.
- **BO Closed** only when invoice Approved (Payable or later).

## Clean + seed

- `repair:clean-smoke-data` also hides smoke invoices (`GA*`, `INV-R4*`, `INV-H-*`) and related payment batches.
- `repair:seed-shop-demo` / `repair:seed-invoice-examples`: idempotent `DEMO-INV-100005` (amount = approved estimate, never duplicate) plus DS01 examples:
  - `DEMO-INV-WITHIN` (0 diffs, ready to approve)
  - `DEMO-INV-OVER` (awaiting reason)
  - `DEMO-INV-ADDED` (added line)
  - `DEMO-INV-SHORT` (short-pay)
  - `DEMO-INV-PAID` (paid)

## §G carryovers

- **Missed POD** tile restored (counts BOs past POD, alongside base stored status).
- Closed BO shows **Closed** in bad-order list (never blank).

## Smoke

```powershell
npm run repair:migrate:local
npm run repair:typecheck-client-invoice
npm run repair:smoke-invoice
npm run repair:clean-smoke-data
npm run repair:seed-shop-demo   # twice → no DEMO-INV duplicates
npm run repair:smoke-shop       # prior still passes
```

Integer cents. Local Postgres. Append-only. No real payments / no Adapter.
