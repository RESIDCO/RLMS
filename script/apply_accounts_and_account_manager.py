"""Apply migrations/20260824_accounts_and_account_manager.sql via SUPABASE_DB_PASSWORD."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / ".env.local").read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

sql = (ROOT / "migrations" / "20260824_accounts_and_account_manager.sql").read_text(encoding="utf-8")
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
        "Could not connect to Postgres. Run migrations/20260824_accounts_and_account_manager.sql "
        f"in the Supabase SQL editor. Last error type: {last_err}"
    )

print(f"connected candidate #{used}")


def columns_for(cur, table: str) -> set[str]:
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        """,
        (table,),
    )
    return {r[0] for r in cur.fetchall()}


try:
    conn.autocommit = False
    with conn.cursor() as cur:
        parts = [p.strip() for p in sql.split(";") if p.strip()]
        for part in parts:
            cur.execute(part)
        acct_cols = columns_for(cur, "accounts")
        rider_cols = columns_for(cur, "riders")
        prog_cols = columns_for(cur, "programs")
        missing = []
        for col in ("id", "name", "notes", "created_at", "updated_at"):
            if col not in acct_cols:
                missing.append(f"accounts.{col}")
        if "account_manager" not in rider_cols:
            missing.append("riders.account_manager")
        if "account_id" not in prog_cols:
            missing.append("programs.account_id")
        if missing:
            raise SystemExit("missing after apply: " + ", ".join(missing))
        cur.execute("SELECT COUNT(*) FROM public.accounts")
        print("accounts rows:", cur.fetchone()[0])
        cur.execute(
            """
            SELECT COUNT(*) FROM (
              SELECT lower(btrim(lessee)) AS k
              FROM public.master_leases
              WHERE lessee IS NOT NULL AND btrim(lessee) <> ''
              GROUP BY 1
            ) s
            """
        )
        print("distinct master_leases.lessee:", cur.fetchone()[0])
    conn.commit()
    print("ok")
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
