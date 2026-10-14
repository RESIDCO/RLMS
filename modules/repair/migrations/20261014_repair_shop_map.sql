-- 20261014_repair_shop_map.sql
-- OWNER_UI §B part 3 — Shop map: lat/lng override + bundled places geocode table.
-- APPLY ONLY to local Postgres. Schema "repair" only.
-- Free/local only — no paid geocoder.

BEGIN;

ALTER TABLE repair.shops
  ADD COLUMN IF NOT EXISTS lat_override double precision,
  ADD COLUMN IF NOT EXISTS lng_override double precision;

COMMENT ON COLUMN repair.shops.lat_override IS
  'Optional manual latitude override for shop map pin. When null, geocode via repair.places (city/ST).';
COMMENT ON COLUMN repair.shops.lng_override IS
  'Optional manual longitude override for shop map pin. When null, geocode via repair.places (city/ST).';

-- Bundled free places (US/CA/MX) for City/ST → lat/lng. Seeded from places-us-ca-mx.json.
CREATE TABLE IF NOT EXISTS repair.places (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  name_lc       text NOT NULL,
  state         text NOT NULL,
  country       text NOT NULL CHECK (country IN ('US', 'CA', 'MX')),
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  population    int NOT NULL DEFAULT 0,
  source        text NOT NULL DEFAULT 'geonames_cities5000',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, state, name_lc)
);

CREATE INDEX IF NOT EXISTS places_lookup_idx
  ON repair.places (name_lc, state, country);

CREATE INDEX IF NOT EXISTS places_state_idx
  ON repair.places (country, state);

COMMENT ON TABLE repair.places IS
  'Bundled GeoNames cities5000 (US/CA/MX) for free City/ST geocoding. No runtime paid geocoder.';

COMMIT;
