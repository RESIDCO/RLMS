from pathlib import Path

t = Path("migrations/20261029_undo_change_group.sql").read_text(encoding="utf-8")
idx = t.find("CREATE OR REPLACE FUNCTION public.rlms_jsonb_key_matches")
body = t[idx:]
body = body.replace(
    "'assignment_history', 'car_status_history'",
    "'assignment_history', 'car_status_history', 'car_tags', 'car_lists', 'car_list_members'",
)
body = body.replace(
    "'program_car_milestones', 'car_rent_stops')",
    "'program_car_milestones', 'car_rent_stops', 'car_tags', 'car_list_members')",
)
body = body.replace(
    "'assignment_history'\n  ) THEN",
    "'assignment_history', 'car_tags', 'car_lists', 'car_list_members'\n  ) THEN",
)
Path("migrations/20261031_undo_workbench_tables.sql").write_text(
    "-- Widen undo engine for workbench tables (R1).\n\n" + body,
    encoding="utf-8",
)
print("ok", "car_tags" in body)
