# Phase 1 walkthrough — RLMS Repair Module

**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2  
**Branch:** `cursor/repair-module-phase1-4199` → `master`  
**Tip this package documents:** `4963628` (lifecycle 06 / MG1–MG4) plus the review-package commit on top  
**Scope:** `modules/repair/` + `repair` schema + minimal host wire-up only  
**Do not merge or deploy.** Local Postgres only. No Supabase branch. No paid services.

Related: [PHASE1_DEMO_WINDOWS.md](./PHASE1_DEMO_WINDOWS.md) · [PHASE1_REVIEW_CHECKLIST.md](./PHASE1_REVIEW_CHECKLIST.md)

---

## What Phase 1 is

A repairSMART replacement **inside** RLMS: bad orders → shop estimate (500-byte) → review/approve → Resp 6 lessee approval → POD/completion/dispo → shop invoice + pre-pay audit → Ready to Close → monthly close with local `CRIPYYMM` export and rebuttal billing. Retention is soft-delete / VOIDED+restore only.

Actors:

| Actor | How they act |
|---|---|
| **Admin / reviewer / fleet** | Logged-in RLMS UI (`/#/repair`, `/#/repair/estimates/:id`) + authed APIs |
| **Shop** | Login-free shop event link `/#/repair/e/:token` |
| **Lessee** | Login-free lessee link `/#/repair/lessee/:token` (Resp 6 only; shop never CC’d) |

Dev email = `LogEmailProvider` (console + `repair.notifications_log`). No real send.

---

## Area-by-area

### 1. Bad orders

**What:** Create a BO event for a VCF car, optionally assign a shop, issue a shop link.

**Screens / routes**

- UI: `/#/repair` (`RepairHome`) — create BO, mint shop link  
- API: `POST /api/repair/bad-orders`, `POST /api/repair/events/:id/links`, bulk BO helpers under authed routes  
- Shop: `/#/repair/e/:token` — ack / decline / arrival / on-hand (Queued gate)

**Who:** Admin/reviewer (authed). Shop acts on the link.

**Notifications:** `BO_CREATED` (via `notify()`; recipients from contact bank / rules when configured). Shop lifecycle emails use shop contact when present.

---

### 2. Estimate intake / statuses

**What:** Load immutable 500-byte AAR files; ERRORS block; WARNINGS → owner accept/reject; Revision vs Adjustment (post-Approved → Adjustment); statuses through Queued → Awaiting Approval → Approved → … → VOIDED.

**Screens / routes**

- UI: `/#/repair/estimates/:id` (`EstimateReview`) — review, submit, approve, internal correction (MG1)  
- Shop link: upload estimate / load AAR  
- API: `POST /api/repair/estimates/load-aar`, shop `…/e/:token/...`, warning decide, void/restore, internal correction

**Who:** Shop uploads via link. Reviewer/admin reviews and decides warnings. Internal line edits = admin/reviewer only (shops re-upload).

**Notifications:** `ESTIMATE_LOAD_WARNINGS`, `ESTIMATE_INTERNAL_CORRECTION` (shop notified on MG1 save). Status transitions audited in `repair.audit_events`.

---

### 3. Shop link + OTP

**What:** Tokenized shop event link. Per-shop `shops.settings.otpSteps` (default **off**). Optional OTP on `invoice_submit` and optional `completed_date`.

**Screens / routes**

- `/#/repair/e/:token` — accept, on-hand, estimate upload, POD/ERD, completed date, invoice, docs  
- API under `/api/repair/e/:token/*`; OTP challenge tables `step_otp_challenges`

**Who:** Shop only (public routes). Reviewer opens the same event from auth UI.

**Notifications:** `INVOICE_OTP` when OTP enabled for that step.

---

### 4. Lessee Resp 6 approval

**What:** Email lessee the Resp 6 portion only; approve/reject via link (primary) or email reply + reviewer confirm. Shop hard-excluded.

**Screens / routes**

- `/#/repair/lessee/:token` (`LesseeApproval`)  
- API: send approval, decide via token, ingest reply, reviewer confirm  
- Trigger from estimate review UI (“request lessee approval”)

**Who:** Reviewer sends. Lessee decides on link. Reviewer confirms email-reply channel.

**Notifications:** `RESP6_LESSEE_EMAIL` / `LESSEE_ESTIMATE_APPROVAL` (include lessee + ad hoc; **exclude shop**), `LESSEE_DECISION_RECEIVED`.

---

### 5. Completion / dispo / POD

