# Phase 1 review checklist (hand-test)

Use with draft PR https://github.com/RESIDCO/RLMS/pull/2 at tip **`4963628`+** (lifecycle 06).  
Prefer the automated walk first: `npm run repair:demo:local` (see [PHASE1_DEMO_WINDOWS.md](./PHASE1_DEMO_WINDOWS.md)).

For each row: do the action, then confirm the **Correct** column.

| # | Action | Correct looks like |
|---|---|---|
| 1 | Create BO for VCF car **OFOX 528313** at shop APA | Event created; shop link minted; status BO/Queued path; audit row |
| 2 | Open `/#/repair/e/:token` as shop — accept + on-hand / arrival | Shop can act; Queued leaves when yard/arrival rules say so |
| 3 | Load 500-byte with a **WARNING** (e.g. multi-car) | Status `PENDING_WARNINGS`; reviewer Accept → estimates loaded; Reject leaves rejected |
| 4 | Shop re-uploads OFOX sample (revision) | New revision; totals from file; compare works on review UI |
| 5 | Submit for approval → Approve | Estimate **Approved**; cents integer totals; OFOX2609 sample ≈ **$36,732.04** |
| 6 | Request Resp 6 lessee approval | Email logged (dev); recipients **exclude shop**; link `/#/repair/lessee/:token` shows **Resp 6 lines only** |
| 7 | Lessee Approve on link | Decision append-only; reviewers notified (`LESSEE_DECISION_RECEIVED`) |
| 8 | Shop enters POD + completed date | Complete locks estimate; docs still uploadable; rollback only reviewer/admin/fleet_manager |
| 9 | Relay dispo to shop | Dispo stored; shop notified; information-only |
| 10 | Shop uploads same 500-byte as **invoice** (`invoice-aar`) | Pre-pay checks run; `TOTAL_MATCH` PASS when totals equal approved estimate; `PENDING_REVIEW` |
| 11 | Reviewer `APPROVED_FOR_ACH` | Allowed only when MATCHED; `match_status` → `APPROVED`; MISMATCH → **409**, no override |
| 12 | Ready to Close | After MATCHED/APPROVED invoice **and** dispo: status `READY_TO_CLOSE`; reviewers notified |
| 13 | One-click Close | Status `CLOSED`; audited; **not** automatic |
| 14 | Monthly close for YYMM | Local `CRIPYYMM…` file; validation OK; events billing-locked; rebuttal rows created |
| 15 | Missing billed-party mapping | Monthly close **422** / blocked until mapping restored |
| 16 | Void estimate + admin restore | VOIDED hidden; shop link locked; restore audited; **no hard delete** |
| 17 | Tank gate (RESIDCO) | Default **OFF**; outbound not blocked for ordinary cars |
| 18 | Phase 2 stub | `POST /api/repair/phase2/crop-import` → **501** |
| 19 | Host isolation | Diff outside `modules/repair` is only App/pages/routes(+10)/package/tsconfig/gitignore/backup script |
| 20 | Safety | No prod Supabase apply; no merge/deploy; secrets not logged |

### Quick “green” signal

`npm run repair:demo:local` exits 0 and writes:

- `modules/repair/dev/demo-output/step-log.json` (steps, links, emails)
- `modules/repair/dev/demo-output/CRIP….txt` (or similar `CRIPYYMM` name)

Optional smokes (already landed):  
`repair:smoke-lifecycle-06`, `repair:smoke-inbound-invoice`, `repair:smoke-monthly-close`, `repair:smoke-ready-to-close`.
