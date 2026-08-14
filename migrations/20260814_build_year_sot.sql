-- Fleet age SoT: railcars.build_year is the column Fleet Registry, import, and
-- the Turning 50 KPI read. built_year remains for the DV calculator; import
-- mirrors build_year into built_year so the two stay in sync going forward.
-- Do not DROP built_year.

COMMENT ON COLUMN public.railcars.build_year IS
  'Fleet source of truth for car build year (Master Car List / age KPIs).';

COMMENT ON COLUMN public.railcars.built_year IS
  'Legacy DV/UMLER build year. Prefer build_year for fleet UI; import writes both.';
