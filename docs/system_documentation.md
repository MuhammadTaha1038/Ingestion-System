# System Documentation (MVP)

This document consolidates the agreed requirements, assumptions, and architecture for the Discord-controlled email ingestion and sending system. It is the authoritative system reference for Phase 1 and Phase 2 unless superseded.

---

## 1. Purpose and Goals

- Build a fully functional end-to-end pipeline for email ingestion, deduplication, queueing, and sending.
- Use Discord as the primary operational interface.
- Expose backend APIs for all system operations, consumed by the Discord bot.
- Deliver a testable MVP in Phase 1 and optimize in Phase 2.
- Keep a clear path to production-grade scalability.

---

## 2. Phase Scope

### Phase 1 (MVP)

- Ingestion pipeline (format-agnostic)
- Global deduplication (permanent)
- Queue system (FIFO)
- SMTP system (dynamic accounts, limits)
- Automated sending pipeline and scheduler
- Basic logging and reporting
- Discord control commands (core operations)

### Phase 2

- Performance tuning and scale optimization
- Advanced monitoring and alerts
- Improved SMTP rotation strategies
- Enhanced Discord controls

---

## 3. High-Level Architecture

[Discord Bot]
  -> [Backend API Layer]
    -> [Ingestion Service]
    -> [Deduplication]
    -> [Queue]
    -> [Scheduler + Workers]
    -> [SMTP Manager / Sending Engine]
    -> [Logging + Reports]

The API layer exposes all core operations and is the only backend interface used by the Discord bot.

---

## 4. Ingestion and Data Handling

### Supported Input Formats

- CSV
- JSON
- TXT
- Raw text
- Bulk pasted content

### Rules

- No fixed schema.
- Only required field: email address.
- Additional fields are optional metadata stored as a flexible JSON blob.

### Pipeline Stages

1. Extraction (regex-based email parsing)
2. Normalization (lowercase, trim, canonical form)
3. Validation (basic RFC-style checks)
4. Deduplication (global)
5. Storage (cleaned dataset + results)

---

## 5. Deduplication

- Global across all datasets and time.
- Key: normalized lowercase email.
- Retention: permanent (no TTL).
- Implementation: central dedup index (DB table or Redis set with persistence).

---

## 6. Storage

- S3-compatible storage (Contabo).
- Input datasets are uploaded externally and referenced via public/signed URLs or storage paths.
- Output artifacts stored back to storage.

### Suggested Structure

- /input/
- /processed/
- /reports/

---

## 7. Queue System

- Asynchronous job processing for ingestion, processing, and sending.
- FIFO queue in Phase 1.
- Job states: pending, processing, completed, failed.
- Queue visibility and operational controls are exposed via Discord.

### Future Extensions

- Priority queues
- Per-campaign queues

---

## 8. Sending Workflow

- Ingestion -> Queue -> Automated Sending
- Manual campaign send trigger is available in Phase 1 via `/campaign-send` and `POST /campaigns/:id/send`.
- Campaign sends are dataset-scoped and require `dataset_id` / `datasetId`.

### Sending Window (Configurable)

- Default: 6-hour cycle.
- Timezone: UTC by default.
- Global schedule (not per campaign in Phase 1).
- Scheduler activates workers only during active windows and resets quotas per window.

---

## 9. SMTP and Account Hierarchy

### Hierarchy

cPanel Account
  -> Subdomains (default: 5)
    -> Email Accounts per Subdomain (default: 5)
      -> Sending Accounts (SMTP identities)

### Limits (Default)

- Max 50 emails per account per 6-hour window.
- All limits configurable.

### Behavior

- Dynamic number of accounts tied to the cPanel hierarchy.
- Round-robin or capacity-based rotation.
- Enforces per-account limits and tracks usage per sending window.
- Scales by adding more accounts without code changes.

---

### 9.1 cPanel Hierarchy & API

The system models the cPanel hierarchy as persistent resources in the database and exposes HTTP API endpoints to manage them. The hierarchy layers are:

- `cpanel_accounts` — top-level account grouping
- `subdomains` — subdomains under a cPanel account
- `email_accounts` — addresses under a subdomain

Phase 1 API endpoints (HTTP):

- `POST /accounts/cpanel` — create a cPanel group (body: `{ name }`)
- `GET /accounts/cpanel` — list cPanel groups
- `POST /accounts/subdomain` — create subdomain (body: `{ cpanelId, name }`)
- `GET /accounts/subdomain?cpanelId=` — list subdomains (optional filter)
- `POST /accounts/email` — create email account (body: `{ subdomainId, address }`)
- `GET /accounts/email?subdomainId=` — list email accounts (optional filter)

These endpoints are intended to be used by the Discord control plane and administrative tooling to manage sending infrastructure. SMTP accounts (sending identities) are modeled separately in `smtp_accounts` and are intended to be created/linked to `email_accounts` using lifecycle APIs (Phase 1/2).

## 10. Campaign System

### Managed via Discord

