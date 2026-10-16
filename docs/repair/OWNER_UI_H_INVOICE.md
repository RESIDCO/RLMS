# Owner UI — Sub-section H: Invoice review + monthly close + multi-car

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)  
**Routes:** `/#/repair/invoices` · `/#/repair/invoices/:id` · `/#/repair/payments` · `/#/repair/months` · `/#/repair/shop/multi-car-invoice`  
**Requires tip:** `81a3d3e` (§H r2) → r3 FF

## Defaults (open Q)

| Q | Decision |
|---|---|
| Tolerance | Both **$** and **%** — default **$0 / 0%** (per entity, `*` row) |
| Payment terms | **Net 30** from invoice approval |
| AP export | **Generic CSV** placeholder (documented columns; no accounting API) |
| Pay-cycle cutoff | **Replaced** by owner/MP **accounting month close** (no end-of-month auto-bucket) |

## Contrast (AA)

Invoice review, queue, payments, months: **white panels**, near-black text (`slate-900` / `slate-700` labels).  
Line table headers: **Line, Job, Match, Change, Est amount, Est qty, Inv amount, Resp**.  
Money as `$36,732.04`. Statuses as plain words (e.g. “Under owner review”).

## Status flow (approval ≠ paid)

Invoice Submitted → Under Owner Review → **Approved – In Open Month** → **Month Closed** → **Sent to AP** → **Paid** (only when payment date + check/ACH ref recorded).

Shop sees: “Approved – scheduled with \<month\> close”, then “Paid \<date\> ref \<ref\>”.

## Accounting months `/#/repair/months`

- One **OPEN** month at a time. Approved invoices land in the open month with frozen car/lease snapshot.
- Owner/MP closes when ready (review totals by shop + by resp owner/lessee6/road3) → confirm.
- Close freezes month (read-only, audited); later approvals → next month.
- Reopen: owner-only with reason.
- Placeholders: CRB received, lessee rebill output (later phase). Show **Lessee rebill pending** and **Road rebill pending** totals now.

## Invoice review

- Side-by-side **APPROVED** estimate revision vs invoice lines (line# then job+location+qualifier).
- **Approve** / **Reject** / **Short-pay**.
- Short-pay: line `short_pay_cents` = **shortfall** (not paid amount). Header shows **short-pay amount** and **net payable**.
- Multi-car: per-car summary (car, estimate, invoiced, difference, flags) → drill-in; approve all or reject/short-pay at line or car level.

## Multi-car invoice (unit trains / bulk)

Shop **Create multi-car invoice**: select several Completed estimates (same shop, same billing entity); one 500-byte + PDF; one invoice number.  
Split per car; match each car’s lines to that car’s approved estimate; header total = sum of cars.  
Rules: car on only one active invoice; mix Resp-3 wreck with others **HARD REJECT**; total mismatch **HARD REJECT**.  
Payment pays invoice once; each car’s BO closes on approval.

## Shop payment `/#/repair/payments`

- After **Month Closed**, invoices are AP-eligible → Create batch → CSV → Sent to AP → Record paid.
- CSV columns: `batch_no,invoice_no,shop_mark,car,amount_dollars,amount_cents,due_date,short_pay_cents,currency` (ISO dates; money 2dp no `$`).
- Outbox: `modules/repair/dev/exports/payment-outbox/`.

## Clean + seed

- `repair:clean-smoke-data` hides `GA*`, `INV-R4*`, `INV-H-*`, and legacy **`APA-OFOX528313`**.
- `repair:seed-shop-demo` (idempotent ×2): DEMO 100005 closed via approved invoice; DS01 invoice examples; **5-car unit-train** `DEMO-INV-UNIT5`; one month/batch.

## Smoke

```powershell
npm run repair:migrate:local
npm run repair:typecheck-client-invoice
npm run repair:smoke-invoice
npm run repair:clean-smoke-data
npm run repair:seed-shop-demo   # twice → no DEMO-INV duplicates
```

Integer cents. Local Postgres. Append-only. No real payments / no Adapter.
