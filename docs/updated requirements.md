# System Requirements & Phase Alignment (Updated)

## Purpose

This document aligns the current implementation with the **intended workflow**, incorporating all recent clarifications to ensure accurate **Phase 1 validation** and clearly scoped **Phase 2 enhancements**.

---

# 1. Intended End-to-End Workflow (Validation Target)

The system must support and allow testing of the following complete workflow:

**SMTP TXT Upload → Account Ingestion → SMTP Login Validation → Storage (S3) → Account Visibility → Campaign Usage → Sending**

### Expected Behavior:

* SMTP accounts are uploaded via TXT file
* Accounts are parsed and ingested into the system
* Each account undergoes login validation
* Accounts are stored in S3
* Accounts become visible in system UI/Discord
* Accounts are available for campaign usage
* Sending workflow utilizes these accounts

### Failure Handling:

* If SMTP login validation fails:

  * Account must be marked as **inactive/failed**
  * Must be excluded from the sending pool

---

# 2. Phase 1 — Core System Capabilities

## 2.1 Dataset Processing

* TXT dataset ingestion
* Email extraction from raw/unstructured text
* Email normalization
* Deduplication

---

## 2.2 SMTP Account Management

### Implemented

* Manual SMTP account creation via:

  * UI
  * Discord commands

### Required for Validation (Now Included)

* SMTP bulk ingestion via TXT file upload
* Parsing of account data from file
* Integration into full workflow (not isolated feature)

---

## 2.3 Sending System (Current Implementation)

### Implemented Features

* 6-hour sending windows
* Automatic window reset
* Per-account quota:

  * Default: 50 emails per window (~200/day)
  * Configurable
* Load distribution:

  * Round-robin across accounts
* Failure handling:

  * Auto-disable after 5 consecutive failures

---

## 2.4 Campaign Workflow

* Campaign creation
* Campaign execution
* SMTP account utilization during sending
* Discord-based system operation and visibility

---

# 3. Phase 1 — Validation Scope

The following must be fully testable before moving forward:

## 3.1 Data Pipeline Validation

* Dataset ingestion
* Email extraction accuracy (real-world TXT datasets)
* Normalization correctness
* Deduplication effectiveness

## 3.2 SMTP Workflow Validation

* TXT-based SMTP account ingestion
* SMTP login validation behavior
* Correct storage (S3)
* Account visibility in system
* Account usability in campaigns

## 3.3 Sending Workflow Validation

* Campaign creation and execution
* Distribution of sends across accounts
* Account participation in sending pool
* End-to-end execution from ingestion to sending

## 3.4 System Integration Validation

* Discord-based control and monitoring
* Full pipeline consistency and reliability

---

# 4. Sending Policy Requirements — Status

## 4.1 Implemented in Phase 1

* 6-hour sending windows
* Per-window quota system
* Round-robin distribution
* Auto-disable on repeated failures

---

## 4.2 Not Implemented (Planned for Phase 2)

The following requirements were identified and are **not part of the current Phase 1 build**:

### Sending Limits & Scheduling

* 9,000 emails/day per SMTP account
* Warmup schedules for new accounts
* Daily sending limits enforcement
* Daily counter reset logic (beyond window-based system)

### Intelligent Distribution

* Advanced distribution across available accounts
* Skipping accounts that reach daily limits

### Deliverability & Compliance

* Bounce handling integration
* Complaint tracking and handling
* Automatic unsubscribe/address suppression
* Account disable logic based on:

  * Bounce thresholds
  * Complaint thresholds

---

# 5. Phase 2 — Refinement & Enhancement Scope

Phase 2 will focus on improving the validated system with:

## 5.1 Sending System Enhancements

* Daily caps (e.g., 9,000 emails/account/day)
* Warmup scheduling system
* Advanced distribution logic
* Smart account rotation and throttling
* Daily quota tracking and reset

## 5.2 Deliverability & Compliance

* Bounce/complaint feedback loops
* Automatic suppression lists (unsubscribe handling)
* Account health monitoring and scoring
* Dynamic account disabling rules

## 5.3 Workflow Automation

* Fully automated ingestion pipelines
* Reduced manual intervention
* Improved operational efficiency

## 5.4 Analytics & Reporting

* Campaign performance metrics
* SMTP account performance tracking
* Delivery, bounce, and complaint statistics
* Reporting dashboards

## 5.5 Performance & Scalability

* Large dataset optimization
* High-volume sending improvements
* Scalable architecture

## 5.6 Reliability & Observability

* Fault tolerance
* Retry mechanisms
* Enhanced logging and monitoring

---

# 6. Key Alignment Notes

* Phase 1 goal: **Validate core system and workflow integrity**

* Phase 2 goal: **Enhance, scale, and optimize the validated system**

* SMTP TXT ingestion is required for:

  * Matching intended workflow
  * Enabling realistic large-scale testing
  * Completing end-to-end validation

* Sending policy rules (advanced) are acknowledged but **deferred to Phase 2**

---

# 7. Next Steps

1. Implement SMTP TXT ingestion with validation integration
2. Notify when ready for testing
3. Client completes full workflow validation
4. Identify gaps/issues (if any)
5. Confirm Phase 1 completion
6. Define and initiate Phase 2 scope

---

**End of Document**
