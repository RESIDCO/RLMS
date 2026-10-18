"""Build JSS step preview CSVs from jss_preview.csv + live snapshot. Writes only."""
import csv
from pathlib import Path

root = Path(__file__).resolve().parent
plan_path = root.parent / "jss_preview.csv"
live_path = root / "live_state.csv"
out = root

plan = list(csv.DictReader(plan_path.open(encoding="utf-8")))
live_rows = list(csv.DictReader(live_path.open(encoding="utf-8")))
live = {int(r["id"]): r for r in live_rows}

def status_for(p, live_row, step):
    if not live_row:
        return "reject", "not found"
    if str(live_row.get("active", "")).lower() not in ("true", "t", "1"):
        return "reject", "inactive – left alone"
    if p["action"] == "none":
        return "reject", "inactive – left alone"
    if p["action"] == "note_only" and step not in ("5_note", "5_tag"):
        return "skip", "notes only"
    if step == "1_off_rent":
        if live_row.get("open_stop_type"):
            t = live_row["open_stop_type"]
            return "reject", "already off rent" if t == "Off rent" else "existing open stop"
        return "ok", "rent_stop Off rent"
    if step == "2_assignment_end":
        if not live_row.get("open_ah_id"):
            return "reject", "assignment already ended"
        return "ok", f"end {live_row.get('open_ah_ol')}"
    if step == "3_mark_sold":
        if live_row.get("fleet_status") == "Sold":
            return "ok", "already Sold (idempotent)"
        disc = p.get("discrepancy_comment") or ""
        if disc:
            return "warn", "sale date before assignment end (expected)"
        return "ok", "mark_sold"
    if step == "4_cut_up":
        return "ok", "set_scrapped_at"
    if step == "4_umler":
        return "ok", "delete_requested"
    if step in ("5_note", "5_tag"):
        return "ok", step
    if step == "6_inactive":
        return "skip", "later from UMLER queue; not this load"
    return "skip", step

steps = [
    ("1_off_rent", "off_rent_date", "car_rent_stops.stop_date"),
    ("2_assignment_end", "assignment_end_date", "assignment_history.end_date"),
    ("3_mark_sold", "sale_date", "fleet_status/sold_to"),
    ("4_cut_up", "cut_up_date", "railcars.scrapped_at"),
    ("4_umler", "umler_delete_queue", "railcars.umler_status"),
    ("5_note", "note", "activity note"),
    ("5_tag", "tag", "car_tags"),
]

for step, value_col, field in steps:
    rows = []
    for p in plan:
        lid = int(p["railcar_id"])
        lr = live.get(lid)
        st, reason = status_for(p, lr, step)
        if p["action"] == "note_only" and step not in ("5_note", "5_tag"):
            continue
        rows.append({
            "railcar_id": p["railcar_id"],
            "car": p["car"],
            "ol": p["ol"],
            "action": p["action"],
            "step": step,
            "field": field,
            "before": {
                "1_off_rent": lr.get("open_stop_type") if lr else "",
                "2_assignment_end": f"ah {lr.get('open_ah_id')} {lr.get('open_ah_ol')} end={lr.get('open_ah_end')}" if lr else "",
                "3_mark_sold": lr.get("fleet_status") if lr else "",
                "4_cut_up": lr.get("scrapped_at") if lr else "",
                "4_umler": lr.get("umler_status") if lr else "",
                "5_note": "",
                "5_tag": "",
            }.get(step, ""),
            "after": p.get(value_col) or "",
            "status": st,
            "reason": reason,
            "applied": "NO — preview only, awaiting sign-off",
        })
    path = out / f"{step}.csv"
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    ok = sum(1 for r in rows if r["status"] == "ok")
    warn = sum(1 for r in rows if r["status"] == "warn")
    rej = sum(1 for r in rows if r["status"] == "reject")
    print(step, "rows", len(rows), "ok", ok, "warn", warn, "reject", rej)
