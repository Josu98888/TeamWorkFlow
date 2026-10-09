# Repository Guidelines

## How to Use This Guide

- Start here for cross-project norms. TeamWorkFlow is a monorepo with a NestJS microservices backend and a Next.js frontend.
- Components may have their own `AGENTS.md` with specific guidelines (today: `frontend/AGENTS.md`, Next.js agent rules written by `next dev`, and one per backend service: `backend/auth`, `backend/organization`, `backend/attendance`, `backend/tasks`, `backend/notifications`, `backend/billing`).
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
| API Gateway | `backend/gateway/` | NestJS 12, `@nestjs/microservices` (NATS client), joi | 3000 (HTTP, prefix `/api`) |
| Auth microservice | `backend/auth/` | NestJS 12, NATS transport | 3001 |
| Organization microservice (sites, employees, shifts) | `backend/organization/` | NestJS 12, NATS transport, Prisma 7 (docs only, not created yet) | n/a (NATS only) |
| Attendance microservice (clock-ins, workdays, alerts, tower) | `backend/attendance/` | NestJS 12, NATS transport, Prisma 7 (docs only, not created yet) | n/a (NATS only) |
| Tasks microservice (forms, tasks, media) | `backend/tasks/` | NestJS 12, NATS transport, Prisma 7, S3-compatible storage (docs only, not created yet) | n/a (NATS only) |
| Notifications microservice | `backend/notifications/` | NestJS 12, NATS transport, Prisma 7, FCM (docs only, not created yet) | n/a (NATS only) |
| Billing microservice (plans, invoices, payments) | `backend/billing/` | NestJS 12, NATS transport, Prisma 7, Mercado Pago behind `PaymentProvider` (docs only, not created yet) | n/a (NATS only) |
| Message broker | `backend/docker-compose.yml` (`nats-server`) | NATS | 4222 (client), 8222 (monitoring) |
| Frontend | `frontend/` | Next.js 16, React 19, Tailwind 4, TypeScript 5 | 3000 by default (see note below) |
| Database | not set up yet | PostgreSQL + Prisma 7 (one shared database `teamworkflow`, one PostgreSQL schema and one role per data-owning microservice) | — |

The MVP is exactly 7 services: `gateway`, `auth`, `organization`, `attendance`, `tasks`, `notifications` and `billing`. Each service folder has its own `AGENTS.md` (source of truth for that service) and a Spanish `README.md`. Naming is English everywhere in the MVP (folders, NATS patterns `<service>.<resource>.<action>`, events `t.<tenant>.<service>.<event>`, error codes, data model); the Spanish names in the root `README.md` belong to the 16-service target architecture.

> Port clash: the gateway and `next dev` both default to 3000. Run the frontend on another port (`pnpm dev -p 3002`) until this is fixed in config.

### Architecture Rules

- The frontend talks ONLY to the gateway: HTTP (`/api/...`) and, for the Torre de Control, a Socket.IO WebSocket. It never calls a microservice or NATS directly.
- The gateway has no database and no business logic: it validates input, forwards to microservices with `ClientProxy` (`NATS_SERVICE`) and maps errors to HTTP.
- Microservices own their data: each one has its own Prisma schema and migrations. All services share one PostgreSQL database (`teamworkflow`); each one has its own PostgreSQL schema (`auth`, `organization`, …) and its own role that cannot read other schemas (`backend/STEPS.md` S1.1). Never read another service's tables; ask the owning service over NATS.
- Microservices throw `RpcException`; the gateway turns them into HTTP errors with the `{ detail, code }` shape (see `teamworkflow-nest`).
- Environment variables are validated at startup with joi in `src/config/envs.ts`. Add every new variable there and to `.env.example`.

---

## Development

Package manager: **pnpm** (each service has its own `package.json`; there is no root workspace yet).

```bash
# Whole backend with Docker (NATS + auth + gateway, hot reload)
cd backend
docker compose up --build

# A single backend service locally
cd backend/gateway        # or backend/auth
pnpm install
pnpm start:dev

# Frontend
cd frontend
pnpm install
pnpm dev -p 3002
```

### Code Quality (per backend service)

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

**Scopes:** `gateway`, `auth`, `frontend`, `prisma`, `docker`, `skills`, plus domain scopes (see `teamworkflow-commits`).

Rules for AI agents:

- NEVER create, switch, rename, merge or delete branches. Always work on the current branch; the user creates branches.
- Commit verified work as you go, following `teamworkflow-commits` (never on `main`/`master`). Open pull requests following `teamworkflow-pr`.
- `git push` only after confirming with the user once (see `teamworkflow-pr`). NEVER `--force`.
- NEVER add `Co-Authored-By` lines or any AI attribution to commits or PRs.
- Never commit `.env` files. Only `.env.example` is tracked.

Before creating a PR:

1. Run lint, tests and build for every service you touched.
2. Review generated `migration.sql` files if `schema.prisma` changed.
3. Fill the PR description following `teamworkflow-pr`.
4. Link screenshots for UI changes.
