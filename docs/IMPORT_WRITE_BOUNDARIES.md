# Import write boundaries — account manager

`accounts.account_manager` is set only in Account Management (account detail). It is never stored on `railcars`. The Railcars "Acct Mgr" column is a live join:

`railcars.rider_external_id` → `riders.schedule_number` → `riders.master_lease_id` → `master_leases.account_id` → `accounts.account_manager`.

`riders.account_manager` is **deprecated and unused** (column kept, not dropped). Importers must still never write it.

Named never-write lists in `shared/rider-import-guard.ts`:

- `RIDER_IMPORT_NEVER_WRITE` currently `["account_manager", "status_tag"]` — every importer rider insert/update runs `assertRiderImporterPatch`.
- `ACCOUNT_IMPORT_NEVER_WRITE` currently `["account_manager"]` — Master Car List account bootstrap uses `assertAccountImporterPatch` (name only; manager stays null).

## Two different importers

| Importer | Route | Creates new `riders` rows? |
|---|---|---|
| **Valid Car File** | `POST /api/import/vcf/commit` | **No.** Writes `railcars`, `assignment_history`, `car_number_history`. After commit, expiration sync may patch existing riders' dates only. |
| **Master Car List** | `POST /api/import/commit` | **Yes**, for an OL/lessee not already in `riders`. New rider rows go through `assertRiderImporterPatch`. New `master_leases` rows get `account_id` via `ensureAccountForLessee` (match or create `accounts` by lessee name; `account_manager` left null). |
| **Financial Data Refresh** | `POST /api/import/financial/commit` | **No.** Writes `rider_financial_summary` + listed car financial fields. Fill-if-blank on riders is allowlisted to `monthly_rent_per_car` only. |

Do-not-touch for all three: **`accounts.account_manager`**, **`riders.account_manager`** (deprecated), **`riders.status_tag`**, and **`rider_account_comments`** (append-only AM notes; not part of any import payload).

`riders.status_tag` is written only by `PATCH /api/account-management/riders/:riderId/status-tag`. OL notes are written only by `POST /api/account-management/riders/:riderId/comments` (session author; body `body` only). Admin-only `DELETE /api/account-management/comments/:commentId` is the escape hatch. No importer references `rider_account_comments`. Lease Management `POST`/`PATCH /api/riders` still strips `status_tag` / leftover `account_mgmt_comment` keys.

Those write routes use `requireAccountMgmtWrite` (any role, including Viewer), except comment delete which is `requireAdmin`.

Named never-write lists in `shared/rider-import-guard.ts`:

- `RIDER_IMPORT_NEVER_WRITE` currently `["account_manager", "status_tag"]`. Master Car List new-rider inserts go through `assertRiderImporterPatch`. Financial fill-blank uses `riderFinancialFillBlankPayload` (`monthly_rent_per_car` only). VCF/Asset Report date governance uses `riderLeaseGovernancePayload` (`expiration_date` / `expiration_source` / `expiration_snapshot_month` only).
- `ACCOUNT_IMPORT_NEVER_WRITE` currently `["account_manager"]`.

## Valid Car File (`POST /api/import/vcf/commit`)

Does **not** insert `riders`, `master_leases`, or `accounts`.

After commit, `governLeaseDates` re-applies Asset Report lease/OL dates onto `riders.expiration_date` and the car-level copies (`lease_end_date` / `lease_expiry` / `estimated_lease_expiry` / `lease_start_date` from `riders.effective_date`). V_Valid car dates are used only for OLs the Asset Report omits. It does not write `effective_date` on riders.

## Financial Data Refresh / Asset Report (`POST /api/import/financial/commit`)

Fill-if-blank on riders uses `riderFinancialFillBlankPayload("monthly_rent_per_car", …)`.

After writing `rider_financial_summary`, the same `governLeaseDates` pass upserts `riders.expiration_date` from `snapshot_month + months_until_lease_exp` (soonest date if an OL is split across rows) and pushes that date down to every car on the OL.

## Master Car List (`POST /api/import/commit`)

Can insert missing `master_leases` / `riders` / `accounts` (name only) for new lessees. Does not write `accounts.account_manager`. Does not insert `rider_account_comments`.
