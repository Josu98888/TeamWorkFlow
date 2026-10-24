# Repository Guidelines

## How to Use This Guide

- Start here for cross-project norms. TeamWorkFlow is a monorepo with a NestJS backend (a modular monolith plus a telemetry service) and a Next.js frontend. The architecture decision is in [`docs/architecture.md`](docs/architecture.md).
- Components may have their own `AGENTS.md` with specific guidelines: `frontend/AGENTS.md` (Next.js agent rules written by `next dev`), `backend/core/AGENTS.md` (core-wide rules and route map), one per core module (`backend/core/src/auth/AGENTS.md`, `backend/core/src/organization/AGENTS.md`, `backend/core/src/tasks/AGENTS.md`, `backend/core/src/notifications/AGENTS.md`, `backend/core/src/billing/AGENTS.md`) and `backend/telemetry/AGENTS.md` (the whole `attendance` domain). `backend/gateway/AGENTS.md` and `backend/auth/AGENTS.md` are stubs: that code is being merged into `backend/core` (task T6 of `odd/tasks/two-service-architecture.md`).
- Component docs override this file when guidance conflicts.
- The project is at an early stage: many files referenced by the skills do not exist yet. Check before importing or assuming (each skill has a "Project Status" section).

## Available Skills

Use these skills for detailed patterns on demand. Read the `SKILL.md` before writing code in its area.

### Backend

| Skill | Description | URL |
|-------|-------------|-----|
| `teamworkflow-nest` | NestJS 12 microservices: gateway, NATS patterns, DTOs, errors, Prisma access, config, tests | [SKILL.md](skills/teamworkflow-nest/SKILL.md) |
| `teamworkflow-prisma-migrations` | Prisma Migrate on PostgreSQL: safe migrations, backfills, forward-fix | [SKILL.md](skills/teamworkflow-prisma-migrations/SKILL.md) |
| `teamworkflow-postgres` | PostgreSQL indexing, EXPLAIN, monitoring, maintenance with Prisma | [SKILL.md](skills/teamworkflow-postgres/SKILL.md) |

### Frontend

| Skill | Description | URL |
|-------|-------------|-----|
| `teamworkflow-frontend` | Frontend architecture, domains, placement, design system (source of truth) | [SKILL.md](skills/teamworkflow-frontend/SKILL.md) |
| `teamworkflow-nextjs` | Next.js 16 App Router, Server Actions, data fetching from the gateway | [SKILL.md](skills/teamworkflow-nextjs/SKILL.md) |
| `teamworkflow-react` | React 19 + React Compiler, forms with `useActionState` | [SKILL.md](skills/teamworkflow-react/SKILL.md) |
| `teamworkflow-tailwind` | Tailwind 4 tokens, `cn()`, `cva` variants | [SKILL.md](skills/teamworkflow-tailwind/SKILL.md) |
| `teamworkflow-typescript` | Strict TypeScript, types mirroring gateway DTOs | [SKILL.md](skills/teamworkflow-typescript/SKILL.md) |
| `teamworkflow-zod` | Zod 4 validation for Server Actions, forms, searchParams | [SKILL.md](skills/teamworkflow-zod/SKILL.md) |
| `teamworkflow-zustand` | Zustand 5 client state with App Router | [SKILL.md](skills/teamworkflow-zustand/SKILL.md) |
| `teamworkflow-test-ui` | Playwright E2E tests, Page Objects, seeding via the gateway | [SKILL.md](skills/teamworkflow-test-ui/SKILL.md) |

### Workflow

| Skill | Description | URL |
|-------|-------------|-----|
| `teamworkflow-commits` | Conventional Commits with repo scopes, commit safety rules | [SKILL.md](skills/teamworkflow-commits/SKILL.md) |
| `teamworkflow-pr` | Pull request title, description, checklist, review replies | [SKILL.md](skills/teamworkflow-pr/SKILL.md) |

### Auto-invoke Skills

When performing these actions, ALWAYS invoke the corresponding skill FIRST:

