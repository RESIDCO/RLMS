# NARN rail-line overlay (simplified)

Source: **North American Rail Network (NARN) Lines** — U.S. DOT / BTS / FRA,
National Transportation Atlas Database (NTAD). Public domain U.S. Government work.

- Dataset: North American Rail Network Lines
  (https://geodata.bts.gov/datasets/usdot::north-american-rail-network-lines)
- ArcGIS FeatureServer queried 2026-10-14
- Field used for color / filter: `RROWNER1` (primary owning / operating railroad mark)
- Coverage: US + Canada + Mexico (full NARN extent), including Class I, regional, and short lines
- DOI / dictionary: https://doi.org/10.21949/1528950

## Size / simplification (repo-practical)

Full NARN GeoJSON export is ~362 MB (~303k segments). Bundled overlay is
**pre-simplified and dissolved by `RROWNER1`**:

| Setting | Value |
|---|---|
| Server `maxAllowableOffset` | 0.08° (~9 km) |
| Geometry precision | 4 decimal degrees |
| Per-mark segment cap | 400 longest segments |
| Per-segment point cap | 80 |
| Output | `narn-lines-simplified.geojson.gz` (~0.6 MB gzip / ~3 MB raw, ~980 marks) |

Not truncated to CONUS — North America extent retained at map scale. Fine yard
track detail is intentionally removed for fast load. Optional **OpenRailwayMap**
tile layer (client-side, free tiles) provides denser detail when toggled on.

Free source only — no paid map / rail APIs.
