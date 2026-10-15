Preview CSVs are generated after `20261016_car_commitments_derived_status.sql` is applied (views only; no tag/seed writes):

```
npx tsx script/kpi_migration_previews.ts
```

Expected from the brief (2026-10-15): retag 119, idle-on-OL 96, seed Idle 238, Unassigned 100, Off Rent 338.

Do not run `migrations/20261016_kpi_migration_apply_DO_NOT_RUN.sql` until Bruce signs off on the CSVs.
