# STEPS.md — backend foundation

Follow /STEPS.rules.md. Order: /STEPS.index.md (row B0). Backend conventions: /backend/STEPS.template.md.

**Status:** last verified: S3.4 · next: — (B0 done) · in progress: — · blocked: —

Foundation of the backend stack: decisions and infrastructure that every service references (`see backend S1.1`). It holds no service code. Services never reopen a decision answered here (rules §4).

Shape: the template phases for use cases, data model, events, close the loop and E2E are not applicable to a foundation and are replaced by Decisions (Phase 1) and Infrastructure (Phase 2).

---

## Phase 0 — Prerequisites

Commits: (none, read-only phase)

- [x] **S0.1** Confirm B0 is the next row in `/STEPS.index.md`.
  Check: `rg -n "^\| B0 " STEPS.index.md` (from repo root) shows status other than `done`, and no row is `in progress`.
- [x] **S0.2** Toolchain required by every backend check is available: Git Bash, `rg`, `pnpm`, `docker`.
  Check: `rg --version && pnpm --version && docker compose version` all print a version.
  2026-10-09: `rg` and `fd` are not on the Git Bash `PATH` (`which rg` fails); `pnpm` 11.5.2 and Docker 29.7.2 present. Installing `rg` is the user's call (rules §6). Later the same day the user installed ripgrep 14.1.1; the check passes (`rg` 14.1.1, `pnpm` 11.5.2, Docker Compose v5.4.0) and S2.4, S3.2, S3.3 were re-run with `rg` (all empty).
- [x] **S0.3** Baseline of the existing services (`auth`, `gateway`) before any change.
  Check: from `backend/auth/` and `backend/gateway/`, run `<lint>`, `<test>`, `<build>`; record pass/fail of each next to this step. A failure here is reported, not fixed in B0.
  2026-10-09: auth — lint pass (2 scaffold warnings), test pass 2/2 (Jest does not exit by itself; passes with `--forceExit`, open handle), build pass (~53 s). gateway — lint pass, test FAIL `No tests found` (no spec files yet), build pass.

## Phase 1 — Decisions

Commits: —

- [x] **S1.1** Database layout: ONE PostgreSQL database with ONE PostgreSQL schema per data-owning service (`auth`, `organization`, `attendance`, `tasks`, `notifications`, `billing`). See **Decisions** 2026-10-08. Isolation enforced per DEFAULT(backend) below (one role per service).
  Check: the answer is in **Decisions** and `rg -n "TODO\(backend\) Database" backend/STEPS.md` (from repo root) is empty.
- [x] **S1.2** JetStream streams: one stream per owning service, created by that service on startup. See **Decisions** 2026-10-09.
  Check: same as S1.1 for `TODO\(backend\) JetStream streams`.
- [x] **S1.3** JetStream client: the official `@nats-io/jetstream` (v3, same family as the `@nats-io/transport-node` that Nest 12 uses) wrapped in a small `JetStreamService` per service. See **Decisions** 2026-10-09.
  Check: same as S1.1 for `TODO\(backend\) JetStream client`.
- [x] **S1.4** E2E infrastructure: a separate `backend/docker-compose.test.yml` with its own NATS (JetStream on) and PostgreSQL, on other ports, without persistent volumes. See **Decisions** 2026-10-09.
  Check: the answer is in **Decisions** and the line in `/STEPS.index.md` §4 is removed.

## Phase 2 — Infrastructure

Commits: —

- [x] **S2.0** Approved: edit `backend/docker-compose.yml` (S2.1–S2.4), create `backend/docker-compose.test.yml`, `backend/postgres/init/` and `backend/.env.example` (S2.2, S2.5). See **Decisions** 2026-10-09.
  Check: the approval is in **Decisions**.
