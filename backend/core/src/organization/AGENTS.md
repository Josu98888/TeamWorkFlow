# AGENTS.md — `organization` module (`backend/core`)

Guide for coding agents working on the `organization` module of `backend/core`. Read `backend/core/AGENTS.md` (core-wide rules: module boundaries, HTTP layer, event bus) and then this file fully before making changes. This file overrides the root `AGENTS.md` and `backend/core/AGENTS.md` for the `organization` domain rules when they conflict. Code patterns live in `skills/teamworkflow-nest`; migrations in `skills/teamworkflow-prisma-migrations`.

## What this module is

`organization` knows WHERE and WHEN people work: the sites of a tenant, the people who work there, and the shifts that connect both. Every other operational module (tasks, notifications) and the `telemetry` service (`attendance` domain) ask it or listen to it.

It is a module of the `backend/core` modular monolith (`src/organization/`, `OrganizationModule`) with three internal sub-modules: `sites`, `employees` and `shifts`. Other core modules reach it only through its exported facade service, or through its events; it can be extracted to its own service later without changing its event consumers (`docs/architecture.md`). Keep the sub-modules separable too: a sub-module never reads another sub-module's tables directly, it calls the other's exported service.

Responsibilities:

- **sites:** site data (name, address, location point, geofence radius, timezone), the fixed QR code of each site (rotatable by an admin) and the posts (puestos) inside a site.
- **employees:** the profile of EVERY user of the tenant (name, last name, email, phone, avatar media id), created or linked from `auth` events. Operational employees also carry legajo (employee number), national id (DNI), skills, enabled sites and a weekly hours limit.
- **shifts:** weekly templates, a daily generator for the next 14 days, manual create/edit/cancel/reassign, validation (overlap blocks, everything else warns), and the lifecycle events `shift_starting`, `shift_started`, `shift_ended`.

Out of scope (do NOT implement here):

- Login, passwords, roles, invitations, site scope of supervisors (`User.siteIds`): owned by `auth`. `organization` receives the actor from the HTTP layer of `core` (its own HTTP controllers) and trusts it.
- Clock-ins, workdays, alerts and the Torre de Control summaries: owned by the `attendance` domain, which lives in the `telemetry` service (`backend/telemetry`).
- Tasks, forms and photos: owned by `tasks`. Avatars are stored by `tasks` media; here only the media id is kept.
- Sending notifications: owned by `notifications`.
- Payroll, holidays, night hours, automatic emergency replacement, polygon geofences, PostGIS. Future work; ask before adding.

## Business Rules

### Sites and posts

1. A site has: `name`, `address`, `latitude`, `longitude`, `geofenceRadiusMeters`, `timezone` (IANA, for example `America/Argentina/Buenos_Aires`), `qrCode` and `isActive`. The geofence is a point plus a radius in meters: no polygons.
2. Each site has ONE fixed QR code. It is a random opaque value, unique across the system, generated at creation. An admin can rotate it (`organization.site.rotate-qr`): the old value stops being valid immediately. The QR is printed and placed at the site, so rotation is a deliberate action.
3. A post (puesto) belongs to a site and has: `name`, `requiredSkills` (list of skill names) and `minPeople` (minimum people needed at the same time).
4. Sites are deactivated, never deleted: shifts and attendance reference them.
5. All times are stored in UTC (`timestamptz`). Anything defined as "wall clock" (template start time, "day" filters) is interpreted in the site timezone.

### Employees

1. Every user of the tenant has an employee record (profile), whatever the role. Fields: `firstName`, `lastName`, `email`, `phone`, `avatarMediaId`, `userId` (nullable until linked), `isActive`.
2. Operational employees additionally have `employeeNumber` (legajo, unique per tenant), `nationalId` (DNI), `skills`, `weeklyHoursLimit`, and a list of enabled sites.
3. On `t.<tenant>.auth.user_created`: look for an employee of the tenant with the same email. If it exists, link it (`userId`). Otherwise create a profile with no legajo. Idempotent (see Events consumed).
4. On `t.<tenant>.auth.user_deactivated`: mark the employee inactive and leave ALL their future shifts (`scheduled`, start in the future) unassigned. Emit `shift_updated` for each one. History is kept.
5. An admin creates an operational employee with email through `organization.employee.create`. It emits `t.<tenant>.organization.employee_created`; `auth` consumes it to create an `employee` invitation. The email is unique per tenant.
6. Employees are never hard-deleted.

