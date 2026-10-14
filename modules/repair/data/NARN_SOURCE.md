# NARN railroad marks seed

Source: **North American Rail Network (NARN) Lines** — U.S. DOT / BTS / FRA,
National Transportation Atlas Database (NTAD). Public domain U.S. Government work.

- Dataset: North American Rail Network Lines (geodata.bts.gov / ArcGIS FeatureServer)
- Fields used: `RROWNER1`, `RROWNER2`, `RROWNER3`, `TRKRGHTS1` (operating / owner / trackage-rights marks)
- DOI / dictionary: https://doi.org/10.21949/1528950

Full legal names for Class I and selected regionals/short lines are a curated
overlay (same public marks; names for type-ahead display). Marks present in NARN
but without a curated name store `name` null (UI shows the mark). A few
requested marks not present in NARN owner fields (e.g. CP, KCSM) are added as
`source=curated_supplement`.

Free source only — no Railinc paid products.

See also `NARN_LINES_SOURCE.md` for the simplified rail-line map overlay
(`narn-lines-simplified.geojson.gz`) and `PLACES_SOURCE.md` for City/ST geocoding.
