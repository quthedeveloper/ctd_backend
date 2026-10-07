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
   for m in database/migrations/*.sql; do
     psql -h <host> -U <user> -d <db> -f "$m"
   done
   ```
   (Migration `002` creates the Better Auth tables and renames
   `users.clerk_user_id` → `users.auth_user_id`. It is safe to re-run.)

3. Copy the example env file and fill it in:
   ```bash
   cp .env.example .env
   ```
   (Optional) Start Redis for package caching and rate limits:
   ```bash
   docker run -d -p 6379:6379 redis:7
   ```
   The app works without Redis; it logs a notice and degrades gracefully.
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
| POST   | /packages         | Create a package (admin only)          |
| GET    | /trials           | List caller's trials (with remaining quota/time) |
| POST   | /trials           | Claim the free trial `{ device_id? }` |
| GET    | /subscriptions    | List caller's subscriptions          |
| GET    | /subscriptions/active | Current active subscription (or null) |
| POST   | /subscriptions    | Activate a subscription `{ package_id }` |
| POST   | /subscriptions/:id/suspend | Suspend an active subscription |
| POST   | /subscriptions/:id/renew   | Renew an expired/suspended subscription |
| POST   | /gateways/register    | Register a gateway (provision-token auth, returns API token once) |
| POST   | /gateways/heartbeat   | Gateway liveness ping (gateway token auth) |
| GET    | /gateways             | List gateways with live online state (admin only) |
| GET    | /gateways/:id         | Get one gateway |
| POST   | /gateways/:id/commands | Queue a control command (operator) |
| GET    | /gateways/:id/commands | List queued/delivered commands |
| POST   | /gateways/commands/:messageId/ack | Gateway acks a command (gateway auth) |
| GET    | /gateways/:id/peers   | List WireGuard peers on a gateway |
| POST   | /gateways/:id/peers   | Authorize a device as a peer `{ device_id }` |
| DELETE | /gateways/:id/peers/:peerId | Revoke a peer |
| POST   | /gateways/sessions    | Gateway reports connect/disconnect (gateway auth) |
| POST   | /gateways/usage       | Gateway posts traffic report (gateway auth) |
| GET    | /sessions             | List my sessions |
| GET    | /sessions/active      | My currently active sessions |
| GET    | /usage                | List my usage records |
| GET    | /usage/summary        | Totals across my usage records |

All endpoints except `/api/auth/*`, `GET /packages` and `GET /packages/:id`
require a signed-in session (401 otherwise). Endpoints marked "admin only"
also require the caller's `users.role` to be `admin` (403 otherwise).
After running migration `006`, promote yourself once:

    UPDATE users SET role = 'admin' WHERE email = 'you@example.com';

### Admin APIs (admin only)

| Method | Endpoint               | Purpose                              |
| ------ | ---------------------- | ------------------------------------ |
| GET    | /admin/stats           | Dashboard numbers (users, active entitlements, gateways online, traffic) |
| GET    | /admin/users           | List users                           |
| GET    | /admin/users/:id       | User detail with devices, subscriptions, trials |
| PATCH  | /admin/users/:id       | Update account status `{ status }`   |
| PATCH  | /admin/users/:id/role  | Promote/demote `{ role: 'admin' | 'customer' }` |
| GET    | /admin/gateways        | List gateways with live online state |
| DELETE | /admin/gateways/:id    | Remove a gateway and its peers       |
| PATCH  | /admin/packages/:id    | Update a package                     |
| DELETE | /admin/packages/:id    | Delete a package                     |
| GET    | /admin/payments        | List payment records                 |
| GET    | /admin/audit-logs      | Security/operation history           |

Mutations are written to `audit_logs` (actor, action, resource, metadata).

The operator routes under `/gateways` (list/get, command queue, peer
management) and `POST /packages` are also admin-only.

## Docker

```bash
# from the repo root, with .env filled in
docker compose up --build -d
```

This starts three containers: `api` (this repo), `db` (PostgreSQL 18),
and `redis` (7). The API container runs `scripts/migrate.js` on startup —
it waits for Postgres, applies `database/migrations/*.sql` in order, then
starts node — so a fresh `up` goes from zero to migrated with no manual psql.

- Postgres data persists in the `pgdata` volume across restarts.
- Redis has no volume on purpose: cache and rate-limit state is ephemeral,
  and the app fails open without it.
- `DB_PASSWORD` must be set in `.env` or compose refuses to start.
- The container listens on 3000 internally; `${PORT}` (default 3000) only
  changes the published host port.

Useful commands:

```bash
docker compose logs -f api   # follow API logs
docker compose ps            # container + health status
docker compose down          # stop (keeps the pgdata volume)
docker compose down -v       # stop AND delete the database volume
```

`docker/` holds the Dockerfile (per the PDF's suggested repo layout);
`docker-compose.yml` stays at the root so `docker compose up` just works.

## Redis (optional)

- `REDIS_URL` enables two things: JSON caching of the public package
  endpoints (`GET /packages`, `GET /packages/:id`, 5-minute TTL by default
  via `CACHE_PACKAGES_TTL_SECONDS`) and Redis-backed rate limits.
- Cache is invalidated on every package create/update/delete, so reads
  never go stale.
- Rate limits (all fail open if Redis is down):
  - `/api/auth/*` — 20/min per IP (brute-force protection)
  - `POST /gateways/register` — 10/min per IP (provision-token protection)
  - `POST /gateways/heartbeat` — 30/min per gateway
  - `POST /gateways/sessions`, `POST /gateways/usage` — 120/min per gateway
- Exceeded limits return 429 with `X-RateLimit-Limit` /
  `X-RateLimit-Remaining` headers.

## Project structure

```
docker/
  Dockerfile           # multi-stage node:22-alpine build
scripts/
  migrate.js           # startup migration runner (also: npm run migrate)
docker-compose.yml     # api + postgres + redis stack
```

## Project structure

```
index.js               # app entry: Better Auth handler, session middleware, routers
config/
  db.js                # pg Pool + connection check
  auth.js              # Better Auth instance (Kysely adapter, hooks)
middleware/
  gatewayAuth.js       # gateway API token authentication
  requireAdmin.js      # admin role guard (users.role = 'admin')
utils/
  audit.js             # audit_logs helper
controllers/
  usersAuth.js         # profile endpoints
  devices.js           # device registration endpoints
  packages.js          # package endpoints
  trials.js            # trial endpoints
  subscriptions.js     # subscription endpoints
  gateways.js            # gateway endpoints
  gatewayCommands.js     # command queue (enqueue/deliver/ack)
  gatewayPeers.js        # WireGuard peer management
  sessions.js            # session tracking
  usage.js               # usage ingestion + quota enforcement
  admin.js               # admin management endpoints
routes/
  users.routes.js
  devices.routes.js
  packages.routes.js
  trials.routes.js
  subscriptions.routes.js
  gateways.routes.js
  sessions.routes.js
  usage.routes.js
database/
  migrations/          # SQL migrations, run in order
```
