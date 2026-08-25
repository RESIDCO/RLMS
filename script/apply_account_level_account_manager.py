"""Apply migrations/20260824_account_level_account_manager.sql via SUPABASE_DB_PASSWORD."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / ".env.local").read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

sql_path = ROOT / "migrations" / "20260824_account_level_account_manager.sql"
sql = sql_path.read_text(encoding="utf-8")
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
        last_err = type(e).__name__
        print(f"candidate {i} {c['host']}:{c['port']} failed: {type(e).__name__}")

if conn is None:
    raise SystemExit(
        "Could not connect to Postgres. Run "
        f"{sql_path.name} in the Supabase SQL editor. Last error type: {last_err}"
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
        parts = [p.strip() for p in sql.split(";") if p.strip() and not p.strip().startswith("--")]
        for part in parts:
            cur.execute(part)
        acct_cols = columns_for(cur, "accounts")
        mla_cols = columns_for(cur, "master_leases")
        missing = []
        if "account_manager" not in acct_cols:
            missing.append("accounts.account_manager")
        if "account_id" not in mla_cols:
            missing.append("master_leases.account_id")
        if missing:
            raise SystemExit("missing after apply: " + ", ".join(missing))
        cur.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM public.master_leases WHERE lessee IS NOT NULL AND btrim(lessee) <> '') AS mlas_with_lessee,
              (SELECT COUNT(*) FROM public.master_leases WHERE account_id IS NOT NULL) AS mlas_linked,
              (SELECT COUNT(*) FROM public.accounts) AS accounts
            """
        )
        print("counts", cur.fetchone())
    conn.commit()
    print("ok")
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
