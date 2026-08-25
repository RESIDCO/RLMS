-- Asset Report governs lease/OL dates (including copies on railcars).
-- V_Valid backfills only when Asset Report has no row for that OL.

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS expiration_source text,
  ADD COLUMN IF NOT EXISTS expiration_snapshot_month date;

COMMENT ON COLUMN public.riders.expiration_source IS
  'asset_report = rider_financial_summary; car_records = V_Valid/car-level fallback when Asset Report is silent.';

COMMENT ON COLUMN public.riders.expiration_snapshot_month IS
  'Asset Report snapshot_month that produced expiration_date; null for car-record fallback.';

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS lease_date_source text;

COMMENT ON COLUMN public.railcars.lease_date_source IS
  'How lease_start/end/expiry were last governed: asset_report or car_records. Intrinsic car fields stay V_Valid.';
