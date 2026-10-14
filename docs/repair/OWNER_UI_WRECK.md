# Owner UI — Wreck dual-track (Rule 107 / Resp 3)

**Status:** **Spec only.** No wreck UI, load-validation changes, or APIs in this tip.  
**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) (§C Bad Orders · §D Estimate Review · §G Railinc validation)  
**Tip base:** `0c0be23f9187a4ccf97f1ef172a5dfe03bd07542` (§D Estimate Review r5)  
**Authoritative corrections:** Bruce (2026-10-14) — **WIN** over any conflicting prior notes.  
**Missing source:** `WRECK_DUAL_TRACK.md` was **not** found in uploads/store. Gaps that need that file are marked `OPEN:` below.

**Delivery rules (unchanged):** integer cents; local Postgres only; no hard deletes; draft PR only; no merge/deploy; no Supabase; no paid services; **bundles only** → Bruce pulls at `C:\Users\BruceHarbridge\rlms-push`. Never push `RESIDCO/RLMS` via GitHub MCP.

---

## Intent

One **wreck event** is the owner’s control surface for a Rule 107 / Defect Card–JIC incident: it links the Bad Order, hand-entered DDCT info, **two** estimate tracks (owner/contract + Resp 3), shared photos/docs, owner-only depreciated-value / settlement controls, and the **JIC deadline tracker**. Shops upload **two separate 500-byte files**. Build is blocked until §D r5 is signed off; this document is the approval gate for that build.

---

## 1. One wreck event (dual track)

| Rule | Spec |
|---|---|
| Who creates / manages | **BO creator** or **asset manager** (owner roles). Shop does **not** create the wreck event. |
| DDCT entry | Owner enters DDCT event / incident info **by hand** on the wreck event (or via BO fields already captured). No DDCT API integration in this slice. |
| Links | Exactly **one** Bad Order (when present), **one** DDCT Incident ID (App. G col 341), **two** estimates (owner track + Resp 3 track), **shared** photo/document gallery (event-scoped; same `documents` pattern as BO ↔ estimate). |
| Tracks | Align with Phase 1 brief `event_tracks`: `OWNER_CONTRACT` and `R107_RESP3`, each with its own estimate + status. |
| Estimates History | Both estimates show on §A; `Wreck?` column remains. Opening either estimate still uses §D Estimate Review. Opening the **wreck event** is the dual-track home. |

```
┌─ Wreck event ─────────────────────────────────────────────┐
│  Car · Shop · BO link · DDCT Incident ID (hand-entered)   │
│  Shared photos / docs                                     │
│  ┌─ Owner / contract estimate ─┐  ┌─ Resp 3 estimate ─┐ │
│  │  track OWNER_CONTRACT       │  │  track R107_RESP3 │ │
│  │  → §D review (warnings)     │  │  → §D + hard load │ │
│  └─────────────────────────────┘  └───────────────────┘ │
│  Owner-only: Rule 107 DV · settlement gauge · 5399      │
│  JIC deadline tracker (clocks from shop arrival)          │
└───────────────────────────────────────────────────────────┘
```

**Acceptance**

- [ ] Creating a wreck event requires car + shop (or BO that supplies them) and records DDCT fields the owner typed.
- [ ] Event shows both track estimates (or empty slots until each file loads) and one shared document gallery.
- [ ] Shop / lessee never see owner-only DV / settlement / 5399 controls.

---

## 2. Two shop data files (no mixed Resp 3)

| Rule | Spec | Citation |
|---|---|---|
| Count | Shops **must** send **two** separate 500-byte files per wreck event: (1) owner / non–Resp 3 file, (2) Resp 3–only file. | Bruce; Manual_Gap_Review #3 (RS p.7, 9); `estimate-load.ts` `RESP3_MIXED` |
| Mixed file | **HARD REJECT** a single file that mixes Resp 3 lines with any other responsibility. | Same; load code `RESP3_MIXED` already ERROR |
| Pure Resp 3 | File where **every** Format 1 line has Responsibility Code `3` → loads onto `R107_RESP3` track. | Bruce; CRB App. G col 138; public CRB responsibility list includes **3 Defect Card/JIC** ([Railinc_Data_File_Reference](../Manual_Gap_Review.md) §5 / App. G) |
| Owner file | File with **no** Resp 3 lines → loads onto `OWNER_CONTRACT` track. | Bruce |
| Multi-car | Unchanged from §G / load slice: multi-car may WARN and split; Resp 3 separation still applies **per file**. | Manual_Gap_Review #3 |

