# Adapt project skills to TeamWorkFlow (NestJS + Prisma + PostgreSQL)

## Objective
Adapt the skills copied from AutoMatch (`skills/`) to TeamWorkFlow: NestJS 12 microservices over NATS (`backend/gateway`, `backend/auth`), Prisma + PostgreSQL (not installed yet), Next.js 16 frontend.

## Constraints
- Edit files only. No commits, no push (user decision).
- Artifacts in English.

## Tasks
- [x] T1 (delegated writer; evidence: rg check empty, skills/nest, migrations, postgres rewritten, automatch-fastapi removed; Prisma 7 targeted per context7): backend skills — `automatch-fastapi` → NestJS skill, `migrations` → Prisma Migrate, `postgres` → Prisma schema indexes.
- [x] T2 (delegated writer; evidence: rg check empty): remaining skills — rename AutoMatch → TeamWorkFlow, replace FastAPI references with the NestJS gateway, adjust commit/PR scopes.
- [x] T3 (inline; folders renamed to match `name`, registry refreshed: 13 teamworkflow-* skills): refresh `.atl/skill-registry.md`.

## Checks
- No `automatch`, `FastAPI`, `SQLAlchemy`, `Alembic`, `Pydantic` references left in `skills/`.
- Valid frontmatter in every `SKILL.md`.

## Progress
- Created 2026-10-06.
