# STEPS.md — backend foundation

Follow /STEPS.rules.md. Order: /STEPS.index.md (row B0). Backend conventions: /backend/STEPS.template.md.

**Status:** last verified: S3.4 · next: — (B0 done) · in progress: — · blocked: —

Foundation of the backend stack: decisions and infrastructure that every backend module references (`see backend S1.1`). It holds no application code. Two-service architecture (see `docs/architecture.md`): `core` (modular monolith with the modules `auth`, `organization`, `tasks`, `notifications`, `billing`) and `telemetry` (the whole `attendance` domain). "Owner" below means a core module or telemetry. Owners never reopen a decision answered here (rules §4). The steps were written and verified when the MVP was seven services; their results still hold, and the wording was updated to owners.

Shape: the template phases for use cases, data model, events, close the loop and E2E are not applicable to a foundation and are replaced by Decisions (Phase 1) and Infrastructure (Phase 2).

---

## Phase 0 — Prerequisites

Commits: (none, read-only phase)

- [x] **S0.1** Confirm B0 is the next row in `/STEPS.index.md`.
  Check: `rg -n "^\| B0 " STEPS.index.md` (from repo root) shows status other than `done`, and no row is `in progress`.
- [x] **S0.2** Toolchain required by every backend check is available: Git Bash, `rg`, `pnpm`, `docker`.
  Check: `rg --version && pnpm --version && docker compose version` all print a version.
  2026-10-09: `rg` and `fd` are not on the Git Bash `PATH` (`which rg` fails); `pnpm` 11.5.2 and Docker 29.7.2 present. Installing `rg` is the user's call (rules §6). Later the same day the user installed ripgrep 14.1.1; the check passes (`rg` 14.1.1, `pnpm` 11.5.2, Docker Compose v5.4.0) and S2.4, S3.2, S3.3 were re-run with `rg` (all empty).
- [x] **S0.3** Baseline of the existing apps (`auth`, `gateway`, which become modules of `core`) before any change.
  Check: from `backend/auth/` and `backend/gateway/`, run `<lint>`, `<test>`, `<build>`; record pass/fail of each next to this step. A failure here is reported, not fixed in B0.
  2026-10-09: auth — lint pass (2 scaffold warnings), test pass 2/2 (Jest does not exit by itself; passes with `--forceExit`, open handle), build pass (~53 s). gateway — lint pass, test FAIL `No tests found` (no spec files yet), build pass.

## Phase 1 — Decisions

Commits: 6e87cb4, 241f03a (S1.3: remove `nats` v2), 5e72244 (plan)

- [x] **S1.1** Database layout: ONE PostgreSQL database with ONE PostgreSQL schema per data owner: one per core module (`auth`, `organization`, `tasks`, `notifications`, `billing`) and `attendance` for telemetry. See **Decisions** 2026-10-08 and 2026-10-24. Isolation enforced per DEFAULT(backend) below (one role per owner).
  Check: the answer is in **Decisions** and `rg -n "TODO\(backend\) Database" backend/STEPS.md` (from repo root) is empty.
- [x] **S1.2** JetStream streams: one stream per owner (core module or telemetry), created by that owner on startup. See **Decisions** 2026-10-09.
  Check: same as S1.1 for `TODO\(backend\) JetStream streams`.
- [x] **S1.3** JetStream client: the official `@nats-io/jetstream` (v3, same family as the `@nats-io/transport-node` that Nest 12 uses) wrapped in a small `JetStreamService` (one per module in `core`, one in telemetry). See **Decisions** 2026-10-09.
  Check: same as S1.1 for `TODO\(backend\) JetStream client`.
- [x] **S1.4** E2E infrastructure: a separate `backend/docker-compose.test.yml` with its own NATS (JetStream on) and PostgreSQL, on other ports, without persistent volumes. See **Decisions** 2026-10-09.
  Check: the answer is in **Decisions** and the line in `/STEPS.index.md` §4 is removed.

## Phase 2 — Infrastructure

Commits: bd78f9d, 34fbdc1, 4d7bf21

- [x] **S2.0** Approved: edit `backend/docker-compose.yml` (S2.1–S2.4), create `backend/docker-compose.test.yml`, `backend/postgres/init/` and `backend/.env.example` (S2.2, S2.5). See **Decisions** 2026-10-09.
  Check: the approval is in **Decisions**.
- [x] **S2.1** NATS with JetStream enabled (today `nats:latest` runs WITHOUT `-js`, so no stream can exist). DEFAULT(backend): `command: ["-js", "-sd", "/data", "-m", "8222"]` plus a named volume for `/data`.
  Check: with the stack up, `curl -s http://localhost:8222/jsz` returns JSON containing `"config"` (JetStream on), not an error.
