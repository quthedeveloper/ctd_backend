-- Migration 003: gateway API token for gateway authentication
-- Run once against your PostgreSQL database. Safe to re-run.

-- Stores the SHA-256 hash of each gateway's API token (the plaintext
-- token is shown once at registration and never stored).
ALTER TABLE gateways ADD COLUMN IF NOT EXISTS api_token_hash TEXT UNIQUE;
