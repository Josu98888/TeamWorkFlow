# STEPS.template.md — backend

> Template for every backend `STEPS.md`. Follows `/STEPS.rules.md` and only adds what is specific to the backend (NestJS microservices over NATS, Prisma, PostgreSQL). It does not repeat the rules.
> Copy the skeleton at the end into `backend/<service>/STEPS.md` and fill it in.

## 1. Where things live (backend)

| File | Purpose |
|---|---|
| `backend/STEPS.template.md` | This file: commands, conventions and phase shapes for the backend. |
| `backend/<service>/STEPS.md` | The plan for one service (`gateway`, `auth`, `organization`, `attendance`, `tasks`, `notifications`, `billing`). In the backend, a domain is a service. |
| `backend/STEPS.md` | Backend foundation: cross-service decisions (docker compose, NATS/JetStream streams, error contract, database layout). Create it the first time a decision affects more than one service. |
| `backend/<service>/AGENTS.md` | Source of truth for the service's business rules, NATS contract, data model, errors and env vars. STEPS files reference its sections (`AGENTS § Invitations`), never copy them. |

## 2. Commands

Run from `backend/<service>/`.

| Placeholder | Command |
|---|---|
| `<lint>` | `pnpm lint` |
| `<format>` | `pnpm exec prettier --check "src/**/*.ts" "test/**/*.ts"` |
| `<typecheck>` | `pnpm exec tsc --noEmit` |
| `<build>` | `pnpm build` |
| `<test>` | `pnpm test` (unit, Jest) |
| `<test> <pattern>` | `pnpm test <pattern>`: only spec files whose path matches `<pattern>` |
| `<e2e>` | `pnpm test:e2e` (Jest + `test/jest-e2e.json`) |
| `<e2e> <pattern>` | `pnpm test:e2e <pattern>` |
| `<prisma-validate>` | `pnpm exec prisma validate` (data-owning services only) |
| `<migrate-status>` | `pnpm exec prisma migrate status` (against the TEST database of `backend/docker-compose.test.yml`) |

The whole stack runs from `backend/` with `docker compose up --build`.

## 3. Grep exclusions

Every "must be empty" grep in a backend check appends `<EXCL>`:

```text
--glob '!*.md' --glob '!test/**' --glob '!**/*.spec.ts' --glob '!src/generated/**' --glob '!prisma/migrations/**' --glob '!node_modules/**' --glob '!dist/**'
```

Test files are `src/**/*.spec.ts` (unit) and `test/**/*.e2e-spec.ts` (e2e). The Prisma Client is generated into `src/generated/prisma/` and is never searched.

## 4. Backend rules on top of `/STEPS.rules.md`

- **Skills.** Before a step in its area, read the skill: `teamworkflow-nest` (patterns, DTOs, errors, tests), `teamworkflow-prisma-migrations` (schema and migrations), `teamworkflow-postgres` (indexes, EXPLAIN).
- **Ask first (in addition to rules §6):** editing `backend/docker-compose.yml`, a service's `dockerfile`, `tsconfig*.json`, `.oxlintrc.json`, `jest.config.ts`, or `schema.prisma` of another service.
- **Contract owner.** The service owns its NATS patterns, events, payloads and error codes (its `AGENTS.md`). The gateway owns the HTTP routes and mirrors only the patterns it calls. A step that changes a pattern, payload or error code lists the gateway and frontend steps it affects.
- **Pattern names** live in `src/<domain>/<domain>.patterns.ts`; event subjects in one file per service. Never write a pattern or subject as a string literal elsewhere.
- **Errors.** Microservices throw `RpcException` with `{ status, code, message }`; checks assert the exact `status` and `code`.
- **Tenant isolation.** Every use case that reads or writes tenant data has a test where an actor of tenant A targets data of tenant B and gets `forbidden` (or sees nothing). Grep is not enough.
- **Secrets.** Checks prove passwords, tokens and hashes never reach logs or responses (behavior test first, grep as fallback).
- **Env vars.** Every variable is validated with joi in `src/config/envs.ts` and listed in `.env.example` with a placeholder value, in the same step.
- **Migrations.** A schema step ends with a reviewed migration (`--create-only` when raw SQL is needed: check constraints, partial indexes). Never reset or drop a shared database.
- **Streams.** Each service creates or updates its own stream `<SERVICE>_EVENTS` on startup and its durable consumers `<service>-<producer>` (see backend S1.2). Never create another service's stream.
- **Events.** Emitted only after the transaction commits, with `eventId` and ISO-8601 UTC `occurredAt`. Consumers are idempotent by `eventId`, check the tenant in the subject against the payload, and ack only after commit.
- **Test database.** Unit tests mock `PrismaService` and `ClientProxy`. E2E runs against `backend/docker-compose.test.yml` (own NATS and PostgreSQL, see backend S1.4), never the dev containers, with fake data only.
- **Test mapping.** Every `describe`/`it` name, or a comment right above it, carries `Covers: S<x>.<y>` (rules §9.7).