**What:** Append-only POD/ERD dates; completed date locks estimate (rollback by reviewer/admin/fleet_manager); dispo is information-only relay (`to_shop` / `from_shop`).

**Screens / routes**

- Shop link: POD/ERD + completed date  
- Auth UI / APIs: dispo relay, rollback complete, POD reminder job (`runPodReminders`, default 5 days after approval)

**Who:** Shop enters POD/complete. Fleet/reviewer relays dispo. Reviewer rolls back complete.

**Notifications (Q13 defaults, editable in `notification_rules`):**

| Type | Default recipients |
|---|---|
| `POD_DUE` | shop (+ event link) |
| `POD_MISSED` | shop + reviewers |
| `POD_REVISED` | internal reviewers only |
| `EVENT_COMPLETE` / `EVENT_COMPLETE_ROLLBACK` | shop, owners, lessee, ad hoc, reviewers |
| `DISPO` | shop (+ ad hoc) |

---

### 6. Ready to Close

**What:** **No auto-close.** When invoice `match_status` is `MATCHED` or `APPROVED` **and** dispo exists (event `COMPLETE` or `IN_REPAIR`) → `READY_TO_CLOSE` + notify. Reviewer one-click `CLOSED` (audited).

**Screens / routes**

- `/#/repair` close helpers; `POST /api/repair/events/:id/ready-to-close`, `POST /api/repair/events/:id/close`

**Who:** System marks Ready to Close; reviewer/admin/fleet_manager closes.

**Notifications:** `READY_TO_CLOSE` (reviewers), `EVENT_CLOSED`.

---

### 7. Inbound invoice + pre-pay audit

**What:** Shop uploads 500-byte invoice via link (or dev inbound email). Parse/validate; append-only `invoice_prepay_checks`; human `APPROVED_FOR_ACH` or `REJECTED`. Q18 blank invoice_no → synthetic key + WARN. Q19 hard dup / soft scope. Q20: MISMATCH cannot ACH (no override).

**Screens / routes**

- Shop: invoice AAR upload on event link  
- Auth: prepay queue / checks / decision / re-audit / set invoice_no  
- Dev inbound: `POST /api/repair/public/inbound-dev`

**Who:** Shop uploads. Reviewer audits.

**Notifications:** `INVOICE_PREPAY_REVIEW`, `INVOICE_REJECTED_TO_SHOP`, `INVOICE_LOADED` (simple invoice path).

---

### 8. Monthly close + CRB export

**What:** Collect `CLOSED` events with unlocked Resp 6/3 lines; bill only at close; write local `CRIPYYMM…` (formats 1/6/8/9); stamp account month; lock events. **No FTP.** Export blocked if billed-party mapping or `carOwnerMark` missing.

**Screens / routes**

- API: `POST /api/repair/billing/monthly-close`  
- Files: `modules/repair/dev/exports/` (gitignore) or demo out dir

**Who:** Reviewer / billing role via authed API.

**Notifications:** none required for the file write; audit via `close_runs` / `crb_export_files`.

**Mark rules (Q14–Q17):** inbound shop file billing=shop / billed=owner; outbound rebuttal billing=`tenants.settings.carOwnerMark`, billed=`billed_party_mappings`.

---

### 9. Rebuttal billing

**What:** At monthly close, bulk `rebuttal_invoices` + `billing_lines` for Resp 6 (lessee) / Resp 3 (railroad). Unlocked items roll to next close.

**Who:** Created by monthly close run (system + closing actor).

**Notifications:** contact email captured on group when lessee contact exists; sending of customer invoices beyond CRIP file is Phase 1 local/dev only.

---

### 10. Retention / void / restore

**What:** Never hard-delete business records. VOIDED hides estimate + locks shop link; admin restore (audited). Soft-delete/restore for attachments and comments (MG2).

**Screens / routes**

- Void/restore APIs on estimates, documents, comments  
- List voided: `GET /api/repair/estimates/voided`

**Who:** Reviewer voids; admin restores.

**Notifications:** none dedicated; audit actions `ESTIMATE_VOIDED` / `ESTIMATE_RESTORED`.

---

## Host files changed **outside** `modules/repair`

