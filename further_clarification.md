# System Clarifications & Finalized Assumptions

This document defines the complete, confirmed behavior and architecture of the system based on client requirements. It is intended to guide implementation without ambiguity.

---

# 1. System Overview

The platform is a **Discord-controlled email operations system** that:

* Ingests datasets from storage or links
* Extracts and processes email records
* Deduplicates globally
* Queues emails for sending
* Automatically sends emails based on configured time windows and account limits

---

# 2. Core Architecture

## 2.1 High-Level Flow

1. Dataset is submitted via Discord (`/ingest`)
2. System fetches file (URL or storage path)
3. Emails are:

   * Extracted
   * Normalized
   * Validated
   * Deduplicated (globally)
4. Valid emails are stored and placed into a **sending queue**
5. Queue is processed automatically during **sending windows**
6. Emails are sent using available SMTP accounts with enforced limits

---

# 3. Ingestion System

## 3.1 Supported Input Formats

* CSV
* JSON
* TXT
* Raw text
* Bulk pasted data

## 3.2 Schema Rules

* No fixed schema
* Only required field: **email**
* All other fields treated as metadata

## 3.3 Input Sources

* Public URLs
* Object storage paths (S3-compatible)
* Storage accessed via credentials or direct links

---

# 4. Deduplication

* Deduplication is:

  * Global across all datasets
  * Based on normalized lowercase email
* No duplicates allowed in storage
* Deduplication is **permanent (no TTL/reset)**

---

# 5. Storage

* S3-compatible object storage (Contabo)
* Used for:

  * Input datasets
  * Processed datasets
  * Reports/logs

## Suggested Structure

/input/
/processed/
/reports/

---

# 6. Sending System

## 6.1 Sending Model

* Fully **automated**
* No manual `/send` required
* Emails enter queue after ingestion
* Queue is processed during **scheduled sending windows**

---

## 6.2 Sending Window

* Default: **6-hour cycle**
* Emails wait until next available window
* System processes queue only during active window

---

## 6.3 Rate Limits (Default Configuration)

Defined per email account:

* Max: **50 emails per 6-hour window**

System must enforce:

* Per-account quotas
* Reset after each window

---

# 7. Infrastructure Hierarchy

The system must model and manage:

cPanel Account
└── Subdomains (5 per account)
  └── Email Accounts (5 per subdomain)
    └── Sending Accounts

### Requirements:

* All entities stored and tracked
* Fully configurable (defaults provided)
* Used to distribute sending load

---

# 8. SMTP / Sending Engine

## 8.1 Requirements

* Support multiple SMTP/email accounts
* Dynamic scaling (accounts can be added)
* Load distribution across accounts

## 8.2 Sending Logic

* Select available account
* Check quota (remaining in current window)
* Send email
* Update usage tracking

---

# 9. Campaign System

## 9.1 Email Content Management

Managed via **Discord commands**

Each campaign includes:

* Subject
* Body (HTML + optional plain text)
* From address
* Reply-to address

---

## 9.2 Campaign Behavior

* Campaign is linked to dataset
* Emails in dataset are sent using campaign content
* Campaigns can be created/updated via Discord

---

# 10. Queue System

## 10.1 Job Types

* Ingestion jobs
* Processing jobs
* Sending jobs

## 10.2 Requirements

* Asynchronous processing
* Job status tracking:

  * Pending
  * Processing
  * Completed
  * Failed

---

# 11. Scheduler System

## 11.1 Responsibilities

* Control sending windows (6-hour cycle)
* Start/stop queue processing
* Reset account quotas per cycle

---

# 12. Discord Interface (Primary Control Layer)

All operations must be accessible via Discord.

## 12.1 Required Commands

### Ingestion

* `/ingest <file_url_or_path>`

### Campaign

* `/campaign create`
* `/campaign update`
* `/campaign list`

### Queue

* `/queue status`

### Accounts

* `/accounts status`

### Control

* `/pause`
* `/resume`

### Logs

* `/logs`

---

## 12.2 Behavior

* Discord acts as **frontend interface**
* System responds with:

  * Status updates
  * Results
  * Errors

---

# 13. Logging & Monitoring

## 13.1 Logging Rules

* Do NOT store raw emails in logs
* Use:

  * Masked emails (e.g. j***@domain.com)
  * OR hashed values

## 13.2 Logged Data

* Ingestion results
* Sending activity
* Failures/errors

---

# 14. Output Artifacts

System should generate:

* Cleaned dataset (deduplicated emails)
* Processing report:

  * Total records
  * Valid emails
  * Duplicates removed
  * Errors

---

# 15. Technical Stack (Defined)

* Backend: Node.js (TypeScript)
* Framework: Fastify / Express
* Database: PostgreSQL
* Queue: Redis + BullMQ
* Storage: S3-compatible (Contabo)
* Discord: discord.js

---

# 16. Non-Goals (Phase 1 Exclusions)

* Unsubscribe management
* Complaint handling (FBL)
* Advanced analytics dashboards
* Email warmup automation
* Template management system (basic only via Discord)

---

# 17. Summary

This system is a:

> Distributed email ingestion and delivery platform
> with automated scheduling, strict rate limiting,
> and full operational control via Discord.

---

# 18. Implementation Readiness

All required behaviors, constraints, and flows are now defined.

No further clarification is required before development.

---

# 19. Client Clarifications (2026-06-04)

- Discord is the primary operational interface; all core operations must be available via commands.
- Backend APIs must expose all system operations and are consumed by the Discord bot.
- The cPanel hierarchy is active infrastructure: cPanel -> subdomain -> email accounts -> SMTP accounts.
- Each level must be modeled explicitly in the database.
- Sending logic enforces per-account limits, tracks usage per sending window, and rotates accounts intelligently.
- SMTP accounts are dynamic resources tied to the hierarchy and scale by adding more accounts.
- Discord operations include pause/resume sending, queue monitoring, account usage inspection, and ingestion triggers.
