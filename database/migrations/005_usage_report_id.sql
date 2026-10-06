-- Migration 005: idempotency key for gateway usage reports
-- Run once against your PostgreSQL database. Safe to re-run.
--
-- Gateways retry usage posts on network failure; report_id lets the backend
-- ignore duplicates so bytes are never double-counted.

ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS report_id TEXT UNIQUE;
