-- Migration 001: base schema (CTD business tables)
-- Snapshot of the original database design. Safe to re-run: every statement
-- is guarded (IF NOT EXISTS for tables/indexes/extension, constraint-existence
-- checks for foreign keys).
--
-- Later migrations build on this foundation:
--   002  Better Auth tables (user/session/account/verification) +
--        users.clerk_user_id -> auth_user_id rename
--   003  gateways.api_token_hash
--   004  gateway_commands table
--   005  usage_records.report_id
--   006  users.role
--   007  schema alignment fixes (nullability, status check values)

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- ---------------------------------------------------------------- tables ---

CREATE TABLE IF NOT EXISTS public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    email character varying(255) NOT NULL UNIQUE,
    role character varying(50) DEFAULT 'admin'::character varying NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'super_admin'::character varying, 'support'::character varying])::text[]))),
    CONSTRAINT admin_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'disabled'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    actor uuid,
    action character varying(100) NOT NULL,
    resource character varying(100) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    public_key text NOT NULL,
    device_identifier character varying(255) NOT NULL UNIQUE,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    last_seen_at timestamp with time zone,
    CONSTRAINT devices_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'blocked'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.gateway_peers (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    gateway_id uuid NOT NULL,
    device_id uuid NOT NULL,
    tunnel_ip inet NOT NULL,
    public_key text NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    CONSTRAINT unique_gateway_device UNIQUE (gateway_id, device_id),
    CONSTRAINT gateway_peers_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'revoked'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.gateways (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    gateway_uuid uuid DEFAULT gen_random_uuid() NOT NULL UNIQUE,
    name character varying(150) NOT NULL,
    status character varying(30) DEFAULT 'offline'::character varying NOT NULL,
    capacity_users integer DEFAULT 0 NOT NULL,
    last_heartbeat_at timestamp with time zone,
    CONSTRAINT gateways_capacity_check CHECK ((capacity_users >= 0)),
    CONSTRAINT gateways_status_check CHECK (((status)::text = ANY ((ARRAY['online'::character varying, 'offline'::character varying, 'maintenance'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name character varying(100) NOT NULL UNIQUE,
    price numeric(12,2) NOT NULL,
    currency character(3) DEFAULT 'GHS'::bpchar NOT NULL,
    quota_bytes bigint NOT NULL,
    duration_hours integer NOT NULL,
    speed_policy jsonb,
    CONSTRAINT packages_duration_check CHECK ((duration_hours > 0)),
    CONSTRAINT packages_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT packages_quota_check CHECK ((quota_bytes > 0))
);

CREATE TABLE IF NOT EXISTS public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    provider_reference character varying(255) NOT NULL UNIQUE,
    amount numeric(12,2) NOT NULL,
    currency character(3) DEFAULT 'GHS'::bpchar NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    paid_at timestamp with time zone,
    CONSTRAINT payments_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT payments_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'successful'::character varying, 'failed'::character varying, 'refunded'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    device_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    tunnel_ip inet,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    disconnected_at timestamp with time zone,
    CONSTRAINT sessions_dates_check CHECK (((disconnected_at IS NULL) OR (disconnected_at >= connected_at))),
    CONSTRAINT sessions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'disconnected'::character varying, 'terminated'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    package_id uuid NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    quota_bytes bigint NOT NULL,
    used_bytes bigint DEFAULT 0 NOT NULL,
    CONSTRAINT subscriptions_dates_check CHECK ((expires_at > starts_at)),
    CONSTRAINT subscriptions_quota_check CHECK ((quota_bytes > 0)),
    CONSTRAINT subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'expired'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT subscriptions_used_check CHECK ((used_bytes >= 0))
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    subject character varying(255) NOT NULL,
    message text NOT NULL,
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    priority character varying(30) DEFAULT 'normal'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'normal'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT support_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'in_progress'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.trials (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    device_id uuid NOT NULL,
    quota_bytes bigint NOT NULL,
    used_bytes bigint DEFAULT 0 NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    CONSTRAINT trials_dates_check CHECK ((expires_at > starts_at)),
    CONSTRAINT trials_quota_check CHECK ((quota_bytes > 0)),
    CONSTRAINT trials_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'expired'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT trials_used_check CHECK ((used_bytes >= 0))
);

CREATE TABLE IF NOT EXISTS public.usage_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    gateway_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    bytes_rx bigint DEFAULT 0 NOT NULL,
    bytes_tx bigint DEFAULT 0 NOT NULL,
    CONSTRAINT usage_dates_check CHECK ((period_end > period_start)),
    CONSTRAINT usage_rx_check CHECK ((bytes_rx >= 0)),
    CONSTRAINT usage_tx_check CHECK ((bytes_tx >= 0))
);

-- NOTE: the original column name is clerk_user_id on purpose — migration 002
-- renames it to auth_user_id (guarded, so this is a no-op where 002 ran).
CREATE TABLE IF NOT EXISTS public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    full_name character varying(150) NOT NULL,
    email character varying(255) NOT NULL UNIQUE,
    phone character varying(30),
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    clerk_user_id character varying(255),
    CONSTRAINT users_clerk_user_id_unique UNIQUE (clerk_user_id),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'disabled'::character varying])::text[])))
);

