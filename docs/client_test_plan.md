# Phase 1 Client Test Plan

This checklist is your end-to-end test guide for Phase 1. It covers production server, storage, and Discord bot verification.

## 1) Prerequisites

- Node.js 20+ on server
- PostgreSQL (Neon) reachable
- Redis installed and running
- S3-compatible storage credentials available
- Discord bot token + app id + server id available

## 2) Environment Variables

Set these in `.env` on the server:
- DATABASE_URL
- REDIS_URL
- ENCRYPTION_KEY (32+ chars base64 or hex)
- S3_ENDPOINT
- S3_REGION
- S3_BUCKET
- S3_ACCESS_KEY_ID
- S3_SECRET_ACCESS_KEY
- DISCORD_BOT_TOKEN
- DISCORD_APP_ID
- DISCORD_SERVER_ID

Optional (for SMTP tests):
- SMTP_TEST_EMAIL
- SMTP_TEST_APP_PASSWORD

## 3) Database Schema Setup

- Ensure schema is applied:
  - Run: `psql "$DATABASE_URL" -f db/schema.sql`

## 4) Redis Check

- Verify Redis is running:
  - `redis-cli ping` => `PONG`

## 5) Install + Build

- `npm ci`
- `npm run build`

## 6) Register Discord Slash Commands

- Start command registration:
  - `RUN_DISCORD_COMMAND_REG=true RUN_DISCORD_BOT=false npm run dev`
- Confirm commands appear in your Discord server

## 7) Start Services

- Start full stack:
  - `RUN_INGESTION_WORKER=true RUN_SENDING_WORKER=true RUN_WINDOW_RESETTER=true RUN_DISCORD_BOT=true npm run dev`

## 8) API Health Checks

- GET /health
- GET /queue
- GET /metrics
- GET /logs

## 9) Ingestion Flow Test

- POST /ingest with:
  - format: csv | json | txt | raw | bulk
  - content: small sample dataset
- Verify:
  - GET /status shows job status
  - Output artifacts created (S3 or local fallback)

## 10) Deduplication Test

- Ingest a dataset with duplicate emails
- Verify:
  - report shows duplicates removed
  - duplicates not inserted again on next ingestion

## 11) SMTP Account Setup

- Create hierarchy:
  - POST /accounts/cpanel
  - POST /accounts/subdomain
  - POST /accounts/email
- Create SMTP account:
  - POST /smtp/account with host/port/username/password
- Validate:
  - GET /smtp/accounts
  - GET /smtp/status

## 12) Sending Test

- Create campaign:
  - POST /campaigns
- Trigger send:
  - POST /campaigns/:id/send
- Verify:
  - sending queue has jobs
  - logs show send attempts
  - /metrics shows smtp usage increments

## 13) Discord Bot Test

- In Discord, verify slash commands:
  - /ingest
  - /status
  - /queue
  - /logs
  - /pause
  - /resume
  - /smtp-status
  - /accounts-status
  - /smtp-list
  - /smtp-disable
  - /smtp-enable
  - /job-status
  - /campaign-list
  - /campaign-create
  - /campaign-send
- Confirm results match API state

## 14) Failure Handling Test

- Use invalid SMTP password
- Verify:
  - send retries happen
  - failures logged
  - account auto-disabled after threshold
  - /smtp/failures shows entries

## 15) Window Reset Test

- Confirm sending window resets usage:
  - observe /smtp/usage across windows
  - sending windows created in DB

## 16) Storage Test (S3)

- Ingest dataset stored on S3 path
- Confirm processed artifacts are written back to S3

## 17) Final Checklist

- All APIs respond correctly
- Discord commands respond correctly
- Queue and workers running
- Logs and metrics visible
- No secrets committed in git

## 18) Remaining credentials to confirm from client

If these are not already present in the server `.env`, ask the client for them before final handoff:

- `DATABASE_URL`
- `REDIS_URL`
- `ENCRYPTION_KEY` (required for SMTP credential encryption)
- Exact S3 bucket name
- Exact S3 region
- `S3_ENDPOINT` if this is not AWS S3
- Optional SMTP test values: `SMTP_TEST_EMAIL`, `SMTP_TEST_APP_PASSWORD`

If the client already provided the storage bucket, region, Discord app id, bot token, and server id, then the only remaining items are usually the database, Redis, encryption key, and optional SMTP test credentials.

