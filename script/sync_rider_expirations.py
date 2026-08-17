"""One-shot: refresh riders.expiration_date from railcars lease fields + print live KPI sanity counts."""
from __future__ import annotations

import os
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / ".env.local").read_text(encoding="cp1252", errors="replace").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

sb = create_client(
    os.environ["SUPABASE_URL"],
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"],
)


def fetch_all(table: str, cols: str, order: str = "id"):
    out = []
    page = 1000
    start = 0
    while True:
        r = sb.table(table).select(cols).order(order).range(start, start + page - 1).execute()
        chunk = r.data or []
        out.extend(chunk)
        if len(chunk) < page:
            break
        start += page
    return out


def is_sold(c):
    return str(c.get("fleet_status") or "").strip() == "Sold"


def is_idle(c):
    return str(c.get("fleet_status") or "").strip() == "Idle"


def car_end(c):
    for f in (c.get("lease_end_date"), c.get("lease_expiry")):
        s = str(f or "").strip()[:10]
        if s:
            return s
    return None


def car_ol(c):
    ol = str(c.get("rider_external_id") or "").strip()
    if not ol or ol.upper() == "SOLD":
        return None
    return ol


def main():
    cars = fetch_all(
        "railcars",
        "id,active,entity,fleet_status,rider_external_id,assignment_label,managed_category,"
        "lessee_name,lease_start_date,lease_end_date,lease_expiry",
    )
    asg = fetch_all("railcar_assignments", "id,railcar_id,rider_id,fleet_name")
    riders = fetch_all("riders", "id,rider_name,schedule_number,expiration_date,effective_date")
    rent = fetch_all("rent_events", "id,car_id,event_type,event_date")

    active = [c for c in cars if c.get("active") is True]
    operating = [c for c in active if not is_sold(c)]
    leased = [c for c in operating if not is_idle(c)]
    idle = [c for c in operating if is_idle(c)]
    op_ids = {c["id"] for c in operating}
    asg_op = [a for a in asg if a["railcar_id"] in op_ids]
    assigned = {a["railcar_id"] for a in asg_op}
    unassigned = len(op_ids - assigned)

    latest = {}
    for ev in sorted(rent, key=lambda x: x.get("event_date") or "", reverse=True):
        if ev["car_id"] in op_ids and ev["car_id"] not in latest:
            latest[ev["car_id"]] = ev["event_type"]
    off_rent = sum(1 for t in latest.values() if t == "off_rent")

    ol_map = defaultdict(lambda: {"count": 0, "ends": [], "lessee": None})
    for c in operating:
        ol = car_ol(c)
        if not ol:
            continue
        k = ol.upper()
        ol_map[k]["count"] += 1
        ol_map[k]["ol"] = ol
        end = car_end(c)
        if end:
            ol_map[k]["ends"].append(end)
        if not ol_map[k]["lessee"] and c.get("lessee_name"):
            ol_map[k]["lessee"] = c["lessee_name"]

    today = date.today()
    d6 = today + timedelta(days=183)
    d12 = today + timedelta(days=365)

    def parse(d):
        try:
            return date.fromisoformat(d[:10])
        except Exception:
            return None

    active_ols = len(ol_map)
    exp6 = exp12 = 0
    known_end_ols = 0
    for agg in ol_map.values():
        end = max(agg["ends"]) if agg["ends"] else None
        if not end:
            continue
        known_end_ols += 1
        d = parse(end)
        if not d:
            continue
        if today <= d <= d6:
            exp6 += 1
        if today <= d <= d12:
            exp12 += 1

    lessee_counts = Counter(
        (c.get("lessee_name") or c.get("assignment_label") or "Unassigned") for c in operating
    )

    # Sync riders cache: set expiration_date from car ends (or null)
    ends_by_ol = {k: max(v["ends"]) if v["ends"] else None for k, v in ol_map.items()}
    starts_by_ol = defaultdict(list)
    for c in operating:
        ol = car_ol(c)
        if not ol:
            continue
        s = str(c.get("lease_start_date") or "").strip()[:10]
        if s:
            starts_by_ol[ol.upper()].append(s)

    updated = 0
    for r in riders:
        keys = [
            str(r.get("rider_name") or "").strip().upper(),
            str(r.get("schedule_number") or "").strip().upper(),
        ]
        keys = [k for k in keys if k]
        ends = []
        starts = []
        for k in keys:
            if k in ends_by_ol and ends_by_ol[k]:
                ends.append(ends_by_ol[k])
            starts.extend(starts_by_ol.get(k, []))
        next_exp = max(ends) if ends else None
        next_eff = min(starts) if starts else None
        prev_exp = str(r.get("expiration_date") or "")[:10] or None
        prev_eff = str(r.get("effective_date") or "")[:10] or None
        if prev_exp == next_exp and (next_eff is None or prev_eff == next_eff):
            continue
        patch = {"expiration_date": next_exp}
        if next_eff:
            patch["effective_date"] = next_eff
        sb.table("riders").update(patch).eq("id", r["id"]).execute()
        updated += 1

    print("=== LIVE KPI SANITY (car-level authority) ===")
    print(f"total_cars={len(cars)}")
    print(f"active_including_sold={len(active)}")
    print(f"total_fleet_operating={len(operating)}")
    print(f"active_assignments_leased={len(leased)}")
    print(f"idle={len(idle)} sold={len(active)-len(operating)}")
    print(f"unassigned_operating={unassigned}")
    print(f"off_rent_rent_events={off_rent} (rent_events rows={len(rent)})")
    print(f"active_ols={active_ols}")
    print(f"ols_with_known_end={known_end_ols}")
    print(f"expiring_6mo_ols={exp6} expiring_12mo_ols={exp12}")
    print(f"util_pct={round(len(leased)/len(operating)*1000)/10 if operating else 0}")
    print("--- lessee groupings (top 8) ---")
    for name, n in lessee_counts.most_common(8):
        print(f"  {name}: {n}")
    print("--- sample OLs ---")
    for sample in ("OL1248", "OL2345", "OL2245"):
        agg = ol_map.get(sample)
        if not agg:
            print(f"  {sample}: (not on operating fleet)")
            continue
        end = max(agg["ends"]) if agg["ends"] else None
        print(f"  {sample}: cars={agg['count']} lessee={agg['lessee']!r} lease_end={end}")
    print(f"--- riders cache sync: scanned={len(riders)} updated={updated} ---")


if __name__ == "__main__":
    main()