| Action | Skill |
|--------|-------|
| Adding indexes or constraints to database tables | `teamworkflow-prisma-migrations` |
| Adding or changing NATS message patterns between gateway and microservices | `teamworkflow-nest` |
| Analyzing query performance with EXPLAIN | `teamworkflow-postgres` |
| App Router / Server Actions | `teamworkflow-nextjs` |
| Changing `schema.prisma` in any microservice | `teamworkflow-prisma-migrations` |
| Committing changes / creating git commits / writing commit messages | `teamworkflow-commits` |
| Create a PR with `gh pr create` | `teamworkflow-pr` |
| Creating endpoints, DTOs or modules in `backend/` | `teamworkflow-nest` |
| Creating or modifying PostgreSQL indexes | `teamworkflow-postgres` |
| Creating or reviewing Prisma migrations | `teamworkflow-prisma-migrations` |
| Creating Zod schemas | `teamworkflow-zod` |
| Creating/modifying TeamWorkFlow UI components | `teamworkflow-frontend` |
| Debugging slow queries or missing indexes | `teamworkflow-postgres` |
| Dropping or reindexing PostgreSQL indexes | `teamworkflow-postgres` |
| Respond to PR review comments | `teamworkflow-pr` |
| Reviewing TeamWorkFlow frontend code | `teamworkflow-frontend` |
| Using Zustand stores | `teamworkflow-zustand` |
| Working on frontend architecture (domains/actions/store/types) | `teamworkflow-frontend` |
| Working with Tailwind classes | `teamworkflow-tailwind` |
| Working with TeamWorkFlow test helpers/pages | `teamworkflow-test-ui` |
| Write or fill a pull request description | `teamworkflow-pr` |
| Writing backend tests | `teamworkflow-nest` |
| Writing business logic or database access in `backend/` | `teamworkflow-nest` |
| Writing data backfill or data migration | `teamworkflow-prisma-migrations` |
| Writing Playwright E2E tests | `teamworkflow-test-ui` |
| Writing React components | `teamworkflow-react` |
| Writing TypeScript types/interfaces | `teamworkflow-typescript` |

> Keep this table in sync with each skill's `metadata.auto_invoke`. After adding, renaming or removing a skill, update both tables above. A skill's folder name MUST match its `name` field.

---

## Project Overview

TeamWorkFlow is a multitenant SaaS for managing and monitoring field staff across many sites (sites, shifts, attendance, tasks, alerts, a real-time control tower). See `README.md` for the product and `docs/database.md` for the data model.

| Component | Location | Tech Stack | Port |
|-----------|----------|------------|------|
| Core (modular monolith) | `backend/core/` (docs only until T6; see migration note below) | NestJS 12, modules `auth`, `organization`, `tasks`, `notifications`, `billing`, public HTTP API (former gateway), NATS (request/reply + JetStream), Prisma 7 | 3000 (HTTP, prefix `/api`) |
| Telemetry | `backend/telemetry/` (docs only, code not created yet) | NestJS 12, whole `attendance` domain (clock-ins, corrections, workdays, alerts, Torre de Control), Socket.IO, NATS, Prisma 7 | to be defined (HTTP `/api/telemetry` + WebSocket `/ws`) |
| Gateway (current code) | `backend/gateway/` | NestJS 12, `@nestjs/microservices` (NATS client), joi. Becomes the HTTP layer of `core` | 3000 (HTTP, prefix `/api`) |
| Auth (current code) | `backend/auth/` | NestJS 12, NATS transport, Prisma 7. Becomes the `auth` module of `core` | 3001 |
| Message broker | `backend/docker-compose.yml` (`nats-server`) | NATS with JetStream | 4222 (client), 8222 (monitoring) |
| Frontend | `frontend/` | Next.js 16, React 19, Tailwind 4, TypeScript 5 | 3000 by default (see note below) |
| Database | not set up yet | PostgreSQL + Prisma 7 (one shared database `teamworkflow`; one PostgreSQL schema, role, Prisma client and migration history per core module and for telemetry) | — |

The MVP backend is exactly 2 services (see [`docs/architecture.md`](docs/architecture.md)):

- `core`: a NestJS modular monolith with the modules `auth`, `organization`, `tasks`, `notifications` and `billing`, plus the public HTTP API (the former `gateway`; there is no separate gateway service). It answers NATS requests from telemetry (`auth.token.verify`, `organization.*.get`).
- `telemetry`: the whole `attendance` domain (clock-in ingestion, corrections, workdays, real-time alerts) and the Torre de Control Socket.IO WebSocket. It exposes HTTP `/api/telemetry` and the WebSocket.

A reverse proxy publishes both under one origin, routing by path (`/api` to `core`; `/api/telemetry` and `/ws` to `telemetry`), so the frontend still sees one API.

> **Migration in progress.** `backend/core` and `backend/telemetry` do not exist yet. Today the code lives in `backend/gateway` and `backend/auth` as separate apps; task T6 of `odd/tasks/two-service-architecture.md` merges them into `backend/core`. The other modules (`organization`, `tasks`, `notifications`, `billing`) and `telemetry` are documented but not built. The folders `backend/organization`, `backend/attendance`, `backend/tasks`, `backend/notifications` and `backend/billing` hold design docs only; they will be folded into `backend/core` and `backend/telemetry` by task T3.

