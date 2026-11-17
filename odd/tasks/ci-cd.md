# CI/CD

## Objective

Every pull request to `develop` and `main` is checked automatically, and `main` deploys to AWS on the free plan.

## Problem and why

There is no `.github/workflows`, no production Dockerfile for `core` or the frontend, and nothing deploys. Regressions like the ones found in the employee walkthrough (PR #24) are only caught by hand.

## Decisions

- **Hosting (AWS free plan, new account: USD 100-200 credits, 6 months):**
  - one EC2 `t3.small` runs `core`, `telemetry`, NATS, nginx and the frontend with Docker Compose;
  - RDS PostgreSQL `db.t4g.micro` (free plan);
  - S3 holds the task media;
  - images go to GitHub Container Registry (GHCR).
- **Why not ECS Fargate:** the load balancer plus a NAT Gateway (~USD 48/month) would spend the credits in 3-4 months.
- **CI first, CD later:** CI runs only checks that pass today. The e2e job joins once the failing e2e specs are fixed (T2), so the CI never starts red.

## Scope and constraints

- Unit tests use `node --experimental-vm-modules`, and the backend needs Node >= 24.9 (jest require(esm)).
- pnpm is pinned in `frontend/package.json` (`pnpm@11.5.2`).
- Each app has its own lockfile, and there is no root workspace.
- No secrets in workflows. Deploy credentials live in GitHub secrets, set by the user.
- Remote operations (SSH to EC2, AWS changes) need explicit user authorization for destination, operation and credential.

## Tasks

- [x] **T1** CI workflow `.github/workflows/ci.yml`:
  - runs on pull requests to `develop`/`main` and on pushes to them;
  - for `core` and `telemetry`: lint, unit tests and build;
  - for the frontend: lint, `tsc` and build;
  - jobs run in parallel with pnpm cache, and path filters skip untouched apps.

  Route: delegated (writer trigger: workflow plus docs, 3 files). Evidence: `@action-validator/cli` passes on `ci.yml`; every command maps to a package script; unit specs pass with the job env (core `src/common|config|auth.service.login` 112 tests, telemetry `src/shifts` 12 tests, `DOTENV_CONFIG_PATH` pointed at a missing file so no local `.env` leaks in). Full lint/test/build are left to the PR run. Commit: see Progress.
- [x] **T2** Fix the failing e2e specs and add the e2e jobs. Spec fixes (done on `fix/ci/e2e-suites`):
  - the Mercado Pago webhook answers 200 and ignores non-UUID references;
  - the S3 upload, the `harness` hook timeout and `Bearer undefined` in the billing spec;
  - the stale tower feature mock in telemetry;
  - the telemetry and core containers run on Node 24.

  CI jobs in `.github/workflows/ci.yml`:
  - `core-e2e` runs `backend/docker-compose.test.yml` (postgres-test, nats-test with `-js`, seaweedfs-test), waits for the bucket init container, generates the five Prisma clients and runs `pnpm test:e2e`; `globalSetup` runs `migrate deploy`. No env or secrets: `test-env.ts` pins the throwaway values;
  - `telemetry` runs `pnpm test:e2e` after the unit tests (mocked NATS and database);
  - the core filter also watches `backend/docker-compose.test.yml` and `backend/postgres/**`.

  Status: the PR #26 CI run 44103138853 was green (all jobs, including `core-e2e`).
- [x] **T3** Production Dockerfiles for `core` and the frontend; review the telemetry one (Node version).
  - `backend/core/Dockerfile.prod`: stages `deps`, `prod-deps`, `builder` (five Prisma clients + `nest build`), `migrate` (builder plus the prisma CLI, configs and migrations; runs the five `migrate deploy` scripts) and `runner` (default target: prod deps only, `NODE_ENV=production`, user `node`, `node dist/main`, port 3000). The dev `dockerfile` used by `backend/docker-compose.yml` is untouched.
  - `frontend/Dockerfile.prod` plus `output: "standalone"` in `next.config.ts`: build args `NEXT_PUBLIC_USE_MOCKS` (default `false`), `NEXT_PUBLIC_WS_URL` (default empty, same origin) and `BACKEND_URL`; runner is user `node`, `node server.js`, port 3000. The dev `dockerfile` is untouched.
  - `backend/telemetry/Dockerfile`: Node 24 and prod-only runner were already right; added a `migrate` target (the runner has no prisma CLI) and `USER node`.
  - `.dockerignore` of the three apps now also excludes `.env.*`, `coverage/` and `test-results/`.

  Route: delegated (writer trigger: 3+ Dockerfiles). Evidence: frontend `pnpm lint` and `pnpm build` (standalone output present); the images are verified by the CI `docker` job (builds the five targets, runs both migrate images against `postgres-test`, smoke-tests the frontend), pending its first green run.
- [ ] **T4** Production compose and nginx for the EC2 host (TLS, env files, a migrations step before start).
- [ ] **T5** CD workflow: build and push images to GHCR on `main`, then deploy to EC2 (needs user authorization and secrets).
- [ ] **T6** AWS setup guide:
  - EC2, RDS, S3, an IAM role for S3 access;
  - security groups;
  - a budget alarm, and the reminder to upgrade the plan before 6 months.

## Acceptance criteria

- T1: the workflow is valid YAML, its commands match the package scripts, and it passes on the PR that adds it.

## Checks

TDD: off (no project or session setting; workflow and config work). Checks per task are listed above.

## Progress

- Branch `feat/ci/github-actions` from `origin/develop` (54d4f4d).
- T1 done: `.github/workflows/ci.yml` (changes, core, telemetry, frontend) and a CI section in `AGENTS.md`. Node 24, pnpm 11.5.2, dummy env in the core and telemetry jobs. Commit: `ci(core)` on `feat/ci/github-actions` (see `git log`).
- T2: e2e jobs added on `fix/ci/e2e-suites`; PR #26 CI run 44103138853 green.
- T3 done on `feat/ci/production-dockerfiles` (see Tasks for the design).
- T3 CI: `docker` job added to `ci.yml` (validator passes); awaiting its first green run on the PR.
- Next step: T4 (production compose and nginx; run the `migrate` targets before starting `core` and `telemetry`).
