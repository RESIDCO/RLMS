# Owner UI — Sub-section H: Invoice review + monthly close + multi-car

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)  
**Routes:** `/#/repair/invoices` · `/#/repair/invoices/:id` · `/#/repair/payments` · `/#/repair/months` · `/#/repair/shop/multi-car-invoice`  
**Requires tip:** `834ee37` (§H r7) → r8 FF (test fixes)

## Defaults (open Q)

| Q | Decision |
|---|---|
| Tolerance | Both **$** and **%** — default **$0 / 0%** (per entity, `*` row) |
| Payment terms | **Net 30** from invoice approval |
| AP export | **Generic CSV** placeholder (documented columns; no accounting API) |
| Pay-cycle cutoff | **Replaced** by owner/MP **accounting month close** (no end-of-month auto-bucket) |

## Contrast (AA) — shared repair theme (§H r7)

**One shared token set** (`--repair-*` in `client/src/index.css`, `repairTokens.ts` / `repairUi` / `shopAa`). Covers text, muted, surfaces, borders, inputs, primary/secondary/disabled buttons, checkboxes, badges, row highlights.  
**Light-only** for owner repair (`REPAIR_LIGHT_ONLY`) — sun toggle cannot put pages into a half-dark washout state.  
Invoice queue: disabled **Create batch + export CSV** = light gray + ≥4.5:1 text + hint **Select invoices first**; light checkboxes with visible check; full page uses `--repair-bg` (no dark gutter).  
Amber highlight = light row tint with dark text. Readable **Review** buttons.  
Line table (BRC): **Line, Loc, Qty, C, AJOB, QA, Description, WM, RJOB, QR, Resp, Labor, Material, Amount** plus **Est amount** / **Inv amount**.  
Money as `$36,732.04` (commas). Statuses as plain words (e.g. “Under owner review” — never `UNDER_OWNER_REVIEW` in the filter).  
**Exceptions (N)** toggle — no long flag list; highlight only exception rows.  
**Guardrails:** `npm run repair:lint-colors` fails on hard-coded hex in repair client files (self-test catches `#000000`). Axe smoke sweeps **every** repair route page + disabled/checkbox AA ratios. Future bundles fail if contrast fails.

## Status flow (approval ≠ paid)

Invoice Submitted → Under Owner Review → **Approved – In Open Month** → **Month Closed** → **Sent to AP** → **Paid** (only when payment date + check/ACH ref recorded).

Shop sees: “Approved – scheduled with \<month\> close”, then “Paid \<date\> ref \<ref\>”.

## Accounting months `/#/repair/months`

- One **OPEN** month at a time. Approved invoices land in the open month with frozen car/lease snapshot.
- Owner/MP closes when ready (review totals by shop + by resp owner/lessee6/road3) → confirm.
- Close freezes month (read-only, audited); later approvals → next month.
- List shows **open month + past months only** — empty future months (e.g. 2026-11 / 2026-12 / 2027-01) from old runs are soft-deleted by clean/seed.
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
