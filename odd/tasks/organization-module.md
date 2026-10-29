# Feature: organization module (demo scope)

## Objective

Build the `organization` module of `backend/core` (sites, posts, employees, shifts) far enough for an end-to-end demo: register/login, create a site and a shift, clock in from `telemetry`, and watch the Torre de Control update live.

## Problem

`telemetry` (merged in `develop`, phases 0-8) asks `core` over NATS for `organization.employee.get`, `organization.site.get` and `organization.shift.get`, and consumes `t.*.organization.shift_*` / `site_updated` events. `backend/core/src/organization/` has zero code today, so no clock-in can succeed.

## Why

The team was asked for an early demo of the app. The backend for attendance exists; organization is the missing link. The frontend pages (`/sedes`, `/torre-control`) come after this feature, on top of `feat/frontend/dashboard-layout`.

## Scope

In (demo scope, from `backend/core/src/organization/AGENTS.md`):

- `OrganizationModule` with sub-modules `sites`, `employees`, `shifts`, own Prisma schema/client/migrations in schema `organization` (role `organization_svc` already created by `backend/postgres/init/01-schemas-and-roles.sh`).
- Sites and posts: create/update/get/list, QR rotation, `site_updated` event.
- Employees: create/update/get/list, `employee_created` event, `auth.user_created` consumer (link by email or create profile).
- Shifts: create/update/reassign/cancel/get/list, overlap block + four warnings, optimistic locking, `shift_created|updated|cancelled` events.
- NATS responders `organization.site.get|employee.get|shift.get`, shaped to what `telemetry` reads (`backend/telemetry/src/nats/dto/nats-contracts.ts`).
- Shift lifecycle job (`shift_starting|started|ended`), needed by `telemetry` workdays.

Out (later feature, not needed for the demo): shift templates + 14-day generator, `employee.list-available`, `user_deactivated`, tenant suspension handling, `data_retention_expired` purge.

## Constraints

- Module boundaries, actor-only tenant, 404 outside supervisor `siteIds`, no PII in logs (`backend/core/AGENTS.md`, module `AGENTS.md`).
- Ask before installing any dependency (`@nestjs/schedule` is needed for T6).
- Never `rm -rf` untracked folders (`backend/auth/`, `backend/gateway/` are untracked leftovers; leave them).

## Contract gaps found with telemetry (to reconcile)

- `SiteDto.radiusMeters` (telemetry) vs `geofenceRadiusMeters` (organization doc).
- `ShiftDto.status` uses `COMPLETED` (telemetry) vs `FINISHED` (organization doc).
- `EmployeeDto.userId` is required in telemetry; employees without a linked user exist in organization.
- Telemetry requests send `{ tenantId, userId | siteId | shiftId }` with no actor (background-style call with explicit `tenantId`, allowed by the doc).

Decision: organization keeps its documented model; the three NATS responders map to the telemetry wire shape (`radiusMeters`, `COMPLETED`). Events keep the documented payload; T5 verifies what `telemetry`'s consumer reads and records any mapping.

## Settings

- TDD: not configured (off), same as `odd/tasks/two-service-architecture.md`. Ordinary functional checks. Runner: jest (`pnpm test`).
- Per-slice checks: `pnpm lint` + touched specs only; full `pnpm test`, `pnpm build`, e2e once at the end (memory: fast slice checks).
- Branch: feature branch `feat/backend/organization` (from `develop`). Delivery strategy: `feature-branch-chain` (as in the previous feature); slice PRs target `feat/backend/organization`, which merges into `develop`, never `main`. Push only after asking.
- Forecast: about 2500 authored lines; one slice PR per task.

## Tasks

- [x] T1 Scaffold: `OrganizationModule`, `ORGANIZATION_DATABASE_URL` in `src/config/envs.ts` + `.env.example`, `prisma.organization.config.ts` + `prisma:organization:*` scripts, Prisma schema (Site, Post, Employee, EmployeeSite, Shift, TenantState, ProcessedEvent) with indexes, first migration, `OrganizationPrismaService`, `organization.patterns.ts`, `ORGANIZATION_EVENTS` stream setup. Route: delegated (writer trigger, 4+ files).
- [x] T2 Sites and posts: facade operations, HTTP controllers (route map), QR generation/rotation, role and site-scope checks, `site_updated` event, unit tests. Route: delegated.
- [x] T3 Employees: facade operations, HTTP controllers, `employee_created` event, `auth.user_created` consumer (idempotent, `ProcessedEvent`), unit tests. Route: delegated.
- [x] T4 Shifts: facade operations, HTTP controllers, overlap check in transaction + warnings, optimistic locking, `shift_*` events, unit tests. Route: delegated.
- [ ] T5 NATS responders for telemetry with wire mapping, responder tests, docs (`backend/core/AGENTS.md`, `docs/architecture.md`, `backend/telemetry/AGENTS.md` if contracts change). Route: delegated.
- [ ] T6 Shift lifecycle job (needs `@nestjs/schedule`, ask first), unit tests. Route: delegated.
- [ ] T7 Final checks: full `pnpm test`, `pnpm build`, docker compose up with core + telemetry, manual demo flow smoke. Route: inline.

