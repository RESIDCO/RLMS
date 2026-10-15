# Phase 1 UI review — Windows runbook (tonight)

**Tip required:** `a3a17a6` (`a3a17a652f8d6a94592cd830a378c65a7ce9d2ff`) — cents demo step **[4] = 36732.04** clean.  
**This bundle:** `rlms-phase1-local-review-mode.bundle` (Windows `cross-env` + **LOCAL REVIEW MODE, no Supabase**).  
**Draft PR:** https://github.com/RESIDCO/RLMS/pull/2 — **do not merge/deploy**.  
**No new features** — click-through review only.  
**Push path:** `C:\Users\BruceHarbridge\rlms-push` (bundles only; agents do not push).

Related: [PHASE1_DEMO_WINDOWS.md](./PHASE1_DEMO_WINDOWS.md) · [PHASE1_REVIEW_CHECKLIST.md](./PHASE1_REVIEW_CHECKLIST.md) · [PHASE1_WALKTHROUGH.md](./PHASE1_WALKTHROUGH.md)

---

## Goal

Get a local repair UI on Windows against portable Postgres **5433**, with demo car **OFOX 528313** seeded, **without** pointing at production Supabase, then open each Phase 1 screen and check the checklist.

---

## 0. Confirm tip

```powershell
cd C:\Users\BruceHarbridge\rlms-push
git rev-parse HEAD
# expect a3a17a652f8d6a94592cd830a378c65a7ce9d2ff
```

If still on `b29d0a5`, apply `rlms-phase1-cents-handoff.bundle` first (see [HANDOFF.md](./HANDOFF.md)).  
If you already applied the docs-only `rlms-phase1-ui-review-runbook.bundle` (tip `60e380b`), still apply **this** local-review-mode bundle on top (or reset to `a3a17a6` and apply only this — it includes the full runbook).

---

## 1. Start portable Postgres (Path B — port 5433)

If you already installed Path B once, each session:

```powershell
$PgData = "$env:USERPROFILE\pgsql-data-repair"
$PgBin  = "$env:USERPROFILE\pgsql\bin"   # or "$env:USERPROFILE\pg-demo\pgsql\bin"

& "$PgBin\pg_ctl.exe" -D $PgData -o "-p 5433 -h 127.0.0.1" -l "$env:USERPROFILE\pgsql-repair.log" start
```

Confirm:

```powershell
& "$PgBin\psql.exe" "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev" -c "SELECT version();"
```

First-time install / `initdb` / create DB: follow **Path B** in [PHASE1_DEMO_WINDOWS.md](./PHASE1_DEMO_WINDOWS.md).

**URL for everything below:**

```text
DATABASE_URL=postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev
```

---

## 2. Env + npm install

Same PowerShell session. **Do not** set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `VITE_SUPABASE_*` for this review.

```powershell
cd C:\Users\BruceHarbridge\rlms-push

$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"

node -v   # prefer v22.x LTS
# Node 22:
npm install
# Node 24 (if stuck on better-sqlite3 / node-gyp):
# npm install --ignore-scripts
```

Repair data uses **`DATABASE_URL`** (local Postgres **5433** only). Local review mode boots **without** Supabase.

---

## 3. Seed a UI-reviewable OFOX 528313 state

### Least friction (recommended tonight)

There is **no seed-only script** and **no mid-demo pause**. `npm run repair:demo:local` always:

1. Drops schema `repair` (unless `REPAIR_DEMO_RESET=0`)
2. Migrates via node-pg
3. Seeds **OFOX 528313** + APA shop contacts / billed-party mapping
4. Walks the **full** lifecycle through **CLOSED** + monthly close + CRIP file
5. Bonus void+restore on a companion estimate
6. Writes `modules/repair/dev/demo-output/step-log.json` (IDs, **shop/lessee links with raw tokens**, emails)

```powershell
npm run repair:demo:local
```

Expect exit **0**. Step **[4]** total **`36732.04`** (not float residue).  
Final event status: **`CLOSED`**. Account month CRIP under `modules/repair/dev/demo-output/`.

**That end state is still reviewable** — open the same screens with the tokens from `step-log.json` and confirm data/totals/status. Many shop *actions* will already be done or locked (correct for CLOSED).

### Optional: fresh mid-lifecycle hand-test after the demo

Demo leaves **OFOX 528313** in the local public stubs. After the demo finishes:

1. Start the app (next section) — local review mode, no login
2. Open `/#/repair` → create a **new** BO for **OFOX / 528313** at shop **APA** → mint shop link
3. Walk checklist rows that need live actions (accept, upload, approve, etc.) on that **new** event

Do **not** re-run `repair:demo:local` mid-review unless you want a full reset (default drops `repair` again). To keep data: `$env:REPAIR_DEMO_RESET = "0"` only if you know you need it — the full walk may still conflict with existing CLOSED events.

### What “correct” looks like after a completed demo (CLOSED)

