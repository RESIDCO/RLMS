-- Trigram indexes for /api/search ILIKE '%term%' filters.
-- Safe to re-run. Does not change application data.
-- Column list matches server/global-search.ts + server/railcar-list.ts
-- (railcars text fields, riders, master_leases). assignment_history is not searched.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_railcars_reporting_marks_trgm
  ON public.railcars USING gin (reporting_marks gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_railcars_car_initial_trgm
  ON public.railcars USING gin (car_initial gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_railcars_car_number_trgm
  ON public.railcars USING gin (car_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_railcars_lessee_name_trgm
  ON public.railcars USING gin (lessee_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_railcars_rider_external_id_trgm
  ON public.railcars USING gin (rider_external_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_railcars_assignment_label_trgm
  ON public.railcars USING gin (assignment_label gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_riders_rider_name_trgm
  ON public.riders USING gin (rider_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_riders_schedule_number_trgm
  ON public.riders USING gin (schedule_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_master_leases_lease_number_trgm
  ON public.master_leases USING gin (lease_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_master_leases_lessee_trgm
  ON public.master_leases USING gin (lessee gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_master_leases_lessor_trgm
  ON public.master_leases USING gin (lessor gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_master_leases_agreement_number_trgm
  ON public.master_leases USING gin (agreement_number gin_trgm_ops);
