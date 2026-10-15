# Owner UI — Wreck dual-track (Rule 107 / Resp 3)

**Status:** **Spec approved.** Build lands on tip after this fold (see HANDOFF / wreck build bundle).  
**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) (§C Bad Orders · §D Estimate Review · §G Railinc validation)  
**Tip base:** `85856b6b224a15464d2e1c1cb032c1d7b01a431c` (wreck-spec §11 FF from `c8a7138`)  
**Authoritative corrections:** Bruce (2026-10-14) — **WIN** over any conflicting prior notes, including the design proposal `WRECK_DUAL_TRACK.md`.  
**§11 answers:** Bruce (2026-10-15) — folded below; six corrections still **WIN**.  
**§11 final OPEN (#1 / #4 / #10):** Bruce (2026-10-15) — **DECIDED** below. Spec **approved**.  
**Folded source:** `WRECK_DUAL_TRACK.md` (draft 2026-10-14; AAR Office Manual 2026 Rev 2026-03-18 “OM”; AAR Field Manual 2026 Rev 2026-01-27 “FM”). Non-conflicting detail folded below; conflicts resolved per Bruce.

**Delivery rules (unchanged):** integer cents; local Postgres only; no hard deletes; draft PR only; no merge/deploy; no Supabase; no paid services; **bundles only** → Bruce pulls at `C:\Users\BruceHarbridge\rlms-push`. Never push `RESIDCO/RLMS` via GitHub MCP.

---

## Intent

One **wreck event** is the owner’s control surface for a Rule 107 / Defect Card–JIC incident: it links the Bad Order, hand-entered DDCT info, **two** estimate tracks (owner/contract + Resp 3), shared photos/docs, owner-only depreciated-value / settlement controls, and the **JIC deadline tracker**. **JIC first:** the contract shop prepares the JIC and sends it to the car owner; the owner submits it to the damaging road for endorsement; **only after endorsement** does the shop submit the detailed owner + Resp 3 estimate data files (two separate 500-byte files; no mixed-file split). Spec is **approved**; implement per this document.

---

## 0. Rule citations (OM / FM)

Page numbers are printed-manual pages (FM “— nnn —” footers). Licensed AAR material — keep private; do not paste full exhibit tables into public surfaces.

| Topic | Rule (page) | Requirement (summary) |
|---|---|---|
| Handling-line responsibility | FM 95.A (p.717–718) | Handling line responsible with specific knowledge of unfair-usage cause (derailment, collision, cornering, obstruction, fire, heat, submerged, storm, forklift/dumper, etc. — 95.A.1.a–v). |
| Rule 107 start | OM/FM 107.B.1 (OM p.55–56) | DDCT notification starts the incident. Damaging carrier notifies owner within **7 days** (car number, incident date, SPLC, major damage items, last commodity). |
| Owner reply | OM 107.B.2 (p.56) | Within **7 days** owner supplies settlement value + shop disposition via DDCT. Inspection (if wanted) within **15 days**. |
| Repair vs. settle | OM 107.C.1–3 (p.56–57) | Below settlement: carrier options (own shop ≤120d; third-party AAR shop with owner approval; safe-to-move + Defect Card ≤30d; home loaded ≤60d + Defect Card). No owner disposition ≤15d → handling line judgment. At/above settlement: offer settlement in DDCT within 30 days of Actual Depreciated Value. |
| Costs outside settlement | OM 107.D (p.57–59) | Transportation, loading/unloading (JC 4699), movement on own wheels, decontamination → damaging carrier unless owner refused settlement. |
| Settlement value | OM 107.E, G Exh. I–V (p.59–69) | Reproduction cost from original/rebuilt/ILS × Exhibit III cost-factor ratio; + A&B (Exhibit V, DDCT type codes). Depreciated value = reproduction × (1 − age × rate, capped) — Exhibit IV. Exhibit II chooses DV / salvage / salvage+20% by car type & age. Salvage = (lightweight − non-metallic) × JC 4244 (+ 4236 Al / 4246 SS). Exhibit I formulas per possession/settlement scenario. |
| Owner data in Umler | OM 115.A.5 (p.91) | Owners report original/rebuilt cost and built date; DDCT uses them for estimated/actual DV. |
| Total cap | OM 102.D.7 (p.44); 107.I.3 (p.70) | Total bill ≤ AAR settlement + authorized additional costs. Excess credited with **JC 5399** (negative material, detail source DC/JI/JD, no labor). |
| Destroyed / dismantled | OM 107.I.1–2, 4–5 (p.70–71) | Destroyed: JC **5199**, detail source **DE**. Rule 108 dismantle: JC **5299**, **DM**. Rack-only: JC **5499**. No added labor. |
| Defect cards | OM 102.B, D (p.44) | Issued/kept in DDCT; cannot be repudiated; expire **4 years**. Charges on **repair completion date**. Rules on D/C date decide responsibility. |
| JIC | OM 103.A (p.45–46) | Email to damaging road’s FindUs.Rail JIC contact. **4–10 photos per unit** (~400×600 px recommended). Alternate JIC adds BRC-format estimate (Rule 83 Exh. A), DV statement, D/C or Rule 107 notice PDF; subject `ALT JIC <init> <num> $<amount>`. |
| JIC timing | OM 103.B.4–9 (p.51+) | Prepare within **30 days** of facility arrival (**45** Alternate); forward within **15 days**. Damaging road: 30 days to inspect/endorse. Alternate: &lt;$25k → 30+30 with auto-endorse at **45** days; ≥$25k → 30+30 with auto-endorse at **75** days. Decline must state reasons. |
| JIC auto-pay | OM 103.A.3.c (p.46) | Endorsed JIC may escalate by cost-factor ratio (repair year ÷ endorsement year). Auto-paid without audit within tolerance: 7% &lt;$10k; 5% $10–25k; 3% $25–50k; 2% $50–75k; 1% &gt;$75k. |
| Pricing | OM 111.1–7 (p.76) | Price matrix for job codes applied/removed — nothing added/deducted. Unpriced = actual man-hours × labor rate. D/C date, DDCT incident date, or JIC endorsement date decides responsibility. |
| Detail sources | OM 112.A.4 (p.80) | BR, CB, DC (102), DE (107), DM (108), DR, GB, JD, JI (103), JR, MA, OT, RE, SH; taxes PT, QT, GT, HT, IV. **Only owner-responsibility repairs may be group billed** (112.A.3.b). |
| D/C & JIC billing | OM 112.B.5–6 (p.80–81) | DDCT D/C → detail source **DC**. Endorsed JIC → **JI** (or **JD** retire/dismantle per 103.C.16). |
| Rebuttal | OM 112.C (p.81) | Intermediate line repaired + billed owner → owner rebills responsible party. Only D/C or endorsed JIC items recoverable. **DR** + D/C PDF, or **JR** (no JIC attached). |
| Time limits | OM 112.E (p.83) | BR/GB/DC/DM: **3 months** from repair. JI: **6 months** from repair. JD/RE/JR/DR/CB/OT: 6 months from each source’s defined date. DE: 3 months from settlement accepted in DDCT. Absolute: **24 months** from original repair. D/C repairs within **48 months** of D/C issue or DDCT incident; JIC repairs within **48 months** of endorsement. Taxes follow parent detail source. |
| Owner extensive repairs | OM/FM 108 (OM p.76; FM p.731) | Owner-responsibility extensive repairs under Rule 108; dismantle JC 5299 / DM. |

**Contract shops vs AAR rates:** Manuals govern interchange billing between subscribers, not what a contract shop may charge its customer. RESIDCO practice: contract shops use the AAR framework but AAR labor rates are **not** mandatory on the owner track — hence owner-portion pricing checks are **warnings only**. The shop bills the **car owner** for Resp 3; when the **owner** rebills the damaging road via CRB, OM 111 pricing applies in full.

---

## 1. One wreck event (dual track)

| Rule | Spec |
|---|---|
| Who creates / manages | **BO creator** or **asset manager** (owner roles). Shop does **not** create the wreck event. |
| DDCT entry | Owner enters DDCT event / incident info **by hand** on the wreck event (or via BO fields already captured). No DDCT API integration in this slice. Format: `XXXX99999999` (CRB App. G col 341). |
| Links | Exactly **one** Bad Order (when present), **one** DDCT Incident ID, **two** estimates (owner track + Resp 3 track), **shared** photo/document gallery (event-scoped; same `documents` pattern as BO ↔ estimate). |
| Tracks | Align with Phase 1 brief `event_tracks`: `OWNER_CONTRACT` and `R107_RESP3`, each with its own estimate + status. |
| Estimates History | Both estimates show on §A; `Wreck?` column remains. Opening either estimate still uses §D Estimate Review. Opening the **wreck event** is the dual-track home. |

```
┌─ Wreck event ─────────────────────────────────────────────┐
│  Car · Shop · BO link · DDCT Incident ID (hand-entered)   │
│  Shared photos / docs · JIC photo set (4–10 / unit)       │
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
| Mixed file | **HARD REJECT** a single file that mixes Resp 3 lines with any other responsibility. **Do not** auto-split a mixed file into two tracks. | Bruce (**wins** over proposal that allowed system split + audit) |
| Pure Resp 3 | A wreck Resp 3 estimate / file may contain **ONLY** Responsibility Code `3` lines. **Any other responsibility code = HARD REJECT** (same as mixed-file rule). Clean all-3 file → loads onto `R107_RESP3` track. | Bruce §11 #8; CRB App. G col 138; public CRB responsibility list includes **3 Defect Card/JIC** |
| Owner file | File with **no** Resp 3 lines → loads onto `OWNER_CONTRACT` track (resp 1 + RESIDCO internal 4–9 splits as today). | Bruce |
| Sequence | Shop uploads the two detailed estimate files **only after** JIC endorsement (see §6). | Bruce §11 #2 |
| Line moves | Lines may move between tracks only with reason + audit (after both files are loaded as separate estimates). | Folded from proposal; does not relax two-file rule |
| Multi-car | Unchanged from §G / load slice: multi-car may WARN and split; Resp 3 separation still applies **per file**. | Manual_Gap_Review #3 |

**Acceptance**

- [ ] Mixed Resp 3 / non-3 file → load blocked (`RESP3_MIXED`); rejected bytes + findings retained; **no** silent split.
- [ ] Two clean files attach to the correct tracks on the same wreck event.
- [ ] UI copy on shop link and owner wreck page states “two files required.”

---

## 3. Resp 3 load validation (HARD REJECT vs flag)

Severity model matches repairSMART / OWNER_UI_SPEC §G: **Errors** block accept; **Warnings / flags** accept into the system with `Issues?` visibility (Manual_Gap_Review #1, RS p.7–8, 14).

### 3a. HARD REJECT (Resp 3 file only)

Load is **rejected entirely** (no estimate created / no Queued row) when any of the following fail. Owner-track files do **not** use this hard set (see §3c).

| # | Check | Cite |
|---|---|---|
| H1 | **Not priced to current-quarter AAR labor rates / Price Master (price list)** — labor rate and/or machine-priceable job amounts must match the quarterly table the estimate records (see §4). Includes unpriced items missing actual man-hours × labor rate (OM 111). | Bruce; OM 111.1–7; Phase 1 brief §8; Railinc_Data_File_Reference §5 |
| H2 | **Invalid or missing Detail Source (source code)** — Format 1 cols 31–32 required; value must be in the published set (BR, CB, DC, DE, DM, DR, GB, GT, HT, IV, JD, JI, JR, MA, OT, PT, QT, RE, SH). | Bruce; OM 112.A.4; CRB App. G.1 Detail Source = **R**; Railinc_Data_File_Reference §4 |
| H3 | **Critical billing identity / money fields missing or invalid** (App. G **R** fields that Railinc treats as critical for exchange): | CRB App. G.1 (R/O/C); Railinc_Data_File_Reference §5; OWNER_UI_SPEC §G |

**H3 field list (HARD REJECT when blank/invalid on Resp 3):**

| Field | App. G cols | Why critical |
|---|---|---|
| Record Format = `1` | 1 | Layout identity |
| Billing / Invoicing Party | 2–5 | Critical mark (Railinc §5) |
| Billed Party | 6–9 | Critical mark (Railinc §5) |
| Account Date YYMM | 10–13 | Billing period key |
| Invoice Number | 14–29 | Invoice identity — **NOT required on estimate / approval loads** (blank OK). **HARD REJECT** only on the shop’s **final invoice** load when blank (Bruce §11 #10 DECIDED). Q18 blank-invoice path remains for non-wreck / non-final-invoice cases. |
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

`OPEN:` Full CRBDX edit-chart / Error Codes PDF row-level mapping (qualifier vs VZ car-part, wheel-only fields, etc.) — use published CRBDX Error Codes in `modules/repair/dev/reference/Railinc_Data_File_Reference.md`. Do **not** invent unpublished codes.

### 3b. ACCEPT + FLAG (Resp 3) — block complete / invoice

Everything else on Resp 3 — **including missing AAR Component IDs (CID, cols 327–340)** — **accepts** the load but **flags** the fields (`Issues?` / load findings severity WARNING or FLAG). Bruce **wins** over the proposal’s hard-reject for CID.

Folded checks that are **flag** (not hard reject) on Resp 3 unless they also fail H1–H3:

| Check | Notes | Ref |
|---|---|---|
| Job + qualifier / car-part when price list says VZ | Flag if incomplete | ref_qualifiers, ref_qualifier_generic |
| Condition / why-made / location vs job | Flag if inconsistent with ref tables | ref_condition_codes, ref_why_made, ref_location_codes, ref_job_code_prices |
| Why-made vs event FM 95.A cause (31 fire, 32 submerged, 33 derailment, 34 unfair usage) | Flag if inconsistent with wreck_event rule basis | FM 95.A; ref_why_made |
| Detail source vs authority on file (DC/JI/JD/DE/DR/JR) | Flag until D/C or endorsed JIC attached; do not invent a second hard-reject tier beyond H2 validity | OM 112.B; wreck_event |
| D/C or endorsed JIC present / not expired (4y D/C; 48mo repair window) | Flag; block invoice path via flag gate | OM 102; 112.E |
| Line covered by D/C or JIC item list (associated damage excluded, 103.A.2.c) | Flag or offer “move to owner track” with reason | OM 103.A.2.c |
| DDCT incident ID on Format 1 (col 341) | Flag if blank on lines (event still requires hand-entered ID) | CRB col 341 |
| Group billing on Resp 3 | Flag (112.A.3.b forbids group bill of non-owner responsibility) | OM 112.A.3.b |
| Invoice time-limit approaching | Flag / escalate; do not invent hard reject beyond existing billing limits UI | OM 112.E; §6 |
| Settlement total &gt; cap / at or over DV | Owner-only warnings/flags (see §5); **no** shop-file hard reject; owner decides settle vs repair | Bruce §11 #5; OM 102.D.7; 107.I.3 |
| Tax lines on Resp 3 (PT/QT/GT/HT/IV) | **No taxes on Resp 3** per AAR rules — **reject or flag** tax lines on the Resp 3 file; owner absorbs that tax outside the Resp 3 bill | Bruce §11 #6; OM 112.A.4 |

Until **all** Resp 3 flags on that estimate are cleared:

| Blocked | Allowed |
|---|---|
| Applying **completed / outbound** date | Estimate stays in review lifecycle (Queued → … → Approved) |
| **Invoicing** the estimate / event | Owner review, revision request, document upload |

**Flag clearance (Bruce §11 #12):** Flags are cleared by **car owner** or **managing partner** only (audited who/when/reason). Shops may fix underlying data and re-upload / revise, but **cannot** clear flags. Badge copy / bulk-clear UX defaults to §D Issues panel + load-findings pattern.

### 3c. Owner / contract track

Owner-track loads get **warnings only** (no Resp 3 hard-reject set). Mixed-file and parse/VCF errors still apply globally. Owner may ACCEPT_WARNINGS per existing load flow. Detail source on owner track should be BR or GB for group-eligible owner work (OM 112.A.3.b) — warn if not.

**Acceptance**

- [ ] Resp 3 missing CID → load accepted + flag; completed date API/UI blocked; invoice blocked.
- [ ] Resp 3 bad/missing Detail Source → HARD REJECT.
- [ ] Resp 3 labor/material not matching recorded quarter’s AAR rates/price list → HARD REJECT.
- [ ] Owner-track equivalent pricing drift → WARNING only.
- [ ] Mixed Resp 3 file → HARD REJECT; no auto-split.

---

## 4. Resp 3 pricing / labor rates (quarterly)

| Rule | Spec |
|---|---|
| Storage | Quarterly-versioned reference table(s) (labor rates + job Price Master / price-list rows as imported). |
| Import path | **Gear → Reference Data** admin importer (same dry-run → confirm pattern as §D r5). CSV upload; edition/**quarter** recorded on confirm. |
| Source file | **AAR Office Manual** or **Railinc** Price Master / labor tables each quarter (Bruce §11 #11). Import via Reference Data. **Q4 2026 not available yet** — keep the **current edition in use** until the next quarter file is imported. |
| Estimate stamp | Each Resp 3 estimate (revision) **records the quarter** it was priced against; H1 validates against that quarter’s table. |
| Owner track | May warn if off-quarter or over contract/AAR; does **not** hard-reject for off-quarter pricing. |
| Unpriced items | Hours × rate check for unpriced wreck-track jobs uses the **AAR quarterly labor rate from the Reference Data price master (current edition)** (Bruce §11 #4 DECIDED). Not the shop contract rate. |
| Owner rebill pricing | When the **owner** rebills the damaging road (CRB), OM 111 matrix pricing applies in full (see §8). Shop never bills the RR. |

**Acceptance**

- [ ] Admin can import a quarter CSV via Reference Data without hard-delete of prior quarters.
- [ ] Resp 3 estimate header/meta shows priced-against quarter.
- [ ] Re-validation after a new quarter import does not silently rewrite historical stamps.

---

## 5. Depreciated value / Rule 107 — OWNER ONLY

| Rule | Spec |
|---|---|
| Visibility | **Owner / system manager / reviewer** only. **Never** on shop event link or lessee token page (API 403 + UI hidden). |
| Inputs | **Original cost** and **A&B** are **Umler fields**. Owner enters or overrides **by hand for now**; optional future RLMS read of Umler (expect incomplete) — validation is **inconsistent-tolerant** (Bruce §11 #1 DECIDED). Cost may be blank. Also: **build / rebuilt / ILS date**, car type class (Exhibit II), lightweight / non-metallic / Al / SS weights for salvage. |
| Engine | Existing pure calculator lives in `shared/rule107.ts` (AAR Office Manual Rule 107.E / settlement exhibits). **Do not wire** a live DV module into wreck UI in this build. |
| Provider | Add a **`RlmsRule107Calculator` provider interface** (read-only link / later swap) — stub or no-op adapter only; **do not wire** to production DV service now. |
| Worksheet | Owner-side worksheet should mirror OM p.72–74 (reproduction → DV → salvage → basis → cap). Store which Exhibit edition was used. Override with reason + audit. |
| Settlement gauge | **Owner-only** on wreck event: Resp 3 at or over DV raises **warnings/flags** (never auto-reject the load). Owner decides **settle vs repair** (107.C.2/C.3). If repair continues at/above settlement cap, require **JC 5399** credit line (negative material, detail source DC/JI/JD, no labor — OM 102.D.7 / 107.I.3). Over-DV and other edge cases are handled **owner-side** (Bruce §11 #3, #5). |
| Threshold | At/over DV → owner-only warn/flag (Bruce §11 #5). Optional earlier soft-warn % is UX polish, not a hard gate. Cap behavior at **≥100%** is per OM. |
| Compare to DDCT | Show comparison to DDCT Actual/Estimated DV when owner pastes/enters it; damaging road may challenge under 107.B.2.a.(1). |
| Shops / lessees | No DV dollars, no settlement matrix, no 5399 prompt. |

**New reference tables (owner / admin; not shop-visible):**

| Table | Source | Status |
|---|---|---|
| `ref_rule107_cost_factors` | Exhibit III | Extracted elsewhere (70 rows, 1956–2025) — import via Reference Data when build lands |
| `ref_rule107_depreciation` | Exhibit IV | Not extracted; hand entry + check (complex layout) |
| `ref_rule107_ab_types` | Exhibit V | Not extracted; hand entry + check |
| `ref_rule107_settlement_basis` | Exhibit II | Not extracted |
| `ref_detail_sources` | OM 112.A.4 + time limits 112.E | Spec’d here; CSV later |

**Acceptance**

- [ ] Shop token and lessee token responses omit DV / settlement / 5399 fields.
- [ ] Owner can save overrides with audit (who/when/reason); original cost may be blank.
- [ ] Provider interface exists; no external DV HTTP dependency required for Phase 1 wreck build.
- [ ] Settlement gauge + 5399 prompt exist only on owner wreck event page.

---

## 6. JIC process & deadline tracker (wreck event page)

| Rule | Spec |
|---|---|
| Belongs to | **JIC process**, **not** the Resp 3 estimate status machine. |
| Who prepares / sends | **Contract shop** prepares the JIC and sends it to the **car owner**; the **owner** submits it to the damaging road for endorsement (Bruce §11 #2). |
| Estimate files | Shop submits the detailed owner + Resp 3 data files **only after** JIC endorsement. |
| Clock start | **Shop arrival date** (yard arrival / on-hand) — same arrival already required before shop Submit for Approval (Manual_Gap_Review #4, RS p.9–10). Bruce **wins**: JIC prep/send/endorse clocks start from **shop arrival**, not from DDCT notify (notify/owner-reply/inspection remain informational timeline dates). |
| Day counting | **Calendar days** (Bruce §11 #13). |
| Clocks (Bruce + OM 103) | **JIC prep** 30 calendar days (45 Alternate Standard) · **Send / forward** 15 calendar days · **Endorse** 30–60 calendar days with **auto-endorse** (Alternate: auto at 45 days if &lt;$25k; auto at 75 days if ≥$25k per OM 103.B) · **billing limits** per OM 112.E (see below). |
| Placement | Shown on the **wreck event** page (not buried only on estimate D). |
| Color | Green → amber at **75%** of allowed time → red when overdue (folded UX from proposal). |

**Billing-limit rows (OM 112.E) on the same tracker:**

| Detail source / case | Limit |
|---|---|
| BR, GB, DC, DM | 3 months from repair |
| JI | 6 months from repair |
| JD, RE, JR, DR, CB, OT | 6 months from each source’s defined date |
| DE | 3 months from settlement accepted in DDCT |
| Absolute | 24 months from original repair |
| D/C repair window | Within 48 months of D/C issue or DDCT incident |
| JIC repair window | Within 48 months of endorsement |

**Informational timeline dates** (store on `wreck_event`; not the JIC clock start): notified (≤7d), owner reply (≤7d), inspection (≤15d), facility/shop arrival (**clock zero**), JIC prepared (by shop), sent to owner, owner forwarded to RR, endorsed / auto-endorsed, estimate files received, repair complete, billed.

**Acceptance**

- [ ] Tracker hidden/zeroed until arrival date exists; starts when arrival is set; due dates use **calendar** days.
- [ ] Wreck event page shows prep / send / endorse / billing-limit rows with due dates + state (open / due / past / auto-endorsed).
- [ ] Changing arrival date recalculates clocks with audit.
- [ ] UI/copy reflects shop→owner→RR JIC path; estimate upload gated until endorsement recorded.

---

## 7. Data model (proposed)

### `wreck_event`

| Field | Notes |
|---|---|
| id, tenant | Standard |
| car_initial / car_number | Locked once set |
| ddct_incident_id | Required; hand-entered; `XXXX99999999` (col 341) |
| incident_date, SPLC | From DDCT / owner entry |
| damaging / handling road mark | Owner entry |
| rule_basis | `107` \| `95.A.x` \| `102` D/C \| `103` JIC |
| fm_95a_condition | e.g. `95.A.1.c` derailment |
| last_commodity / STCC | Optional |
| disposition | 107.C.1.a–d / C.2 / C.3 |
| status | Event lifecycle |
| shop_arrival_date | **JIC clock zero** |
| timeline dates | notified, owner_reply, inspection, jic_prepared, jic_forwarded, jic_endorsed / auto_endorsed, repair_complete, billed |
| bad_order_id | Link to existing BO (DDCT Event ID may already exist on BO) |
| owner_estimate_id / wreck_estimate_id | The two track estimates |
| defect_card | party, date, PDF |
| jic | type standard\|alternate; prepared by shop; sent to owner; owner forwarded to RR; endorsed; endorsing road; PDF; decline reason |
| settlement_calc_id | Owner-only worksheet |

### Estimates / tracks

- Same car, shop, and BO. Track field: `OWNER_CONTRACT` or `R107_RESP3` (Phase 1 names).
- Owner track: resp 1 (+ RESIDCO 4–9 internal splits).
- Wreck track: **resp 3 only**.
- **Two files required** — no system split of a mixed upload (Bruce).

### Shared attachments

- Photos/docs attach to `wreck_event` and appear on both estimates.
- **JIC photo set** picker enforces **4–10 photos per unit** (OM 103.A).

### `settlement_calc` (owner-only)

- Inputs: original/rebuilt/ILS cost (optional), built/rebuilt date, car type class (Exh. II), A&B items (type code + install date), lightweight, non-metallic weight, Al/SS weight.
- Outputs: reproduction cost, depreciated value, salvage value, settlement basis, cap.
- Store Exhibit edition used.

---

## 8. Rebill to damaging road (owner CRB) — shop never bills the RR

**Billing parties (Bruce §11 #3, #9):**

| Who | Bills whom | Notes |
|---|---|---|
| **Contract shop** | **Car owner** (for Resp 3 work on the wreck) | Shop invoice to owner only. Shop **never** bills the railroad. |
| **Owner (RESIDCO)** | **Damaging road** | Owner rebills by changing detail source and creating **rebuttal billing (CRB)**. |
| **Lessee** | — | **Never** any lessee rebill on wreck estimates. Wreck estimates are **excluded from Send Lessee** entirely (§9). |

After the shop’s invoice to the owner is approved (flags cleared by owner/managing partner; completed date allowed):

1. Owner generates outbound **500-byte CRIP** (rebill / rebuttal):
   - Billing party = RESIDCO mark; billed party = **damaging road** (not lessee).
   - Detail source **JI** (endorsed JIC), **DC** (DDCT defect card), **JD**, or rebuttal **DR** / **JR** as appropriate (OM 112.C — change source code for rebill).
   - Each line: resp 3; D/C or JIC party + date (cols 139–148); DDCT incident ID (col 341); component ID; matrix pricing (OM 111).
   - Format 8 subtotal per detail source; Format 6 BP contact; Format 8 ZZ; Format 9.
   - Destroyed unit: bill **DE** / JC **5199** for settlement value instead.
   - **No tax lines** on Resp 3 rebill (Bruce §11 #6).
2. Over-DV and other edge cases are resolved **owner-side** before/with the rebill (Bruce §11 #3, #5).
3. Track Railinc accept/reject + CBA exceptions; keep original file bytes.
4. **1–7% auto-pay tolerance** (OM 103.A.3.c): **out of scope** for shop/owner front end — park for back-end CRB / billed-party phase (Bruce §11 #7). Spec may still *display* expected auto-pay amount later; no short-pay exception queue in this UI slice.

---

## 9. Screens affected

| Screen | Change |
|---|---|
| **Bad Orders (§C)** | “Is Wreck?” opens wreck panel: DDCT incident ID, Rule 95.A condition, handling road, D/C or JIC, disposition → creates/links wreck event. |
| **Estimates History (§A)** | Wreck badge/filter; linked pair side by side; deep link to wreck event. |
| **Estimate Review (§D)** | Track context (Owner \| Wreck); strict-mode banner + hard errors on Wreck load path; “Move line to other track” (reason + audit); settlement meter link (owner); JIC photo-set picker when opened from event. |
| **Update Responsibilities** | Resp 3 lines locked to Wreck track. |
| **Wreck Event page (new)** | Timeline, documents, settlement worksheet (owner), JIC generator shell (PDF + Alternate email draft — build later), rebill builder/status, **deadline tracker**. |
| **Intake validation (§G)** | Wreck-tier rules when shop uploads the Resp 3 file. |
| **Send Lessee** | **Exclude wreck estimates entirely** — never Send Lessee / never lessee rebill on wreck (Bruce §11 #9). |
| **Shop token** | Upload **two** files **after JIC endorsement**; arrival; **no** DV; cannot clear flags. |
| **Lessee token** | §F for non-wreck; wreck events do not route here. |

---

## 10. Routes & information architecture (proposed)

| Route | Role | Purpose |
|---|---|---|
| `/#/repair/wreck/:eventId` | Owner | Wreck event dual-track home + deadlines + owner DV |
| `/#/repair/estimates/:id` | Owner | Existing §D (each track’s estimate) |
| `/#/repair/bad-orders` | Owner | §C; Is Wreck? / Wreck Est / DDCT fields feed event create |
| `/#/repair/e/:token` | Shop | Upload **two** files; arrival; **no** DV |
| `/#/repair/lessee/:token` | Lessee | §F for non-wreck only; wreck estimates never sent here |

`OPEN:` Final path name (`wreck` vs `events/:id/wreck`) — pick at build time; keep deep-linkable from §A `Wreck?` and BO history.

---

## 11. Open questions (remaining)

Resolved by Bruce (2026-10-14 six corrections + 2026-10-15 §11 answers) or this fold — **cleared**:

| # | Topic | Resolution |
|---|---|---|
| R1 | One mixed file + auto-split? | **Rejected.** Two separate files; mixed → HARD REJECT. |
| R2 | Missing CID on Resp 3 | **ACCEPT + FLAG**; block completed date + invoicing until cleared. |
| R3 | DV visibility / wiring | **Owner-only**; `RlmsRule107Calculator` interface unwired; original cost optional. |
| R4 | JIC clock zero | **Shop arrival date** on wreck event page. |
| R5 | DDCT integration this slice | Hand entry only (no API). |
| R6 | 5399 / settlement exhibits | Folded from OM 102.D.7 / 107.E / Exh. I–V; gauge + 5399 owner-side. |
| R7 (§11 #2) | Who prepares / sends JIC | **Contract shop** prepares → sends to **car owner** → owner submits to RR for endorsement. Detailed estimate files **after** endorsement only. |
| R8 (§11 #3) | Resp 3 rebill party | Shop bills **car owner**; **owner** rebills **damaging road** via source-code change + CRB rebuttal. Shop never bills the RR. Over-DV / edge cases owner-side. |
| R9 (§11 #5) | Over DV / settle vs repair | Resp 3 at/over DV → owner-only **warnings/flags**; **no auto-reject**; owner decides settle vs repair. |
| R10 (§11 #6) | Taxes on Resp 3 | **No taxes** on Resp 3 per AAR. Reject or flag tax lines on the Resp 3 file; owner absorbs that tax. |
| R11 (§11 #7) | 1–7% auto-pay tolerance | **Out of scope** for shop/owner front end; park for back-end CRB / billed-party phase. |
| R12 (§11 #8) | Resp 3 purity | Wreck Resp 3 estimate may contain **ONLY** resp 3 lines; any other code = **HARD REJECT**. |
| R13 (§11 #9) | Lessee / Send Lessee | **Never** lessee rebill on wreck. Wreck estimates **excluded from Send Lessee** entirely. |
| R14 (§11 #11) | Price Master source | **AAR Office Manual** or **Railinc** each quarter via Reference Data importer. Q4 2026 not out yet — keep current edition in use. |
| R15 (§11 #12) | Who clears flags | **Car owner** or **managing partner** only (audited). Shops fix data but cannot clear flags. |
| R16 (§11 #13) | JIC day counting | **Calendar days**. |
| R17 (§11 #1) | Original cost / A&B source | **Umler fields.** Manual owner entry for now; optional future RLMS Umler read (expect incomplete) → **inconsistent-tolerant**. Cost may be blank. |
| R18 (§11 #4) | Unpriced wreck labor rate | **AAR quarterly labor rate** from Reference Data **price master (current edition)**. |
| R19 (§11 #10) | Resp 3 invoice number | **Not required** on approval / estimate loads. **HARD REJECT** on shop’s **final invoice** load only if missing. |

All prior `OPEN:` items in §11 are **DECIDED**. Spec **approved**.

**Known gaps (data):** Exhibits IV, V, and Settlement Value Worksheet not yet extracted to CSV (complex layout). Railinc CRB Procedures Manual edit charts / error codes not in the OM/FM PDFs — pull separately for rebill validator. Contract-shop labor rates are contractual, not AAR-mandated (wreck unpriced check uses AAR quarterly labor rate, not contract rate).

---

## 12. Out of scope (this build)

- Live DDCT system integration (hand entry only).
- Wiring `RlmsRule107Calculator` to a hosted DV service (interface + stub only).
- Auto-splitting mixed Resp 3 uploads.
- Inventing full AAR shopping-reason lists or unpublished CRBDX codes.
- Full outbound CRB/CRIP rebill exporter polish beyond Phase 1 stub/notes (follow existing CRIP patterns).
- Screen E document polish / Screen F Lessee (still parked).

---

## 13. Build gate

| Step | Content | Status |
|---|---|---|
| **Spec** | This document (six corrections + all §11 answers incl. #1/#4/#10) | **Approved** |
| **Build** | Wreck event UI + Resp 3 hard validation + quarterly import + owner DV shell + JIC tracker + smokes | **Approved to build** on tip `85856b6` FF chain |

---

## 14. Source map

| Source | Use |
|---|---|
| Bruce corrections (2026-10-14) | **WIN** — event model, two files (no split), hard vs flag (CID → flag), quarterly rates, owner-only DV (unwired provider; optional cost), JIC clocks from shop arrival |
| Bruce §11 answers (2026-10-15) | JIC shop→owner→RR + files after endorse; owner CRB rebill (shop never bills RR); over-DV warn/flag owner decides; no Resp 3 taxes; 1–7% FE out of scope; Resp 3 purity hard reject; no Send Lessee on wreck; Price Master AAR/Railinc quarterly; flag clear owner/MP only; calendar days; #1 Umler/manual inconsistent-tolerant; #4 AAR quarterly labor rate; #10 invoice # not required on estimate loads / HARD REJECT on final invoice only |
| `WRECK_DUAL_TRACK.md` | Folded OM/FM citations, data model, JIC 4–10 photos, settlement exhibits/ref tables, rebill CRIP outline, timeline/billing limits, detail sources, screen list; conflicts overridden by Bruce |
| Manual_Gap_Review.md | RS #1 errors/warnings; #3 Resp 3 separate; #4 yard arrival |
| Railinc_Data_File_Reference.md / App. G | Detail Source R; critical marks; Format 1 R field list; Price Master note; DDCT col 341; CID col 327 |
| OWNER_UI_SPEC §G | Required Format-1 table; reject retention |
| Phase 1 brief | `event_tracks` OWNER_CONTRACT / R107_RESP3; quarterly pricing (validation timing per Bruce) |
| `shared/rule107.ts` | DV math reference for later provider |
| `estimate-load.ts` | Existing `RESP3_MIXED` ERROR |

---

## Bundle

- Spec tip: `docs/bundles/rlms-phase1-owner-ui-wreck-spec.bundle` — requires **`c8a7138`** → lands **`85856b6`**.
- Build tip: `docs/bundles/rlms-phase1-owner-ui-wreck.bundle` — requires **`85856b6`** → lands tip in companion README.
