#!/usr/bin/env bash
set -euo pipefail

# Load .env if present
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "Export it or add it to db/.env"
  exit 1
fi

MIGRATIONS_DIR="$(dirname "$0")/migrations"

# Create tracking table if it doesn't exist
psql "$DATABASE_URL" -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
SQL

# Run each migration in order
for file in "$MIGRATIONS_DIR"/*.sql; do
  filename=$(basename "$file")

  already_applied=$(psql "$DATABASE_URL" -tAc \
    "SELECT COUNT(*) FROM schema_migrations WHERE filename = '$filename'")

  if [ "$already_applied" -eq 0 ]; then
    echo "Applying $filename ..."
    psql "$DATABASE_URL" -q -f "$file"
    psql "$DATABASE_URL" -q -c \
      "INSERT INTO schema_migrations (filename) VALUES ('$filename')"
    echo "  Done."
  else
    echo "Skipping $filename (already applied)"
  fi
done

echo "All migrations complete."