-- ------------------------------------------------- foreign keys (guarded) ---

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_devices_user') THEN
        ALTER TABLE ONLY public.devices ADD CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gateway_peers_device') THEN
        ALTER TABLE ONLY public.gateway_peers ADD CONSTRAINT fk_gateway_peers_device FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_gateway_peers_gateway') THEN
        ALTER TABLE ONLY public.gateway_peers ADD CONSTRAINT fk_gateway_peers_gateway FOREIGN KEY (gateway_id) REFERENCES public.gateways(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_subscription') THEN
        ALTER TABLE ONLY public.payments ADD CONSTRAINT fk_payments_subscription FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payments_user') THEN
        ALTER TABLE ONLY public.payments ADD CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessions_device') THEN
        ALTER TABLE ONLY public.sessions ADD CONSTRAINT fk_sessions_device FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessions_gateway') THEN
        ALTER TABLE ONLY public.sessions ADD CONSTRAINT fk_sessions_gateway FOREIGN KEY (gateway_id) REFERENCES public.gateways(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessions_user') THEN
        ALTER TABLE ONLY public.sessions ADD CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscriptions_package') THEN
        ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT fk_subscriptions_package FOREIGN KEY (package_id) REFERENCES public.packages(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_subscriptions_user') THEN
        ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_support_user') THEN
        ALTER TABLE ONLY public.support_tickets ADD CONSTRAINT fk_support_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_trials_device') THEN
        ALTER TABLE ONLY public.trials ADD CONSTRAINT fk_trials_device FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_trials_user') THEN
        ALTER TABLE ONLY public.trials ADD CONSTRAINT fk_trials_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_usage_gateway') THEN
        ALTER TABLE ONLY public.usage_records ADD CONSTRAINT fk_usage_gateway FOREIGN KEY (gateway_id) REFERENCES public.gateways(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_usage_session') THEN
        ALTER TABLE ONLY public.usage_records ADD CONSTRAINT fk_usage_session FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_usage_user') THEN
        ALTER TABLE ONLY public.usage_records ADD CONSTRAINT fk_usage_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ---------------------------------------------------------------- indexes ---

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs USING btree (actor);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON public.devices USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_gateway_peers_device_id ON public.gateway_peers USING btree (device_id);
CREATE INDEX IF NOT EXISTS idx_gateway_peers_gateway_id ON public.gateway_peers USING btree (gateway_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON public.payments USING btree (subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON public.payments USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON public.sessions USING btree (device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_gateway_id ON public.sessions USING btree (gateway_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions USING btree (status);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions USING btree (status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets USING btree (status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_trials_user_id ON public.trials USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_usage_gateway_id ON public.usage_records USING btree (gateway_id);
CREATE INDEX IF NOT EXISTS idx_usage_session_id ON public.usage_records USING btree (session_id);
CREATE INDEX IF NOT EXISTS idx_usage_user_id ON public.usage_records USING btree (user_id);