- [x] **S2.1** NATS with JetStream enabled (today `nats:latest` runs WITHOUT `-js`, so no stream can exist). DEFAULT(backend): `command: ["-js", "-sd", "/data", "-m", "8222"]` plus a named volume for `/data`.
  Check: with the stack up, `curl -s http://localhost:8222/jsz` returns JSON containing `"config"` (JetStream on), not an error.
- [x] **S2.2** One `postgres` service per S1.1, with a healthcheck, a named volume, and an init script (`backend/postgres/init/`, shared with S2.5) that creates the `teamworkflow` database, the six schemas and one role per service (`auth_svc`, …) owning only its schema. Credentials only through env, with placeholders in `backend/.env.example`.
  2026-10-09: compose service, healthcheck, volume, init script, six schemas and six `*_svc` roles verified. `backend/.env.example` created by the user (the agent cannot read or write `.env*` files here): existence verified by the agent, placeholder-only content confirmed by the user.
  Check: `docker compose -f backend/docker-compose.yml exec postgres pg_isready` prints `accepting connections`; `docker compose -f backend/docker-compose.yml exec postgres psql -U postgres -d teamworkflow -tAc "select nspname from pg_namespace where nspname in ('auth','organization','attendance','tasks','notifications','billing') order by 1"` prints the six schemas.
- [x] **S2.2b** Cross-schema isolation is enforced by the database, not by convention.
  Check: `docker compose -f backend/docker-compose.yml exec postgres psql -U auth_svc -d teamworkflow -c "select 1 from billing.invoices"` (or any table/`create table billing.x(id int)`) fails with `permission denied for schema billing`.
- [x] **S2.3** Not applicable in B0: per S1.2 each service creates its own stream on startup (auth S1.8 creates `AUTH_EVENTS`). B0 only provides JetStream (S2.1).
- [x] **S2.4** Each data-owning service gets `DATABASE_URL` in compose from env (no literal credentials in the file).
  Check: `rg -n "postgres(ql)?://[^$]*:[^$]*@" backend/docker-compose.yml` is empty.
- [x] **S2.5** `backend/docker-compose.test.yml` per S1.4: `nats-test` (`-js`, ports 4223/8223, no volume) and `postgres-test` (port 5433, `tmpfs` data, same init script as S2.2, so same database, schemas and roles). Fixed project name `teamworkflow-test` so it never touches the dev containers. DEFAULT(e2e): services run their E2E from the host against these ports.
  Check: `docker compose -f backend/docker-compose.test.yml up -d` then `curl -s http://localhost:8223/jsz` contains `"config"` and `docker compose -f backend/docker-compose.test.yml exec postgres-test pg_isready` prints `accepting connections`; `docker compose -f backend/docker-compose.test.yml down` leaves no volume (`docker volume ls -q --filter label=com.docker.compose.project=teamworkflow-test` is empty).

## Phase 3 — Done checks

Commits: —

- [x] **S3.1** Whole stack starts clean.
  Check: `docker compose -f backend/docker-compose.yml up -d --build` then `docker compose -f backend/docker-compose.yml ps` shows every service `running`/`healthy`.
- [x] **S3.2** No secrets committed.
  Check: `git ls-files backend | rg "(^|/)\.env$"` is empty.
- [x] **S3.3** Every backend-scoped and e2e-scoped TODO marker in `/STEPS.index.md` §4 is answered and removed there; services that waited on them reference the decision.
  Check: `rg -n "TODO\((backend|e2e)\)" STEPS.index.md backend --glob '!**/node_modules/**' --glob '!backend/STEPS.template.md'` is empty.
- [x] **S3.4** Index updated: B0 `done`, B1 `Next` no longer waits on B0.
  Check: `rg -n "^\| B0 .*\| done \|" STEPS.index.md` has one hit.

---

## Blocked

| Step | Waits for |
|------|-----------|
| — | — |

## Decisions

