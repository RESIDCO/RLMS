# Lease date authority

## Decision (2026-10-18)

`riders.expiration_date` is the authoritative OL expiry when `expiration_source` is `asset_report` or `asset_report_multi_term`.

That date is governed by `server/govern-lease-dates.ts` and `shared/lease-governance.ts` (commit 2d3ac69, 24 Aug 2026). Governance runs on every VCF commit. It uses the latest Asset Report snapshot and, when an OL is split across rows, the soonest date.

- `car_records` is the V_Valid fallback. Those riders go on the CRM check-date watch list. They are not renewal candidates.
- A null expiry means the date is unknown.
- A renewal keeps the same OL number. Only its dates change, and the CRM does not write `riders.expiration_date`. The governed date arrives through the Asset Report / VCF commit.
- A re-lease to a new lessee, or out of an EA, gets a new OL through Lease Management remarket. The CRM does not create OLs, lessees, or accounts.

The 13 Aug 2026 note below treated `riders.expiration_date` as a stale cache. That note is superseded. Dashboard KPIs still use car-level on-rent status (`v_rlms_kpi_car_rows` / `rlms_fleet_kpis`), not the rider expiry, to decide whether a car is on rent.

## Previous note (2026-08-13, superseded)

Source of truth then recorded for lease status, lessee, and OL code was the `railcars` fields maintained by the monthly VCF import (`rider_external_id`, `lessee_name`, `assignment_label`, `lease_start_date` / `lease_end_date` / `lease_expiry`). `riders.expiration_date` had been seeded early and had gone stale. Do not reintroduce Dashboard / expiration-timeline / Active OL counts from the riders table without re-validating against car-level fields.
