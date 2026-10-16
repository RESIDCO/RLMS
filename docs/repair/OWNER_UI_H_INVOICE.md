# Owner UI — Sub-section H: Invoice review + monthly close + multi-car

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)  
**Routes:** `/#/repair/invoices` · `/#/repair/invoices/:id` · `/#/repair/payments` · `/#/repair/months` · `/#/repair/shop/multi-car-invoice`  
**Requires tip:** `ea48201` (§H r4) → r5 FF

## Defaults (open Q)

| Q | Decision |
|---|---|
| Tolerance | Both **$** and **%** — default **$0 / 0%** (per entity, `*` row) |
| Payment terms | **Net 30** from invoice approval |
| AP export | **Generic CSV** placeholder (documented columns; no accounting API) |
| Pay-cycle cutoff | **Replaced** by owner/MP **accounting month close** (no end-of-month auto-bucket) |

## Contrast (AA)

Invoice review, queue, payments, months: **white panels**, near-black text (`slate-900` / `slate-700` labels).  
Line table (BRC): **Line, Loc, Qty, C, AJOB, QA, Description, WM, RJOB, QR, Resp, Labor, Material, Amount** plus **Est amount** / **Inv amount**.  
Money as `$36,732.04`. Statuses as plain words (e.g. “Under owner review”).  
**Exceptions (N)** toggle — no long flag list; highlight only exception rows.

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

- Summary cards (Invoice / Approved estimate / Difference / Status) + resp split, then BRC line grid.
- Code reference hovers match Estimate Review. Amber/red/struck rows for exceptions; hover/expand shows reason.
- **Exceptions (N)** filter: all lines or exceptions only. Cleared/overridden flags → small badge (who/when), not a list.
- **Approve** / **Reject** / **Short-pay**. Line `short_pay_cents` = **shortfall** only when &gt; 0 (no $0 rows). Header shows short-pay + net payable.
- Multi-car: per-car summary (Car, Estimate, Invoiced, Difference, Exceptions, plain status) → car picker shows **one car’s** BRC grid.

## Multi-car invoice

Shop **Create multi-car invoice**: select **two or more** Completed estimates (same shop, same billing entity; **no cap** on cars); one 500-byte + PDF; one invoice number.  
500-byte split by each record’s car initial+number; each selected car must appear; unselected car in file or selected car missing → **HARD REJECT** naming the car.  
Also: car on only one active invoice; mix Resp-3 wreck with others **HARD REJECT**; total mismatch **HARD REJECT**.  
Payment pays invoice once; each car’s BO closes on approval.

## Shop payment `/#/repair/payments`

- After **Month Closed**, invoices are AP-eligible → Create batch → CSV → Sent to AP → Record paid.
- CSV columns: `batch_no,invoice_no,shop_mark,car,amount_dollars,amount_cents,due_date,short_pay_cents,currency` (ISO dates; money 2dp no `$`).
- Outbox: `modules/repair/dev/exports/payment-outbox/`.

## Clean + seed

- `repair:clean-smoke-data` hides `GA*`, `INV-R4*`, `INV-H-*`, **`APA-%`** (prefix + APA shop), renamed **`DEMO-INV-UNIT5`**, and **stale DEMO-*** invoices/events.
- `repair:seed-shop-demo` (idempotent ×2): DEMO 100005 closed via approved invoice; **DEMO-INV-SHORT** total **$36,732.04** with **$747.50** short across **2** lines (no $0 short-pay rows); **5-car multi-car** `DEMO-INV-MULTI` with varied amounts + one exception; open month **2026-10**; Paid in closed **2026-09**. Smokes/seeds never leave future months open.

## Smoke

```powershell
npm run repair:migrate:local
npm run repair:typecheck-client-invoice
npm run repair:smoke-invoice
npm run repair:clean-smoke-data
npm run repair:seed-shop-demo   # twice → no DEMO-INV duplicates
```

Integer cents. Local Postgres. Append-only. No real payments / no Adapter.
