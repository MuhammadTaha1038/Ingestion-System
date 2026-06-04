# System Clarifications & Assumptions

This document captures confirmed requirements and defined assumptions for the system before implementation begins. It ensures alignment between development and expected behavior.

---

# 1. Confirmed Requirements

## 1.1 Ingestion & Data Handling

- The system must support **flexible input formats**, including:
  - CSV
  - JSON
  - TXT
  - Raw text
  - Bulk pasted content
- There is **no fixed schema**
- The **only required field is email address**
- The ingestion pipeline must:
  - Extract emails from any format
  - Normalize emails (lowercase, trimmed)
  - Validate email format
  - Process and store valid emails
- Additional fields are treated as **optional metadata**

---

## 1.2 Deduplication

- Deduplication is:
  - **Global across the entire system**
  - Based on **normalized email address**
- Same email must never exist twice in storage
- Applies across:
  - All datasets
  - All ingestion runs

---

## 1.3 Storage

- Object storage is provided via **Contabo**
- Datasets are:
  - Uploaded externally (not via Discord)
  - Referenced using:
    - Public URLs OR
    - Object storage paths
- System will:
  - Fetch files from provided paths
  - Process and store results internally

---

## 1.4 Discord as Primary Interface

Discord is the **main operational control layer**.

All key operations must be accessible via Discord commands, including:

- Ingestion triggering
- Job status tracking
- Queue visibility
- SMTP monitoring
- Sending controls
- Logs and alerts

### Example command:
/ingest https://storage-location/file.csv


---

## 1.5 SMTP System

- Must support **dynamic number of SMTP accounts**
- Each account should have:
  - Configurable sending limits
  - Independent usage tracking
- System should support:
  - SMTP rotation
  - Load distribution across accounts

---

# 2. System Behavior Expectations

## 2.1 Ingestion Workflow

1. User submits file via Discord command
2. System:
   - Downloads file
   - Extracts emails
   - Normalizes and validates
   - Removes duplicates (global)
   - Stores results
3. System returns:
   - Total records processed
   - Valid emails count
   - Duplicates removed
   - Errors (if any)

---

## 2.2 Queue System

- All ingestion and sending operations must be **asynchronous**
- Each operation is treated as a **job**
- Jobs must include:
  - Unique ID
  - Status (pending, processing, completed, failed)
  - Progress tracking

---

## 2.3 Logging & Monitoring

- System must log:
  - Ingestion activity
  - Sending activity
  - Failures and errors
- Logs should be accessible (initially basic, extended later)

---

# 3. Open Areas (Defined Assumptions)

The following were not explicitly defined and are assumed for implementation.

---

## 3.1 Preferred Stack

**Assumed stack:**

- **Backend:** Node.js (TypeScript)
- **Framework:** Express / Fastify
- **Database:** PostgreSQL
- **Queue:** Redis + BullMQ
- **Storage SDK:** S3-compatible (Contabo)
- **Discord Integration:** discord.js

### Reasoning:
- Strong async support
- Good ecosystem for queues and Discord bots
- Scalable and production-proven

---

## 3.2 Expected Dataset Size & Throughput

**Assumptions:**

- Dataset size:
  - Typical: 10K – 500K emails per file
  - Max (initial): up to ~1M emails

- Throughput target:
  - Ingestion: ~5K–20K emails/sec (batch processed)
  - Sending: depends on SMTP limits

### Notes:
- System will be designed to scale beyond this if needed
- Streaming ingestion will be used for large files

---

## 3.3 SMTP Providers & Constraints

**Assumptions:**

- Multiple SMTP providers may be used
- Each account may have:
  - Daily/hourly sending limits
  - Concurrent connection limits

### System Design:

- Configurable per-account:
  - Max emails/hour
  - Max concurrent sends
- Basic rotation strategy:
  - Round-robin or weighted distribution

### Warmup:

- Not enforced at system level initially
- Can be added later as Phase 2 enhancement

---

## 3.4 Compliance (Implicit)

- Email validation is required
- System will:
  - Avoid duplicate sends
  - Track failed sends

**Not included (unless specified later):**
- Unsubscribe management
- Complaint handling (FBL)
- Legal compliance workflows (GDPR/CAN-SPAM)

---

## 3.5 Storage Configuration

- S3-compatible storage (Contabo)
- Assumptions:
  - Single bucket (unless specified)
  - No lifecycle rules initially
  - Files persist unless manually removed

---

## 3.6 Logging Retention

**Assumption:**
- Logs retained for:
  - Short-term debugging (7–14 days)
- Can be extended later if needed

---

# 4. Phase Alignment

## Phase 1 (MVP)

Includes:

- Full ingestion pipeline
- Global deduplication
- Queue system
- SMTP system (functional)
- Sending workflow
- Basic Discord control interface

System must be:
- Fully functional
- End-to-end testable

---

## Phase 2

Focus on:

- Performance optimization
- Stability improvements
- Real dataset calibration
- Advanced Discord controls
- Better monitoring & reporting

---

# 5. Summary

This system is designed as:

> A scalable email ingestion and sending platform  
> controlled entirely via Discord,  
> with flexible input handling and global deduplication.

---

# 6. Next Step

If any assumptions above differ from expectations, they should be clarified before implementation continues.