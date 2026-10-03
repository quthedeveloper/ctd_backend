# CTD Backend

Node.js + Express + PostgreSQL control plane for the CTD Internet Gateway System.
Handles customer authentication, accounts, devices, and (going forward) packages,
subscriptions, payments, gateway control, sessions and usage accounting.

**Core principle:** this backend is the *control plane*. The gateway is the *data
plane* — customer Internet traffic never passes through here.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create the database, then run the migrations in order:
   ```bash
   psql -h <host> -U <user> -d <db> -f database/migrations/002_better_auth.sql
   ```
   (Migration `002` creates the Better Auth tables and renames
   `users.clerk_user_id` → `users.auth_user_id`. It is safe to re-run.)

3. Copy the example env file and fill it in:
   ```bash
   cp .env.example .env
   ```
   - `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`
   - `BETTER_AUTH_URL` — public URL of this API (e.g. `http://localhost:3000`)
   - `FRONTEND_URL` — your app's origin (comma-separated if several); required
     for auth cookies to work cross-origin

4. Start the server:
   ```bash
   npm run dev   # with nodemon
   npm start     # plain node
   ```

## Authentication (Better Auth, self-hosted)

Auth is handled by [Better Auth](https://www.better-auth.com) running inside
this app — no external auth vendor. Users and sessions live in your own
Postgres (`user`, `session`, `account`, `verification` tables).

- Sign-up / sign-in / sign-out are served by Better Auth itself under
  `/api/auth/*` (e.g. `POST /api/auth/sign-up/email`,
  `POST /api/auth/sign-in/email`). Call these with plain HTTP from any
  frontend (web, Flutter, ...); the session is cookie-based.
- A session middleware in `index.js` verifies the session on every request
  and exposes the signed-in user as `req.authUser` (null when signed out).
- When someone signs up, a hook in `config/auth.js` automatically creates
  their row in the CTD `users` table, linked by `auth_user_id`.
- Email verification is **off** for V1. Better Auth does not send email
  itself — wire a provider (e.g. Resend) into
  `emailVerification.sendVerificationEmail` in `config/auth.js` when you
  want verification and password-reset emails.

> Migrating from Clerk? Run migration `002`, have users sign up again
> through the new flow (old Clerk ids/tokens are not accepted), and remove
> any Clerk keys from your environment.

## API (so far)

| Method | Endpoint          | Purpose                              |
| ------ | ----------------- | ------------------------------------ |
| GET    | /auth/user/me     | Get (and sync) caller profile        |
| PATCH  | /auth/user/me     | Update `full_name` / `phone`         |
| GET    | /devices          | List caller's devices                |
| POST   | /devices          | Register device `{ public_key, device_identifier? }` |
| DELETE | /devices/:id      | Remove one of the caller's devices   |
| GET    | /packages         | List packages (public)               |
| GET    | /packages/:id     | Get one package (public)             |
| POST   | /packages         | Create a package                     |
| GET    | /trials           | List caller's trials (with remaining quota/time) |
| POST   | /trials           | Claim the free trial `{ device_id? }` |
| GET    | /subscriptions    | List caller's subscriptions          |
| GET    | /subscriptions/active | Current active subscription (or null) |
| POST   | /subscriptions    | Activate a subscription `{ package_id }` |
| POST   | /subscriptions/:id/suspend | Suspend an active subscription |
| POST   | /subscriptions/:id/renew   | Renew an expired/suspended subscription |

All endpoints except `/api/auth/*`, `GET /packages` and `GET /packages/:id`
require a signed-in session (401 otherwise).

## Project structure

```
index.js               # app entry: Better Auth handler, session middleware, routers
config/
  db.js                # pg Pool + connection check
  auth.js              # Better Auth instance (Kysely adapter, hooks)
controllers/
  usersAuth.js         # profile endpoints
  devices.js           # device registration endpoints
  packages.js          # package endpoints
  trials.js            # trial endpoints
  subscriptions.js     # subscription endpoints
routes/
  users.routes.js
  devices.routes.js
  packages.routes.js
  trials.routes.js
  subscriptions.routes.js
database/
  migrations/          # SQL migrations, run in order
```
