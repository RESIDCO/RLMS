/**
 * Bundled US/CA/MX places geocode (GeoNames cities5000).
 * Free/local only — no runtime paid geocoder.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { q } from "../db";

export type PlaceRow = {
  name: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
  population: number;
};

type SeedPlace = {
  name: string;
  name_lc: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
  pop: number;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_JSON = join(__dirname, "../data/places-us-ca-mx.json");

function loadSeedPlaces(): SeedPlace[] {
  const raw = JSON.parse(readFileSync(SEED_JSON, "utf8")) as SeedPlace[];
  const out: SeedPlace[] = [];
  for (const p of raw) {
    const name = String(p.name ?? "").trim();
    const nameLc = String(p.name_lc ?? name).trim().toLowerCase();
    const state = String(p.state ?? "").trim().toUpperCase();
    const country = String(p.country ?? "").trim().toUpperCase();
    if (!name || !nameLc || !state || !["US", "CA", "MX"].includes(country)) {
      continue;
    }
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      name,
      name_lc: nameLc,
      state,
      country,
      lat,
      lng,
      pop: Number(p.pop) || 0,
    });
  }
  return out;
}

export async function seedPlacesFromBundle(): Promise<{
  inserted: number;
  updated: number;
  total: number;
}> {
  const places = loadSeedPlaces();
  const before = await q(`SELECT count(*)::int AS n FROM repair.places`);
  const beforeN = Number(before.rows[0]?.n ?? 0);

  const BATCH = 200;
  for (let i = 0; i < places.length; i += BATCH) {
    const chunk = places.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values: string[] = [];
    chunk.forEach((p, idx) => {
      const o = idx * 7;
      values.push(
        `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},'geonames_cities5000')`,
      );
      params.push(p.name, p.name_lc, p.state, p.country, p.lat, p.lng, p.pop);
    });
    await q(
      `INSERT INTO repair.places
         (name, name_lc, state, country, lat, lng, population, source)
       VALUES ${values.join(",")}
       ON CONFLICT (country, state, name_lc) DO UPDATE SET
         name = EXCLUDED.name,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         population = EXCLUDED.population`,
      params,
    );
  }

  const after = await q(`SELECT count(*)::int AS n FROM repair.places`);
  const afterN = Number(after.rows[0]?.n ?? 0);
  const inserted = Math.max(0, afterN - beforeN);
  const updated = Math.max(0, places.length - inserted);
  return { inserted, updated, total: places.length };
}

export function validateLatLng(
  lat: number | null | undefined,
  lng: number | null | undefined,
):
  | { ok: true; lat: number | null; lng: number | null }
  | { ok: false; error: string } {
  const la = lat == null || (lat as unknown) === "" ? null : Number(lat);
  const ln = lng == null || (lng as unknown) === "" ? null : Number(lng);
  if ((la == null) !== (ln == null)) {
    return {
      ok: false,
      error: "Latitude and longitude must both be set or both cleared",
    };
  }
  if (la == null && ln == null) return { ok: true, lat: null, lng: null };
  if (!Number.isFinite(la!) || !Number.isFinite(ln!)) {
    return { ok: false, error: "Latitude / longitude must be numbers" };
  }
  if (la! < -90 || la! > 90) {
    return { ok: false, error: "Latitude must be between -90 and 90" };
  }
  if (ln! < -180 || ln! > 180) {
    return { ok: false, error: "Longitude must be between -180 and 180" };
  }
  return { ok: true, lat: la, lng: ln };
}

/** Resolve City + ST → lat/lng. Prefer US, then CA, then MX. */
export async function geocodeCityState(
  city: string,
  state: string,
): Promise<PlaceRow | null> {
  const nameLc = city.trim().toLowerCase();
  const st = state.trim().toUpperCase();
  if (!nameLc || !/^[A-Z]{2}$/.test(st)) return null;
  const { rows } = await q(
    `SELECT name, state, country, lat, lng, population
     FROM repair.places
     WHERE name_lc = $1 AND state = $2
     ORDER BY CASE country WHEN 'US' THEN 0 WHEN 'CA' THEN 1 ELSE 2 END,
              population DESC
     LIMIT 1`,
    [nameLc, st],
  );
  if (!rows[0]) return null;
  return {
    name: String(rows[0].name),
    state: String(rows[0].state),
    country: String(rows[0].country),
    lat: Number(rows[0].lat),
    lng: Number(rows[0].lng),
    population: Number(rows[0].population) || 0,
  };
}
