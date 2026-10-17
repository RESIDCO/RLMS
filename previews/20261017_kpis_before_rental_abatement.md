# KPI snapshot before first abatement apply (live 2026-10-17)

From `rlms_fleet_kpis()` after tracker sync, before any `car_rent_stops` rows:

- idle 242
- unassigned 45
- sold 1021
- leased 14208
- off_rent 287
- in_program 841
- going_on_lease_cars 6
- active_including_sold 15516
- abatement 0 (hardcoded in core)

After this migration, with zero open abatement stops:

- `kpis.rental_abatement` = 0
- `kpis.abatement` = 0
- leased / idle / unassigned / off_rent unchanged vs core

TFOX 000430 (id 29330) if later applied (not applied now): on-rent −1, rental_abatement +1, Idle and Unassigned unchanged.
