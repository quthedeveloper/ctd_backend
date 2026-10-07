-- Migration 007: align the base schema with the API's actual behavior
-- Run once against your PostgreSQL database. Safe to re-run: every statement
-- is guarded.
--
-- Found by diffing the code against the real schema (pg_dump 2026-10-07).
-- Without this, the following endpoints 500 against the real database:
--
--  1. POST /devices and POST /trials without the optional device_identifier /
--     device_id -> devices.device_identifier and trials.device_id were NOT NULL
--     while the API treats both as optional.
--  2. POST /gateways/:id/peers (and the quota-exhaustion path) -> the
--     gateway_peers.status check only allowed active/inactive/revoked, but the
--     peer lifecycle writes pending -> active -> revoking -> revoked (or error).
--  3. POST /gateways/sessions (disconnect) -> sessions.status check lacked
--     'closed', which the disconnect path writes.
--  4. POST /subscriptions/:id/suspend -> subscriptions.status check lacked
--     'suspended'.

-- 1) Optional API fields must accept NULL
ALTER TABLE public.devices ALTER COLUMN device_identifier DROP NOT NULL;
ALTER TABLE public.trials ALTER COLUMN device_id DROP NOT NULL;

-- 2) Peer lifecycle statuses used by the API
ALTER TABLE public.gateway_peers DROP CONSTRAINT IF EXISTS gateway_peers_status_check;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gateway_peers_status_check') THEN
        ALTER TABLE public.gateway_peers ADD CONSTRAINT gateway_peers_status_check
            CHECK ((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'revoking'::character varying, 'revoked'::character varying, 'error'::character varying, 'inactive'::character varying])::text[]));
    END IF;
END $$;

-- 3) Session close status used by the API
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_status_check') THEN
        ALTER TABLE public.sessions ADD CONSTRAINT sessions_status_check
            CHECK ((status)::text = ANY ((ARRAY['active'::character varying, 'disconnected'::character varying, 'terminated'::character varying, 'closed'::character varying])::text[]));
    END IF;
END $$;

-- 4) Suspended status used by the API
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check') THEN
        ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
            CHECK ((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'expired'::character varying, 'cancelled'::character varying, 'suspended'::character varying])::text[]));
    END IF;
END $$;