### Roles in this module

| Action | owner / admin | supervisor | employee |
|--------|:-------------:|:----------:|:--------:|
| Create/edit sites, posts, QR rotation | ✅ | ❌ | ❌ |
| Create/edit employees, enable sites | ✅ | ❌ | ❌ |
| Manage shift templates | ✅ | ❌ | ❌ |
| Create/edit/cancel/reassign single shifts | ✅ all sites | ✅ only `siteIds` | ❌ |
| Read sites, employees, shifts | ✅ all | ✅ only `siteIds` | own profile and own shifts only |

- `owner` and `admin` see every site of the tenant. A supervisor acts only on sites listed in the actor's `siteIds`; anything outside them answers 404 (never 403) to prevent enumeration.
- The actor (`userId`, `tenantId`, `role`, `siteIds`) comes from the HTTP layer of `core`, which got it from `auth.token.verify`. Never read tenant or role from the payload body.

### Shift templates and generation

1. A weekly template has: `siteId`, `postId`, `weekdays` (list, 1 = Monday ... 7 = Sunday), `startTime` (`HH:mm`, site timezone), `durationMinutes`, optional `employeeId` and `isActive`.
2. A daily job generates shifts for the next 14 days from every active template. It is idempotent per `(templateId, startsAt)`: running it twice creates nothing new. Each created shift emits `shift_created`.
3. Generated shifts copy the template employee (if any). Editing a template changes only shifts generated afterwards; existing shifts are edited individually.
4. A template whose employee is inactive generates unassigned shifts.

### Shifts

States: `scheduled`, `in_progress`, `finished`, `cancelled`.

1. Admins and supervisors (within their sites) can create, edit, cancel and reassign single shifts manually, in addition to the generated ones.
2. Edits use optimistic locking: the payload carries the `version` the caller read; a mismatch answers `version_conflict` (409). Every successful write increments `version`.
3. Validation when assigning an employee:
   - **Blocks:** the employee already has another non-cancelled shift that overlaps in time (`shift_overlap`, 409). This is the ONLY blocking rule.
   - **Warnings (never block):** rest under 12 hours since the previous shift or before the next one (`rest_under_12h`), weekly hours over `weeklyHoursLimit` (`weekly_hours_exceeded`), employee lacks a required skill of the post (`missing_skill`), site not in the employee's enabled sites (`site_not_enabled`).
4. Write endpoints return `{ shift, warnings: [{ code, message }] }`. The caller decides what to do with the warnings.
5. A cancelled or finished shift cannot be edited or reassigned (`shift_not_editable`, 409).
6. Deactivating an employee leaves their future shifts unassigned (see Employees).

### Shift lifecycle job

A job runs every minute (all tenants, skipping suspended ones) and:

- emits `shift_starting` for `scheduled` shifts that start within 15 minutes;
- moves shifts whose start time arrived to `in_progress` and emits `shift_started`;
- moves shifts whose end time arrived to `finished` and emits `shift_ended`.

Each transition is applied once (compare-and-set on the status or on a marker column) and the job tolerates being late: if it was down, it catches up on the next run. Emitting is at-least-once; consumers are idempotent.

### Tenant suspension and cancellation

Consume `t.<tenant>.auth.tenant_suspended`, `tenant_cancelled` and `tenant_reactivated`. While a tenant is suspended or cancelled: the generator and the lifecycle job skip it (no `shift_*` events). Interactive requests are not blocked here (the HTTP layer of `core` does that). Data is kept. After reactivation the jobs resume and the lifecycle job catches up.

### Tenant data purge

Consume `t.<tenant>.billing.data_retention_expired` (emitted 90 days after the tenant was cancelled). It permanently deletes ALL the tenant's data in this module: sites, posts, employees and their enabled sites, shift templates, shifts, tenant state and processed events. It is idempotent (a second delivery finds nothing and is a no-op), runs in one transaction, and emits no `shift_*` or `site_updated` events (the other modules and `telemetry` purge their own copies from the same event).

