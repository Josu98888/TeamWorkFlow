# Two-service architecture (modular monolith + telemetry)

## Objective
Replace the 7-microservice MVP (gateway, auth, organization, attendance, tasks, notifications, billing) with 2 services:
- `backend/core`: a NestJS modular monolith with modules `auth`, `organization`, `tasks`, `notifications`, `billing` and the public HTTP API (the former gateway).
- `backend/telemetry`: the full `attendance` domain: clock-in ingestion (high frequency), corrections, workdays, real-time alerts and the Torre de Control WebSocket.

## Problem / Why
Seven services mean seven deploys, pipelines and databases to operate, plus distributed debugging, before the product has users. The goals are lower operating complexity, simpler local debugging and lower deployment cost, while keeping event-driven decoupling between domains.

## Decisions
- 2026-10-24 (user): telemetry owns the whole `attendance` domain (ClockEvent, ClockEventCorrection, Workday, Alert, tower snapshot). The core consumes its events (`workday_closed`, `alert_opened`, ...) for reporting and notifications.
- 2026-10-24 (user): NATS JetStream stays the only domain event bus, both between core modules and between core and telemetry. The existing auth event code (envelope, `ProcessedEvent` dedup, durable consumers) is kept, and a module can be extracted later without rewriting its consumers.
- Default: each core module keeps its own PostgreSQL schema, Prisma client, migrations and role. Database isolation between modules (STEPS S2.2b) stays enforced by roles, not only by convention.
- Default: modules talk to each other only through an exported module service (a public facade) or events; never through another module's Prisma client.
- Default: telemetry exposes its own HTTP ingestion and Socket.IO tower endpoints, routed under the same public origin (reverse proxy, path `/api/v1/telemetry`, `/ws`). Telemetry verifies tokens through the NATS request `auth.token.verify`, which the core answers.

## Scope
- Docs: root `AGENTS.md`, `README.md`, `STEPS.index.md`, `backend/STEPS.md`, `docs/database.md`, per-service `AGENTS.md`/`README.md`, `skills/teamworkflow-*`.
- Infra: `backend/docker-compose*.yml`, `backend/.env.example`, `backend/postgres/init/`.
- Code: merge `backend/gateway` + `backend/auth` into `backend/core` (auth controllers move from `@MessagePattern` to HTTP controllers; services unchanged).

## Constraints
- Artifacts in English. Conventional Commits via `teamworkflow-commits`, on the current branch, no AI attribution. Never create branches. Push only after asking.
- Do not break the existing auth test suites: unit and e2e specs move with the code and stay green.

## Tasks
- [x] T1 (inline; evidence: docs/architecture.md written, decisions confirmed by user 2026-10-24; commit 45f473c): architecture decision record `docs/architecture.md` (context, decision, consequences, module boundaries, event bus, DB, public entrypoints).
- [x] T2 (delegated writer; evidence: commit 0b97cfd; `rg` for 7-service wording leaves only the README replaced-design sentence and the superseded STEPS.index entry; `rg backend/core|telemetry` hits in all 3 files): root docs — `AGENTS.md`, `README.md`, `STEPS.index.md` (rows and "7 MVP services" decision).
- [x] T3 (delegated writer; evidence: commits ee86ceb organization, 35aee6d tasks, e003f3d notifications, 4bf0ab5 billing, 6c60733 auth+STEPS, 0f65fcf/31fa59a telemetry, 3330730 core AGENTS, 755b739 core README, 90d008b/cf9ea38 old README removal, dc4e93e/e262f9d gateway/auth stubs, dd6a215/22f3a22/cc61ec2 path refs; `fd` on organization/tasks/notifications/billing/attendance: folders gone; `rg` path refs leave only intended hits; skills left to T5; user decision 2026-10-24: module docs live in `backend/core/src/<module>/`): service docs — `backend/core/` and `backend/telemetry/` `AGENTS.md`/`README.md` built from the 7 existing pairs; old folders' docs removed or moved into `backend/core/src/<module>/`.
  - Gaps recorded in the docs: error class in core (RpcException vs HttpException, T6); owner/admin tower rooms need a site list from core (`organization.site.list` is not in the ADR responder list); `workday_closed` payload unspecified; telemetry port, rate-limit numbers and per-module `DATABASE_URL` naming undefined (T4/T6); Prisma folder layout per module in core (T6); `backend/core/src/http/STEPS.md` path chosen for STEPS row B2.
- [ ] T4 (delegated writer; partial; evidence: commits 3aeb3ac postgres init, 4e5ea89 database.md, df92c24 STEPS.md; `bash -n` init OK; `docker compose config -q` OK for both files; `rg` 7-service wording: 0 hits): DB and infra docs/config — `backend/STEPS.md`, `docs/database.md`, compose files, `.env.example`, postgres init.
  - Decisions: env vars `<OWNER>_DATABASE_URL` (`AUTH_`, `ORGANIZATION_`, `TASKS_`, `NOTIFICATIONS_`, `BILLING_`, `ATTENDANCE_DATABASE_URL`); passwords `<OWNER>_DB_PASSWORD`; telemetry port 3003; compose keeps `gateway`/`auth` until T7; legacy `backend/auth` keeps `DATABASE_URL` until T6.
  - Telemetry port/env refs fixed in root `AGENTS.md` and telemetry docs (commit 20e56e7).
  - Pending: `backend/.env.example` per-owner `*_DATABASE_URL` placeholders (path blocked by a permission rule; user edits it).
- [x] T5 (delegated writer; evidence: commits 11fa463 nest, a2dbacb prisma-migrations, 1267479 postgres, 02c0e6d nextjs+frontend, a351cf4 typescript/zod/react, fa40cbd test-ui, 1939694 commits, 6fd651c pr, b3de197 root tables; `rg` 7-service wording: only ADR history; `name` == folder for 13 skills; changed auto_invoke rows match root table; known pre-existing mismatches left: commits "Creating git commits"/"Writing commit messages", test-ui "Writing TeamWorkFlow E2E tests"; nest Dockerfile/compose notes need update in T7): skills — `teamworkflow-nest` and the other skills that mention services; keep the root `AGENTS.md` skill table in sync.
- [ ] T6 (delegated writer): code — create `backend/core` from gateway + auth; auth tests (unit + e2e) green; lint and build pass.
- [ ] T7 (delegated writer): compose runs `core` (+ nats, postgres) locally; smoke-test login through `/api`.

## Acceptance criteria
- No doc describes the MVP as 7 services (only as historical context in the ADR).
- `backend/core`: `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build` pass.
- `docker compose up` starts nats, postgres and core; login works through the HTTP API.

## Checks
- `rg -i "7 (microservices|services)|microservicio" ` over docs/skills: only intended hits.
- TDD: not configured for this project/session (off); ordinary functional checks per task. Runner: jest via `pnpm test` / `pnpm test:e2e`.

## Delivery
- Strategy: `ask-on-risk`. Docs tasks T1–T5 are large but passive; code tasks T6–T7 likely exceed ~400 lines (mostly moves).

## Progress
- Created 2026-10-24. T2 done. T3 done. T4 partial (only `.env.example` pending, user-owned). T5 done. Next: T6.
