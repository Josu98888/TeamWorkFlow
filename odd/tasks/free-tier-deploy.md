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
- [x] **T3** Health endpoints (public, shallow) for core and telemetry, and migrations at container start (entrypoint) in both images. Route: delegated.
  - Evidence: `GET /api/v1/health` (core) and `GET /api/v1/telemetry/health` (telemetry) answer `{ status: 'ok' }` with no DB or NATS call (`src/http/health/health.controller.ts` in each app, `@Public()`). Telemetry's guard gained `@Public()` (`src/http/decorators/public.decorator.ts`, checked first in `AuthGuard`), used only by the health route (documented exception in `backend/telemetry/AGENTS.md`); it has no throttler or CSRF check ahead of the guard. Specs: controller specs (answers ok, marked public) in both apps, telemetry guard spec (public route passes without verify; existing reflector call order updated); `pnpm test -- src/http` core 4 suites/21 tests, telemetry 2 suites/11 tests, `pnpm lint` clean and `npx tsc --noEmit` clean in both apps. Migrations at start: new stage `migrator-cli` (isolated `/opt/migrate` with `prisma@7.10.0` + `dotenv@18.0.9`, installed with npm as `node`) copied into the runner together with the `prisma.*.config.ts`, schemas and migrations from the build context; `docker-entrypoint.sh` (ENTRYPOINT, `set -eu`, runs `prisma migrate deploy` per module only when `MIGRATE_ON_START=true`, then `exec "$@"`); `migrate`/`builder`/`runner` targets keep their behavior (compose dev uses `target: builder`, untouched). `.gitattributes` forces LF for `*.sh`. CI `docker` job now loads both runner images and checks the CLI, configs and migrations are inside, and that the entrypoint fails when migrations cannot connect. `MIGRATE_ON_START=false` documented in `deploy/env/*.env.example` (not in joi: the shell reads it). `@action-validator/cli` passes on `ci.yml`. Commits: 82e601a (core health); a6baee4, eaead85 (telemetry guard and health); 46776ad (route maps); 496b329 (core entrypoint), a05a416 (telemetry entrypoint); 5fe3b63 (CI); cbacd21 (env examples). Not verified: Docker builds and a real migration run (user runs them; the CI docker job will).
