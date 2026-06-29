#!/usr/bin/env bash
# ops/3_build_and_start.sh
# Builds the application and configures the systemd service.

set -e

echo "=== Building the Application ==="
npm ci
npm run build

echo "=== Setting up Systemd Service ==="
cat <<EOF > /etc/systemd/system/ingestion-system.service
[Unit]
Description=Ingestion System
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ingestion-system
ExecStart=/usr/bin/node /opt/ingestion-system/dist/main.js
Restart=on-failure
EnvironmentFile=/opt/ingestion-system/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ingestion-system
systemctl restart ingestion-system

echo "=== Service Status ==="
systemctl status ingestion-system --no-pager

echo "=== Application Started Successfully ==="