## Stack

- NestJS 12 module inside `backend/core`; HTTP controllers for this module's endpoints live in `src/organization/` (see `backend/core/AGENTS.md`). NATS is used for JetStream events and for the request responders that `telemetry` needs (see NATS Contract).
- PostgreSQL + Prisma 7 with its own `prisma/schema.prisma` in the `organization` schema of the shared `teamworkflow` database, accessed through its own Prisma client with its own `organization_svc` role that cannot read other schemas (see `backend/STEPS.md` S1.1). Not installed yet.
- `class-validator` + `class-transformer` with the global `ValidationPipe` of `core` (422 `validation_error`). Not installed yet.
- Scheduling for the jobs (for example `@nestjs/schedule`). Not installed yet.
- Env validation with joi in `src/config/envs.ts`, same pattern as the rest of `core`.
- Jest for tests.

Ask before installing any dependency.

## Current Status (READ FIRST)

`backend/core` exists (scaffold, HTTP layer and `auth` module). The organization scaffold is in place (T1 of `odd/tasks/organization-module.md`): `OrganizationModule` (registered in `AppModule`, exports only `OrganizationService`, an empty facade), the Prisma schema and first migration (`src/organization/prisma/`), `OrganizationPrismaService`, `organization.patterns.ts` and `OrganizationEventsService` (`src/organization/events/`, owns the `ORGANIZATION_EVENTS` stream and publishing). Since T2 the `sites` sub-module is built (`src/organization/sites/`: `SitesService`, `PostsService`, `SitesController` with the site and post routes of the route map, DTOs, `site-policy.ts`) and exposed through the `OrganizationService` facade; Since T3 the `employees` sub-module is built (`src/organization/employees/`: `EmployeesService`, `EmployeesController` with `POST /employees`, `PATCH /employees/:employeeId`, `GET /employees/:employeeId`, `GET /employees`, DTOs, `employee-policy.ts`, and the `UserCreatedHandler` consumer) and exposed through the facade (`createEmployee`, `updateEmployee`, `getEmployee`, `getEmployeeByUserId`, `getEmployeeForTenant(tenantId, { employeeId | userId })` for the NATS responder of T5, `listEmployees`); Since T4 the `shifts` sub-module is built (`src/organization/shifts/`: `ShiftsService`, `ShiftsController` with `POST /shifts`, `PATCH /shifts/:shiftId`, `POST /shifts/:shiftId/reassign`, `POST /shifts/:shiftId/cancel`, `GET /shifts/:shiftId`, `GET /shifts`, DTOs, `shift-policy.ts`, `shift-time.ts`) and exposed through the facade (`createShift`, `updateShift`, `reassignShift`, `cancelShift`, `getShift`, `getShiftForTenant(tenantId, shiftId)` for the NATS responder of T5, `listShifts`); the shift templates, the shift lifecycle job and the other consumers are not built yet. Shift rules as built: owner/admin act on every site, a supervisor only inside `siteIds` (create on a site outside answers 404 `site_not_found`; get, update, reassign and cancel on a shift outside answer 404 `shift_not_found`), an employee reads only their own shifts and cannot write (403). Writes carry the `version` the caller read; the update is a compare-and-set on `version` (and on a non-final status), so a stale or concurrent write answers 409 `version_conflict`. The overlap check runs in the write transaction after a per-employee `pg_advisory_xact_lock`, so two concurrent writes for the same employee cannot both pass (no new database constraint). The four warnings are computed with the same employee and post data: rest is checked 12 hours around the shift, the weekly total counts non-cancelled shifts that start in the Monday to Sunday week of the site timezone, skills match case-insensitively. `GET /shifts` filters by `siteId`, `employeeId` and `day` (`YYYY-MM-DD` in the site timezone, which requires `siteId`). Assigned employees must be active (422 `validation_error`). Employee visibility: owner/admin see the whole tenant, a supervisor only employees enabled in one of `siteIds` (404 `employee_not_found` otherwise), an employee only their own profile (list returns just them); the national id is hidden from supervisors. Email and legajo duplicates answer 409 `email_taken`; enabled `siteIds` must exist in the tenant (422 `validation_error`). The `auth.user_created` consumer is the durable `organization-auth` on stream `AUTH_EVENTS` (filter `t.*.auth.user_created`), run by `OrganizationEventsService`; handling goes through `ConsumedEventProcessor` (tenant check, `ProcessedEvent` dedupe in the same transaction). Employee actors get an empty site list and 404 `site_not_found` on site/post reads (never 403, never `qrCode`); supervisors are limited to `siteIds` (404 outside); writes are owner/admin only (403 `forbidden`).

