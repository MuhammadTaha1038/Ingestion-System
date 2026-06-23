# Deployment Runbook

This document describes the verified deployment process for the ingestion system on a Linux VPS.

## 1. Server requirements
- Ubuntu 22.04 LTS (or compatible Linux host)
- Node.js 20.x installed
- PostgreSQL accessible via `DATABASE_URL`
- Redis accessible via `REDIS_URL`
- Optional but recommended: local `.env` file in the deployment directory for environment variables

## 2. Verified production service configuration
- Service path: `/opt/ingestion-system`
- Service unit: `ingestion-system.service`
- Systemd unit path: `/etc/systemd/system/ingestion-system.service`
- Service startup command: `/usr/bin/node /opt/ingestion-system/dist/main.js`
- Environment file loaded by systemd: `/opt/ingestion-system/.env`

## 3. Required environment variables
The deployment requires these environment variables, stored securely in `/opt/ingestion-system/.env` or the runtime environment:
- `DATABASE_URL`
- `REDIS_URL`
- `ENCRYPTION_KEY`
- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_SERVER_ID`
- optional: `DISCORD_DASHBOARD_CHANNEL_ID`
- optional: `DISCORD_STATUS_CHANNEL_ID`

> The Discord bot posts the dashboard panel to `DISCORD_DASHBOARD_CHANNEL_ID` when set. If that variable is not configured, it falls back to `DISCORD_STATUS_CHANNEL_ID`.
- `NODE_ENV=production`

> Do not store secrets in Git. Keep `.env` excluded from source control.

## 4. Deployment workflow
Use the following steps on the VPS after SSH’ing into the server.

```bash
cd /opt/ingestion-system
git pull origin main
npm ci
npm run build
systemctl restart ingestion-system
```

If the repository is not yet cloned on the server, use:

```bash
git clone https://github.com/<owner>/<repo>.git /opt/ingestion-system
cd /opt/ingestion-system
npm ci
npm run build
systemctl enable ingestion-system
systemctl start ingestion-system
```

## 5. Build and continuous deployment notes
- `npm ci` installs the exact dependencies from `package-lock.json`
- `npm run build` compiles TypeScript into `dist/`
- The systemd service reads `/opt/ingestion-system/.env`, so update that file before restarting if configuration changes

## 6. Health checks and verification
After deployment, verify the service is healthy:

```bash
systemctl status ingestion-system
curl -s http://127.0.0.1:3000/health
```

Expected health response:

```json
{"status":"ok"}
```

Also verify the internal healthcheck script:

```bash
bash /opt/ingestion-system/ops/healthcheck.sh
```

## 7. Service restart and logs
- Restart service: `systemctl restart ingestion-system`
- Check status: `systemctl status ingestion-system`
- View logs: `journalctl -u ingestion-system -n 100 --no-pager`

## 8. Deployment validation checklist
- [ ] Git pull completed without conflicts
- [ ] `npm ci` completed successfully
- [ ] `npm run build` completed without compilation errors
- [ ] `systemctl restart ingestion-system` succeeded
- [ ] `systemctl status ingestion-system` shows `active (running)`
- [ ] `curl -s http://127.0.0.1:3000/health` returns `{"status":"ok"}`
- [ ] `bash /opt/ingestion-system/ops/healthcheck.sh` returns `healthcheck ok`

## 9. Rollback guidance
If a new deployment fails, revert to the previous commit and restart the service:

```bash
cd /opt/ingestion-system
git checkout HEAD@{1}
npm run build
systemctl restart ingestion-system
```

> Keep a backup of the previous working commit or tagged release for safer rollback.
