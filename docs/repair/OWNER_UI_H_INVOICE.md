# Owner UI — Sub-section H: Invoice review + shop payment

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md)  
**Routes:** `/#/repair/invoices` · `/#/repair/invoices/:id`  
**Requires tip:** `c5bad2a` (§G r5)

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

- Side-by-side approved estimate lines vs invoice lines (match **line# + job code**).
- Highlight: added / removed / qty-price changed / not on approved estimate.
- Validation (same engine): AAR pricing current for account date, invoice no. required, CID flags cleared, totals reconcile to the cent.
- Within tolerance → **Approve** enabled. Over → owner/MP approval with reason.
- Actions (audited): **Approve**, **Reject** with line comments (back to shop), **Short-pay** (lesser amount, reason per line).
- Resp split: owner vs lessee (6) vs damaging road (3) — rebill queued **Rebill pending** (next phase).

## Shop payment

- Approve → **Payable**, due date = approval + net terms.
- Payment batch: select payables → create batch → export CSV → mark **Exported**. Record paid (date, check/ACH ref) manually.
- Statuses: Payable → In Batch → Exported → Paid. Short-paid shown via `short_pay_cents`.
- Shop sees own invoice status + paid date/ref only.
- **BO Closed** only when invoice Approved (Payable or later).

## §G carryovers

- **Missed POD** tile restored (counts BOs past POD, alongside base stored status).
- Closed BO shows **Closed** in bad-order list (never blank).

## Seed DS01

Smoke creates: within tolerance, over (with reason), added-line reject, short-pay, batch export, paid. Seed/smoke does **not** modify tracked files.

```powershell
npm run repair:migrate:local
npm run repair:typecheck-client-invoice
npm run repair:smoke-invoice
npm run repair:smoke-shop   # prior still passes
```

Integer cents. Local Postgres. Append-only. No real payments / no Adapter.