| File | Why |
|---|---|
| `client/src/App.tsx` | Register repair pages; allow `/repair/e/*` and `/repair/lessee/*` without auth gate |
| `client/src/pages/repair/*.tsx` | Overlay UI: home, shop link, estimate review, lessee approval (lives under `client/` by RLMS convention) |
| `server/routes.ts` | **+10 lines only:** import + `registerRepairPublicRoutes` / `registerRepairAuthedRoutes` (monolith restored from master) |
| `package.json` / `package-lock.json` | `pg` + `@types/pg`; `repair:*` scripts (migrate, smokes, demo) |
| `tsconfig.json` | Include `modules/**/*` |
| `.gitignore` | Local repair storage, backups, CRB/demo exports |
| `scripts/backup-repair-dev.sh` | Dev-only `pg_dump` / restore for **`repair` schema** |

No edits to existing RLMS tables, views, or auth beyond read-only views defined **inside** repair migrations.

---

## Full `repair` schema

### Tables (purpose)

| Table | Purpose |
|---|---|
| `tenants`, `users`, `user_roles` | Module tenant + role stubs (separate from RLMS auth) |
| `statuses`, `status_transitions` | Configurable status machine |
| `audit_events` | Append-only audit |
| `shops`, `contacts`, `event_adhoc_emails` | Shops + contact bank + per-event emails |
| `notification_rules`, `notifications_log`, `user_email_prefs`, `reminder_fires` | Notify matrix, log, opt-out, POD reminders |
| `events`, `event_tracks`, `bad_orders`, `event_links` | BO / event / tokenized links |
| `estimates`, `estimate_revisions`, `estimate_lines` | Estimates (cents integer) |
| `estimate_load_*` | 500-byte load runs / findings / decisions / per-car apply |
| `documents`, `attachment_categories`, `attachment_allowed_types` | Files + categories + allowlist |
| `comments` | Threaded comments (soft-delete) |
| `pod_dates`, `dispo`, `invoices`, `invoice_*` | POD, dispo, invoices, prepay, multi-estimate links |
| `step_otp_challenges` | Optional shop OTP |
| `lessee_approvals`, `lessee_approval_decisions` | Resp 6 workflow (append-only decisions) |
| `repair_categories`, `why_made_codes`, `responsibility_codes` | Catalog seeds |
| `aar_layout_*`, `aar_files`, `aar_raw_lines` | Versioned 500-byte layout + raw |
| `tank_doc_*` | Tank doc packets/decisions (gate **OFF** for RESIDCO by default, MG3) |
| `outbound_bulk_*`, `monthly_bill_*` | Outbound bulk + bill summary stubs |
| `billing_periods`, `close_runs`, `close_run_events`, `billing_lines`, `rebuttal_invoices`, `crb_export_files` | Monthly close + CRIP |
| `billed_party_mappings`, `billed_party_mapping_history` | Q15 mapping (append-only history) |

### What reads RLMS (read-only)

| Object | Reads |
|---|---|
| **View `repair.cars_ref`** | `public.railcars` + `public.v_valid_export_rows` (VCF membership). **No public DDL** in module migrations. |
| Integration helpers | Same view / VCF checks for car validation |

Local empty DB: `modules/repair/dev/local-public-stubs.sql` creates minimal public stubs (**never against prod**).

---

## Known limits / polish left / Phase 2 hooks

**Known limits (Phase 1)**

- Email/storage are local/dev adapters (no Postmark/S3 Object Lock yet)  
- Cover-sheet / Excel/PDF BRC export / bill-summary polish thin  
- Notification admin UI and full status-matrix UI are minimal  
- Shop line edit = re-upload only (internal correction = MG1)  
- ACH payment is outside RLMS (`APPROVED_FOR_ACH` is a gate, not a payment rail)  
- CRIP is written locally — no Railinc FTP  

**Polish still OK later in Phase 1**

- Richer bill summary PDF/Excel; invoice cover-sheet UI  
- Backup restore drill docs; rebill rule grid polish  
- Notification matrix admin screens  

**Phase 2 hooks (do not implement now)**

- CROP / AAR history import via carMARQS — `POST /api/repair/phase2/crop-import` → **501**  
- `getPhase2Hooks()` markers only (MG4)

---

## How to demo locally

```bash
# One command (migrate + walk + write demo-output/)
export DATABASE_URL=postgresql://repairdev:repairdev@127.0.0.1:5432/rlms_repair_dev
export REPAIR_LOCAL_DB=1
npm run repair:demo:local
```

Windows step-by-step (Node 22 / `npm install --ignore-scripts`, portable Postgres on **5433**): [PHASE1_DEMO_WINDOWS.md](./PHASE1_DEMO_WINDOWS.md).  
Hand-test list: [PHASE1_REVIEW_CHECKLIST.md](./PHASE1_REVIEW_CHECKLIST.md).
