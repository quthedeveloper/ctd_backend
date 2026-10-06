-- Migration 004: gateway command queue (backend -> gateway control plane)
-- Run once against your PostgreSQL database. Safe to re-run.
--
-- The gateway initiates all communication (heartbeat), so commands are queued
-- here and delivered on the next heartbeat. Each command carries a unique
-- message_id for idempotency (PDF section 11).

CREATE TABLE IF NOT EXISTS gateway_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gateway_id UUID NOT NULL REFERENCES gateways(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gateway_commands_pending
    ON gateway_commands(gateway_id, status);