- [x] **T4** Socket token: core `POST /api/v1/auth/socket-token`, token purpose in `auth.token.verify`, telemetry gateway uses `handshake.auth.token` with purpose `socket`. Route: delegated.
  - Evidence: core `POST /api/v1/auth/socket-token` (guarded: cookie + CSRF or bearer; `@RequiresFeature('tower')`; `AuthService.issueSocketToken` re-checks role owner/admin/supervisor, tenant present, status not suspended/cancelled, feature `tower`) returns `{ token, expiresIn: 60 }`; JWT claims `sub, tenantId, role, typ: 'socket', jti, iat, exp`, same secret and HS256 (a derived key was not worth it: every verifier checks `typ`, and the telemetry local fallback is off for sockets). `auth.token.verify` gained `purpose?: 'access' | 'socket'` (default `access`): `access` rejects any token with a `typ` claim (so a socket token fails `AuthGuard` in core and telemetry; existing tokens have none), `socket` requires `typ === 'socket'` and a tenant (never `platform_admin`). Telemetry: `NatsClientService.verifyToken(token, { purpose })` sends `purpose` in the payload and in the cache key; `socket` is never cached, never served stale and never verified locally; `verifyHs256JwtLocally` rejects tokens with `typ`. `TowerGateway` reads only `handshake.auth.token` (header and cookie ignored), verifies with purpose `socket`, and disconnects after a fixed `MAX_SOCKET_SESSION_MS` of 15 minutes from connection (`actor.exp` no longer used; note core's verify never returned `exp`, so the old expiry timer never fired). Socket.IO CORS unchanged (`WEB_ORIGIN`, `credentials: true` kept, no longer needed). Checks: core `pnpm test -- src/auth/auth src/auth/token src/auth/dto src/http` 17 suites / 219 tests, `pnpm lint` exit 0 (warnings only) and `npx tsc --noEmit` clean in both apps; telemetry `pnpm test -- src/nats src/tower src/http` 7 suites / 73 tests. Commits: 7e5711d, 72a94b4, 9a1c636, 9f66fe3, 83a4038 (core); b24a6ed, 5461794 (telemetry); fd279ce, ec61fbd (docs). Deploy order: core before telemetry (an older core rejects the new `purpose` field with 422). Not verified: a real browser handshake and NATS round trip (T5 wires the client).
- [x] **T5** Frontend: two ordered rewrites (`CORE_URL`, `TELEMETRY_URL`), socket `auth` callback fetching the socket token. Route: delegated.
  - Evidence: `next.config.ts` returns `[/api/v1/telemetry/:path* -> TELEMETRY_URL, /api/v1/:path* -> CORE_URL]` (plain array = `afterFiles`; `/api` has no page, `proxy.ts` treats it as public), each falling back to `BACKEND_URL`, trailing slashes stripped. Build with `CORE_URL=https://core.example.com/ TELEMETRY_URL=https://telemetry.example.com`: `.next/routes-manifest.json` `afterFiles` = telemetry first (`https://telemetry.example.com/api/v1/telemetry/:path*`), then core (`https://core.example.com/api/v1/:path*`). `fetchSocketToken()` (`features/telemetry/http.ts`) goes through `apiFetch` (cookies, CSRF header, 401 refresh). `useTowerLive`: `auth` callback fetches a fresh token per (re)connect, no `withCredentials`; token failure (401/403/network) disconnects without retry and keeps the 15 s polling; `io server disconnect` after >= 10 s of session (the 15 min cap) calls `socket.connect()`, a faster one is treated as a rejection (the gateway accepts then disconnects, so no loop). `Dockerfile.prod` build args `CORE_URL`/`TELEMETRY_URL` (empty = `BACKEND_URL`), `.env.example` documented. Checks: `npx tsc --noEmit` clean, eslint on changed files clean (full `pnpm lint` 0 errors, 2 existing warnings), `pnpm build` passes in default and split mode. The frontend has no unit test runner, so no hook tests. Commits: f6ca6c3, c6a3769, 9e8d1c7. Not verified: a real browser handshake, the 15 min reconnect, Vercel external rewrites.
- [x] **T6** Deploy docs: per-platform setup and env tables (Supabase, Synadia, Render, Koyeb, Vercel), bucket and CORS notes, uptime pinger, seeding the platform admin. Route: delegated.
  - Evidence: `deploy/free-tier/README.md` (overview and limits, order of operations, per-platform setup with env tables read from both `env.schema.ts`, seed, pinger, smoke test, troubleshooting); `backend/postgres/supabase/01-schemas-and-roles.editor.sql` (SQL Editor variant with `CHANGE_ME_*` placeholders, same statements as the psql script, cross-referenced in both headers); root `README.md` Tower lines now describe the 60 s socket token; guide linked from `deploy/README.md` and root `AGENTS.md`. No code change; core requires `PORT` (Render injects it), telemetry must not get `JWT_SECRET`. Commits: 01a52e0, fc34fe7, 862321d. Not verified: Render/Koyeb UI field names (Dockerfile path vs build context), Koyeb BuildKit cache mounts, Supabase session pooler client limit vs `DB_POOL_MAX`, Supabase S3 CORS, Synadia free limits.

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
- T3 done (commits above).
- T4 done (commits above). Risk tier `high` (`gentle-ai review assess`, RDD off), so an independent read-only verifier ran: PASS, no exploitable issue; core `pnpm test -- src/auth src/http` 997/997, telemetry `pnpm test -- src/nats src/tower src/http` 73/73. Its one low finding (a session timer set on a socket that left while joining rooms) is fixed in `4992910` with a spec. Accepted by design: a socket token can be replayed within its 60 s life.
- CI run 44158950640 (T1-T3) green, all jobs.
- T5 done (commits above).
- T6 done (commits above).
- Next step: the user configures the platforms following `deploy/free-tier/README.md`; open checks: Supabase S3 CORS for the photo upload, Synadia free limits, pooler connection budget, Koyeb build with cache mounts, real browser handshake and Vercel external rewrites.
