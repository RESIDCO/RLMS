# Places geocode table (US / CA / MX)

Source: **GeoNames** `cities5000` dump — free under the Creative Commons
Attribution 4.0 License (https://www.geonames.org / https://download.geonames.org/export/dump/).

- File: `cities5000.zip` downloaded 2026-10-14
- Filter: country codes **US**, **CA**, **MX** only; population ≥ 5,000
- Fields kept: ASCII name, admin1 → 2-letter state/province, lat, lng, population
- US admin1 already 2-letter; CA/MX mapped to postal / ISO-3166-2 style codes
- Deduped by `(country, state, name_lc)` keeping highest population
- Bundled as `places-us-ca-mx.json` (~10.6k rows, ~1.2 MB); seeded into `repair.places`

Shop map pins resolve **City + ST** against this table (prefer US, then CA, then MX).
Manual `lat_override` / `lng_override` on `repair.shops` wins when set.

No paid geocoder. No runtime calls to GeoNames or other geocode APIs.
