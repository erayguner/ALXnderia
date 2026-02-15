#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:?Must set DB_HOST}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-cloud_identity_intel}"
DB_USER="${DB_USER:-cloudintel}"
DB_PASSWORD="${DB_PASSWORD:?Must set DB_PASSWORD}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_DIR="$SCRIPT_DIR/../../schema"

export PGPASSWORD="$DB_PASSWORD"

echo "Waiting for database to be ready..."
for i in $(seq 1 30); do
  if pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo "Database is ready (attempt $i)."
    break
  fi
  echo "  attempt $i/30..."
  sleep 5
  if [ "$i" -eq 30 ]; then
    echo "Database did not become ready in time."
    exit 1
  fi
done

echo "Applying schema files..."
for sqlfile in $(find "$SCHEMA_DIR" -name '*.sql' | sort); do
  echo "Applying $sqlfile"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --set ON_ERROR_STOP=1 -f "$sqlfile"
done

echo "Schema migration complete."
