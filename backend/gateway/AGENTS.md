# AGENTS.md — `gateway` (being merged into `core`)

This folder still holds the code of the former API gateway. It is being merged into `backend/core` (task T6 of `odd/tasks/two-service-architecture.md`) and will then be removed. The architecture is now two services, `core` and `telemetry` (see `docs/architecture.md`): there is no standalone gateway anymore.

Where the old rules went:

- HTTP layer rules (actor, auth guard, tokens and cookies, CSRF, CORS, roles, plan gating, tenant status, rate limiting, webhook, error mapping) and the route map: `backend/core/AGENTS.md`.
- Torre de Control WebSocket and the attendance routes: `backend/telemetry/AGENTS.md`.
- Domain rules of each module: `backend/core/src/<module>/AGENTS.md`.

Until T6 runs:

- Do not change the code under `src/` unless the user asks for it.
- Commands to work on the current code (from `backend/gateway/`, package manager pnpm): `pnpm install`, `pnpm start:dev`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm build`.
- Env validation lives in `src/config/envs.ts` (today `PORT` and `NATS_SERVER`); add any new variable there and to `.env.example`.
