# Cursor brief: Railcars workbench + JSS scrap sale (RESIDCO/RLMS, master)

## Ground rules (apply to every PR)
- **Migrations run on Supabase BEFORE merge.** A merge auto-deploys Render. Each migration is additive and idempotent (`IF NOT EXISTS`).
- **Every write goes through the shared capture:** `withChangeGroupResult` + `recordChange` with before/after, so it's undoable from Activity. One bulk apply = one change_group.
- **Every bulk write is preview → Bruce sign-off → apply.** The preview endpoint writes nothing. Apply takes the preview token/hash and re-validates.
- **Active cars only.** Inactive cars are rejected in preview ("inactive – left alone"), never written. Keep existing rules:
  - Sold wins.
  - Never deactivate a Sold car until `scrapped_at` is set.
  - The `applyCarStatusChange` guards stay.
- Don't touch: `RLMS_RECOMPUTE_FLEET_STATUS` (leave it unset), RepairSMART estimates, `RENDER_API_KEY` (never print it).
- Tests: add vitest coverage for each new server module (preview math, inactive reject, per-car dates, undo round-trip).

---

## PR R1: Schema (migration first, no UI)
Migration `2026xxxx_railcars_workbench.sql`:
```sql
alter table railcars add column if not exists scrapped_at date;
alter table railcars add column if not exists scrap_source text;
alter table railcars add column if not exists umler_status text
  check (umler_status in ('delete_requested','deleted'));
alter table railcars add column if not exists umler_status_at date;

create table if not exists car_tags (
  railcar_id int references railcars(id) on delete cascade,
  tag text not null,
  created_by text,
  created_at timestamptz default now(),
  primary key (railcar_id, tag));

create table if not exists car_lists (
  id serial primary key,
  name text not null,
  owner text,
  shared boolean default false,
  query jsonb,
  created_at timestamptz default now());

create table if not exists car_list_members (
  list_id int references car_lists(id) on delete cascade,
  railcar_id int references railcars(id),
  primary key (list_id, railcar_id));
```
- Add the new columns to `v_rlms_kpi_car_rows`, with the view's column order unchanged plus the new ones appended: scrapped_at, umler_status, tags (string_agg), latest_rent_stop_type, latest_rent_stop_date.
- Add the columns to the Drizzle schema in `shared/schema.ts`.
- Register `car_tags`, `car_lists` and the new railcar columns with the undo engine (row_pk mapping).

## PR R2: Direct Off rent rent stop + per-car dates
In `server/rent-stops.ts`:
- `POST /api/rent-stops/car/:id/off-rent` with body `{stop_date, reason, reason_other, note}`. It creates a `type='Off rent'` stop directly, not just through conversion.
- Bulk preview/apply accept `type: 'Abatement'|'Off rent'` and **either** `stop_date` (shared) **or** `rows: [{car, stop_date, note?}]` (per car).
- Preview returns per car: matched, inactive (rejected), existing open stop (rejected or "already off rent"), date before rent_start or after today (warning), not found.
- Apply: one change_group, `recordChange` per inserted row.
- Don't change `assignment_history`. Ending the assignment stays with the existing return/sold flows.
- Off-rent cars count as off rent in `v_rlms_kpi_car_rows.on_rent` and `rlms_fleet_kpis()`, in the same place Abatement is handled. Check with a before/after KPI diff in the PR description.

## PR R3: Unified bulk-apply engine (server)
- New module `server/railcar-bulk.ts` with `POST /api/railcars/bulk/preview` and `/apply`.
- Payload: `{cars: string[] | railcar_ids, ops: Op[], per_car?: {car, field, value}[]}`.
- Supported ops:
  - `add_note`: writes the same notes store as `/api/activity/notes`, one note per car.
  - `add_tag` / `remove_tag`
  - `set_status`: through `applyCarStatusChange` and its guards.
  - `mark_sold` / `unmark_sold`: through `applyMarkSold`. Verified: `applyMarkSold` already records before-values. Add a per-car `effective_date`.
  - `set_commitment` / `clear_commitment`: reuse the commitment module.
  - `rent_stop`: reuse R2.
  - `set_scrapped_at`
  - `set_umler_status`
  - `deactivate`: blocked unless the car has `scrapped_at`, or the car isn't Sold.
