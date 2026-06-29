#!/usr/bin/env bash
# ops/1_setup_postgres.sh
# Installs PostgreSQL and sets up the local database and user.

set -e

echo "=== Installing PostgreSQL ==="
apt-get update -y
apt-get install -y postgresql postgresql-contrib postgresql-client
systemctl start postgresql
systemctl enable postgresql

echo "=== Creating Local Database and User ==="
# Create user if it doesn't exist
sudo -u postgres psql -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ingestion_user') THEN CREATE USER ingestion_user WITH PASSWORD 'Ingestion2026!'; END IF; END \$\$;"

# Create database if it doesn't exist
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'ingestion_db'" | grep -q 1 || sudo -u postgres createdb -O ingestion_user ingestion_db

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ingestion_db TO ingestion_user;"

echo "=== PostgreSQL Setup Complete ==="
echo "Local Database URL: postgresql://ingestion_user:Ingestion2026!@localhost:5432/ingestion_db"
