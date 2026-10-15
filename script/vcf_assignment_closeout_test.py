"""Run: python3 script/vcf_assignment_closeout_test.py"""

from vcf_assignment_closeout import (
    closeout_stats,
    end_date_match_key,
    open_period_match_key,
    plan_vcf_assignment_closeout,
    skip_vcf_assignment_writes,
    strip_manual_protected_railcar_fields,
)


def hist(**partial):
    row = {
        "rider_external_id": "EA1739",
        "assignment_label": "EA1739 - xKBX",
        "start_date": "2026-07-21",
        "end_date": None,
        "active": True,
        "comment": None,
        "assignment_id_ext": None,
        "moved_at": "2026-08-13T00:00:00.000Z",
        "moved_by": "vcf-import",
        "reason": "V_VALID_CARS assignment period",
    }
    row.update(partial)
    return row


passed = 0
failed = 0


def ok(cond, label):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("FAIL", label)


ok(skip_vcf_assignment_writes({"active_source": "manual", "active": True}), "manual skips AH")
ok(skip_vcf_assignment_writes({"active_source": "auto", "active": False}), "inactive skips AH")
ok(not skip_vcf_assignment_writes({"active_source": "auto", "active": True}), "active auto writes AH")

stripped = strip_manual_protected_railcar_fields(
    {
        "active": True,
        "active_status": "Active",
        "status": "Active/In-Service",
        "active_source": "auto",
        "lessee_name": "KBX",
    }
)
ok(stripped["lessee_name"] == "KBX", "strip keeps lessee")
ok("active" not in stripped, "strip drops active")
ok("status" not in stripped, "strip drops status")

ok(
    open_period_match_key(1, "EA1739", "2026-07-21")
    == open_period_match_key(1, "EA1739", "2026-07-21"),
    "match key equal",
)
ok(
    open_period_match_key(1, "EA1739", "2026-07-21")
    != open_period_match_key(1, "OL1739", "2026-07-21"),
    "EA !== OL",
)
ok(end_date_match_key("4000-12-31") == "" and end_date_match_key("4000-12-21") == "", "indefinite ends match as open")
ok(end_date_match_key(None) == end_date_match_key("4000-12-31"), "null end matches 4000-12-31")

actions = plan_vcf_assignment_closeout(
    [
        hist(id=32, assignment_id_ext=None, railcar_id=15516),
        hist(id=41074, assignment_id_ext="558", railcar_id=15516),
    ],
    [hist(assignment_id_ext="558", railcar_id=15516)],
)
stats = closeout_stats(actions)
ok(stats["closed"] == 0, "does not auto-close leftover sibling in the same key")
ok(stats["inserted"] == 0, "does not insert a third open")
ok(
    any(a["op"] == "unchanged" and a["existing_id"] == 41074 for a in actions)
    or any(a["op"] == "update" and a["existing_id"] == 41074 for a in actions),
    "keeps filled ASSIGNMENT_ID row",
)

incoming = hist(assignment_id_ext="558", railcar_id=15516)
actions = plan_vcf_assignment_closeout([{"id": 41074, **incoming}], [incoming])
stats = closeout_stats(actions)
ok(
    stats == {"inserted": 0, "updated": 0, "closed": 0, "unchanged": 1},
    "re-run is no-op",
)

actions = plan_vcf_assignment_closeout(
    [hist(id=10, rider_external_id="OL1739", railcar_id=1)],
    [hist(rider_external_id="EA1739", start_date="2026-07-21", railcar_id=1, assignment_id_ext="558")],
)
stats = closeout_stats(actions)
ok(stats["closed"] == 1, "closes old OL period")
ok(stats["inserted"] == 1, "inserts EA period")
close = next(a for a in actions if a["op"] == "close")
ok(close["end_date"] == "2026-07-21", "changed close uses incoming start")

closed = hist(
    railcar_id=9,
    rider_external_id="OL1221",
    start_date="2012-11-01",
    end_date="2023-12-31",
    active=False,
    assignment_id_ext="1221",
)
opened = hist(
    railcar_id=9,
    rider_external_id="OL1221",
    start_date="2012-11-01",
    end_date=None,
    active=True,
    assignment_id_ext="1221",
)
existing = [{**closed, "id": 1}, {**opened, "id": 2}]
incoming = [closed, opened]
stats = closeout_stats(plan_vcf_assignment_closeout(existing, incoming))
ok(stats["unchanged"] == 2 and stats["inserted"] == 0, "HMBX-style pair matches both ends")
stats = closeout_stats(plan_vcf_assignment_closeout(existing, incoming))
ok(stats["unchanged"] == 2 and stats["inserted"] == 0, "second load changes nothing")

print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
