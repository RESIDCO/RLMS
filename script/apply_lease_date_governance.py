"""Apply migrations/20260825_lease_date_governance.sql via SUPABASE_DB_PASSWORD."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / ".env.local").read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

sql = (ROOT / "migrations" / "20260825_lease_date_governance.sql").read_text(encoding="utf-8")
password = os.environ.get("SUPABASE_DB_PASSWORD")
if not password:
    raise SystemExit("SUPABASE_DB_PASSWORD missing from .env.local")

try:
    import psycopg2
except ImportError:
    raise SystemExit("psycopg2 is required: py -m pip install psycopg2-binary")

ref = "eweydhfduepaefshriar"
candidates = [
    {"host": "aws-0-us-east-1.pooler.supabase.com", "port": 5432, "user": f"postgres.{ref}"},
    {"host": "aws-1-us-east-1.pooler.supabase.com", "port": 5432, "user": f"postgres.{ref}"},
    {"host": "aws-0-us-east-1.pooler.supabase.com", "port": 6543, "user": f"postgres.{ref}"},
    {"host": "aws-1-us-east-1.pooler.supabase.com", "port": 6543, "user": f"postgres.{ref}"},
    {"host": f"db.{ref}.supabase.co", "port": 5432, "user": "postgres"},
]

last_err = None
conn = None
used = None
for i, c in enumerate(candidates):
    try:
        conn = psycopg2.connect(
            host=c["host"],
            port=c["port"],
            dbname="postgres",
            user=c["user"],
            password=password,
            sslmode="require",
            connect_timeout=12,
        )
        used = i
        break
    except Exception as e:
        last_err = type(e).__name__ + ": connection failed"
        print(f"candidate {i} {c['host']}:{c['port']} failed: {type(e).__name__}")

if conn is None:
    raise SystemExit(
        "Could not connect to Postgres. Run migrations/20260825_lease_date_governance.sql "
        f"in the Supabase SQL editor. Last error type: {last_err}"
    )

print(f"connected candidate #{used}")

try:
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql)
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN ('riders', 'railcars')
              AND column_name IN ('expiration_source', 'expiration_snapshot_month', 'lease_date_source')
            ORDER BY table_name, column_name
            """
        )
        for row in cur.fetchall():
            print("column:", row[0])
    print("ok")
except Exception:
    raise
finally:
    conn.close()
