"""Apply migrations/20260815_estimated_lease_expiry.sql via SUPABASE_DB_PASSWORD."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / ".env.local").read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

sql = (ROOT / "migrations" / "20260815_estimated_lease_expiry.sql").read_text(encoding="utf-8")
password = os.environ.get("SUPABASE_DB_PASSWORD")
if not password:
    raise SystemExit("SUPABASE_DB_PASSWORD missing from .env.local")

try:
    import psycopg2
except ImportError:
    raise SystemExit("psycopg2 is required: py -m pip install psycopg2-binary")

ref = "eweydhfduepaefshriar"
candidates = [
    {"host": "aws-0-us-east-1.pooler.supabase.com", "port": 6543, "user": f"postgres.{ref}"},
    {"host": "aws-0-us-east-1.pooler.supabase.com", "port": 5432, "user": f"postgres.{ref}"},
    {"host": "aws-1-us-east-1.pooler.supabase.com", "port": 6543, "user": f"postgres.{ref}"},
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
        last_err = e

if conn is None:
    raise SystemExit(
        "Could not connect to Postgres — the DB password in .env.local was rejected by the pooler. "
        f"Run migrations/20260815_estimated_lease_expiry.sql in the Supabase SQL editor instead. Last error: {last_err}"
    )

conn.autocommit = True
parts = [p.strip() for p in sql.split(";") if p.strip()]
try:
    with conn.cursor() as cur:
        for part in parts:
            cur.execute(part)
    print(f"Applied migrations/20260815_estimated_lease_expiry.sql (conn #{used})")
finally:
    conn.close()
