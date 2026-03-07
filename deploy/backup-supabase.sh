#!/bin/bash
# Backup Supabase PostgreSQL database
# Run from your local machine (requires pg_dump)
# Get direct connection string from: Supabase Dashboard → Settings → Database → Connection string (Session mode, port 5432)

set -e

# Usage: ./backup-supabase.sh "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
CONNECTION_STRING="${1:-$SUPABASE_DATABASE_URL}"

if [ -z "$CONNECTION_STRING" ]; then
  echo "Usage: $0 'postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres'"
  echo "Or set SUPABASE_DATABASE_URL environment variable"
  exit 1
fi

OUTPUT_FILE="supabase_backup_$(date +%Y%m%d_%H%M%S).sql"
echo "Backing up to $OUTPUT_FILE..."

pg_dump "$CONNECTION_STRING" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  -f "$OUTPUT_FILE"

echo "Backup complete: $OUTPUT_FILE"
echo "Size: $(du -h "$OUTPUT_FILE" | cut -f1)"