- [x] **S2.2** One `postgres` compose service per S1.1, with a healthcheck, a named volume, and an init script (`backend/postgres/init/`, shared with S2.5) that creates the `teamworkflow` database, the six schemas and one role per owner (`auth_svc`, …, `attendance_svc` for telemetry) owning only its schema. Credentials only through env, with placeholders in `backend/.env.example`.
  2026-10-09: compose service, healthcheck, volume, init script, six schemas and six `*_svc` roles verified. `backend/.env.example` created by the user (the agent cannot read or write `.env*` files here): existence verified by the agent, placeholder-only content confirmed by the user.
  Check: `docker compose -f backend/docker-compose.yml exec postgres pg_isready` prints `accepting connections`; `docker compose -f backend/docker-compose.yml exec postgres psql -U postgres -d teamworkflow -tAc "select nspname from pg_namespace where nspname in ('auth','organization','attendance','tasks','notifications','billing') order by 1"` prints the six schemas.
- [x] **S2.2b** Cross-schema isolation is enforced by the database, not by convention.
  Check: `docker compose -f backend/docker-compose.yml exec postgres psql -U auth_svc -d teamworkflow -c "select 1 from billing.invoices"` (or any table/`create table billing.x(id int)`) fails with `permission denied for schema billing`.
- [x] **S2.3** Not applicable in B0: per S1.2 each owner creates its own stream on startup (auth S1.8 creates `AUTH_EVENTS`). B0 only provides JetStream (S2.1).
- [x] **S2.4** Each data owner gets its connection string in compose from env (no literal credentials in the file). Naming convention (2026-10-24): `<OWNER>_DATABASE_URL` for `core` modules and telemetry (`AUTH_DATABASE_URL`, `ORGANIZATION_DATABASE_URL`, `TASKS_DATABASE_URL`, `NOTIFICATIONS_DATABASE_URL`, `BILLING_DATABASE_URL`, `ATTENDANCE_DATABASE_URL`); the passwords stay `<OWNER>_DB_PASSWORD`. Since T7 the `core` compose service passes `AUTH_DATABASE_URL` (the legacy `DATABASE_URL` of the removed `backend/auth` app is gone).
  Check: `rg -n "postgres(ql)?://[^$]*:[^$]*@" backend/docker-compose.yml` is empty.
- [x] **S2.5** `backend/docker-compose.test.yml` per S1.4: `nats-test` (`-js`, ports 4223/8223, no volume) and `postgres-test` (port 5433, `tmpfs` data, same init script as S2.2, so same database, schemas and roles). Fixed project name `teamworkflow-test` so it never touches the dev containers. DEFAULT(e2e): `core` and telemetry run their E2E from the host against these ports.
  Check: `docker compose -f backend/docker-compose.test.yml up -d` then `curl -s http://localhost:8223/jsz` contains `"config"` and `docker compose -f backend/docker-compose.test.yml exec postgres-test pg_isready` prints `accepting connections`; `docker compose -f backend/docker-compose.test.yml down` leaves no volume (`docker volume ls -q --filter label=com.docker.compose.project=teamworkflow-test` is empty).

## Phase 3 — Done checks

Commits: (verification only, no files)

- [x] **S3.1** Whole stack starts clean.
  Check: `docker compose -f backend/docker-compose.yml up -d --build` then `docker compose -f backend/docker-compose.yml ps` shows every service `running`/`healthy`.
- [x] **S3.2** No secrets committed.
  Check: `git ls-files backend | rg "(^|/)\.env$"` is empty.
- [x] **S3.3** Every backend-scoped and e2e-scoped TODO marker in `/STEPS.index.md` §4 is answered and removed there; modules that waited on them reference the decision.
  Check: `rg -n "TODO\((backend|e2e)\)" STEPS.index.md backend --glob '!**/node_modules/**' --glob '!backend/STEPS.template.md'` is empty.
- [x] **S3.4** Index updated: B0 `done`, B1 `Next` no longer waits on B0.
  Check: `rg -n "^\| B0 .*\| done \|" STEPS.index.md` has one hit.

---

## Blocked

| Step | Waits for |
|------|-----------|
| — | — |

## Decisions

- **2026-10-09 · user · S2.0 Infrastructure changes approved (rules §6).** Scope: edit `backend/docker-compose.yml` (NATS with `-js` and a data volume, a `postgres` service with healthcheck and volume, `DATABASE_URL` of each service from env, as written then; superseded in naming by the 2026-10-24 decision); create `backend/docker-compose.test.yml`, `backend/postgres/init/` (database, six schemas, six roles) and `backend/.env.example` (placeholders only). Anything outside this list still needs a new approval.
- **2026-10-09 · user · Extra approval.** Create `backend/.gitignore` ignoring `.env`, so local compose secrets are never committed (S3.2). Not approved: a `.gitattributes` forcing LF on `*.sh`.

