# Ops Assets (Phase 1)

This folder contains basic operational assets for the Phase 1 MVP.

## systemd unit

1. Copy the unit file:

```
sudo cp ops/ingestion-system.service /etc/systemd/system/ingestion-system.service
```

2. Reload and enable:

```
sudo systemctl daemon-reload
sudo systemctl enable --now ingestion-system
```

## Healthcheck

Run locally on the server:

```
bash ops/healthcheck.sh
```

Example cron (every 5 minutes):

```
*/5 * * * * /opt/ingestion-system/ops/healthcheck.sh >> /var/log/ingestion-health.log 2>&1
```
