# Import write boundaries — `riders.account_manager`

`riders.account_manager` is set only in Lease Management (Edit Rider / Add Rider). It is never stored on `railcars`. The Railcars "Acct Mgr" column is a live join: `railcars.rider_external_id` → `riders.schedule_number`.

Named never-write list: `RIDER_IMPORT_NEVER_WRITE` in `shared/rider-import-guard.ts` currently `["account_manager"]`. Every importer rider insert/update runs `assertRiderImporterPatch` (or the typed payload helpers) against that list.

## Two different importers

| Importer | Route | Creates new `riders` rows? |
|---|---|---|
| **Valid Car File** | `POST /api/import/vcf/commit` | **No.** Writes `railcars`, `assignment_history`, `car_number_history`. After commit, expiration sync may patch existing riders' dates only. |
| **Master Car List** | `POST /api/import/commit` | **Yes**, for an OL/lessee not already in `riders`. New rows go through `assertRiderImporterPatch` so `account_manager` cannot be on the insert. |
| **Financial Data Refresh** | `POST /api/import/financial/commit` | **No.** Writes `rider_financial_summary` + listed car financial fields. Fill-if-blank on riders is allowlisted to `monthly_rent_per_car` only (`RIDER_FINANCIAL_FILL_BLANK_FIELDS`). |

Do-not-touch for all three: **`riders.account_manager`**.

## Valid Car File (`POST /api/import/vcf/commit`)

Normal re-import writes:

- `railcars` (car attributes from V_VALID_CARS, with guarded `entity` / `active` / `fleet_status` exceptions)
- `assignment_history` (VCF periods, `moved_by = vcf-import`)
- `car_number_history` (remarks, `changed_by = vcf-import`)

It does **not** insert `riders` or `master_leases`. There is no VCF new-rider auto-create path.

After commit, `syncRiderExpirationsFromCars` may patch `riders.expiration_date` and (when known) `riders.effective_date` via `riderVcfExpirationSyncPayload` (`RIDER_VCF_EXPIRATION_SYNC_FIELDS` only).

Code: `server/routes.ts` (`/api/import/vcf/commit`), `shared/vcf-import.ts`, `server/sync-rider-expirations.ts`.

## Financial Data Refresh / Asset Report (`POST /api/import/financial/commit`)

Writes:

- `rider_financial_summary` (replace that `snapshot_month` only)
- four per-car financial fields on `railcars` plus `financial_snapshot_month` (`RAILCAR_FINANCIAL_REFRESH_FIELDS` in `shared/financial-import.ts`: `nbv`, `oec`, `monthly_rent_per_car`, `monthly_depr_per_car`, `financial_snapshot_month`)
- estimated lease expiry columns on `railcars` (`refreshEstimatedLeaseExpiry`)

Fill-if-blank on riders uses `riderFinancialFillBlankPayload("monthly_rent_per_car", …)` — allowlist `RIDER_FINANCIAL_FILL_BLANK_FIELDS`, plus `RIDER_IMPORT_NEVER_WRITE` so `account_manager` is an explicit exclusion, not an accidental omission.

Code: `server/routes.ts` (`/api/import/financial/commit`), `shared/financial-import.ts`, `server/rider-rent-rollup.ts`, `shared/rider-import-guard.ts`.

## Master Car List (`POST /api/import/commit`)

Can insert missing `master_leases` / `riders` for new lessees/OLs. Insert payloads are passed through `assertRiderImporterPatch` before write. Not a Valid Car File load.

New Lease Setup and Add Rider also insert riders without `account_manager`.
