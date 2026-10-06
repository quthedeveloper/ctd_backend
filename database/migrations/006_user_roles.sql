-- Migration 006: role-based access for the admin APIs
-- Run once against your PostgreSQL database. Safe to re-run.
--
-- After running, promote yourself to admin with:
--   UPDATE users SET role = 'admin' WHERE email = 'you@example.com';

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer';
