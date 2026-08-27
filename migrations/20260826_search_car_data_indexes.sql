-- Search: index car-data fields used by scoped /api/railcars and /api/search.
-- car_type / equipment_type_code are short AAR codes (exact + prefix) → B-tree.
-- general_description / mechanical_designation need substring match ("gon") → trigram GIN.
-- Safe to re-run. Does not change application data.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_railcars_car_type
  ON public.railcars (car_type);

CREATE INDEX IF NOT EXISTS idx_railcars_equipment_type_code
  ON public.railcars (equipment_type_code);

CREATE INDEX IF NOT EXISTS idx_railcars_general_description_trgm
  ON public.railcars USING gin (general_description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_railcars_mechanical_designation_trgm
  ON public.railcars USING gin (mechanical_designation gin_trgm_ops);
