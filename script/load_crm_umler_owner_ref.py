"""Load a read-only UMLER owner snapshot into crm_umler_owner_ref.

Default is a count only. Pass --apply to upsert RLMS. Never writes UMLER.
UMLER project jtxyvjxmhuanvivmhimv, schema umler.equipment_classified.
RLMS uses SUPABASE_DB_PASSWORD. UMLER uses UMLER_DB_PASSWORD.
"""
from __future__ import annotations

import argparse
import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
env_path = ROOT / ".env.local"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

UMLER_SQL = """
with base as (
  select upper(btrim(reporting_mark)) as reporting_mark,
         nullif(btrim(umler_owner), '') as umler_owner,
         nullif(btrim(owner_group), '') as owner_group,
         nullif(btrim(owner_segment), '') as owner_segment,
         count(*)::int as n
  from umler.equipment_classified
  where btrim(coalesce(reporting_mark, '')) <> ''
  group by 1, 2, 3, 4
), ranked as (
  select reporting_mark, umler_owner, owner_group, owner_segment,
         sum(n) over (partition by reporting_mark)::int as car_count,
         row_number() over (
           partition by reporting_mark
           order by n desc, owner_group nulls last, umler_owner nulls last
         ) as rn
  from base
)
select reporting_mark, umler_owner, owner_group, owner_segment, car_count
from ranked
where rn = 1
"""


def connect(password: str, ref: str, readonly: bool):
    import psycopg2

    candidates = [
        {"host": "aws-0-us-east-1.pooler.supabase.com", "port": 5432, "user": f"postgres.{ref}"},
        {"host": "aws-1-us-east-1.pooler.supabase.com", "port": 5432, "user": f"postgres.{ref}"},
        {"host": f"db.{ref}.supabase.co", "port": 5432, "user": "postgres"},
    ]
    last = None
    for candidate in candidates:
        try:
            conn = psycopg2.connect(
                host=candidate["host"],
                port=candidate["port"],
                dbname="postgres",
                user=candidate["user"],
                password=password,
                sslmode="require",
                connect_timeout=12,
            )
            conn.set_session(readonly=readonly)
            return conn
        except Exception as exc:
            last = exc
    raise SystemExit(f"could not connect to {ref}: {last}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="upsert RLMS; omit for a read-only count")
    args = parser.parse_args()
    umler_password = os.environ.get("UMLER_DB_PASSWORD")
    if not umler_password:
        raise SystemExit("UMLER_DB_PASSWORD is required")
    try:
        import psycopg2
        from psycopg2.extras import execute_values
    except ImportError:
        raise SystemExit("psycopg2 is required")

    umler = connect(umler_password, "jtxyvjxmhuanvivmhimv", readonly=True)
    try:
        with umler.cursor() as cur:
            cur.execute(UMLER_SQL)
            rows = cur.fetchall()
    finally:
        umler.close()

    marks = len(rows)
    groups = len({row[2] for row in rows if row[2]})
    print(f"distinct marks {marks}; owner groups {groups}")
    if not args.apply:
        print("read-only; pass --apply to write RLMS")
        return

    rlms_password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not rlms_password:
        raise SystemExit("SUPABASE_DB_PASSWORD is required to write RLMS")
    today = date.today().isoformat()
    payload = [(row[0], row[2], row[1], row[3], row[4], today) for row in rows]
    rlms = connect(rlms_password, "eweydhfduepaefshriar", readonly=False)
    try:
        with rlms.cursor() as cur:
            execute_values(
                cur,
                """
                insert into crm_umler_owner_ref
                  (reporting_mark, owner_group, umler_owner, owner_segment, car_count, snapshot_at)
                values %s
                on conflict (reporting_mark) do update set
                  owner_group = excluded.owner_group,
                  umler_owner = excluded.umler_owner,
                  owner_segment = excluded.owner_segment,
                  car_count = excluded.car_count,
                  snapshot_at = excluded.snapshot_at
                """,
                payload,
            )
        rlms.commit()
    finally:
        rlms.close()
    print(f"upserted {marks} marks")


if __name__ == "__main__":
    main()
