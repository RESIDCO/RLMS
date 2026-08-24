"""Apply migrations/20260824_activity_log.sql via SUPABASE_DB_PASSWORD."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / ".env.local").read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

sql = (ROOT / "migrations" / "20260824_activity_log.sql").read_text(encoding="utf-8")
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
        "Could not connect to Postgres. Run migrations/20260824_activity_log.sql "
        f"in the Supabase SQL editor. Last error type: {last_err}"
    )

print(f"connected candidate #{used}")

try:
    conn.autocommit = False
    with conn.cursor() as cur:
        parts = [p.strip() for p in sql.split(";") if p.strip()]
        for part in parts:
            cur.execute(part)
        cur.execute("SELECT COUNT(*) FROM public.activity_log")
        print("activity_log rows:", cur.fetchone()[0])
        cur.execute(
            """
            SELECT action, COUNT(*) FROM public.activity_log
            GROUP BY action ORDER BY 2 DESC
            """
        )
        for action, n in cur.fetchall():
            print(f"  {action}: {n}")
    conn.commit()
    print("ok")
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
