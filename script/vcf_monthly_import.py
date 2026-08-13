"""
Monthly / repeatable VCF import (§2.1 step 5) — idempotent upserts.

Natural keys:
  assignment_history: railcar_id + ASSIGNMENT_ID + start_date
    (start_date required — VCF reuses ASSIGNMENT_ID across renewals)
  car_number_history: railcar_id + old/new initials+numbers + changed_at::date
  railcars: car_initial + car_number (update in place; insert if new)

Does NOT delete existing history rows that are absent from the file.
Requires --confirm-production-import.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from supabase import create_client

# Reuse parse / payload helpers from first-load commit
sys.path.insert(0, str(Path(__file__).resolve().parent))
from vcf_commit import (  # noqa: E402
    ROOT,
    car_num,
    chunked,
    parse_workbook,
    railcar_payload,
    s,
)

for line in (ROOT / ".env.local").read_text(encoding="cp1252", errors="replace").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())


def ah_key(railcar_id, assignment_id_ext, start_date, end_date=None) -> str:
    return "|".join(
        [
            str(railcar_id),
            str(assignment_id_ext or "").strip(),
            str(start_date or "").strip(),
            str(end_date or "").strip(),
        ]
    )


def cnh_key(row) -> str:
    day = str(row.get("changed_at") or "")[:10]
    return "|".join(
        [
            str(row["railcar_id"]),
            str(row.get("old_car_initial") or "").strip().upper(),
            str(row.get("old_car_number") or "").strip(),
            str(row.get("new_car_initial") or "").strip().upper(),
            str(row.get("new_car_number") or "").strip(),
            day,
        ]
    )


def fetch_all(sb, table, cols):
    out = []
    page = 0
    while True:
        chunk = sb.table(table).select(cols).range(page, page + 999).execute().data or []
        if not chunk:
            break
        out.extend(chunk)
        if len(chunk) < 1000:
            break
        page += 1000
    return out


def count_table(sb, table):
    return sb.table(table).select("id", count="exact").execute().count


def railcars_fingerprint(rows):
    """Stable hash of VCF-owned railcar fields (excludes financial/runtime columns)."""
    fields = [
        "car_initial",
        "car_number",
        "car_type",
        "mechanical_designation",
        "general_description",
        "lease_type",
        "managed",
        "managed_category",
        "lining_material",
        "entity",
        "active",
        "rider_external_id",
        "lessee_name",
        "assignment_label",
        "lease_start_date",
        "lease_end_date",
        "dot_code",
        "current_assignment_id",
        "client_id",
        "cover_sheet",
        "legal_owner",
    ]
    parts = []
    for r in sorted(rows, key=lambda x: (x.get("car_initial") or "", str(x.get("car_number") or ""))):
        parts.append("|".join(str(r.get(f) if r.get(f) is not None else "") for f in fields))
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def ah_fingerprint(rows):
    fields = [
        "railcar_id",
        "assignment_id_ext",
        "start_date",
        "end_date",
        "rider_external_id",
        "assignment_label",
        "active",
        "comment",
    ]
    parts = []
    for r in sorted(
        rows,
        key=lambda x: (
            x.get("railcar_id") or 0,
            str(x.get("assignment_id_ext") or ""),
            str(x.get("start_date") or ""),
            x.get("id") or 0,
        ),
    ):
        parts.append("|".join(str(r.get(f) if r.get(f) is not None else "") for f in fields))
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def cnh_fingerprint(rows):
    fields = [
        "railcar_id",
        "old_car_initial",
        "old_car_number",
        "new_car_initial",
        "new_car_number",
        "changed_at",
        "reason",
    ]
    parts = []
    for r in sorted(
        rows,
        key=lambda x: (
            x.get("railcar_id") or 0,
            str(x.get("old_car_number") or ""),
            str(x.get("changed_at") or ""),
            x.get("id") or 0,
        ),
    ):
        row = dict(r)
        if row.get("changed_at"):
            row["changed_at"] = str(row["changed_at"])[:10]
        parts.append("|".join(str(row.get(f) if row.get(f) is not None else "") for f in fields))
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def snapshot_state(sb):
    cars = fetch_all(
        sb,
        "railcars",
        "id,car_initial,car_number,car_type,mechanical_designation,general_description,"
        "lease_type,managed,managed_category,lining_material,entity,active,"
        "rider_external_id,lessee_name,assignment_label,lease_start_date,lease_end_date,"
        "dot_code,current_assignment_id,client_id,cover_sheet,legal_owner",
    )
    ah = fetch_all(
        sb,
        "assignment_history",
        "id,railcar_id,assignment_id_ext,start_date,end_date,rider_external_id,"
        "assignment_label,active,comment",
    )
    cnh = fetch_all(
        sb,
        "car_number_history",
        "id,railcar_id,old_car_initial,old_car_number,new_car_initial,new_car_number,changed_at,reason",
    )
    return {
        "railcars_count": len(cars),
        "assignment_history_count": len(ah),
        "car_number_history_count": len(cnh),
        "railcars_fingerprint": railcars_fingerprint(cars),
        "assignment_history_fingerprint": ah_fingerprint(ah),
        "car_number_history_fingerprint": cnh_fingerprint(cnh),
    }


def content_equal_ah(existing, payload):
    fields = [
        "rider_external_id",
        "assignment_label",
        "start_date",
        "end_date",
        "active",
        "comment",
        "assignment_id_ext",
        "reason",
    ]
    for f in fields:
        if str(existing.get(f) if existing.get(f) is not None else "") != str(
            payload.get(f) if payload.get(f) is not None else ""
        ):
            return False
    return True


def content_equal_cnh(existing, payload):
    fields = [
        "old_car_initial",
        "old_car_number",
        "new_car_initial",
        "new_car_number",
        "reason",
        "changed_by",
    ]
    for f in fields:
        a = existing.get(f)
        b = payload.get(f)
        if f in ("old_car_initial", "new_car_initial"):
            a = (a or "").strip().upper() or None
            b = (b or "").strip().upper() or None
        if str(a if a is not None else "") != str(b if b is not None else ""):
            return False
    # compare date portion only
    ea = str(existing.get("changed_at") or "")[:10]
    eb = str(payload.get("changed_at") or "")[:10]
    return ea == eb


def safe_update(sb, table, payload, id_):
    last = None
    for attempt in range(5):
        try:
            local = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
            local.table(table).update(payload).eq("id", id_).execute()
            return
        except Exception as e:
            last = e
            time.sleep(0.2 * (attempt + 1))
    raise last


def safe_insert(sb, table, payload):
    last = None
    for attempt in range(5):
        try:
            local = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
            res = local.table(table).insert(payload).select("id").execute()
            return (res.data or [{}])[0].get("id")
        except Exception as e:
            last = e
            time.sleep(0.2 * (attempt + 1))
    raise last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "xlsx",
        nargs="?",
        default=r"C:\Users\BruceHarbridge\OneDrive - RESIDCO\Documents\V_VALID_CARS_toAlltranstek 8-10-26.xlsx",
    )
    ap.add_argument("--confirm-production-import", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not args.confirm_production_import and not args.dry_run:
        print("Pass --confirm-production-import or --dry-run", file=sys.stderr)
        return 2

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    before = snapshot_state(sb)
    print("BEFORE", json.dumps(before, indent=2))

    path = Path(args.xlsx)
    print(f"Parsing {path} …")
    cars, review = parse_workbook(path)
    print(
        f"Parsed rows={review['totalRows']} distinct={review['distinctCars']} "
        f"double-active={review['multipleActiveCount']}"
    )

    existing_cars = fetch_all(
        sb,
        "railcars",
        "id,car_initial,car_number,reporting_marks,car_type,mechanical_designation,"
        "general_description,lease_type,managed,managed_category,lining_material,entity,"
        "active,active_status,rider_external_id,lessee_name,assignment_label,"
        "lease_start_date,lease_end_date,lease_expiry,dot_code,dot_specification,"
        "comment_event_note,legacy_valid_car_id,client_id,cover_sheet,legal_owner,"
        "update_made,update_needed_next_vcf,current_assignment_id,data_source,status",
    )
    id_by_key = {}
    car_by_id = {}
    for r in existing_cars:
        key = f"{(r.get('car_initial') or '').strip().upper()}|{str(r.get('car_number') or '').strip()}"
        id_by_key[key] = r["id"]
        car_by_id[r["id"]] = r


    def norm_cmp(v):
        if v is None:
            return ""
        if isinstance(v, bool):
            return "1" if v else "0"
        return str(v).strip()

    def soft_text(v):
        import re
        return re.sub(r"[^a-z0-9]+", "", norm_cmp(v).casefold())

    def railcar_content_equal(existing, payload):
        for k, v in payload.items():
            if k == "status":
                continue  # derived convenience field; ignore for drift check
            ev = existing.get(k)
            # Soft-compare free text so casing/punctuation-only VCF quirks
            # don't force writes on identical monthly re-runs.
            if k in (
                "car_initial",
                "reporting_marks",
                "legal_owner",
                "lessee_name",
                "assignment_label",
                "general_description",
            ):
                if soft_text(ev) != soft_text(v):
                    return False
            elif norm_cmp(ev) != norm_cmp(v):
                return False
        return True

    existing_ah = fetch_all(
        sb,
        "assignment_history",
        "id,railcar_id,assignment_id_ext,start_date,end_date,rider_external_id,"
        "assignment_label,active,comment,reason",
    )
    ah_by_key: dict[str, list] = defaultdict(list)
    for r in existing_ah:
        ah_by_key[
            ah_key(
                r["railcar_id"],
                r.get("assignment_id_ext"),
                r.get("start_date"),
                r.get("end_date"),
            )
        ].append(r)

    existing_cnh = fetch_all(
        sb,
        "car_number_history",
        "id,railcar_id,old_car_initial,old_car_number,new_car_initial,new_car_number,changed_at,changed_by,reason",
    )
    cnh_by_key = {}
    for r in existing_cnh:
        cnh_by_key[cnh_key(r)] = r

    stats = {
        "railcars_inserted": 0,
        "railcars_updated": 0,
        "railcars_unchanged": 0,
        "ah_inserted": 0,
        "ah_updated": 0,
        "ah_unchanged": 0,
        "cnh_inserted": 0,
        "cnh_updated": 0,
        "cnh_unchanged": 0,
        "touched_railcar_ids": set(),
    }

    now_iso = datetime.utcnow().isoformat() + "Z"
    write = not args.dry_run and args.confirm_production_import

    # --- railcars upsert ---
    for i, c in enumerate(cars):
        payload = railcar_payload(c["current"], c["needsReview"])
        key = c["carKey"]
        existing_id = id_by_key.get(key)
        if existing_id:
            existing_row = car_by_id[existing_id]
            # Avoid firing entity→managed_category trigger when entity unchanged
            update_payload = dict(payload)
            if existing_row.get("entity") == update_payload.get("entity"):
                update_payload.pop("entity", None)
            if railcar_content_equal(existing_row, update_payload):
                stats["railcars_unchanged"] += 1
            else:
                if write:
                    safe_update(sb, "railcars", update_payload, existing_id)
                    car_by_id[existing_id] = {**existing_row, **update_payload}
                stats["railcars_updated"] += 1
                stats["touched_railcar_ids"].add(existing_id)
            rid = existing_id
        else:
            if write:
                new_id = safe_insert(sb, "railcars", payload)
                id_by_key[key] = new_id
                car_by_id[new_id] = {"id": new_id, **payload}
                rid = new_id
            else:
                rid = None
            stats["railcars_inserted"] += 1
            if rid:
                stats["touched_railcar_ids"].add(rid)

        if rid is None:
            continue

        for p in c["periods"]:
            start = None if p["start_date_unknown"] else p.get("start_date")
            end = (
                None
                if p["end_date_unknown"] or p["end_date_indefinite"]
                else p.get("end_date")
            )
            hist = {
                "railcar_id": rid,
                "rider_external_id": p.get("rider_external_id"),
                "assignment_label": p.get("assignment_label"),
                "start_date": start,
                "end_date": end,
                "active": p["active"] if p["active_ok"] else None,
                "comment": p.get("comment"),
                "assignment_id_ext": p.get("assignment_id"),
                "moved_by": "vcf-import",
                "reason": "V_VALID_CARS assignment period",
            }
            k = ah_key(
                rid,
                hist["assignment_id_ext"],
                hist["start_date"],
                hist["end_date"],
            )
            existing_rows = ah_by_key.get(k) or []
            match = next((ex for ex in existing_rows if content_equal_ah(ex, hist)), None)
            if match:
                stats["ah_unchanged"] += 1
            elif existing_rows:
                # Update the first existing row for this natural key
                ex = existing_rows[0]
                if write:
                    safe_update(
                        sb,
                        "assignment_history",
                        {**hist, "moved_at": now_iso},
                        ex["id"],
                    )
                    existing_rows[0] = {**ex, **hist}
                stats["ah_updated"] += 1
                stats["touched_railcar_ids"].add(rid)
            else:
                if write:
                    new_id = safe_insert(
                        sb,
                        "assignment_history",
                        {**hist, "moved_at": now_iso},
                    )
                    ah_by_key[k] = [{"id": new_id, **hist}]
                stats["ah_inserted"] += 1
                stats["touched_railcar_ids"].add(rid)

            if p.get("old_car_initial") or p.get("old_car_number"):
                changed = (
                    f"{p['start_date']}T00:00:00.000Z"
                    if p.get("start_date") and not p["start_date_unknown"]
                    else now_iso
                )
                remark = {
                    "railcar_id": rid,
                    "old_car_initial": p.get("old_car_initial"),
                    "old_car_number": p.get("old_car_number") or p["car_number"],
                    "new_car_initial": p["car_initial"],
                    "new_car_number": p["car_number"],
                    "changed_at": changed,
                    "changed_by": "vcf-import",
                    "reason": "V_VALID_CARS OLD_CAR_*",
                }
                rk = cnh_key(remark)
                rex = cnh_by_key.get(rk)
                if rex:
                    if content_equal_cnh(rex, remark):
                        stats["cnh_unchanged"] += 1
                    else:
                        if write:
                            safe_update(sb, "car_number_history", remark, rex["id"])
                        stats["cnh_updated"] += 1
                        stats["touched_railcar_ids"].add(rid)
                else:
                    if write:
                        new_id = safe_insert(sb, "car_number_history", remark)
                        cnh_by_key[rk] = {"id": new_id, **remark}
                    stats["cnh_inserted"] += 1
                    stats["touched_railcar_ids"].add(rid)

        if (i + 1) % 2000 == 0:
            print(f"  processed cars {i+1}/{len(cars)}")

    after = snapshot_state(sb) if write else before
    out = {
        "mode": "vcf_monthly_import",
        "sourceFile": path.name,
        "dryRun": not write,
        "before": before,
        "after": after,
        "countsUnchanged": {
            "assignment_history": before["assignment_history_count"]
            == after["assignment_history_count"],
            "car_number_history": before["car_number_history_count"]
            == after["car_number_history_count"],
            "railcars": before["railcars_count"] == after["railcars_count"],
        },
        "fingerprintsUnchanged": {
            "assignment_history": before["assignment_history_fingerprint"]
            == after["assignment_history_fingerprint"],
            "car_number_history": before["car_number_history_fingerprint"]
            == after["car_number_history_fingerprint"],
            "railcars": before["railcars_fingerprint"] == after["railcars_fingerprint"],
        },
        "stats": {
            **{k: (len(v) if isinstance(v, set) else v) for k, v in stats.items()},
        },
        "naturalKeyNote": (
            "assignment_history upsert key = railcar_id + ASSIGNMENT_ID + start_date + end_date. "
            "ASSIGNMENT_ID alone is not unique in V_VALID_CARS (renewals reuse it). "
            "ACTIVE is excluded from the key so MoM ACTIVE flips update the period in place."
        ),
        "touched_railcar_id_list": sorted(stats["touched_railcar_ids"]),
    }
    out_path = ROOT / "script" / "vcf-monthly-import-last.json"
    # sets not JSON serializable — already converted
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))
    print(f"Wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
