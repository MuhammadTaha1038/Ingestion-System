# Deployment Runbook (MVP)

This runbook lists steps to deploy the Phase 1 MVP to a Linux VM.

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

4. Services
  - Run workers and scheduler via systemd or PM2 with env vars:
    - `RUN_INGESTION_WORKER=true`
    - `RUN_SENDING_WORKER=true`
    - `RUN_WINDOW_RESETTER=true`
    - `RUN_DISCORD_BOT=true`
  - Sample systemd unit and healthcheck are in `ops/`

5. Health checks
  - API health: `GET /health`
  - Queue status: `GET /queue`
  - Metrics: `GET /metrics`
  - Logs: `GET /logs`

6. Rollback
  - Keep previous release and restart with previous build.