| Area | Expect |
|---|---|
| Event | Status **CLOSED**; Ready-to-Close / Close already audited |
| Estimate | **Approved**; final revision total **$36,732.04** (OFOX2609 sample) |
| Lessee link | Resp **6** lines only; decision already **APPROVE** (re-decide may error — OK) |
| Shop link | Event/shop history visible; POD/complete/invoice already on file; further lifecycle actions limited |
| Invoice | Pre-pay **APPROVED** / match path already passed |
| Monthly close | `CRIP….txt` in demo-output; billing lock on closed events |
| Companion estimate | Void + restore already exercised (retention) |

---

## 4. Start the app (Windows — local review, no Supabase)

Keep `$env:DATABASE_URL`, `$env:REPAIR_LOCAL_DB`, and `$env:REPAIR_DEV_BYPASS_AUTH` from section 2.

### Recommended (sets flags + works on cmd / PowerShell / Git Bash)

```powershell
npm run repair:dev:local
```

Console must show:

```text
LOCAL REVIEW MODE, no Supabase
```

### Also works: `npm run dev` (now uses `cross-env` for Windows)

```powershell
# flags already set in section 2
npm run dev
```

`npm run dev` alone without the two `REPAIR_*` flags still expects Supabase env (normal RLMS). For UI review use **`repair:dev:local`** or set both flags first.

### Manual fallback (if scripts ever fail)

```powershell
$env:NODE_ENV = "development"
$env:REPAIR_LOCAL_DB = "1"
$env:REPAIR_DEV_BYPASS_AUTH = "1"
$env:VITE_REPAIR_LOCAL_REVIEW = "1"
$env:DATABASE_URL = "postgresql://repairdev:repairdev@127.0.0.1:5433/rlms_repair_dev"
npx tsx server/index.ts
```

