# Ingestion Module

This folder contains the format-agnostic ingestion pipeline used in Phase 1.

Implemented:
- Email extraction for CSV, JSON, and text inputs
- Normalization and validation helpers
- In-memory dedup store for local testing
- Ingestion result stats and error reporting

Notes:
- CSV parsing uses csv-parse for header-aware extraction.
- Large datasets should move to streaming ingestion in Phase 1 follow-up.
- Deduplication is wired via an interface so storage can be swapped to PostgreSQL later.
