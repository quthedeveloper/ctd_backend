-- Migration 008: add OAuth token columns to the account table
-- Run once against your PostgreSQL database. Safe to re-run: every statement
-- is guarded.
--
-- The account table from migration 002 predates better-auth 1.7.x, which
-- expects these columns and logs a "Database schema mismatch" error at
-- startup without them. They stay NULL for email/password accounts —
-- no OAuth providers are configured in V1.

ALTER TABLE public.account ADD COLUMN IF NOT EXISTS "accessToken" text;
ALTER TABLE public.account ADD COLUMN IF NOT EXISTS "refreshToken" text;
ALTER TABLE public.account ADD COLUMN IF NOT EXISTS "idToken" text;
ALTER TABLE public.account ADD COLUMN IF NOT EXISTS "accessTokenExpiresAt" timestamp with time zone;
ALTER TABLE public.account ADD COLUMN IF NOT EXISTS "refreshTokenExpiresAt" timestamp with time zone;
ALTER TABLE public.account ADD COLUMN IF NOT EXISTS "scope" text;
