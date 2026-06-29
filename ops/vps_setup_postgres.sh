#!/usr/bin/env bash
# VPS PostgreSQL Setup Script
# Run this on the VPS to: install PostgreSQL, create DB + user, apply schema

set -e

echo "=== Step 1: Update apt and install PostgreSQL ==="
apt-get update -y
apt-get install -y postgresql postgresql-contrib

echo "=== Step 2: Start and enable PostgreSQL ==="
systemctl start postgresql
systemctl enable postgresql

echo "=== Step 3: Create database and user ==="
sudo -u postgres psql <<'EOSQL'
-- Create dedicated user
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ingestion_user') THEN
    CREATE USER ingestion_user WITH PASSWORD 'ingestion_pass_2026';
  END IF;
END $$;

-- Create database
SELECT 'CREATE DATABASE ingestion_db OWNER ingestion_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ingestion_db')\gexec

GRANT ALL PRIVILEGES ON DATABASE ingestion_db TO ingestion_user;
EOSQL

echo "=== Step 4: Configure pg_hba.conf for password auth ==="
PG_VERSION=$(psql --version | awk '{print $3}' | cut -d'.' -f1)
PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
if ! grep -q "ingestion_user" "$PG_HBA"; then
  echo "host    ingestion_db    ingestion_user    127.0.0.1/32    md5" >> "$PG_HBA"
fi
systemctl reload postgresql

echo "=== PostgreSQL setup complete ==="
echo "Connection string: postgresql://ingestion_user:ingestion_pass_2026@localhost:5432/ingestion_db"