## 5. Phases

Every backend `STEPS.md` has these phases in this order. A phase that does not apply stays with one line: `Not applicable: <reason>` (rules §10).

| Phase | Name | Content |
|---|---|---|
| 0 | Contract and prerequisites | Order in `/STEPS.index.md`, inventory of what exists, the contract in `AGENTS.md` to implement. Read-only. |
| 1 | Foundation | Dependencies, `envs.ts` + `.env.example`, bootstrap (`createMicroservice` with NATS, or HTTP for the gateway), exception hierarchy, global `ValidationPipe`, patterns file, event transport. |
| 2 | Data model | `schema.prisma`, indexes, constraints, first migration, `PrismaService`. Not applicable for the gateway. |
| 3…N | Use cases | One phase per resource or flow (`Sessions`, `Invitations`…). One step per pattern or rule group. |
| N+1 | Events consumed | One step per consumed subject. Not applicable if the service consumes none. |
| N+2 | Close the loop | Wiring owed to or by other services (gateway routes, producers of consumed events). |
| N+3 | E2E | `test/` harness and flows over the real transport. |
| N+4 | Done checks | Sweeps over the whole service. |

## 6. Step shapes

Use these shapes; adapt names, keep the Check style.

**Env var**

```markdown
- [ ] **S1.2** `src/config/envs.ts` validates `<VAR>` (<rule>) and `.env.example` lists it with a placeholder.
  Check: `<test> envs` passes: missing `<VAR>` throws; invalid `<VAR>` throws. `rg -n "<VAR>=" .env.example` shows a placeholder, not a real value.
```

**Request-reply pattern**

```markdown
- [ ] **S3.1** `<service>.<resource>.<action>` (AGENTS § <section>): <what it does>. Errors: `<code>` <status>.
  Check: `<test> <resource>.<action>` passes: happy path, each error with exact `status`/`code`, tenant A actor on tenant B data → `forbidden`.
```

**Schema change**

```markdown
- [ ] **S2.2** `<Model>` in `prisma/schema.prisma` (AGENTS § Data Model), `@@map` snake_case, indexes for <lookup paths>.
  Check: `<prisma-validate>` passes; migration `<name>` contains the expected `CREATE TABLE` / `CREATE INDEX`; `<migrate-status>` reports up to date.
```

**Event emitted**

```markdown
- [ ] **S3.4** Emits `t.<tenant>.<service>.<event>` after commit with `eventId`, `occurredAt`, <payload>.
  Check: `<test> <use-case>` passes: publish called once with that subject and payload, and not called when the transaction fails.
```

**Event consumed**

```markdown
- [ ] **S7.1** Consumes `t.<tenant>.<producer>.<event>` (AGENTS § <section>): <effect>.
  Check: `<test> <handler>` passes: effect applied; same `eventId` twice is a no-op; tenant mismatch between subject and payload is rejected; no ack when the handler throws.
```

**Close the loop**

```markdown
- [!] **S9.1** <other service> calls/produces `<pattern or subject>`. Waits for `<other> S<x>`; that service ticks this step.
  Check: <command run against the real dependency>.
```

## 7. Standard done checks

Every backend `STEPS.md` ends with at least these steps in its Done checks phase:

1. Plant a hit for each grep check in `src/__plant.ts`, confirm each grep finds it, delete the file. Check: `test ! -e src/__plant.ts`.
2. Quality gate. Check: `<lint>`, `<typecheck>`, `<test>`, `<build>` and `<e2e>` pass.
3. Tenant isolation sweep. Check: `<test> tenant-isolation` passes, one case per repository/service method that touches tenant data.
4. No secrets in logs. Check: `rg -n -i "(log|warn|error|debug)\(.*(password|token|hash|secret)" src <EXCL>` is empty.
5. No leftover markers. Check: `rg -n "TODO\(<service>\)" src <EXCL>` is empty.
6. The service's `README.md` and `AGENTS.md` status sections describe what was built.

## 8. Skeleton

```markdown
# STEPS.md — backend / <service>

Follow /STEPS.rules.md. Order: /STEPS.index.md. Backend conventions: /backend/STEPS.template.md.

**Status:** last verified: — · next: S0.1 · in progress: — · blocked: —

Source of truth: `backend/<service>/AGENTS.md`.

## Phase 0 — Contract and prerequisites

Commits: (none, read-only phase)

## Phase 1 — Foundation

Commits: —

## Phase 2 — Data model

Commits: —

## Phase 3 — <use case>

Commits: —

## Phase N+1 — Events consumed

Commits: —

## Phase N+2 — Close the loop

Commits: —

## Phase N+3 — E2E

Commits: —

## Phase N+4 — Done checks

Commits: —

---

## Blocked

| Step | Waits for |
|------|-----------|

## Decisions

(none yet)

## Defaults to confirm
```
