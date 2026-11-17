# Free-tier demo deploy

## Objective

Run a public demo of TeamWorkFlow at zero cost:

| Piece | Platform |
|-------|----------|
| Frontend | Vercel |
| `core` | Render (free web service, Docker) |
| `telemetry` | Koyeb (free instance, Docker) |
| NATS (request/reply + JetStream) | Synadia Cloud (free Personal plan) |
| PostgreSQL | Supabase |
| Task media | Supabase Storage (S3-compatible API) |

## Problem and why

The AWS plan in `odd/tasks/ci-cd.md` (T5, T6) needs an AWS account the user does not want for a demo. The `deploy/` compose + nginx setup stays as the path for a future VPS.

## Decisions

- **NATS stays.** Replacing it with Upstash Redis would rewrite the event bus (38 coupled files) and lose JetStream delivery guarantees. Synadia Cloud only needs a credentials file.
- **Same origin for HTTP through Vercel rewrites**: `/api/v1/telemetry/*` to telemetry first, then `/api/v1/*` to core. Auth cookies (`SameSite=Lax`, `HttpOnly`) keep working unchanged.
- **The Tower WebSocket connects straight to telemetry** (Vercel rewrites do not proxy WebSocket). It authenticates with a short-lived socket token (`typ: 'socket'`, 60 s) issued by core; access-token verification rejects socket tokens and vice versa.
- **Supabase reserves the `auth` and `storage` schemas.** Module schemas get a prefix (`tw_auth`, `tw_organization`, ...). Migrations are unqualified, so only URLs, roles and the init script change.
- **RLS enabled and the Data API off in Supabase.** Module roles own their tables, so RLS does not affect them; it blocks `anon`/`authenticated`.
- **Migrations run at container start** (Render free has no pre-deploy step).
- **Secrets never in the repo**: every credential is set in each platform's environment settings.
- Free instances sleep when idle (Render ~15 min, Koyeb 1 h): acceptable for a demo; a free uptime pinger on the health URLs keeps them awake.

## Scope and constraints

- Render free: 512 MB RAM. Koyeb free: 512 MB RAM, 0.1 vCPU, one instance.
- Supabase connection budget: pool size per Prisma client becomes configurable (5 core clients + 1 telemetry).
- Synadia free limits (connections, streams, consumers) to be confirmed in the account: the app creates 8 connections, 6 streams and 16 durable consumers.
- In-memory outbox stays for the demo (events that fail to publish can be lost on restart); a persistent outbox is out of scope.

## Tasks