- Name
- Subject
- Body (HTML + plain text fallback)
- Reply-to address
- SMTP account email (optional)
- The send worker uses the campaign sender fields at delivery time.

### Phase 1 Defaults

- No attachments.
- HTML sanitized before sending.

---

## 11. Discord Control Plane

Discord is the primary operational interface for all core operations.

### Dashboard UI

- `/dashboard` opens a button-based operational panel inside Discord.
- The dashboard exposes ingestion, SMTP account management, campaign management, queue and status visibility, logs, window controls, and account usage.
- Campaign actions include create, update, usage view, and delete workflows via Discord modals.

### Phase 1 Commands (Implemented)

- /dashboard
- /ingest
- /status
- /queue
- /logs
- /pause
- /resume
- /health
- /metrics
- /cpanel-create
- /cpanel-list
- /subdomain-create
- /subdomain-list
- /email-create
- /email-list
- /smtp-status
- /smtp-import
- /accounts-status
- /smtp-create
- /smtp-update
- /smtp-disable
- /smtp-enable
- /smtp-usage
- /smtp-failures
- /job-status
- /campaign-create
- /campaign-update
- /campaign-list
- /campaign-send

### Client clarifications (2026-06-04)

- Discord is the primary operational interface; all core operations must be available via commands (ingestion, queue visibility, SMTP/account monitoring, sending controls, logs, and campaign management).
- Backend APIs must expose every system operation and are consumed by the Discord bot.
- The cPanel hierarchy is active infrastructure: cPanel -> subdomain -> email accounts -> SMTP accounts.
- Each hierarchy level is modeled explicitly in the database.
- Sending logic enforces per-account limits, tracks usage per sending window, and rotates accounts intelligently.
- SMTP accounts are dynamic resources tied to the hierarchy and scale by adding more accounts.
- Operational controls via Discord include pause/resume sending, queue monitoring, account usage inspection, and ingestion triggers.

### Phase 2 Extensions (Planned)

- Advanced alerts and monitoring

---

## 12. Backend API Layer (Phase 1)

The backend exposes APIs consumed by the Discord bot:

- POST /ingest
- GET /status
- GET /queue
- GET /smtp/status
- GET /accounts/status
- POST /accounts/cpanel
- GET /accounts/cpanel
- POST /accounts/subdomain
- GET /accounts/subdomain
- POST /accounts/email
- GET /accounts/email
- POST /smtp/account
- GET /smtp/accounts
- POST /smtp/account/:id/disable
- POST /smtp/account/:id/enable
- GET /smtp/failures
- POST /campaigns
- PUT /campaigns/:id
- GET /campaigns
- POST /campaigns/:id/send (body: `{ datasetId }`)
- POST /control/pause
- POST /control/resume
- GET /logs

### Security: SMTP credentials

SMTP account passwords are stored encrypted using AES-256-GCM. Set `ENCRYPTION_KEY` (at least 32 characters) in the environment before creating SMTP accounts. The backend encrypts passwords at creation and decrypts them only at send time.

---

## 13. Logging and Monitoring

- Logs include ingestion results, send attempts, and failures.
- Email visibility in logs is allowed by default (can be masked/hashed later).
- Retention: 7 to 14 days (configurable).

---

## 14. Output Artifacts

- Cleaned dataset (deduplicated emails).
- Processing report:
  - Total records processed
  - Valid emails count
  - Duplicates removed
  - Errors

---

## 15. Throughput and Scaling (Assumed)

- Typical dataset size: 10K to 500K emails.
- Initial maximum: up to ~1M emails.
- Ingestion throughput target: 5K to 20K emails/sec (batch, streaming).
- Sending throughput depends on SMTP account limits.
- Horizontal worker scaling is supported.

---

## 16. Tech Stack (Defined)

- Backend: Node.js (TypeScript)
- Framework: Fastify or Express
- Database: PostgreSQL
- Queue: Redis + BullMQ
- Storage SDK: S3-compatible (Contabo)
- Discord integration: discord.js

---

## 17. Deployment Plan (Initial)

1. Server setup (VPS hardening, dependencies).
2. Storage integration (S3 read/write validation).
3. Discord bot setup (register commands, permissions).
4. Core services deployment (ingestion, queue, sender).
5. End-to-end testing with real datasets.

---

## 18. Security and Ops Notes

- Use environment variables or a secrets manager.
- No hardcoded credentials.
- Restrict VPS access and prefer SSH keys.

---

## 19. Out of Scope (Phase 1)

- Unsubscribe management
- Complaint handling (FBL)
- Advanced analytics dashboards
- Email warmup automation
- Advanced templating systems
- Attachments
- Per-campaign scheduling rules

---

## 19. Future Expansion

- Horizontal scaling and load balancing
- Advanced monitoring (metrics dashboards)
- UI dashboard (optional)
- Automated scheduling enhancements

---

## 20. Deferred Questions (Optional Later)

- Window start time and timezone overrides per environment
- Campaign-to-dataset mapping rules
- Bulk paste size limits
- SMTP providers and DKIM/SPF/DMARC readiness
- Retry policy details (soft vs hard failures)
