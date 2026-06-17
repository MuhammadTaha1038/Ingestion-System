# Client Handoff - Phase 1 MVP

## What is included

- Ingestion pipeline for CSV, JSON, TXT, raw text, and bulk pasted content.
- Normalization, validation, and global deduplication.
- PostgreSQL-backed persistence for datasets, jobs, campaigns, SMTP accounts, usage, and failures.
- Redis/BullMQ queueing for ingestion and sending.
- S3-compatible artifact storage for processed outputs and reports.
- Discord control plane with slash commands for core operations.
- SMTP sending worker with retries, per-window limits, and failure auto-disable.
- Metrics and health endpoints for operational visibility.

Campaign sends can now be fully automatic: when a dataset finishes and an active campaign exists, the worker queues sending without requiring a manual dataset id in the normal flow.

## How it is built

- Runtime: Node.js 20+ + TypeScript.
- API: Fastify.
- Queue: BullMQ + Redis.
- Database: PostgreSQL.
- Storage: S3-compatible bucket.
- Discord: discord.js.
- Mail sending: nodemailer.

## How to test

1. Install dependencies:

```bash
npm ci
```

2. Run the SMTP integration smoke test:

```bash
npm run test:send
```

3. Run the full environment smoke test:

```bash
npm run test:e2e
```

Required environment variables for full smoke test:
- `DATABASE_URL`
- `REDIS_URL`
- `ENCRYPTION_KEY`
- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_SERVER_ID`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

Campaign creation accepts `from_address` and optional `reply_to`; those values are used when sending.

- For file ingestion, prefer direct downloadable object URLs or S3 object paths. The pipeline auto-detects supported formats after fetching the file bytes.
## Operational notes

- Keep SMTP credentials in `.env`, not in git.
- For Gmail testing, use an app password rather than a normal account password.
- Phase 1 implementation is largely complete; final validation against the client environment remains before handoff.