- **2026-10-09 · user · S1.4 E2E infrastructure.** E2E suites run against a separate `backend/docker-compose.test.yml` (NATS with JetStream on ports 4223/8223, PostgreSQL on 5433), with no persistent volumes, so every run starts clean, never touches the dev streams or database, and can run while the dev stack is up. It reuses the dev Postgres init script, so the TEST database has the same `teamworkflow` database, schemas and roles. This is the TEST database required by rules §9.8. Rejected: a `test` profile in the dev compose, reusing the dev containers with a `teamworkflow_test` database.

- **2026-10-09 · user · S1.3 JetStream client.** Each owner uses the official `@nats-io/jetstream` package (v3), wrapped in a small `JetStreamService` (connect, create/update its stream, publish with ack, create durable consumers, consume with explicit ack and retry). No third-party Nest JetStream transport. The legacy `nats` v2 package was unused and was removed from `auth` and `gateway` (both still build). The first module (auth) writes the wrapper; later modules and telemetry follow the same shape (DEFAULT(backend) below).

- **2026-10-09 · user · S1.2 JetStream streams.**
  - One stream per subject owner, named `<MODULE>_EVENTS`, capturing `t.*.<module>.>` (the owner is a core module, or telemetry for `ATTENDANCE_EVENTS`): `AUTH_EVENTS`, `ORGANIZATION_EVENTS`, `ATTENDANCE_EVENTS`, `TASKS_EVENTS`, `BILLING_EVENTS`, `NOTIFICATIONS_EVENTS`. `NOTIFICATIONS_EVENTS` also captures `t.*.notifications.send`, which other owners publish but `notifications` owns.
  - The owner creates or updates its stream on startup (idempotent). Nothing else creates streams.
  - File storage, limits retention, `max_age` 7 days.
  - One durable consumer per consumer + producer pair, named `<consumer>-<producer>` (for example `billing-auth`), with `filter_subjects` limited to the events it handles, explicit ack.
  - A consumer that starts before the producer's stream exists retries creating its durable consumer (with backoff) instead of crashing. A publisher whose target stream does not exist yet gets an error from the publish ack and handles it like any failed publish.
  - Rejected: one `EVENTS` stream on `t.>` created by a script in `backend/` (single shared owner, startup race).

- **2026-10-08 · user · S1.1 Database layout.** One PostgreSQL database (`teamworkflow`) split internally into one schema per data owner: `auth`, `organization`, `attendance`, `tasks`, `notifications`, `billing`. The gateway has no schema. Each owner's connection string points to its own schema; its Prisma migrations (and its `_prisma_migrations` table) live only in that schema. Rejected: one container per service (too heavy locally), one database per service.

- **2026-10-24 · user · Two-service architecture (T4).** The MVP is `core` (modular monolith; modules `auth`, `organization`, `tasks`, `notifications`, `billing`; the former gateway is its HTTP layer, with no schema) plus `telemetry` (owns the whole `attendance` domain, schema `attendance`: ClockEvent, ClockEventCorrection, Workday, Alert, tower snapshot). The 2026-10-08 layout above is unchanged: same database, same six schemas and `*_svc` roles, each module and telemetry keeping its own Prisma client and migration history; no cross-schema foreign keys. Events keep `t.<tenant>.<module>.<event>` on NATS JetStream, request/reply keeps `<module>.<resource>.<action>`. Per-owner connection strings are `<OWNER>_DATABASE_URL` (see S2.4). Telemetry HTTP/WebSocket port: 3003 (core 3000, legacy auth 3001, frontend dev 3002). Compose keeps the `gateway` and `auth-microservice` entries until `backend/core` exists (T6); switching compose to `core` is T7.

## Defaults to confirm

- DEFAULT(backend): one Postgres role per owner (`<schema>_svc`) that owns only its schema and has no `USAGE` on the others, so a query to another owner's tables fails with `permission denied` (S2.2b). This is what keeps the "never read another module's tables" rule enforced with a shared database, including between modules of `core`.
- DEFAULT(backend): how each module and telemetry select their schema with Prisma 7 + `@prisma/adapter-pg` (URL `?schema=<service>` vs the adapter's `schema` option) is verified against the Prisma docs in each owner's data-model phase (auth S2.6), not assumed.

- DEFAULT(backend): NATS runs with `-js -sd /data -m 8222` and a named volume (S2.1).
- DEFAULT(backend): no shared npm package in the MVP; the first owner to need a cross-module helper (JetStream client, `RpcException` hierarchy) writes it following `skills/teamworkflow-nest`, later modules and telemetry follow the same shape, and extracting a shared package is a separate refactor step (rules §8).