- The preview returns a table of car, field, before, after, status (ok/warn/reject) and reason, plus a `preview_hash`.
- Apply checks the hash, runs everything in **one transaction** and **one change_group**, and returns the undo link.
- Leave the old per-feature endpoints in place. They can later call the engine.

## PR R4: Railcars workbench UI (`FleetRegistry.tsx` split)
- Split `FleetRegistry.tsx` into `pages/railcars/{RailcarsPage, RailcarsGrid, BulkEditDrawer, PasteSearchBar, SavedFilters, CarDetail}.tsx`, without changing behavior first.
- **Paste search bar:** accepts any list (commas, newlines, tabs, "TFOX 1036", "TFOX001036"). The results strip shows matched / not found (copy button) / duplicates / inactive.
- **Grid:**
  - Keep `useColumnPrefs("fleet_registry")` and the ColumnPicker.
  - Add per-column header filters (text, in-list, date range, empty / not empty).
  - New columns: tags, last note, rent stop, scrapped_at, umler_status, buyer, program, commitment.
  - Shift-click range select. "Select all N matching." A "Show selected only" toggle.
- **Saved filters:** stored in `car_lists.query` (shared or private), shown in a dropdown next to the search box.
- **Export:** a "Selected (N)" / "All results (M)" choice, as CSV or xlsx, with the visible columns.
- **Bulk edit drawer:** fields for note, tags, status, buyer/Mark Sold, commitment, rent stop (Off rent or Abatement), cut-up date, UMLER.
  - Each date field has a toggle: "one date for all" or "per car (paste car,date or upload CSV)".
  - Flow: Preview → diff table (red rejects, amber warnings) → "Apply N changes" → undo toast.
- **Saved list:** "Save selection as list…" and "Promote list to program…" (opens the existing program create, prefilled).

## PR R5: CSV/XLS import of per-car values
- An "Import…" button in the drawer. It parses csv, xls or xlsx client-side, or server-side with SheetJS.
- Column mapper: car column (or mark + number), value column, target field (off-rent date / cut-up date / note / tag / UMLER status). Excel serial dates are converted. Blank and text values are skipped, or go into the note.
- Then the R3 preview, sign-off and apply.
- Test with Bruce's `TFOX CUT UPS.xls` (it has duplicate rows and text rows in the date column) and the CSX trace CSV (Y/M/D columns, filter Event Text = ACTUAL PLACEMENT).

## PR R6: UMLER deletion queue + scrap close-out
- `#/railcars/umler-queue` lists cars with `scrapped_at` set and `umler_status` not 'deleted'.
- Bulk "Mark deleted in UMLER (date)" goes through the engine.
- Program milestone: `scrapped_at` set counts as program done. Hook it into `rlms_program_car_is_program_done()`, and add a test that OL1503 completion doesn't regress.
- Optional prompt: after UMLER deleted, offer "Make inactive". Use the Inactive path; it only appears if scrapped_at is set.

## JSS data load (after R2/R3 are deployed): preview only until Bruce signs off
**Bundle files** (`cursor_railcars_bundle.zip`):
- `jss_preview.csv`: the per-car plan, 45 rows.
- `jss_source.xls`: JSS "TFOX CUT UPS" cut-up confirmations, including the WILL NOT MAKE, EXTRA and LOST rows.
- `jss_source.csv`: CSX trace with the last sighting for 35 cars.

The R5 importer must reproduce `jss_preview.csv` from `jss_source.xls` + `jss_source.csv` plus the overrides below.

**Bruce's rules (10/17, final):**
- **Arrival = off-rent date, always.** The off-rent date is the last trace arrival at the industry.
  - Industry = **Benning DC, Cumberland MD, Jessup MD**.
  - An arrival is an ACTUAL PLACEMENT at any of these, **or a RELEASED event at Benning DC** (DOA, counts as arrived on that event date).
  - The cut-up date never overrides it.
