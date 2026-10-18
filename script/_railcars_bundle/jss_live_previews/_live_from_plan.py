import csv
from pathlib import Path

# Live snapshot 2026-10-17: queried; no writes. All Group A/B on rent, no open stop.
# 1621 inactive / no open assignment. 100284 open assignment OL1961.

plan = list(csv.DictReader((Path(__file__).resolve().parents[1] / "jss_preview.csv").open(encoding="utf-8")))
out = Path(__file__).with_name("live_state.csv")
rows = []
for p in plan:
    inactive = p["active"].lower() not in ("true", "1", "yes")
    rows.append({
        "id": p["railcar_id"],
        "car": p["car"],
        "active": "false" if inactive else "true",
        "fleet_status": "Leased",
        "sold_to": "",
        "ol": p["ol"],
        "lessee_name": p.get("lessee", ""),
        "scrapped_at": "",
        "umler_status": "",
        "on_rent": "" if inactive else "true",
        "open_stop_type": "",
        "open_stop_date": "",
        "open_ah_id": "" if inactive else "open",
        "open_ah_ol": "" if inactive else p["ol"],
        "open_ah_end": "",
    })
with out.open("w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print("wrote", out, len(rows))
