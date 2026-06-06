# Ingestion System (MVP)

This repository contains the Phase 1 MVP implementation of the ingestion and sending system.

## What it does

- Accepts datasets in CSV, JSON, TXT, raw text, and bulk-paste form
- Normalizes, validates, and globally deduplicates email addresses
- Stores processed artifacts in S3-compatible storage or local fallback storage
- Manages SMTP accounts, usage windows, retries, and failure auto-disable
- Exposes an HTTP API and a Discord control plane for operations

## Runtime requirements

- Node.js 20+
- PostgreSQL for persistence-backed features
- Redis for BullMQ queues
- S3-compatible storage credentials
- Discord bot token, application id, and server id for the control plane

## Environment

Set these in `.env`:

- `DATABASE_URL`
- `REDIS_URL`
- `ENCRYPTION_KEY`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_SERVER_ID`

Optional for SMTP tests:

- `SMTP_TEST_EMAIL`
- `SMTP_TEST_APP_PASSWORD`

## Development

```bash
npm ci
npm run dev
```

## Tests

```bash
npm run test:send
npm run test:gmail
npm run test:e2e
```

## Status

The core Phase 1 code is implemented. Final delivery still depends on environment validation, client credentials, and production smoke testing.