First tasks, in order (ask before each install):

- [x] Create `OrganizationModule` in `backend/core/src/organization/`, its config (`ORGANIZATION_DATABASE_URL`) in `src/config/envs.ts` and `.env.example`.
- [x] Prisma schema and first migration (`prisma:organization:*` scripts, `prisma.organization.config.ts`). `ShiftTemplate` comes with the template feature.
- [x] Sub-modules `sites` (done in T2), `employees` (done in T3), `shifts` (done in T4), with their HTTP controllers, the exported facade service and the pattern constants for the NATS responders.
- [ ] Consumers of `auth` events (`user_created` done in T3; `user_deactivated`, tenant status and purge pending) and the jobs.
- [ ] Expose the module routes through its HTTP controllers in `core` (no separate service, no extra compose entry).

## NATS Contract

Operation names follow `organization.<resource>.<action>` and carry NO tenant: the tenant comes from the actor. Domain events follow `t.<tenant>.organization.<event>` (JetStream, snake_case names).

In `core` the operations below are **in-process calls** to the module's facade service (invoked by the module's HTTP controllers and by other core modules); the pattern string is kept as the operation's stable name. Only these three are also **NATS request-reply responders**, because `telemetry` (a separate service) needs them: `organization.site.get`, `organization.employee.get`, `organization.shift.get`. Keep the names in constants files (to create: `src/organization/organization.patterns.ts`).

### Operations (module facade) and NATS responders

"actor" = `{ userId, tenantId, role, siteIds }` from `auth.token.verify`. Lists return `{ items, total }`.

| Operation | Caller | Payload | Returns |
|---------|--------|---------|---------|
| `organization.site.create` / `update` | HTTP controller (owner/admin) | actor, site fields (and `siteId` on update) | site (employees never see `qrCode`) |
| `organization.site.get` | HTTP controller; `telemetry` (NATS responder) | actor, `siteId` | site with geofence and `qrCode` |
| `organization.site.list` | HTTP controller | actor, `page`, `pageSize` | sites visible to the actor |
| `organization.site.rotate-qr` | HTTP controller (owner/admin) | actor, `siteId` | site with the new `qrCode` |
| `organization.post.create` / `update` / `list` | HTTP controller | actor, `siteId`, post fields | post / posts |
| `organization.employee.create` | HTTP controller (owner/admin) | actor, profile + operational fields, `email` | employee |
| `organization.employee.update` | HTTP controller (owner/admin) | actor, `employeeId`, fields (skills, enabled sites, weekly limit, ...) | employee |
| `organization.employee.get` | HTTP controller, other core modules (facade); `telemetry` (NATS responder) | actor, `employeeId` OR `userId` | employee |
| `organization.employee.list` | HTTP controller | actor, filters, `page`, `pageSize` | employees |
| `organization.employee.list-available` | HTTP controller (owner/admin/supervisor) | actor, `shiftId` | employees able to replace, sorted by fewest weekly hours first |
| `organization.shift-template.create` / `update` / `deactivate` / `list` | HTTP controller (owner/admin) | actor, template fields | template / templates |
| `organization.shift.create` | HTTP controller (owner/admin/supervisor) | actor, site, post, `startsAt`, `endsAt`, optional `employeeId` | `{ shift, warnings }` |
| `organization.shift.update` | same | actor, `shiftId`, `version`, fields | `{ shift, warnings }` |
| `organization.shift.reassign` | same | actor, `shiftId`, `version`, `employeeId` or `null` | `{ shift, warnings }` |
| `organization.shift.cancel` | same | actor, `shiftId`, `version` | shift |
| `organization.shift.get` | HTTP controller, `tasks` (facade); `telemetry` (NATS responder) | actor, `shiftId` | shift |
| `organization.shift.list` | HTTP controller | actor, filter by `siteId`, `employeeId` or `day` (site timezone), `page`, `pageSize` | shifts |

