"""VCF assignment-history close-out (Phase 1). Mirrors shared/vcf-assignment-closeout.ts."""

from __future__ import annotations

CLOSE_DUP = "VCF close-out: collapsed duplicate open period (same rider+start)"
CLOSE_CHANGED = "VCF close-out: period changed; closed at incoming start"

VCF_MANUAL_PROTECTED_RAILCAR_FIELDS = (
    "active",
    "active_status",
    "status",
    "active_source",
)


def open_period_match_key(railcar_id, rider_external_id, start_date) -> str:
    return f"{railcar_id}|{str(rider_external_id or '').strip()}|{str(start_date or '').strip()}"


def skip_vcf_assignment_writes(car) -> bool:
    if str(car.get("active_source") or "").strip() == "manual":
        return True
    return car.get("active") is not True


def strip_manual_protected_railcar_fields(payload: dict) -> dict:
    out = dict(payload)
    for key in VCF_MANUAL_PROTECTED_RAILCAR_FIELDS:
        out.pop(key, None)
    return out


def ah_natural_key(railcar_id, assignment_id_ext, start_date, end_date=None) -> str:
    return "|".join(
        [
            str(railcar_id),
            str(assignment_id_ext or "").strip(),
            str(start_date or "").strip(),
            str(end_date or "").strip(),
        ]
    )


def is_open(row) -> bool:
    end = row.get("end_date")
    return end is None or str(end).strip() == ""


def end_date_match_key(end) -> str:
    s = str(end or "").strip()[:10]
    if not s:
        return ""
    try:
        if int(s[:4]) >= 3000:
            return ""
    except ValueError:
        pass
    return s


def assignment_ids_compatible(a, b) -> bool:
    x = str(a or "").strip()
    y = str(b or "").strip()
    if not x or not y:
        return True
    return x == y


def _end_date_distance(a, b) -> float:
    from datetime import datetime

    ka = end_date_match_key(a) or "4000-12-31"
    kb = end_date_match_key(b) or "4000-12-31"
    try:
        da = datetime.fromisoformat(ka)
        db = datetime.fromisoformat(kb)
    except ValueError:
        return float("inf")
    return abs((da - db).total_seconds())


def _pick_exact_existing(cands):
    if not cands:
        return None
    return sorted(
        cands,
        key=lambda row: (1 if row.get("assignment_id_ext") else 0, row.get("id") or 0),
        reverse=True,
    )[0]


def _pair_incoming_to_existing(existing_rows, incoming):
    actions = []
    used_e = set()
    used_i = set()

    def emit_pair(hist, keep):
        used_e.add(keep["id"])
        merged = dict(hist)
        merged["assignment_id_ext"] = hist.get("assignment_id_ext") or keep.get("assignment_id_ext")
        if content_equal_ah(keep, merged):
            actions.append({"op": "unchanged", "existing_id": keep["id"], "payload": merged})
        else:
            actions.append({"op": "update", "existing_id": keep["id"], "payload": merged})

    for i, hist in enumerate(incoming):
        want_end = end_date_match_key(hist.get("end_date"))
        cands = [
            e
            for e in existing_rows
            if e["id"] not in used_e
            and end_date_match_key(e.get("end_date")) == want_end
            and assignment_ids_compatible(e.get("assignment_id_ext"), hist.get("assignment_id_ext"))
        ]
        keep = _pick_exact_existing(cands)
        if keep is None:
            continue
        used_i.add(i)
        emit_pair(hist, keep)

    left_i = [(i, h) for i, h in enumerate(incoming) if i not in used_i]
    left_e = [e for e in existing_rows if e["id"] not in used_e]
    if len(left_i) == 1 and len(left_e) == 1:
        used_i.add(left_i[0][0])
        emit_pair(left_i[0][1], left_e[0])
    elif left_i and left_e:
        avail = list(left_e)
        for i, hist in left_i:
            if not avail:
                break
            avail.sort(key=lambda e: _end_date_distance(e.get("end_date"), hist.get("end_date")))
            keep = avail.pop(0)
            used_i.add(i)
            emit_pair(hist, keep)

    for i, hist in enumerate(incoming):
        if i not in used_i:
            actions.append({"op": "insert", "payload": hist})
    return actions


def append_comment(existing, note: str) -> str:
    cur = str(existing or "").strip()
    if not cur:
        return note
    if note in cur:
        return cur
    return f"{cur} | {note}"


def content_equal_ah(existing, payload) -> bool:
    fields = (
        "rider_external_id",
        "assignment_label",
        "start_date",
        "end_date",
        "active",
        "comment",
        "assignment_id_ext",
        "reason",
    )
    for f in fields:
        if str(existing.get(f) if existing.get(f) is not None else "") != str(
            payload.get(f) if payload.get(f) is not None else ""
        ):
            return False
    return True


def _prefer_filled_then_later(a, b):
    a_filled = 1 if a.get("assignment_id_ext") else 0
    b_filled = 1 if b.get("assignment_id_ext") else 0
    if a_filled != b_filled:
        return a if a_filled > b_filled else b
    if str(b.get("start_date") or "") > str(a.get("start_date") or ""):
        return b
    if str(b.get("start_date") or "") < str(a.get("start_date") or ""):
        return a
    return b if (b.get("id") or 0) > (a.get("id") or 0) else a


def plan_vcf_assignment_closeout(existing_rows, incoming):
    """Return a list of {op, ...} actions. Never deletes."""
    actions = []
    incoming_keys = set(
        open_period_match_key(p.get("railcar_id"), p.get("rider_external_id"), p.get("start_date"))
        for p in incoming
    )
    groups = {k: {"existing": [], "incoming": []} for k in incoming_keys}
    for hist in incoming:
        key = open_period_match_key(hist.get("railcar_id"), hist.get("rider_external_id"), hist.get("start_date"))
        groups[key]["incoming"].append(hist)
    for row in existing_rows:
        key = open_period_match_key(row.get("railcar_id"), row.get("rider_external_id"), row.get("start_date"))
        if key in groups:
            groups[key]["existing"].append(row)

    claimed = set()
    for g in groups.values():
        part = _pair_incoming_to_existing(g["existing"], g["incoming"])
        for a in part:
            actions.append(a)
            if a["op"] in ("update", "unchanged"):
                claimed.add(a["existing_id"])

    incoming_open = [p for p in incoming if is_open(p)]
    if not incoming_open:
        return actions

    starts = sorted(str(p.get("start_date") or "") for p in incoming_open)
    latest_incoming_start = starts[-1] or None if starts else None

    for row in existing_rows:
        if not is_open(row) or row["id"] in claimed:
            continue
        key = open_period_match_key(row.get("railcar_id"), row.get("rider_external_id"), row.get("start_date"))
        if key in incoming_keys:
            continue
        actions.append(
            {
                "op": "close",
                "existing_id": row["id"],
                "end_date": latest_incoming_start,
                "comment": append_comment(row.get("comment"), CLOSE_CHANGED),
            }
        )
    return actions


def closeout_stats(actions):
    stats = {"inserted": 0, "updated": 0, "closed": 0, "unchanged": 0}
    for a in actions:
        op = a["op"]
        if op == "insert":
            stats["inserted"] += 1
        elif op == "update":
            stats["updated"] += 1
        elif op == "close":
            stats["closed"] += 1
        else:
            stats["unchanged"] += 1
    return stats


def status_aligned_to_active_flag(current_status, active: bool) -> str:
    cur = str(current_status or "").strip()
    if active:
        return cur if cur == "Active/In-Service" else "Active/In-Service"
    if cur and cur != "Active/In-Service":
        return cur
    return "Off-Lease"