- **Sale date = cut-up date.** Mark Sold to "Joseph Smith & Sons" only when the car is cut up.
- **Off rent and sale only for cars with both an arrival and a cut-up date.**
- **When cut-up < arrival:** still apply both. Off rent uses the arrival date, and the car gets an extra comment noting the discrepancy (`discrepancy_comment` column, included in `note`).
- **Manual overrides from Bruce:**
  - **TFOX 100284** (OL1961): arrival/off-rent = 9/14 per Bruce (it has no trace row). Cut-up 9/14, sale 9/14. Note: "arrival date per Bruce, no trace row". **End its OL1961 assignment**, not OL1724.
  - **3037 / 3195:** cut-up and sale date 9/15 confirmed (the source file also has 9/14 rows; ignore those). Arrivals are 9/03 and 9/10 from the trace.
- **Notes only, stays on rent:** lost cars 1441 and 3258, and the will-not-make cars.
- **1621** is inactive: untouched.

**Group A: 36 cars** (`action = off_rent+sold+cut_up+umler_queue+note`):
- 25 with ACTUAL PLACEMENT
- 10 RELEASED at Benning DC: 1036, 1048, 1073, 1137, 1223, 1232, 1329, 1382, 1438, 1651
- 100284, with its arrival per Bruce

Each step below is its own preview → sign-off → apply → change_group, in this order:
1. **Off rent.** R2 bulk rent stop, `type='Off rent'`, per-car `stop_date = off_rent_date`, reason `other`, reason_other "JSS scrap sale – arrived at industry".
   - `lease_ref` = the car's current lease: OL1724 for 35 cars, **OL1961 for 100284**.
2. **Assignment end** on the **same date** (`assignment_end_date = off_rent_date`). Close the car's open assignment (OL1724, or OL1961 for 100284) through the existing return/end-assignment write path, with `recordChange` before/after. Don't create a new assignment.
3. **Mark Sold**, buyer "Joseph Smith & Sons", effective date = `sale_date`, which is 13 distinct dates.
   - `applyMarkSold` already captures before-values (verified on master), but it takes one `effective_date` per apply.
   - Either add per-car dates through the R3 engine, or run one apply per date.
   - The car stays active.
4. **Cut-up and UMLER:** `scrapped_at = cut_up_date`, `scrap_source='JSS cut-up confirmation'` (100284: `'JSS cut-up confirmation; arrival per Bruce'`), `umler_status='delete_requested'`.
5. **Note and tag:** `add_note` (`note` column, which includes the discrepancy comment) and `add_tag 'JSS scrap sale 2026'`.
6. **Inactive** happens later, from the UMLER queue once deletion is confirmed. It isn't part of this load.

**Discrepancy comments, cut-up < arrival (8 cars):**

| Car | Cut-up | Arrival (off rent) |
|---|---|---|
| 1221 | 8/01 | 8/14 |
| 1390 | 8/01 | 8/14 |
| 3065 | 8/01 | 8/22 |
| 3267 | 8/01 | 8/18 |
| 3297 | 9/23 | 9/24 |
| 1048 | 10/07 | 10/11 |
| 1329 | 10/07 | 10/11 |
| 1382 | 10/07 | 10/11 |

For these cars the Sold history row will be dated before the assignment end. That's expected under Bruce's rule, so show a warning but don't block. If R2 finds an existing open rent stop, or an assignment that has already ended, reject that car and list it.

**Group B: 8 cars, note and tag only** (`action = note_only`). No rent stop, no Sold, no scrapped_at.
- Will not make: 1230, 1352, 1645, 3254, 3302, 3320
- Lost: 1441, 3258

**Group C: 1 car:** TFOX 001621, inactive, no writes. The preview shows it as `rejected: inactive`.

The import must be idempotent. A later re-run with a new trace or cut-up file moves cars from B to A once both dates exist, and skips cars that already have the same Off rent stop, Sold status or scrapped_at.
