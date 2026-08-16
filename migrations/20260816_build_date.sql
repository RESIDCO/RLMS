-- Full Built Date from the equipment CSV (MM/DD/YYYY). Additive.
-- Do not drop or rewrite build_year / built_year.

ALTER TABLE public.railcars
  ADD COLUMN IF NOT EXISTS build_date date;

COMMENT ON COLUMN public.railcars.build_date IS
  'Full built date (month/day/year) from the equipment CSV. Grid/KPI still use build_year.';
