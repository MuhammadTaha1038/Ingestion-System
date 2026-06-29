#!/usr/bin/env bash
# ops/2_migrate_neon_to_local.sh
# Migrates data directly from the Neon database to the local PostgreSQL database.

set -e

echo "=== Migrating Data from Neon to Local Database ==="

# Neon DB URL (Source)
NEON_URL="postgresql://neondb_owner:npg_jNqh7ZuvzwT0@ep-old-sound-ap6yk83m-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require"

# Local DB URL (Destination)
LOCAL_URL="postgresql://ingestion_user:Ingestion2026!@localhost:5432/ingestion_db"

echo "Dumping from Neon and restoring to Local..."
# Use pg_dump to pipe data directly to psql (no local file created)
pg_dump "$NEON_URL" --no-owner --no-acl | psql "$LOCAL_URL"

echo "=== Migration Complete ==="