## Acceptance criteria

- With `docker compose up`, an owner can create a site, an employee linked to a user, and a shift over HTTP; `telemetry` resolves them via NATS and a clock-in inside the geofence is accepted.
- Tenant isolation and supervisor scope covered by unit tests.

## Progress

- 2026-10-29: feature branch created from `develop` (`a6ff74b`). Document created.
- 2026-10-29: T1 done on slice branch feat/backend/org-scaffold, route delegated (writer trigger). Commits 0ed7461 (@nestjs/schedule dep), 2ae2fb6 (scaffold). Checks: prisma:organization:generate ok, lint ok, tsc ok, jest src/config ok (14 tests). Events: organization-owned OrganizationEventsService (auth JetStreamService is auth-specific, not shared). `.env.example` files not updated (read/edit denied in this session): add ORGANIZATION_DATABASE_URL manually.
- 2026-10-29: parent spot check: `tsc --noEmit` ok; `pnpm test:smoke` 2 suites / 21 tests passed (121 s; the writer's 150 s timeout killed it before, not a hang).

## Next step

T2.
- 2026-10-29: T2 done on slice branch feat/backend/org-sites (stacked on org-scaffold), route delegated (writer trigger). Commit fb0103e (sites and posts). Checks: lint ok, tsc ok, jest src/organization 3 suites / 49 tests ok. Decisions: employees get empty list / 404 site_not_found on site and post reads (never 403, never qrCode); posts writes owner/admin only; site_updated also emitted on create; telemetry's site_updated consumer reads only siteId, so the documented payload is compatible unchanged. Unstaged .env.example change (ORGANIZATION_DATABASE_URL) left for the user.
- 2026-10-29: T3 done on slice branch feat/backend/org-employees (stacked on org-sites), route delegated (writer trigger, 2+ non-trivial files). Commits a62a39a (employees sub-module, consumer, tests), 3e0d0a9 (docs). Checks: lint ok, tsc ok, jest src/organization src/common 10 suites / 135 tests ok. Decisions: durable consumer `organization-auth` on `AUTH_EVENTS` (filter `t.*.auth.user_created`) run by OrganizationEventsService with an organization-owned ConsumedEventProcessor (tenant check + ProcessedEvent dedupe in one transaction); employees see only their own profile, supervisors only employees enabled in their `siteIds` (404), supervisors do not get `nationalId`; `getEmployeeForTenant(tenantId, {employeeId|userId})` is ready for the T5 responder; duplicate email or legajo maps to 409 `email_taken`; invalid enabled sites answer 422. Not covered by unit tests: the NATS-level dispatch/ack code in OrganizationEventsService (needs the T7 docker smoke).
- 2026-10-29: T4 done on slice branch feat/backend/org-shifts (stacked on org-employees), route delegated (writer trigger, 2+ non-trivial files). Commits 4404854 (shifts sub-module, exceptions, tests), docs commit follows. Checks: lint ok, tsc ok, `pnpm test src/organization src/common` 13 suites / 191 tests ok (the bare `jest` command needs `node --experimental-vm-modules`, use `pnpm test`). Decisions: no schema change or migration; the overlap block runs in the write transaction after a per-employee `pg_advisory_xact_lock(hashtextextended(...))` (serialized check, no exclusion constraint, which would need btree_gist); writes are a compare-and-set on `version` plus non-final status (409 `version_conflict`); `shift_not_editable` is checked before the version; supervisor outside `siteIds` gets 404 `site_not_found` on create and 404 `shift_not_found` otherwise; employees read only their own shifts and get 403 on writes; assigned employees must be active (422); `GET /shifts?day=` needs `siteId` (site timezone) and weekly hours use the Monday to Sunday week of the site timezone (Intl only, no dependency). Event payload mapping: `shift_created|updated|cancelled` carry the documented snapshot (`shiftId`, `tenantId`, `siteId`, `postId`, `employeeId` nullable, `startsAt`, `endsAt` ISO, `status` SCHEDULED|IN_PROGRESS|CANCELLED, `version`, plus `eventId`/`occurredAt`). Telemetry's `OrganizationConsumer.handleShiftUpsert` reads `shiftId`, `siteId`, `postId`, `employeeId`, `startsAt`, `endsAt`, `status`, `version` and the tenant from the subject, so these three events are compatible unchanged (they never carry FINISHED, which telemetry names COMPLETED; that mapping matters only for `shift_ended` in T6 and the `organization.shift.get` responder in T5). `getShiftForTenant(tenantId, shiftId)` is ready for T5. Not verified: the advisory lock and the Prisma `$queryRaw` against a real PostgreSQL (unit tests mock Prisma); needs the T7 docker smoke.
