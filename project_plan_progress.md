# Project Plan and Progress

This document tracks the step-by-step plan and progress for the MVP and Phase 2. Update this file as work progresses to keep scope, decisions, and client visibility clear.

---

## 1. Current Status

- Date: 2026-06-04
- Date: 2026-06-06
- Phase: Phase 1 (MVP)
- Status: Implementation largely complete; delivery validation pending

---

## 2. Phase 1 Milestones (MVP)

- [x] Infrastructure setup and hardening
- [x] Storage integration and validation
- [x] Core services scaffold (API, workers, scheduler)
- [x] Ingestion pipeline (format-agnostic)
- [x] Global deduplication store
- [x] Queue and job lifecycle
- [x] SMTP manager with rate limits and account hierarchy
- [x] Sending engine and retries
- [x] Discord primary control plane (core ops via commands)
- [x] Logging and reports
- [ ] End-to-end test run
- [x] Deployment runbook and handoff notes

---

## 3. Phase 2 Milestones (Optimization)

- [ ] Performance tuning (ingestion and sending)
- [ ] Dedup scale optimization
- [ ] SMTP rotation improvements
- [ ] Observability upgrades (metrics, alerts)
- [ ] Expanded Discord controls

---

## 4. Detailed Step Plan (Phase 1)

### 4.1 Foundations

- [x] Confirm environment and stack versions
- [x] Establish project structure and repo conventions
- [x] Define configuration and secrets strategy

### 4.2 Data Layer

- [x] Design database schema (dedup index, jobs, campaigns, accounts)
- [x] Define storage paths and output artifact formats
- [x] Implement database access layer and repositories
- [x] Add S3 storage adapter (read/write for ingestion artifacts)

### 4.3 Ingestion

- [x] Implement streaming ingestion per format
- [x] Implement extraction, normalization, validation
- [x] Integrate global deduplication (Postgres-backed store with fallback)
- [x] Persist cleaned dataset and summary report (S3 or local fallback)

### 4.4 Queue and Scheduler

- [x] Implement FIFO queue
- [x] Implement job lifecycle and progress
- [x] Implement scheduler with configurable window

### 4.5 Sending

- [x] Implement SMTP account hierarchy models and lifecycle management
- [x] Implement rate limits, per-window usage tracking, and rotation strategy
- [x] Implement sending engine and retries

### 4.6 Discord Control Plane

- [x] Implement primary Discord commands for ingestion, queue visibility, SMTP/account monitoring, sending controls, logs, and campaign management
- [ ] Implement permission checks and response formatting
- [x] Ensure API coverage for all Discord operations

### 4.7 Logging and Monitoring

- [x] Structured logs for ingestion and sending
- [x] Reporting outputs (summary + artifacts)

### 4.8 QA and Release

- [ ] Run end-to-end test with sample datasets
- [ ] Validate sending window behavior
- [ ] Verify Discord command flows
- [x] Produce deployment runbook

---

## 5. Progress Log

- 2026-06-04: Project documentation created (system documentation and plan/progress tracker).
- 2026-06-04: Initial project scaffold created (base configs, entry point, and module folders).
- 2026-06-04: Environment file created and env template updated.
- 2026-06-04: Initial database schema and data-layer documentation added.
- 2026-06-04: Ingestion parsing, normalization, and validation core implemented.
- 2026-06-04: Queue scaffolding added with BullMQ and Redis connection setup.
- 2026-06-04: Configurable sending window scheduler implemented.
- 2026-06-04: Backend API scaffold added with core endpoints.
- 2026-06-04: Ingestion pipeline scaffolding added (parsers, normalization, validation, dedup interface).
- 2026-06-04: Job tracking added with in-memory store and queue status APIs.
- 2026-06-04: Ingestion worker added with local processed dataset and report outputs.
- 2026-06-04: Postgres-backed dedup store added and documentation updated with client clarifications.
- 2026-06-04: Database repositories added and ingestion now persists dataset/job status.
- 2026-06-04: S3-compatible storage integration added for ingestion inputs and artifacts.
- 2026-06-04: S3 storage adapter added for ingestion input/output with local fallback.
- 2026-06-05: cPanel/subdomain/email_account repository and API endpoints added.
 - 2026-06-05: SMTP lifecycle create/list APIs added; encryption helper added for SMTP passwords; nodemailer sender stub added.
 - 2026-06-05: SMTP enable/disable endpoints and failures reporting added; account auto-disable on repeated failures implemented; minimal Discord bot command handlers added.
 - 2026-06-05: Slash-command registration script and interaction-based Discord bot handlers added; campaign create/send endpoints implemented (batch enqueue).
 - 2026-06-05: Metrics endpoint added; CI workflow added to run SMTP integration test; README and deployment runbook added for handoff.
- 2026-06-06: Discord bot command surface expanded to cover ingest, queue, status, logs, pause/resume, SMTP status, account status, campaign create/list/send; build verified clean.


---

## 6. Decisions and Assumptions

- Configurable sending window schedule (global, UTC default).
- Permanent global deduplication with no TTL.
- Automated sending after ingestion (no manual send command in Phase 1).
- FIFO queue in Phase 1.
- Discord is the primary operational interface; all operations are exposed via API and Discord commands.
- cPanel hierarchy is active infrastructure; SMTP accounts are dynamic resources that scale by adding accounts.
- Sending enforces per-account limits, tracks per-window usage, and rotates accounts intelligently.

---

## 7. Risks and Dependencies

- SMTP provider limits and account readiness (SPF/DKIM/DMARC).
- Discord API limits and message size constraints.
- Dataset size variance and memory pressure during ingestion.

---

## 8. Deferred Questions (Ask Later)

- Window start time and any exceptions
- Campaign-to-dataset mapping rules
- Bulk paste limits and formats
- Retry policy details (soft vs hard failures)

---

## 9. Change Log

- 2026-06-04: Initial creation.
