# Project Plan and Progress

This document tracks the step-by-step plan and progress for the MVP and Phase 2. Update this file as work progresses to keep scope, decisions, and client visibility clear.

---

## 1. Current Status

- Date: 2026-06-04
- Phase: Phase 1 (MVP)
- Status: In progress

---

## 2. Phase 1 Milestones (MVP)

- [ ] Infrastructure setup and hardening
- [ ] Storage integration and validation
- [ ] Core services scaffold (API, workers, scheduler)
- [ ] Ingestion pipeline (format-agnostic)
- [ ] Global deduplication store
- [ ] Queue and job lifecycle
- [ ] SMTP manager with rate limits and account hierarchy
- [ ] Sending engine and retries
- [ ] Discord primary control plane (all ops via commands)
- [ ] Logging and reports
- [ ] End-to-end test run
- [ ] Deployment runbook and handoff notes

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

- [ ] Confirm environment and stack versions
- [x] Establish project structure and repo conventions
- [x] Define configuration and secrets strategy

### 4.2 Data Layer

- [x] Design database schema (dedup index, jobs, campaigns, accounts)
- [x] Define storage paths and output artifact formats
- [x] Implement database access layer and repositories
- [x] Add S3 storage adapter (read/write for ingestion artifacts)

### 4.3 Ingestion

- [ ] Implement streaming ingestion per format
- [x] Implement extraction, normalization, validation
- [x] Integrate global deduplication (Postgres-backed store with fallback)
- [x] Persist cleaned dataset and summary report (local storage prototype; S3 pending)

### 4.4 Queue and Scheduler

- [x] Implement FIFO queue
- [x] Implement job lifecycle and progress
- [x] Implement scheduler with configurable window

### 4.5 Sending

- [ ] Implement SMTP account hierarchy models and lifecycle management
- [ ] Implement rate limits, per-window usage tracking, and rotation strategy
- [ ] Implement sending engine and retries

### 4.6 Discord Control Plane

- [ ] Implement primary Discord commands for ingestion, queue visibility, SMTP/account monitoring, sending controls, logs, and campaign management
- [ ] Implement permission checks and response formatting
- [ ] Ensure API coverage for all Discord operations

### 4.7 Logging and Monitoring

- [ ] Structured logs for ingestion and sending
- [ ] Reporting outputs (summary + artifacts)

### 4.8 QA and Release

- [ ] Run end-to-end test with sample datasets
- [ ] Validate sending window behavior
- [ ] Verify Discord command flows
- [ ] Produce deployment runbook

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