Naming is English everywhere in the MVP (folders, NATS patterns `<module>.<resource>.<action>`, events `t.<tenant>.<module>.<event>`, error codes, data model); the Spanish names in the root `README.md` belong to the 16-service target architecture, which stays as the long-term reference (each core module is a natural extraction candidate).

> Port clash: the gateway and `next dev` both default to 3000. Run the frontend on another port (`pnpm dev -p 3002`) until this is fixed in config.

### Architecture Rules

- The frontend talks ONLY to the public HTTP API: `core` under `/api/...`, `telemetry` under `/api/telemetry`, and, for the Torre de Control, a Socket.IO WebSocket on `/ws` (telemetry). Both are behind one origin (reverse proxy by path). It never calls NATS directly.
- The HTTP layer of `core` (the former gateway) has no business logic: it validates input, calls the owning module's exported service (facade) and maps errors to HTTP with the `{ detail, code }` shape (see `teamworkflow-nest`). `telemetry` verifies tokens with the NATS request `auth.token.verify`, which the `auth` module answers.
- Module boundaries inside `core`: each module lives in `backend/core/src/<module>/` and exposes only one public service (facade). A module never imports another module's repositories, Prisma client or internal classes. Cross-domain reactions go through events; synchronous facade calls are reserved for reads needed inside a request.
- NATS JetStream is the ONLY domain event bus, between core modules and between `core` and `telemetry`. Subjects `t.<tenant>.<module>.<event>`, one stream `<MODULE>_EVENTS` per module, durable consumers with explicit ack, `ProcessedEvent` dedup in the same transaction as the handler. Request/reply patterns are `<module>.<resource>.<action>`.
- Data: one PostgreSQL database (`teamworkflow`). Each core module and `telemetry` owns its own PostgreSQL schema (`auth`, `organization`, `tasks`, `notifications`, `billing`, `attendance`), role, Prisma client and migrations; roles cannot read other schemas (`backend/STEPS.md` S1.1, S2.2b). No cross-schema foreign keys. Never read another module's tables or use its Prisma client; use its facade or events.
- Errors: the `RpcException` shape `{ status, code, message }` stays for NATS request/reply (core to telemetry); the HTTP layer turns errors into `{ detail, code }`.
- Environment variables are validated at startup with joi in `src/config/envs.ts`. Add every new variable there and to `.env.example`.

---

## Development

Package manager: **pnpm** (each app has its own `package.json`; there is no root workspace yet).

```bash
# Whole backend with Docker (today: NATS + auth + gateway, hot reload)
# Target after task T7: NATS + PostgreSQL + core (+ telemetry once it exists)
cd backend
docker compose up --build

# A single backend app locally
cd backend/gateway        # or backend/auth (today)
pnpm install
pnpm start:dev
# Target after task T6: cd backend/core, same commands

# Frontend
cd frontend
pnpm install
pnpm dev -p 3002
```

### Code Quality (per backend app)

```bash
pnpm lint        # oxlint --type-aware
pnpm format      # prettier
pnpm test        # jest (unit)
pnpm test:e2e    # jest + supertest
pnpm build       # nest build
```

Frontend: `pnpm lint` (eslint) and `pnpm build`.

---

## Commit & Pull Request Guidelines

Follow Conventional Commits: `<type>(<scope>): <description>`

**Types:** `feat`, `fix`, `docs`, `chore`, `perf`, `refactor`, `style`, `test`

**Scopes:** `core` (backend/core infrastructure), module scopes (`auth`, `organization`, `tasks`, `notifications`, `billing`), `telemetry`, `gateway` (until it is merged into `core`), `frontend`, `prisma`, `docker`, `architecture` (for `docs/architecture.md` and cross-service docs), `skills`, plus domain scopes (see `teamworkflow-commits`).

Rules for AI agents:

- NEVER create, switch, rename, merge or delete branches. Always work on the current branch; the user creates branches.
- Commit verified work as you go, following `teamworkflow-commits` (never on `main`/`master`). Open pull requests following `teamworkflow-pr`.
- `git push` only after confirming with the user once (see `teamworkflow-pr`). NEVER `--force`.
- NEVER add `Co-Authored-By` lines or any AI attribution to commits or PRs.
- Never commit `.env` files. Only `.env.example` is tracked.

Before creating a PR:

1. Run lint, tests and build for every app you touched.
2. Review generated `migration.sql` files if `schema.prisma` changed.
3. Fill the PR description following `teamworkflow-pr`.
4. Link screenshots for UI changes.
