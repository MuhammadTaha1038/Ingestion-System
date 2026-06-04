# Data Schema (PostgreSQL)

This document defines the Phase 1 database schema for the ingestion system. It focuses on global deduplication, campaign sending, SMTP hierarchy, and operational tracking.

---

## 1. Overview

The schema supports:

- Global email deduplication (permanent)
- Dataset tracking and ingestion reporting
- Campaign management
- Sending queue and delivery status
- SMTP account hierarchy and usage per window (active infrastructure)
- Job tracking for ingestion and sending workflows

---

## 2. Core Tables

### 2.1 datasets

Tracks ingestion datasets and processing outcomes.

Key fields:

- source_path (URL or storage path)
- status (pending, processing, completed, failed)
- counts (raw, valid, duplicates, errors)
- processed_path and report_path

### 2.2 recipients

Global dedup index for normalized emails.

Key fields:

- email_normalized (unique)
- email_domain
- metadata (jsonb)
- first_dataset_id

### 2.3 campaigns

Stores campaign content and sending details.

Key fields:

- subject
- body_html
- body_text
- from_address
- reply_to
- status (draft, active, paused, archived)

### 2.4 sending_tasks

Links recipients to campaigns and tracks delivery state.

Key fields:

- campaign_id
- recipient_id
- status (pending, sending, sent, failed, skipped)
- attempt_count and last_error

### 2.5 jobs

Tracks async operations such as ingestion and sending.

Key fields:

- type (ingestion, processing, sending)
- status (pending, processing, completed, failed)
- dataset_id and campaign_id
- progress counts

---

## 3. SMTP Hierarchy

### 3.1 cpanel_accounts

Top-level account grouping.

### 3.2 subdomains

Subdomains under a cPanel account.

### 3.3 email_accounts

Email accounts under a subdomain.

### 3.4 smtp_accounts

SMTP identities used for sending.

Key fields:

- host, port, username
- password_encrypted (storage placeholder)
- max_per_window
- max_concurrent
- status (active, paused, disabled)

SMTP accounts are treated as managed resources tied to the hierarchy. Usage is tracked per sending window to enforce limits and enable rotation.

---

## 4. Scheduling

### 4.1 sending_windows

Tracks active and historical sending windows.

### 4.2 smtp_usage

Per-window usage tracking per SMTP account.

---

## 5. Notes and Constraints

- Deduplication is permanent via unique constraint on email_normalized.
- Queue is FIFO in Phase 1 (priority can be added later).
- Email visibility in logs is allowed for now; masking can be added later.
- Passwords should be stored securely (encrypted or via secret reference).

---

## 6. Reference SQL

See db/schema.sql for the authoritative table definitions.