Calls from other modules or from `telemetry` (for example `telemetry` asking `organization.shift.get` over NATS) carry the same actor the HTTP layer got, or, for background work without a user, an explicit `tenantId` in the payload. Never accept a tenant from a client.

### Events emitted (JetStream)

| Event subject | Payload |
|---------------|---------|
| `t.<tenant>.organization.employee_created` | `eventId`, `employeeId`, `tenantId`, `email`, `firstName`, `lastName`, `occurredAt` |
| `t.<tenant>.organization.site_updated` | `eventId`, `siteId`, `tenantId`, `latitude`, `longitude`, `geofenceRadiusMeters`, `qrRotated`, `occurredAt`. Emitted on create, update (any field, including deactivation) and QR rotation (`qrRotated: true`). `telemetry` only reads `siteId` (cache invalidation) |
| `t.<tenant>.organization.shift_created` | shift snapshot (built in T4) |
| `t.<tenant>.organization.shift_updated` | shift snapshot (edit, reassign, unassign) |
| `t.<tenant>.organization.shift_cancelled` | shift snapshot |
| `t.<tenant>.organization.shift_starting` | shift snapshot (15 min before start) |
| `t.<tenant>.organization.shift_started` | shift snapshot |
| `t.<tenant>.organization.shift_ended` | shift snapshot |

- Shift snapshot = `eventId`, `tenantId`, `shiftId`, `siteId`, `postId`, `employeeId` (nullable), `startsAt`, `endsAt`, `status`, `version`, `occurredAt`. A full snapshot lets consumers keep a local copy without calling back.
- `occurredAt` is ISO-8601 UTC. Every event carries a unique `eventId` so consumers deduplicate.
- Emit events only after the database transaction commits. Failing to emit must not roll back the data; the next job run or a retry re-emits (consumers are idempotent). An outbox table is possible future hardening, not a requirement.

### Events consumed (JetStream, durable consumer, explicit ack)

| Event subject | Producer | Handling |
|---------------|----------|----------|
| `t.<tenant>.auth.user_created` | `auth` | Link by email or create the profile (no legajo). |
| `t.<tenant>.auth.user_deactivated` | `auth` | Mark employee inactive; unassign future shifts. |
| `t.<tenant>.auth.tenant_suspended` / `tenant_cancelled` | `auth` | Pause jobs for the tenant. |
| `t.<tenant>.auth.tenant_reactivated` | `auth` | Resume jobs for the tenant. |
| `t.<tenant>.billing.data_retention_expired` | `billing` | Permanently delete every row of the tenant (idempotent). |

The tenant of a consumed event comes from the subject and is checked against the payload. Handlers are idempotent: deduplicate by `eventId` in a `ProcessedEvent` table or by a natural unique key. Errors in an `@EventPattern` handler never reach the producer: catch and log them, and let the message be redelivered when it must be retried.

### Errors

Throw an `AppException` subclass from `src/common/exceptions/` (see `teamworkflow-nest`). The HTTP exception filter of `core` maps it to HTTP `{ detail, code }`; NATS responders map it to `{ status, code, message }` via `NatsErrorFilter`.

| code | status | When |
|------|--------|------|
| `forbidden` | 403 | Role not allowed for the action |
| `site_not_found` / `employee_not_found` / `shift_not_found` / `post_not_found` | 404 | Missing, or outside the actor's tenant or sites |
| `shift_overlap` | 409 | The employee already has an overlapping shift |
| `version_conflict` | 409 | Optimistic lock mismatch |
| `shift_not_editable` | 409 | Shift is cancelled or finished |
| `email_taken` | 409 | Employee email or legajo already exists in the tenant |
| `validation_error` | 422 | DTO validation failed |

## Data Model (Prisma, to create)

Models are PascalCase, fields camelCase, tables plural snake_case through `@@map` / `@map`. Every model has `tenantId`.

