-- GATED: do not run until Bruce has signed off on
-- script/kpi_migration_previews/*.csv
-- (preview_retag.csv, review_idle_on_ol.csv, preview_seed_idle.csv, preview_seed_unassigned.csv).
-- This file is intentionally a no-op so it cannot be applied by accident.

SELECT 'blocked: wait for KPI migration 2026-10 sign-off' AS status;
