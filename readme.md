# Ingestion System (MVP)

Minimal README to run the MVP locally for review and testing.

Requirements
- Node.js 20+
- PostgreSQL (optional for database-backed features)
- Redis (optional for queues)

Local dev

1. Install dependencies:

```bash
npm install
```

2. Start the app for development:

```bash
npm run dev
```

Environment
- Set `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY` (32+ chars), and optionally `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_SERVER_ID` for Discord features.

Testing
- Integration SMTP test:

```bash
npm run test:send
```

- Gmail SMTP test (requires SMTP_TEST_EMAIL / SMTP_TEST_APP_PASSWORD in `.env`):

```bash
npm run test:gmail
```

- Full environment smoke test (requires DB + Redis):

```bash
npm run test:e2e
```

Notes
- This repo contains Phase 1 (MVP) features. See `project_plan_progress.md` for status.
# 📦 System Architecture & Implementation – Phase 1 & Phase 2

## 1. Overview

This project is a scalable email processing and sending system with a Discord-based control interface. It is designed to handle large-scale dataset ingestion, deduplication, queue-based processing, SMTP-based sending, and real-time operational monitoring.

The system follows a two-phase delivery approach:

* **Phase 1:** Core system implementation (fully functional and testable)
* **Phase 2:** Optimization, refinement, and performance tuning using real-world datasets

---

## 2. Objectives

* Build a fully operational end-to-end pipeline for email ingestion and sending
* Enable Discord as the primary control interface
* Ensure system is testable with real datasets after Phase 1
* Improve performance, reliability, and scalability in Phase 2

---

## 3. Infrastructure

### 3.1 Application Layer

* VPS (Contabo)
* Linux-based environment (Ubuntu recommended)

### 3.2 Storage Layer

* S3-compatible Object Storage (Contabo)
* Used for:

  * Raw dataset storage
  * Processed data
  * Intermediate ingestion files

### 3.3 Interface Layer

* Discord Bot (Primary control interface)

---

## 4. High-Level Architecture

```
[Discord Bot]
     ↓
[API / Command Layer]
     ↓
[Ingestion Service] → [Deduplication Layer]
     ↓
[Queue System]
     ↓
[SMTP Engine / Sender]
     ↓
[Logging & Monitoring System]
```

---

## 5. Core Components

### 5.1 Ingestion Service

* Accepts dataset paths (S3 URLs or storage paths)
* Supports CSV / Parquet formats
* Parses and normalizes input data
* Validates structure and fields

---

### 5.2 Deduplication System

* Ensures global uniqueness (e.g., email-based deduplication)
* Prevents duplicate sending across datasets
* Uses hashing/indexing strategy

---

### 5.3 Queue System

* Handles job-based processing
* Supports ingestion jobs and sending jobs
* Enables pause/resume functionality
* Ensures controlled throughput

---

### 5.4 SMTP Management

* Supports multiple SMTP accounts
* Handles:

  * Rotation
  * Rate limits
  * Failover
* Tracks usage per account

---

### 5.5 Sending Engine

* Batch-based email sending
* Retry mechanism for failed attempts
* Tracks:

  * Success
  * Failures
  * Bounce handling (basic in Phase 1)

---

### 5.6 Logging System

* Captures:

  * Job status
  * Errors
  * Processing logs
* Provides visibility for debugging and monitoring

---

### 5.7 Discord Interface

#### Phase 1 (Basic Control Layer)

* Trigger ingestion jobs
  `/ingest <file_path>`
* Check job status
  `/status`
* Basic system status

#### Phase 2 (Extended Control Layer)

* Queue monitoring
* SMTP account status
* Sending controls (start/pause/resume)
* Logs and failure reporting
* Alerts and notifications

---

## 6. Phase Breakdown

### 🔹 Phase 1 – Core System Implementation

**Goal:** Deliver a fully functional and testable system

#### Includes:

* Full ingestion pipeline (S3-based)
* Data parsing and normalization
* Deduplication logic (basic but functional)
* Queue system (job handling)
* SMTP integration (rotation + limits)
* Sending pipeline (basic batch sending)
* Logging system (basic visibility)
* Discord integration:

  * Ingestion trigger
  * Status commands

#### Outcome:

* End-to-end workflow is operational
* System is ready for real dataset testing
* Core components exist but are not fully optimized

---

### 🔹 Phase 2 – Optimization & Refinement

**Goal:** Improve system performance and reliability

#### Includes:

* Performance tuning (queue + sending)
* Deduplication improvements (scale handling)
* SMTP optimization (rotation strategies)
* Error handling enhancements
* Logging improvements
* Discord expansion:

  * Advanced controls
  * Monitoring
  * Alerts

#### Outcome:

* Production-ready system
* Stable under real-world usage
* Improved operational control

---

## 7. Ingestion Workflow

1. Upload dataset to storage
2. Trigger ingestion via Discord:

```
/ingest s3://bucket/path/file.csv
```

3. System:

   * Fetches file
   * Parses data
   * Deduplicates entries
   * Pushes to queue

---

## 8. Sending Workflow

1. Queue processes records
2. SMTP engine selects account
3. Applies rate limits
4. Sends email
5. Logs result

---

## 9. Security Considerations

* Credentials stored using environment variables
* No hardcoded secrets
* Access keys rotated after setup
* VPS access restricted (recommended)

---

## 10. Deployment Plan

### Step 1: Server Setup

* Configure VPS
* Install dependencies

### Step 2: Storage Integration

* Connect to S3-compatible storage
* Validate read/write

### Step 3: Discord Setup

* Deploy bot
* Register commands

### Step 4: Core System Deployment

* Deploy ingestion + queue + sender

### Step 5: Testing

* Run ingestion jobs
* Validate sending pipeline

---

## 11. Assumptions

* Input datasets are structured (CSV/Parquet)
* SMTP accounts are valid and functional
* Storage access is correctly configured
* Discord bot has required permissions

---

## 12. Out of Scope (Phase 1)

* Advanced analytics dashboards
* High-scale distributed processing
* Complex retry orchestration
* Full observability stack (metrics dashboards)
* Advanced alerting systems

---

## 13. Future Expansion (Post Phase 2)

* Horizontal scaling
* Load balancing
* Advanced monitoring (Prometheus/Grafana)
* UI dashboard (optional)
* Automated scheduling

---

## 14. Summary

This system is designed to:

* Be modular and scalable
* Provide early functional value (Phase 1)
* Reach production quality through iteration (Phase 2)

The phased approach ensures:

* Faster initial deployment
* Real-world validation
* Controlled system evolution