- **2026-10-09 · user · S2.0 Infrastructure changes approved (rules §6).** Scope: edit `backend/docker-compose.yml` (NATS with `-js` and a data volume, a `postgres` service with healthcheck and volume, `DATABASE_URL` of each service from env); create `backend/docker-compose.test.yml`, `backend/postgres/init/` (database, six schemas, six roles) and `backend/.env.example` (placeholders only). Anything outside this list still needs a new approval.
- **2026-10-09 · user · Extra approval.** Create `backend/.gitignore` ignoring `.env`, so local compose secrets are never committed (S3.2). Not approved: a `.gitattributes` forcing LF on `*.sh`.

- **2026-10-09 · user · S1.4 E2E infrastructure.** E2E suites run against a separate `backend/docker-compose.test.yml` (NATS with JetStream on ports 4223/8223, PostgreSQL on 5433), with no persistent volumes, so every run starts clean, never touches the dev streams or database, and can run while the dev stack is up. It reuses the dev Postgres init script, so the TEST database has the same `teamworkflow` database, schemas and roles. This is the TEST database required by rules §9.8. Rejected: a `test` profile in the dev compose, reusing the dev containers with a `teamworkflow_test` database.

- **2026-10-09 · user · S1.3 JetStream client.** Each service uses the official `@nats-io/jetstream` package (v3), wrapped in its own small `JetStreamService` (connect, create/update its stream, publish with ack, create durable consumers, consume with explicit ack and retry). No third-party Nest JetStream transport. The legacy `nats` v2 package was unused and was removed from `auth` and `gateway` (both still build). The first service (auth) writes the wrapper; later services follow the same shape (DEFAULT(backend) below).

- **2026-10-09 · user · S1.2 JetStream streams.**
  - One stream per subject owner, named `<SERVICE>_EVENTS`, capturing `t.*.<service>.>`: `AUTH_EVENTS`, `ORGANIZATION_EVENTS`, `ATTENDANCE_EVENTS`, `TASKS_EVENTS`, `BILLING_EVENTS`, `NOTIFICATIONS_EVENTS`. `NOTIFICATIONS_EVENTS` also captures `t.*.notifications.send`, which other services publish but `notifications` owns.
  - The owning service creates or updates its stream on startup (idempotent). Nothing else creates streams.
  - File storage, limits retention, `max_age` 7 days.
  - One durable consumer per consumer + producer pair, named `<consumer>-<producer>` (for example `billing-auth`), with `filter_subjects` limited to the events it handles, explicit ack.
  - A consumer that starts before the producer's stream exists retries creating its durable consumer (with backoff) instead of crashing. A publisher whose target stream does not exist yet gets an error from the publish ack and handles it like any failed publish.
  - Rejected: one `EVENTS` stream on `t.>` created by a script in `backend/` (single shared owner, startup race).

- **2026-10-08 · user · S1.1 Database layout.** One PostgreSQL database (`teamworkflow`) split internally into one schema per data-owning service: `auth`, `organization`, `attendance`, `tasks`, `notifications`, `billing`. The gateway has no schema. Each service's `DATABASE_URL` points to its own schema; its Prisma migrations (and its `_prisma_migrations` table) live only in that schema. Rejected: one container per service (too heavy locally), one database per service.

## Defaults to confirm

- DEFAULT(backend): one Postgres role per service (`<service>_svc`) that owns only its schema and has no `USAGE` on the others, so a query to another service's tables fails with `permission denied` (S2.2b). This is what keeps the "never read another service's tables" rule enforced with a shared database.
- DEFAULT(backend): how each service selects its schema with Prisma 7 + `@prisma/adapter-pg` (URL `?schema=<service>` vs the adapter's `schema` option) is verified against the Prisma docs in each service's data-model phase (auth S2.6), not assumed.

- DEFAULT(backend): NATS runs with `-js -sd /data -m 8222` and a named volume (S2.1).
- DEFAULT(backend): no shared npm package in the MVP; the first service to need a cross-service helper (JetStream client, `RpcException` hierarchy) writes it following `skills/teamworkflow-nest`, later services follow the same shape, and extracting a shared package is a separate refactor step (rules §8).