- [x] **T1** NATS credentials: optional `NATS_CREDS` (creds file content) in both services, one connect-options helper used by all 8 connection sites, env examples. Route: delegated (writer trigger: 2+ non-trivial files).
  - Evidence: `credsAuthenticator` comes from `@nats-io/nats-core`, re-exported by `@nats-io/transport-node` (no new dependency). Nest 12 spreads transport `options` into `connect()`, so `authenticator` is forwarded. Helper `src/config/nats-options.ts` in each service (`buildNatsOptions(servers, creds)`, `
` conversion, `NATS_CREDS` joi pattern for the JWT header). Sites: core `main.ts` + 5 `*-events.module.ts`/`*-events.service.ts` pairs; telemetry `nats.module.ts` + 3 `connect` calls in `jetstream.service.ts`. Checks: telemetry `pnpm test -- src/config src/nats` (config 10/10 passing; nats suites passing), core `pnpm test -- src/config` (28/28) and events suites (14 suites, 139 tests), `pnpm lint` exit 0 in both apps. Commits: e0912f4, 745ed7c, 9e9c593, 1a82073, 8420f34, fac8def, df4cc9c (core); eed6ca4, 69c6d89 (telemetry); 1923ddc (deploy env examples). Pending by hand: add the commented `NATS_CREDS` line to `backend/core/.env.example` and `backend/telemetry/.env.example` (blocked for the agent). Not verified against a real Synadia server.
- [x] **T2** Supabase database: `tw_` schema prefix, Supabase-safe roles script (no `REVOKE ... public`, `GRANT <role> TO postgres`), configurable pool size and SSL for the 6 Prisma clients, separate migration URL. Route: delegated.
  - Evidence: no code hardcodes a schema besides the `DEFAULT_SCHEMA` fallbacks (the only raw SQL is an advisory lock), so `tw_*` is set only through `?schema=` in the URLs. Helper `buildPgPoolConfig(url, { max, ssl, sslCa })` in `core/src/common/prisma/pg-pool-config.ts` and `telemetry/src/prisma/pg-pool-config.ts`, used by the 5 core Prisma services, the platform admin seed (reads `DB_*` from `process.env`) and the telemetry service. Env: `DB_POOL_MAX` (default 10 = pg default), `DB_SSL` (default false), `DB_SSL_CA` (PEM, only with `DB_SSL=true`). SSL without CA is encrypted but unverified (`rejectUnauthorized: false`); with CA it is verified. pg gives the URL precedence over the config, so use `DB_SSL`, not `sslmode`, on Supabase. Prisma configs read `MIGRATE_<X>_DATABASE_URL ?? <X>_DATABASE_URL`. Script `backend/postgres/supabase/01-schemas-and-roles.sql` (psql variables, idempotent; usage in its header). Deploy env examples have commented Supabase blocks. Checks: core `pnpm test -- src/config src/common/prisma` and the 4 Prisma service specs (50 tests), telemetry `pnpm test -- src/config src/prisma` (22 tests), `pnpm lint` exit 0 and `npx tsc --noEmit` clean in both apps. Commits: 3db8a6d, dd890fc, 1bf8237, 1b8b610, a111579, a70007d, ca0d204 (core); 617c7cb, 36a683b, 1f94e18 (telemetry); 09a600c, 5d822f7 (prisma configs); 02f2e32 (script); c180974 (env examples). Pending by hand: add the commented `DB_*` and `MIGRATE_*` lines to `backend/core/.env.example` and `backend/telemetry/.env.example` (blocked for the agent). Not verified: the SQL script against a real Supabase, the app against Supabase poolers.
- [ ] **T3** Health endpoints (public, shallow) for core and telemetry, and migrations at container start (entrypoint) in both images. Route: delegated.
- [ ] **T4** Socket token: core `POST /api/v1/auth/socket-token`, token purpose in `auth.token.verify`, telemetry gateway uses `handshake.auth.token` with purpose `socket`. Route: delegated.
- [ ] **T5** Frontend: two ordered rewrites (`CORE_URL`, `TELEMETRY_URL`), socket `auth` callback fetching the socket token. Route: delegated.
- [ ] **T6** Deploy docs: per-platform setup and env tables (Supabase, Synadia, Render, Koyeb, Vercel), bucket and CORS notes, uptime pinger, seeding the platform admin. Route: delegated.

## Acceptance criteria

- Lint, touched unit specs and build pass per task; CI green on the PR.
- With every platform configured, a user logs in on the Vercel URL, uses core and telemetry screens, and the Tower receives live updates.

## Checks

TDD: off (no project or session setting). Per task: lint + touched specs; CI runs the full suites.

## Delivery

Forecast: ~1,000-1,200 authored changed lines, above the ~400-line budget. Strategy: `ask-on-risk`, chain `feature-branch-chain` (user's standing rule: slice PRs chain onto the feature branch, the feature branch merges into `develop`). Slices: S1 = T1-T3 (backend infra), S2 = T4-T5 (socket token), S3 = T6 (docs).

## Progress

- Branch `feat/deploy/free-tier`, stacked on `feat/ci/production-dockerfiles`.
- Exploration done (NATS sites, rewrites, socket auth, Prisma/Supabase, storage, health, crons).
- T1 done (commits above).
- T2 done (commits above).
- Next step: T3.
