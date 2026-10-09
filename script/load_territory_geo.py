"""
One-off Census 2020 loader for RLMS Territory Map.
Reads script/_census2020 extracts, writes client/public/geo/us-counties-2020.json,
upserts geo_counties / geo_zips, then seeds territory_county_assignments.
"""
from __future__ import annotations

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

import shapefile  # pyshp

ROOT = Path(__file__).resolve().parents[1]
CENSUS = ROOT / "script" / "_census2020"
SHP = CENSUS / "county_shp" / "cb_2020_us_county_20m.shp"
REL = CENSUS / "tab20_zcta520_county20_natl.txt"
GAZ = CENSUS / "gaz" / "2020_Gaz_zcta_national.txt"
OUT_GEO = ROOT / "client" / "public" / "geo" / "us-counties-2020.json"

STATE_FIPS = {
    "01", "02", "04", "05", "06", "08", "09", "10", "11", "12", "13", "15",
    "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27",
    "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39",
    "40", "41", "42", "44", "45", "46", "47", "48", "49", "50", "51", "53",
    "54", "55", "56",
}


def load_dotenv():
    p = ROOT / ".env.local"
    if not p.exists():
        return
    for line in p.read_text(encoding="latin-1").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def rest(method: str, path: str, body=None, prefer: str | None = None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + path
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_ANON_KEY"]
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8")) if raw else None
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"REST {method} {path} failed {e.code}: {err[:800]}") from e


def sql(query: str):
    # PostgREST can't run arbitrary SQL; use supabase rpc only. Callers use rest inserts.
    raise NotImplementedError


def build_counties():
    r = shapefile.Reader(str(SHP))
    fields = [f[0] for f in r.fields[1:]]
    features = []
    rows = []
    for sr in r.shapeRecords():
        rec = dict(zip(fields, sr.record))
        statefp = str(rec.get("STATEFP") or "").zfill(2)
        geoid = str(rec.get("GEOID") or "").zfill(5)
        name = str(rec.get("NAME") or "").strip()
        if statefp not in STATE_FIPS or len(geoid) != 5:
            continue
        geom = sr.shape.__geo_interface__
        features.append({
            "type": "Feature",
            "id": geoid,
            "properties": {"name": name, "statefp": statefp},
            "geometry": geom,
        })
        rows.append({"county_fips": geoid, "statefp": statefp, "name": name})
    OUT_GEO.parent.mkdir(parents=True, exist_ok=True)
    OUT_GEO.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT_GEO.name} features={len(features)} bytes={OUT_GEO.stat().st_size}")
    return rows


def build_zips(county_fips: set[str], state_by_county: dict[str, str]):
    best: dict[str, tuple[str, int]] = {}
    with REL.open(encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, delimiter="|")
        for row in reader:
            zcta = (row.get("GEOID_ZCTA5_20") or "").strip().zfill(5) if (row.get("GEOID_ZCTA5_20") or "").strip() else ""
            county = (row.get("GEOID_COUNTY_20") or "").strip().zfill(5)
            if len(zcta) != 5 or not zcta.isdigit() or len(county) != 5:
                continue
            if county not in county_fips:
                continue
            land = int(row.get("AREALAND_PART") or 0)
            prev = best.get(zcta)
            if prev is None or land > prev[1] or (land == prev[1] and county < prev[0]):
                best[zcta] = (county, land)

    latlng: dict[str, tuple[float, float]] = {}
    with GAZ.open(encoding="utf-8", errors="replace") as f:
        header = f.readline()
        cols = [c.strip() for c in header.split("\t")]
        i_geo = cols.index("GEOID")
        i_lat = next(i for i, c in enumerate(cols) if c.upper() in ("INTPTLAT", "INTPTLAT"))
        i_lng = next(i for i, c in enumerate(cols) if "INTPTLONG" in c.upper() or c.upper() == "INTPTLON")
        for line in f:
            parts = line.split("\t")
            if len(parts) <= max(i_geo, i_lat, i_lng):
                continue
            z = parts[i_geo].strip().zfill(5)
            try:
                latlng[z] = (float(parts[i_lat].strip()), float(parts[i_lng].strip()))
            except ValueError:
                continue

    out = []
    for zcta, (county, _) in best.items():
        lat, lng = latlng.get(zcta, (None, None))
        out.append({
            "zip": zcta,
            "county_fips": county,
            "state_usps": None,  # filled after we map fips→usps
            "lat": lat,
            "lng": lng,
        })
    return out


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def main():
    load_dotenv()
    if "SUPABASE_URL" not in os.environ:
        sys.exit("SUPABASE_URL missing")

    states = rest("GET", "/rest/v1/geo_states?select=usps,fips")
    fips_to_usps = {s["fips"]: s["usps"] for s in states}
    print(f"geo_states={len(fips_to_usps)}")

    counties = build_counties()
    payload = []
    for c in counties:
        usps = fips_to_usps.get(c["statefp"])
        if not usps:
            continue
        payload.append({"county_fips": c["county_fips"], "state_usps": usps, "name": c["name"]})
    print(f"counties to upsert={len(payload)}")
    for batch in chunks(payload, 400):
        rest("POST", "/rest/v1/geo_counties?on_conflict=county_fips", batch, prefer="resolution=merge-duplicates,return=minimal")
        time.sleep(0.05)
    print("geo_counties upserted")

    county_fips = {c["county_fips"] for c in payload}
    state_by_county = {c["county_fips"]: c["state_usps"] for c in payload}
    zips = build_zips(county_fips, state_by_county)
    zip_payload = []
    for z in zips:
        usps = state_by_county.get(z["county_fips"])
        if not usps:
            continue
        zip_payload.append({
            "zip": z["zip"],
            "county_fips": z["county_fips"],
            "state_usps": usps,
            "lat": z["lat"],
            "lng": z["lng"],
        })
    print(f"zips to upsert={len(zip_payload)}")
    for batch in chunks(zip_payload, 400):
        rest("POST", "/rest/v1/geo_zips?on_conflict=zip", batch, prefer="resolution=merge-duplicates,return=minimal")
        time.sleep(0.04)
    print("geo_zips upserted")

    # Seed assignments from territory_state_seed (no-op if already assigned)
    seed = rest("GET", "/rest/v1/territory_state_seed?select=state_usps,owner_initials")
    seed_map = {s["state_usps"]: s["owner_initials"] for s in seed}
    assigns = []
    for c in payload:
        owner = seed_map.get(c["state_usps"])
        if not owner:
            continue
        assigns.append({
            "county_fips": c["county_fips"],
            "owner_initials": owner,
            "updated_by": "initial seed 2026-10-09",
        })
    print(f"assignments to upsert={len(assigns)}")
    for batch in chunks(assigns, 400):
        rest("POST", "/rest/v1/territory_county_assignments?on_conflict=county_fips", batch, prefer="resolution=merge-duplicates,return=minimal")
        time.sleep(0.04)
    print("territory_county_assignments seeded")

    geo_ids = {str(f["id"]) for f in json.loads(OUT_GEO.read_text(encoding="utf-8"))["features"]}
    db_ids = {c["county_fips"] for c in payload}
    only_geo = sorted(geo_ids - db_ids)
    only_db = sorted(db_ids - geo_ids)
    print(f"reconcile only_geojson={len(only_geo)} only_db={len(only_db)}")
    if only_geo[:10]:
        print(" only_geo sample", only_geo[:10])
    if only_db[:10]:
        print(" only_db sample", only_db[:10])


if __name__ == "__main__":
    main()
