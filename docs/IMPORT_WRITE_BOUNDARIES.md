# Import write boundaries — account manager

`accounts.account_manager` is set only in Account Management (account detail). It is never stored on `railcars`. The Railcars "Acct Mgr" column is a live join:

`railcars.rider_external_id` → `riders.schedule_number` → `riders.master_lease_id` → `master_leases.account_id` → `accounts.account_manager`.

`riders.account_manager` is **deprecated and unused** (column kept, not dropped). Importers must still never write it.

Named never-write lists in `shared/rider-import-guard.ts`:

- `RIDER_IMPORT_NEVER_WRITE` currently `["account_manager"]` — every importer rider insert/update runs `assertRiderImporterPatch`.
- `ACCOUNT_IMPORT_NEVER_WRITE` currently `["account_manager"]` — Master Car List account bootstrap uses `assertAccountImporterPatch` (name only; manager stays null).

## Two different importers

| Importer | Route | Creates new `riders` rows? |
|---|---|---|
| **Valid Car File** | `POST /api/import/vcf/commit` | **No.** Writes `railcars`, `assignment_history`, `car_number_history`. After commit, expiration sync may patch existing riders' dates only. |
| **Master Car List** | `POST /api/import/commit` | **Yes**, for an OL/lessee not already in `riders`. New rider rows go through `assertRiderImporterPatch`. New `master_leases` rows get `account_id` via `ensureAccountForLessee` (match or create `accounts` by lessee name; `account_manager` left null). |
| **Financial Data Refresh** | `POST /api/import/financial/commit` | **No.** Writes `rider_financial_summary` + listed car financial fields. Fill-if-blank on riders is allowlisted to `monthly_rent_per_car` only. |

Do-not-touch for all three: **`accounts.account_manager`** and **`riders.account_manager`**.

## Valid Car File (`POST /api/import/vcf/commit`)

Does **not** insert `riders`, `master_leases`, or `accounts`.

After commit, `syncRiderExpirationsFromCars` may patch `riders.expiration_date` and (when known) `riders.effective_date` via `riderVcfExpirationSyncPayload`.

## Financial Data Refresh / Asset Report (`POST /api/import/financial/commit`)

Fill-if-blank on riders uses `riderFinancialFillBlankPayload("monthly_rent_per_car", …)`.

## Master Car List (`POST /api/import/commit`)

Can insert missing `master_leases` / `riders` / `accounts` (name only) for new lessees. Does not write `accounts.account_manager`.
