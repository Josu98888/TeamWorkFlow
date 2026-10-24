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
- Default: telemetry exposes its own HTTP ingestion and Socket.IO tower endpoints, routed under the same public origin (reverse proxy, path `/api/telemetry`, `/ws`). Telemetry verifies tokens through the NATS request `auth.token.verify`, which the core answers.

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
- [ ] T3 (delegated writer): service docs — `backend/core/` and `backend/telemetry/` `AGENTS.md`/`README.md` built from the 7 existing pairs; old folders' docs removed or moved into `backend/core/src/<module>/`.
- [ ] T4 (delegated writer): DB and infra docs/config — `backend/STEPS.md`, `docs/database.md`, compose files, `.env.example`, postgres init.
- [ ] T5 (delegated writer): skills — `teamworkflow-nest` and the other skills that mention services; keep the root `AGENTS.md` skill table in sync.
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
- Created 2026-10-24. T2 done. Next: T3.