**Base URL:** [http://127.0.0.1:5000](http://127.0.0.1:5000)  
(`PORT` defaults to **5000**; override with `$env:PORT` if needed.)

Hash router — repair paths are under `/#/…`.

**Confirmed screens in this mode (no Supabase login):**

| Screen | URL |
|---|---|
| Repair home / BO / close helpers | http://127.0.0.1:5000/#/repair |
| Estimate review | http://127.0.0.1:5000/#/repair/estimates/\<estimateId\> |
| Shop link | http://127.0.0.1:5000/#/repair/e/\<shopToken\> |
| Lessee link | http://127.0.0.1:5000/#/repair/lessee/\<lesseeToken\> |

Non-repair `/api/*` returns **503** in local review mode. Health: http://127.0.0.1:5000/api/repair/health

---

## 5. How to get shop / lessee / estimate URLs after seed

After `repair:demo:local`, open:

```text
modules\repair\dev\demo-output\step-log.json
```

Top-level fields (also printed at end of the console run):

| Field | Use |
|---|---|
| `shopLink` | e.g. `/repair/e/<rawToken>` → browser **`http://127.0.0.1:5000/#/repair/e/<rawToken>`** |
| `lesseeLink` | e.g. `/repair/lessee/<rawToken>` → **`http://127.0.0.1:5000/#/repair/lessee/<rawToken>`** |
| `reviewUi` | e.g. `/repair/estimates/<estimateId>` → **`http://127.0.0.1:5000/#/repair/estimates/<estimateId>`** |
| `eventId` / `estimateId` / `invoiceId` | Paste into Repair Home close helpers / estimate field |
| `emails` / `steps[].details` | Dev adapter notifications (console + log); shop **never** on Resp 6 send |

**Important:** Raw tokens are returned **once** at mint time and stored only as hashes in DB. After the demo, **`step-log.json` is the source of truth** for clickable URLs. Console step lines also print `shopLink` / `lesseeLink`.

New BO from the UI: Repair Home shows a shop link after “Create bad order + shop link”. Lessee URL appears after “request lessee approval” on the estimate review page (and in that API response / notification log).

---

## 6. Click-through map (checklist → URL → correct)

Base: `http://127.0.0.1:5000`  
Replace `<shopToken>`, `<lesseeToken>`, `<estimateId>`, `<eventId>` from `step-log.json` (or a fresh BO).

| # | Checklist action | URL / how | Correct looks like (from checklist) | After full demo |
|---|---|---|---|---|
| 1 | Create BO for **OFOX 528313** at APA | `/#/repair` (login) — Create bad order + shop link | Event created; shop link minted; BO/Queued path; audit | Demo already created one (CLOSED). **Or** create a new BO here for a live walk |
| 2 | Shop accept + on-hand / arrival | `/#/repair/e/<shopToken>` (no login) | Shop can act; Queued leaves when yard/arrival rules say so | Demo already accepted/on-hand/arrival; page should load event for OFOX 528313 |
| 3 | Load 500-byte with WARNING → Accept | Estimate load via shop link / review UI; warnings on load | `PENDING_WARNINGS` → Accept loads estimates; Reject leaves rejected | Demo accepted MULTI_CAR; estimate loaded |
| 4 | Shop re-upload OFOX sample (revision) | Shop link upload / review UI | New revision; totals from file; compare on review UI | Demo revision total **36732.04**; open estimate review to see revisions/compare |
| 5 | Submit → Approve | `/#/repair/estimates/<estimateId>` | Estimate **Approved**; cents totals; ≈ **$36,732.04** | Already Approved — confirm total display |
| 6 | Request Resp 6 lessee approval | Estimate review → request lessee; email in step-log / notifications | Email logged; recipients **exclude shop**; link shows **Resp 6 only** | Demo already sent; use `lesseeLink` from step-log |
| 7 | Lessee Approve | `/#/repair/lessee/<lesseeToken>` | Decision append-only; reviewers notified | Already APPROVED via link; page should still show Resp 6 lines / car |
| 8 | Shop POD + completed date | `/#/repair/e/<shopToken>` | Complete locks estimate; docs still uploadable; rollback = reviewer/admin/fleet_manager | Demo set POD + complete |
| 9 | Relay dispo to shop | Authed API / review flow (fleet) | Dispo stored; shop notified; information-only | Demo relayed `to_shop` |
| 10 | Shop invoice (same 500-byte as invoice-aar) | Shop link invoice section | Pre-pay checks; `TOTAL_MATCH` PASS when totals equal; `PENDING_REVIEW` | Demo ingested CRB invoice |
| 11 | Reviewer `APPROVED_FOR_ACH` | Authed invoice decision (API / review path) | Only when MATCHED; `match_status` → `APPROVED`; MISMATCH → **409**, no override | Demo already APPROVED_FOR_ACH |
| 12 | Ready to Close | `/#/repair` — paste `eventId` → Check / mark Ready to Close | After MATCHED/APPROVED invoice **and** dispo: `READY_TO_CLOSE` | Already moved past RTC → CLOSED |
| 13 | One-click Close | `/#/repair` — Close event | Status `CLOSED`; audited; **not** automatic | Already CLOSED |
| 14 | Monthly close YYMM | Demo already wrote file; or authed `POST /api/repair/billing/monthly-close` | Local `CRIPYYMM…`; validation OK; billing-locked; rebuttals | See `cripFilename` / `cripPath` in step-log |
| 15 | Missing billed-party mapping | Temporarily remove mapping then retry monthly close | **422** / blocked until mapping restored | Intentional negative test — optional |
| 16 | Void estimate + admin restore | Authed void/restore APIs / flows | VOIDED hidden; shop link locked; restore audited; **no hard delete** | Demo did companion estimate void+restore (step 14) |
| 17 | Tank gate (RESIDCO) | Ordinary outbound cars | Default **OFF**; not blocked | Smoke / no special UI |
| 18 | Phase 2 stub | `POST http://127.0.0.1:5000/api/repair/phase2/crop-import` | **501** | curl/Postman while app running |
| 19 | Host isolation | `git diff master...HEAD --stat` (outside review UI) | Outside `modules/repair`: only App/pages/routes(+10)/package/tsconfig/gitignore/backup | Docs/checklist item |
| 20 | Safety | Process check | No prod Supabase migrate; no merge/deploy; secrets not logged | Keep `DATABASE_URL` on **5433** local only |

### Screen cheat sheet

| Screen | Local URL | Auth |
|---|---|---|
| Admin / BO / contact bank / close helpers | `http://127.0.0.1:5000/#/repair` | **None** in local review (`VITE_REPAIR_LOCAL_REVIEW=1`) |
| Estimate review / Resp 6 request | `http://127.0.0.1:5000/#/repair/estimates/<estimateId>` | **None** in local review |
| Shop secure link | `http://127.0.0.1:5000/#/repair/e/<shopToken>` | **None** |
| Lessee secure link | `http://127.0.0.1:5000/#/repair/lessee/<lesseeToken>` | **None** |

---

## 7. Quick green signals

- `npm run repair:demo:local` exit 0  
- Step **[4]** / approved total **`36732.04`**  
- `step-log.json` has `shopLink`, `lesseeLink`, `reviewUi`, `eventId`, `estimateId`  
- `npm run repair:dev:local` prints **LOCAL REVIEW MODE, no Supabase** and serves **http://127.0.0.1:5000**  
- `/api/repair/health` → `{ ok: true, ... }` with **no** `SUPABASE_*` env set  
- `/#/repair`, shop link, lessee link, estimate review open **without** Supabase login  

Optional smokes (API only): `repair:smoke-lifecycle-06`, `repair:smoke-inbound-invoice`, `repair:smoke-monthly-close`, `repair:smoke-ready-to-close`.

---

## 8. Safety

- Point `DATABASE_URL` at **local** Postgres **5433** only  
- Never run repair migrations against production `rlms-residco`  
- **No** production Supabase URL/keys for this review — local review mode stubs Supabase  
- No Supabase branch / no paid services  
- Keep draft PR draft — no merge, no deploy  
- Agents deliver **bundles only**; you push from `rlms-push`