- `Site`: `id`, `tenantId`, `name`, `address`, `latitude`, `longitude`, `geofenceRadiusMeters`, `timezone`, `qrCode` (unique), `qrRotatedAt`, `isActive`, timestamps.
- `Post`: `id`, `tenantId`, `siteId`, `name`, `requiredSkills` (string list), `minPeople`, `isActive`.
- `Employee`: `id`, `tenantId`, `userId` (nullable, unique per tenant), `email` (unique per tenant), `firstName`, `lastName`, `phone`, `avatarMediaId`, `employeeNumber` (nullable, unique per tenant), `nationalId` (nullable), `skills` (string list), `weeklyHoursLimit` (nullable), `isActive`, timestamps.
- `EmployeeSite`: `tenantId`, `employeeId`, `siteId`, primary key (`employeeId`, `siteId`).
- `ShiftTemplate`: `id`, `tenantId`, `siteId`, `postId`, `weekdays` (int list), `startTime`, `durationMinutes`, `employeeId` (nullable), `isActive`.
- `Shift`: `id`, `tenantId`, `templateId` (nullable), `siteId`, `postId`, `employeeId` (nullable), `startsAt`, `endsAt`, `status` (`SCHEDULED` | `IN_PROGRESS` | `FINISHED` | `CANCELLED`), `version`, `startingEmittedAt`, timestamps. Unique `(tenantId, templateId, startsAt)` for generated shifts.
- `TenantState`: `tenantId`, `isSuspended` (true while suspended or cancelled), `updatedAt`. No row means active.
- `ProcessedEvent`: `eventId` (unique), `processedAt`.

Every query filters by `tenantId`. Add indexes for the real lookups: shifts by `(tenantId, employeeId, startsAt)`, by `(tenantId, siteId, startsAt)` and by `(status, startsAt)` for the job (`teamworkflow-postgres`). The overlap check must run inside the same transaction as the write, and a database constraint or a serializable check must back it so two concurrent writes cannot both pass.

The jobs are the only code that reads across tenants. They still process one tenant at a time and skip suspended ones.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NATS_SERVER` | Comma-separated NATS URLs (shared by all of `core`) |
| `ORGANIZATION_DATABASE_URL` | PostgreSQL connection string for the `teamworkflow` database, `organization` schema (`?schema=organization`), `organization_svc` role |
| `SHIFT_HORIZON_DAYS` | Days ahead the generator fills. Default `14` |

Variable names are provisional until the shared `core` config exists (T4/T6): in `core` each module has its own database URL for its own role. Validate all of them in `src/config/envs.ts` and list them in `.env.example`. Never commit `.env`.

## Security Rules (non-negotiable)

1. `tenantId` always comes from the verified actor or the database, never from client input.
2. Every query filters by `tenantId`; a test proves tenant isolation.
3. Supervisors never touch a site outside `siteIds`; out-of-scope resources answer 404.
4. Never log personal data (national id, phone, email) in full.
5. Never return the site `qrCode` to an `employee` actor through listing endpoints; only the internal call from `attendance` and admin/supervisor reads include it.
6. Never read another module's tables or use its Prisma client; call its exported facade service or consume its events.

## Tests

- Unit tests for every use case with Prisma and the facades of other modules mocked (`pnpm test`).
- Always covered: tenant isolation on every module; supervisor limited to `siteIds` (404 outside); overlap blocks while the four warnings do not; optimistic locking; generator idempotency (run twice, no duplicates) and the 14-day horizon in the site timezone; lifecycle job transitions and catch-up; `user_created` linking by email vs creating a profile; `user_deactivated` unassigning future shifts only; QR rotation invalidating the old value; suspended and cancelled tenants skipped by the jobs and resumed after `tenant_reactivated`; tenant data purge (`data_retention_expired` deletes every row of the tenant, leaves other tenants untouched and is idempotent); idempotent handling of every consumed event.
- E2E tests (to create in `test/`) once the transport and the database are set up, against a dedicated test database.

## Before Finishing a Task

- [ ] `pnpm lint`, `pnpm test` and `pnpm build` pass.
- [ ] Schema changes come with a reviewed Prisma migration.
- [ ] If you changed a pattern, event or payload, you updated this file, `backend/core/AGENTS.md` and the consuming modules' and services' docs (`telemetry`), and called it out in the PR description.
- [ ] No secrets or personal data in logs, tests or fixtures.
