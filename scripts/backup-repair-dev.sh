#!/usr/bin/env bash
# Backup / restore helpers for the *dev* repair schema only.
# Never point DATABASE_URL at production without explicit Bruce approval.
set -euo pipefail

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR=${REPAIR_BACKUP_DIR:-./backups}
mkdir -p "$OUT_DIR"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL to your LOCAL or approved-branch Postgres URL." >&2
  exit 1
fi

case "${1:-backup}" in
  backup)
    FILE="$OUT_DIR/repair-schema-$STAMP.dump"
    echo "Dumping schema repair → $FILE"
    pg_dump "$DATABASE_URL" --schema=repair --format=custom --file="$FILE"
    echo "OK: $FILE"
    ;;
  restore)
    FILE=${2:-}
    if [[ -z "$FILE" ]]; then
      echo "Usage: $0 restore <dump-file>" >&2
      exit 1
    fi
    echo "Restoring $FILE into DATABASE_URL (repair schema)"
    pg_restore --clean --if-exists --schema=repair --dbname="$DATABASE_URL" "$FILE"
    echo "OK"
    ;;
  *)
    echo "Usage: $0 [backup|restore <file>]" >&2
    exit 1
    ;;
esac
