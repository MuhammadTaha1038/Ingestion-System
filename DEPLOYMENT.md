# Deployment Runbook (MVP)

This runbook lists the verified steps to deploy the Phase 1 MVP to a Linux VM.

1. Provision server(s)
  - Ubuntu 22.04 LTS
  - Install Node.js 20+, PostgreSQL, Redis

2. Environment and secrets
  - `DATABASE_URL` (postgres)
  - `REDIS_URL`
  - `ENCRYPTION_KEY` (32+ chars)
  - `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_SERVER_ID` (required for Discord commands)

3. Build and run
  - Clone repo, install deps `npm ci`
  - Build: `npm run build`
  - Run: `NODE_ENV=production node dist/main.js`

4. Deploy from GitHub
  - On the VPS, pull the latest commit from `origin/main`
  - Rebuild the project with `npm run build`
  - Restart the service with `systemctl restart ingestion-system`
  - Confirm the checkout is on the latest commit with `git log --oneline -1`

5. Services
  - Run workers and scheduler via systemd or PM2 with env vars:
    - `RUN_INGESTION_WORKER=true`
    - `RUN_SENDING_WORKER=true`
    - `RUN_WINDOW_RESETTER=true`
    - `RUN_DISCORD_BOT=true`
  - The verified systemd unit is `ops/ingestion-system.service`
  - The verified service name is `ingestion-system.service`
  - Sample healthcheck is `ops/healthcheck.sh`

6. Health checks
  - API health: `GET /health`
  - Queue status: `GET /queue`
  - Metrics: `GET /metrics`
  - Logs: `GET /logs`
  - Server healthcheck: `bash ops/healthcheck.sh`

7. Verification after restart
  - Confirm `systemctl status ingestion-system`
  - Confirm `curl http://127.0.0.1:3000/health` returns `{"status":"ok"}`
  - Confirm `bash ops/healthcheck.sh` returns exit code `0`

8. Rollback
  - Keep previous release and restart with previous build.
