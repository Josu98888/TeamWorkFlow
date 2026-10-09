# STEPS.index.md — implementation order

> Follow `/STEPS.rules.md`. This file is the ONLY place the order is written. Domain `STEPS.md` files reference it, never copy it.

**Next action:** start B1 auth (`backend/auth/STEPS.md`, from S0.1); S1.1 and S1.6 need the user's answers.

## 1. How an agent uses this file

Run this at the start of every session, before opening any domain `STEPS.md`:

1. If a row is `in progress`, continue it. Never start a second domain while one is `in progress` (unless the user says so).
2. Otherwise take the FIRST row, top to bottom, whose status is not `done` and whose **Depends on** rows are all `done`.
3. If that row is `not planned`, its first job is to write its `STEPS.md` from the stack template (`backend/STEPS.template.md`, `frontend/STEPS.template.md`), then set it to `planned`.
4. If no row can start, report which dependency blocks it and stop. Never skip ahead.
5. After every session, update the row's **Status** and **Next** columns and the **Next action** line above (pre-approved, rules §6).

Status values: `not planned` (no `STEPS.md` yet) · `planned` (`STEPS.md` written, no step ticked) · `in progress` · `blocked` (name the reason in **Next**) · `done` (its Done checks phase passed).

## 2. Order

### Backend

| # | Domain | STEPS file | Depends on | Status | Next |
|---|--------|-----------|------------|--------|------|
| B0 | backend foundation | `backend/STEPS.md` | — | done | — |
| B1 | auth | `backend/auth/STEPS.md` | B0 | planned | S0.1 (S1.1, S1.6 need TODO(auth) answers) |
| B2 | gateway | `backend/gateway/STEPS.md` | B1 | not planned | — |
| B3 | billing | `backend/billing/STEPS.md` | B1, B2 | not planned | — |
| B4 | organization | `backend/organization/STEPS.md` | B1, B2, B3 | not planned | — |
| B5 | attendance | `backend/attendance/STEPS.md` | B4 | not planned | — |
| B6 | tasks | `backend/tasks/STEPS.md` | B4 | not planned | — |
| B7 | notifications | `backend/notifications/STEPS.md` | B1, B3, B4, B5, B6 | not planned | — |

### Frontend

| # | Domain | STEPS file | Depends on | Status | Next |
|---|--------|-----------|------------|--------|------|
| F0 | frontend template | `frontend/STEPS.template.md` | — | not planned | Write it (commands, phases, step shapes) |
| F1 | frontend foundation | `frontend/shared/STEPS.md` | F0, B2 | not planned | — |
| F2… | frontend domains | `frontend/domains/<domain>/STEPS.md` | F1 + the backend rows that own its contract | not planned | TODO(frontend) list the domains |

A frontend domain never starts before the backend rows that own its endpoints are `done` (rules §8: the backend owns the contract).

## 3. Why this order (dependencies between services)

Cycles exist (auth ↔ billing, auth ↔ organization). They are broken with rules §8: the earlier domain builds its side against the contract in the other service's `AGENTS.md` and leaves a blocked "Close the loop" step; the later domain wires itself in and ticks it.

| Row | Needs from earlier rows | Leaves for later rows (Close the loop) |
|-----|------------------------|----------------------------------------|
| B0 | — | Docker compose, databases, JetStream stream used by every service |
| B1 auth | B0 | Gateway calling `auth.*` patterns (auth S9.1 → B2); producers of `billing.*` and `organization.employee_created` (auth S9.2, S10.3 → B3, B4) |
| B2 gateway | `auth.token.verify` for the guard | HTTP routes of each later service are added in that service's Close the loop |
| B3 billing | `auth.tenant_created`, `auth.user.list-recipients` | Consumer of `notifications.send` (→ B7); ticks auth S9.2 for billing events |
| B4 organization | `auth.user_created`, `user_deactivated`, `tenant_*`; `billing.data_retention_expired` | Ticks auth S9.2 for `employee_created`; shift and site events for B5, B6 |
| B5 attendance | `organization.shift_*`, `site_updated`, `organization.site.get`, `organization.employee.get`, `organization.shift.get`; `billing` plan events; `auth.tenant_*` | `attendance.alert_opened` for B7; tower events for B2 (Socket.IO) |
| B6 tasks | `organization.shift_started`, `shift_cancelled`; `billing` plan events; `auth.tenant_*` | `tasks.task_assigned` for B7 |
| B7 notifications | `auth.user.list-recipients`, `organization.employee.get`, events of B3, B5, B6 | — |

## 4. Open cross-stack decisions

Declared scopes for `TODO(<scope>)` / `DEFAULT(<scope>)` that are not a single domain:

| Scope | Covers |
|-------|--------|
| `backend` | Anything shared by 2+ backend services (compose, databases, NATS/JetStream, shared conventions). Answered in `backend/STEPS.md`. |
| `e2e` | Test infrastructure shared across services or stacks (test databases, seeding through the gateway). |
| `frontend` | Shared frontend decisions. Answered in `frontend/shared/STEPS.md`. |

Open:

- `TODO(frontend)` List of frontend domains for rows F2….

Answered decisions move to the **Decisions** section of the file that owns them (`backend/STEPS.md`, `frontend/shared/STEPS.md`) and are removed from this list.

## 5. Cross-stack decisions already taken

Referenced, not reopened (rules §4). Source in parentheses.

- 7 MVP backend services; English naming everywhere (`/AGENTS.md` § Project Overview).
- Request-reply patterns `<service>.<resource>.<action>`, no tenant prefix; events `t.<tenant>.<service>.<event>` on JetStream with `eventId` + `occurredAt` (`/AGENTS.md`, each service `AGENTS.md` § NATS Contract).
- The frontend talks only to the gateway (HTTP `/api/...` and Socket.IO for the Torre de Control) (`/AGENTS.md` § Architecture Rules).
- Errors: microservices throw `RpcException { status, code, message }`; the gateway answers HTTP `{ detail, code }` (`skills/teamworkflow-nest`).
- `tenantId`, `role`, `siteIds`, `plan`, `features` come only from `auth.token.verify` (`backend/auth/AGENTS.md` § Sessions and tokens).
- Each service owns its data and Prisma schema; never read another service's tables (`/AGENTS.md` § Architecture Rules).
- One PostgreSQL database, one schema per data-owning service, one role per service (`backend/STEPS.md` S1.1, Decisions 2026-10-08).
- One JetStream stream per owning service (`<SERVICE>_EVENTS` on `t.*.<service>.>`), created by that service on startup; durable consumers named `<consumer>-<producer>` (`backend/STEPS.md` S1.2, Decisions 2026-10-09).
- JetStream client: official `@nats-io/jetstream` v3 wrapped in a `JetStreamService` per service; `nats` v2 is not used (`backend/STEPS.md` S1.3).
- E2E runs against `backend/docker-compose.test.yml` (own NATS + PostgreSQL, other ports, no volumes) (`backend/STEPS.md` S1.4).
- Port clash: gateway and `next dev` both default to 3000; run the frontend on 3002 (`/AGENTS.md` § Project Overview).
