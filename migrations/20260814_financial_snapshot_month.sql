-- Stamp which Asset Report month last wrote per-car financials.
-- Safe to re-run.

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS financial_snapshot_month date;

COMMENT ON COLUMN public.railcars.financial_snapshot_month IS
  'snapshot_month of rider_financial_summary that last wrote nbv, oec, monthly_rent_per_car, monthly_depr_per_car.';