**Acceptance**

- [ ] Mixed Resp 3 / non-3 file → load blocked (`RESP3_MIXED`); rejected bytes + findings retained.
- [ ] Two clean files attach to the correct tracks on the same wreck event.
- [ ] UI copy on shop link and owner wreck page states “two files required.”

---

## 3. Resp 3 load validation (HARD REJECT vs flag)

Severity model matches repairSMART / OWNER_UI_SPEC §G: **Errors** block accept; **Warnings / flags** accept into the system with `Issues?` visibility (Manual_Gap_Review #1, RS p.7–8, 14).

### 3a. HARD REJECT (Resp 3 file only)

Load is **rejected entirely** (no estimate created / no Queued row) when any of the following fail. Owner-track files do **not** use this hard set (see §3c).

| # | Check | Cite |
|---|---|---|
| H1 | **Not priced to current-quarter AAR labor rates / Price Master (price list)** — labor rate and/or machine-priceable job amounts must match the quarterly table the estimate records (see §4). | Bruce; Phase 1 brief §8 (“Rule 107 Resp 3 must follow current-quarter AAR pricing”); Railinc_Data_File_Reference §5 (Price Master / Rule 107-adjacent job prices) |
| H2 | **Invalid or missing Detail Source (source code)** — Format 1 cols 31–32 required; value must be in the published set (e.g. BR, CB, DC, DE, DM, DR, GB, GT, HT, IV, JD, JI, JR, MA, OT, PT, QT, RE, SH). | Bruce; CRB Procedures Manual App. G.1 Format 1 field **Detail Source** = **R**; Railinc_Data_File_Reference §4 |
| H3 | **Critical billing identity / money fields missing or invalid** (App. G **R** fields that Railinc treats as critical for exchange): | CRB App. G.1 (R/O/C); Railinc_Data_File_Reference §5 (“Critical errors → reject whole file or affected invoice”; invalid Billing/Billed marks critical); OWNER_UI_SPEC §G required Format-1 table |

**H3 field list (HARD REJECT when blank/invalid on Resp 3):**

| Field | App. G cols | Why critical |
|---|---|---|
| Record Format = `1` | 1 | Layout identity |
| Billing / Invoicing Party | 2–5 | Critical mark (Railinc §5) |
| Billed Party | 6–9 | Critical mark (Railinc §5) |
| Account Date YYMM | 10–13 | Billing period key |
| Invoice Number | 14–29 | Invoice identity — **OPEN:** detail-only extracts may interact with Q18 blank-invoice policy; for **Resp 3 wreck** Bruce’s hard-reject intent wins unless Bruce clarifies Q18 exception |
| Price Master Currency | 30 | Pricing key (LOCK set on §D) |
| Detail Source | 31–32 | Same as H2 |
| Car Initial + Car Number | 48–57 | + **VCF** hard fail if unknown (existing load / invoice audit) |
| Repair Date | 60–65 | Repair timing |
| SPLC | 66–71 | Location |
| Repairing Party | 72–75 | Shop mark |
| Repair Facility Type | 107–108 | Facility code set |
| Quantity | 113–116 | Line quantity |
| Condition Code | 117 | Condition |
| Applied Job Code | 120–123 | Pricing / Price Master key |
| Why Made Code | 127–128 | Why-made |
| Removed Job Code | 131–134 | Couplet |
| Responsibility Code | 138 | Must be `3` for every line in this file |
| Labor Charge | 149–155 | Integer cents |
| Material Charge | 156–163 | Integer cents |
| Material Sign D/C | 164 | Sign |
| Machine Priceable Y/N/H | 165 | Drives Price Master edits |
| Description / wheel narrative | 167+ | Required narrative |
| Line Number | 289–293 | Line identity |

`OPEN:` Full CRBDX edit-chart / Error Codes PDF row-level mapping (qualifier vs VZ car-part, wheel-only fields, etc.) is **not** fully restated here — use published CRBDX Error Codes where referenced in `modules/repair/dev/reference/Railinc_Data_File_Reference.md`. Do **not** invent unpublished codes. Any additional hard rejects that lived only in missing `WRECK_DUAL_TRACK.md` remain `OPEN:`.

### 3b. ACCEPT + FLAG (Resp 3) — block complete / invoice

Everything else on Resp 3 — **including missing AAR Component IDs (CID, cols 327–340)** — **accepts** the load but **flags** the fields (`Issues?` / load findings severity WARNING or FLAG).

Until **all** Resp 3 flags on that estimate are cleared:

| Blocked | Allowed |
|---|---|
| Applying **completed / outbound** date | Estimate stays in review lifecycle (Queued → … → Approved) |
| **Invoicing** the estimate / event | Owner review, revision request, document upload, flag clearance |

`OPEN:` Exact flag taxonomy UI (badge copy, bulk clear, who may clear) — not in missing source; default to §D Issues panel + load-findings pattern until Bruce specifies.

### 3c. Owner / contract track

Owner-track loads get **warnings only** (no Resp 3 hard-reject set). Mixed-file and parse/VCF errors still apply globally. Owner may ACCEPT_WARNINGS per existing load flow.

**Acceptance**

- [ ] Resp 3 missing CID → load accepted + flag; completed date API/UI blocked; invoice blocked.
- [ ] Resp 3 bad/missing Detail Source → HARD REJECT.
- [ ] Resp 3 labor/material not matching recorded quarter’s AAR rates/price list → HARD REJECT.
- [ ] Owner-track equivalent pricing drift → WARNING only.

---

## 4. Resp 3 pricing / labor rates (quarterly)

| Rule | Spec |
|---|---|
| Storage | Quarterly-versioned reference table(s) (labor rates + job Price Master / price-list rows as imported). |
| Import path | **Gear → Reference Data** admin importer (same dry-run → confirm pattern as §D r5). CSV upload; edition/**quarter** recorded on confirm. |
| Source file | Railinc and/or AAR publications — **still being decided**. `OPEN:` which CSV/product is authoritative each quarter. |
| Estimate stamp | Each Resp 3 estimate (revision) **records the quarter** it was priced against; H1 validates against that quarter’s table. |
| Owner track | May warn if off-quarter; does not hard-reject for off-quarter pricing. |

**Acceptance**

- [ ] Admin can import a quarter CSV via Reference Data without hard-delete of prior quarters.
- [ ] Resp 3 estimate header/meta shows priced-against quarter.
- [ ] Re-validation after a new quarter import does not silently rewrite historical stamps.

---

## 5. Depreciated value / Rule 107 — OWNER ONLY

| Rule | Spec |
|---|---|
| Visibility | **Owner / system manager / reviewer** only. **Never** on shop event link or lessee token page (API 403 + UI hidden). |
| Inputs | Owner enters or overrides: **original cost** (optional — missing for some cars), **build date**, **additions / betterments**. |
| Engine | Existing pure calculator lives in `shared/rule107.ts` (AAR Office Manual Rule 107.E / settlement exhibits). **Do not wire** a live DV module into wreck UI in this build. |
| Provider | Add a **`RlmsRule107Calculator` provider interface** (read-only link / later swap) — stub or no-op adapter only; **do not wire** to production DV service now. |
| Settlement | **Settlement gauge** + **5399 credit prompt** stay **owner-side** on the wreck event page. |
| Shops / lessees | No DV dollars, no settlement matrix, no 5399 prompt. |

`OPEN:` Exact 5399 credit job-code / prompt copy and settlement-gauge thresholds were expected in `WRECK_DUAL_TRACK.md` (not found). Do not invent AAR settlement dollar rules beyond what `shared/rule107.ts` already encodes; Bruce to confirm 5399 UX.

**Acceptance**

- [ ] Shop token and lessee token responses omit DV / settlement / 5399 fields.
- [ ] Owner can save overrides with audit (who/when/reason).
- [ ] Provider interface exists; no external DV HTTP dependency required for Phase 1 wreck build.

---

## 6. JIC deadline tracker (wreck event page)

| Rule | Spec |
|---|---|
| Belongs to | **JIC process**, **not** the Resp 3 estimate status machine. |
| Clock start | **Shop arrival date** (yard arrival / on-hand) — same arrival already required before shop Submit for Approval (Manual_Gap_Review #4, RS p.9–10). |
| Clocks (Bruce) | **JIC prep** 30 / 45 days · **Send** 15 days · **Endorse** 30–60 days with **auto-endorse** · plus **billing limits**. |
| Placement | Shown on the **wreck event** page (not buried only on estimate D). |

`OPEN:` Which calendar (business vs calendar days), exact prep 30 vs 45 selection rule, endorse window start event, auto-endorse side effects, and billing-limit numbers — expected in missing `WRECK_DUAL_TRACK.md`. Spec stores Bruce’s durations; implementation must not invent the missing branching rules.

**Acceptance**

- [ ] Tracker hidden/zeroed until arrival date exists; starts when arrival is set.
- [ ] Wreck event page shows prep / send / endorse / billing limit rows with due dates + state (open / due / past / auto-endorsed).
- [ ] Changing arrival date recalculates clocks with audit.

---

## 7. Routes & information architecture (proposed)

| Route | Role | Purpose |
|---|---|---|
| `/#/repair/wreck/:eventId` | Owner | Wreck event dual-track home + deadlines + owner DV |
| `/#/repair/estimates/:id` | Owner | Existing §D (each track’s estimate) |
| `/#/repair/bad-orders` | Owner | §C; Is Wreck? / Wreck Est / DDCT fields feed event create |
| `/#/repair/e/:token` | Shop | Upload **two** files; arrival; **no** DV |
| `/#/repair/lessee/:token` | Lessee | §F; **no** DV / Resp 3 settlement |

`OPEN:` Final path name (`wreck` vs `events/:id/wreck`) — pick at build time; keep deep-linkable from §A `Wreck?` and BO history.

---

## 8. Out of scope (this spec / next build)

- Implementing any wreck UI or new load APIs in the tip that carries **only** this document.
- Live DDCT system integration (hand entry only).
- Wiring `RlmsRule107Calculator` to a hosted DV service.
- Inventing full AAR shopping-reason lists or unpublished CRBDX codes.
- Changing §D r5 Reference Data tabs beyond adding quarterly price/labor import when the wreck **build** lands.
- Screen E document polish / Screen F Lessee (still parked after §D sign-off unless Bruce reorders).

---

## 9. Build gate

| Step | Content | Status |
|---|---|---|
| **Spec** | This document + docs-only bundle | **Awaiting Bruce review** |
| **Build** | Wreck event UI + Resp 3 hard validation + quarterly import + owner DV shell + JIC tracker | **Blocked until §D r5 sign-off** and Bruce accepts this spec (incl. `OPEN:` resolutions he cares about) |

---

## 10. Source map

| Source | Use |
|---|---|
| Bruce corrections (brief) | **WIN** — event model, two files, hard vs flag, quarterly rates, owner-only DV, JIC clocks |
| Manual_Gap_Review.md | RS #1 errors/warnings; #3 Resp 3 separate; #4 yard arrival |
| Railinc_Data_File_Reference.md / App. G | Detail Source R; critical marks; Format 1 R field list; Price Master note; DDCT col 341; CID col 327 |
| OWNER_UI_SPEC §G | Required Format-1 table; reject retention |
| Phase 1 brief | `event_tracks` OWNER_CONTRACT / R107_RESP3; quarterly pricing later-phase note (superseded for **validation** timing by Bruce — store quarter now, hard-check on Resp 3 load) |
| `shared/rule107.ts` | DV math reference for later provider |
| `estimate-load.ts` | Existing `RESP3_MIXED` ERROR |
| **Missing** `WRECK_DUAL_TRACK.md` | `OPEN:` items above |

---

## Bundle

`docs/bundles/rlms-phase1-owner-ui-wreck-spec.bundle` — requires **`0c0be23`**. Docs only.
