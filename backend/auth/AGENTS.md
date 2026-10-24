# AGENTS.md — `auth` (being merged into `core`)

This folder still holds the code of the `auth` service. It is being merged into `backend/core` as the `auth` module (task T6 of `odd/tasks/two-service-architecture.md`) and will then be removed. The domain rules, the contract and the step plan did not change; they moved with the module:

- Rules and contract: `backend/core/src/auth/AGENTS.md` (source of truth).
- Step plan and history: `backend/core/src/auth/STEPS.md`.
- Core-wide rules (module boundaries, HTTP layer, event bus): `backend/core/AGENTS.md`.

Until T6 runs:

- Keep working on the code here following those documents (steps are run from `backend/auth/`).
- Commands (from `backend/auth/`, package manager pnpm): `pnpm install`, `pnpm start:dev`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build`; Prisma commands per `skills/teamworkflow-prisma-migrations`.
- Env validation lives in `src/config/envs.ts`; add any new variable there and to `.env.example`.
