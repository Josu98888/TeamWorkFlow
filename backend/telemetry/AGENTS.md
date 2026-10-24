# AGENTS.md — `telemetry` service

Guide for coding agents working on the `telemetry` service. Read it fully before making changes. It overrides the root `AGENTS.md` when they conflict. Architecture context: `docs/architecture.md` (accepted ADR) and `backend/core/AGENTS.md` (the other service, which answers this one's NATS requests). Code patterns live in `skills/teamworkflow-nest`; migrations in `skills/teamworkflow-prisma-migrations`.

## What this service is

`telemetry` is the standalone service that owns the WHOLE `attendance` domain: it knows who is present at each site and warns when something fails. It exists apart from `backend/core` because its load is different: high-frequency clock-in ingestion and long-lived real-time connections (Torre de Control) must scale without affecting the rest of the API.

It is one NestJS 12 app with four internal modules: `clock-ins`, `workdays`, `alerts` and `tower`. Keep them separable: a module never reads another module's tables, it calls the other module's exported service.

**Naming note:** the service is called `telemetry`, but the domain, the PostgreSQL schema (`attendance`), the role (`attendance_svc`), the event subjects (`t.<tenant>.attendance.<event>`), the stream (`ATTENDANCE_EVENTS`) and the operation names (`attendance.<resource>.<action>`) keep the name `attendance`. Other docs that say `attendance` mean this service's domain.

Public entrypoints (same public origin as `core`, routed by a reverse proxy; see `docs/architecture.md`):

- HTTP under `/api/v1/telemetry` (clock-in ingestion, corrections, workdays, alerts, tower snapshot).
- Socket.IO WebSocket of the Torre de Control (path `/ws`), moved here from the former gateway.

Responsibilities:

- **clock-ins:** clock events (`in`, `out`, `break_start`, `break_end`) by `gps`, `qr` or `manual`; location check; offline clock events; supervisor corrections with an audit trail.
- **workdays:** one workday per shift with worked minutes, overtime minutes and lateness minutes.
- **alerts:** detection of late arrivals, uncovered posts, out-of-geofence clock events and missing clock-outs, and the alert lifecycle.
- **tower:** the live site summaries, the initial snapshot and the Socket.IO connection for the Torre de Control.
- **HTTP/WebSocket layer:** the guard, actor, role/plan/tenant-status checks, rate limiting and error mapping for the routes above (see HTTP and WebSocket Layer).

Plans: clock-ins and workdays belong to the `basic` plan; alerts and the Torre de Control are `pro` features. The HTTP layer of this service blocks the alert and tower routes (and the WebSocket) of a tenant whose plan lacks the feature (403 `feature_not_in_plan`, from `auth.token.verify`), and the domain ALSO keeps a local copy of the tenant's `features` and skips the pro work for tenants without them (see Plan gating inside the service).

Out of scope (do NOT implement here):

- Sites, employees and shifts: owned by the `organization` module of `core`. This service keeps a local copy of shift data (see Shift data) and never reads its tables.
- Identity, tokens and tenant status: owned by the `auth` module of `core`. This service only verifies tokens through the NATS request `auth.token.verify`.
- Sending notifications: owned by the `notifications` module of `core`, which consumes this service's alert events.
- Routes of other domains (auth, organization, tasks, notifications, billing): served by `core` under `/api/v1`.
- Selfie on clock-in, continuous GPS tracking, configurable thresholds, night hours, holidays, period closing, payroll export, automatic emergency replacement. Future work; ask before adding.

## HTTP and WebSocket Layer

This service has no gateway in front of it, so it applies the same HTTP rules as the HTTP layer of `core` (see `backend/core/AGENTS.md`, section HTTP layer) to its own routes. The code is NOT shared with `core` (separate service); keep behavior equivalent and record any intentional difference here.

- **Actor (non-negotiable):** `{ userId, tenantId, role, siteIds, tenantStatus, plan, features }` is built ONLY from the `auth.token.verify` NATS request answered by `core`. Never read tenant, role, sites, plan or features from the body, query, path or headers. `platform_admin` is refused on every telemetry route (403 `forbidden`).
- **Auth guard:** a global guard runs on every route and on every WebSocket connection, extracts the access token (cookie for web, `Authorization: Bearer` for mobile; same rules as `core`), calls `auth.token.verify` and attaches the actor. Missing token or `invalid_token` answers 401. Never cache the verify result across requests. Telemetry has no public routes.
- **Verify unavailable:** if the NATS request times out or has no responder, answer 504 `upstream_timeout` or 503 `upstream_unavailable`; never let a request through unverified.
- **Cookies, CSRF, CORS:** the access cookie is set by `core`; telemetry only reads it. Cookie-authenticated `POST`, `PUT`, `PATCH` and `DELETE` require the double-submit CSRF header (`X-CSRF-Token`) compared in constant time; bearer requests skip CSRF. CORS and the Socket.IO origin policy allow only `WEB_ORIGIN` with credentials, never `*`.
- **Role checks:** route decorators declare coarse roles (route map below); fine-grained rules (employee only for themselves, supervisor limited to `siteIds`) are enforced in the domain.
- **Plan gating:** `alerts` routes need feature `alerts`; `tower` routes and the WebSocket need `tower`. Otherwise 403 `feature_not_in_plan`.
- **Tenant status:** `suspended` or `cancelled` tenants: `owner` and `admin` have no billing/export route here, so every telemetry route answers 403 `tenant_suspended` / `tenant_cancelled` (matching the status); `supervisor` and `employee` are already rejected by `auth.token.verify`. `active` and `past_due` are unrestricted.
- **Rate limiting:** `@nestjs/throttler`, per user (`userId`) with a generous limit because clock-in ingestion is high frequency; over the limit answers 429 `rate_limited`. Exact numbers are open (see Environment Variables).
- **Error mapping:** a global filter maps errors `{ status, code, message }` to HTTP `{ detail, code }`; unknown errors answer 500 `{ detail: "Internal server error", code: "internal_error" }`; the global `ValidationPipe` answers 422 `validation_error`.
- **Never** log tokens, cookies, `Authorization` headers, QR values, or coordinates together with the employee name.

### Route map (proposed shape, under `/api/v1/telemetry`)

The operation names are the stable contract; the paths are proposed and move from the former gateway route map. "any" means any authenticated tenant role (the domain decides the rest). The documented caller for manual, correct, acknowledge, resolve and snapshot is supervisor/admin; `owner` is also let through (owner can do everything an admin can); confirm if this should change.

| Method + path | Operation | Auth | Feature |
|---|---|---|---|
| `POST /clock-events` | `attendance.clock-event.create` | employee | - |
| `POST /clock-events/manual` | `attendance.clock-event.create-manual` | supervisor, admin | - |
| `PATCH /clock-events/:clockEventId` | `attendance.clock-event.correct` | supervisor, admin | - |
| `GET /clock-events` | `attendance.clock-event.list` | any | - |
| `GET /workdays/:shiftId`, `GET /workdays` | `attendance.workday.get` / `list` | any | - |
| `GET /alerts` | `attendance.alert.list` | any | `alerts` |
| `POST /alerts/:alertId/acknowledge` | `attendance.alert.acknowledge` | supervisor, admin | `alerts` |
| `POST /alerts/:alertId/resolve` | `attendance.alert.resolve` | supervisor, admin | `alerts` |
| `GET /tower/snapshot` | `attendance.tower.snapshot` | supervisor, admin | `tower` |

### Control Tower WebSocket

- Socket.IO through `@nestjs/websockets`, same origin/credentials policy as HTTP, path `/ws`.
- On connection: take the access token, call `auth.token.verify`, require feature `tower` and role `owner`, `admin` or `supervisor`. Otherwise disconnect with a typed error (`invalid_token`, `feature_not_in_plan`, `forbidden`, `tenant_suspended`, `tenant_cancelled`).
- Rooms: one room per allowed site, named `{tenantId}:{siteId}`. Supervisor: the `siteIds` from verify. Owner/admin: every site of the tenant. Never accept room names or site ids from the client. OPEN: the list of all sites of a tenant must come from `core` (a NATS request such as `organization.site.list` is NOT among the responders listed in `docs/architecture.md`; decide whether to add it or derive the sites from local data).
- Initial state: compute `attendance.tower.snapshot` for the actor and send it to the socket (in-process, no hop).
- Live updates: subscribe server-side (once per process, not per socket) to `t.*.attendance.site_summary_updated` and emit each message to the room `{tenantId}:{siteId}` built from the event subject tenant and the payload `siteId`. The browser never talks to NATS. Check that the subject tenant matches the payload `tenantId` before emitting.
- Token expiry: disconnect the socket when the access token expires (use `exp`; do not verify again on a timer); the client reconnects with its refreshed token, which runs verify again.
- Known limitation: a supervisor's site assignment change applies on reconnect, not live.

## Business Rules

### Clock events

1. Types: `in`, `out`, `break_start`, `break_end`. Methods: `gps`, `qr`, `manual`.
2. `gps` and `qr` events are created by the employee from the mobile app (the actor is the employee). `manual` events are created by a supervisor (within their sites) or admin on behalf of an employee, with a mandatory `reason`.
3. Every clock event belongs to a shift. The service finds the employee's non-cancelled shift that matches the site and device time:
   - An `in` matches a shift from 60 minutes BEFORE the shift start until the shift end (constant `CLOCK_IN_EARLY_MINUTES = 60`). Outside that window (too early, or after the shift ended) it answers `no_matching_shift` (404); a supervisor can then add a manual clock event with a reason.
   - An `out`, `break_start` or `break_end` belongs to the shift where the employee has an open `in`; with none it answers `no_matching_shift`.
4. The employee is identified from the actor `userId` through the NATS request `organization.employee.get` (by `userId`) answered by `core`; the result is cached in memory per `(tenantId, userId)`.

### Location check (never reject for location)

The site geofence is a point plus a radius in meters (from `organization.site.get`).

| Situation | Result |
|-----------|--------|
| GPS position inside the radius | Valid |
| The employee scanned the site QR (matches the site `qrCode`) | Valid, even if GPS failed or is missing |
| GPS outside the radius and no valid QR | ACCEPTED, flagged `outOfGeofence = true`, and an `out_of_geofence` alert is opened |
| No GPS and no QR | Rejected as `validation_error` (the app must send one of the two) |
| Wrong QR value | Rejected as `invalid_qr` (422) |

Never reject a clock event because of the location. Distance is computed with the haversine formula; store the computed `distanceMeters`.

### Offline clock events

- The app generates a unique `clientEventId` and sends the device time (`deviceTime`) with each event.
- Duplicates (same tenant and `clientEventId`) are ignored and return the already stored event (idempotent).
- The device time is accepted when the event reaches the server within 24 hours of it. Older events are rejected with `clock_too_old` (422). Store both `deviceTime` and `receivedAt`; calculations use `deviceTime`.

### Supervisor corrections

- A supervisor (within their sites) or admin can correct a clock event (time, type) or add a manual one, always with a mandatory `reason`.
- Corrections are never destructive: the event is updated and a `ClockEventCorrection` row stores the full before and after, the reason, the author and the time.
- Recompute the affected workday and the site summary after every correction.

### Workdays

One `Workday` per shift, recalculated on every clock event, every correction and on `shift_ended`:

- `workedMinutes` = time between each `in` and its following `out`, minus the time between `break_start` and `break_end`.
- `overtimeMinutes` = `max(0, workedMinutes - shiftDurationMinutes)`.
- `lateMinutes` = `max(0, firstIn - shiftStart)`.
- No night hours or holiday logic yet.

**Missing clock-out:** when the shift end + 2 hours (constant `MISSING_CLOCK_OUT_HOURS = 2`) has passed and the employee has an `in` with no matching `out`, the periodic check marks the workday `MISSING_CLOCK_OUT`, counts 0 `workedMinutes` (and 0 overtime) for it and opens a `missing_clock_out` alert for the supervisors of the site. The supervisor adds a manual clock-out (`attendance.clock-event.create-manual`, mandatory `reason`); the recalculation then counts the real minutes, the workday becomes `CLOSED` and the alert resolves automatically. A clock-out sent by the employee that reaches the server AFTER the workday was marked `MISSING_CLOCK_OUT` (for example an offline `out` synced late) is also accepted, as long as it still respects the 24 hour offline rule and the matching rules above (the shift still has its open `in`): it closes the workday, recalculates the minutes and auto-resolves the `missing_clock_out` alert, exactly like the manual one. Until shift end + 2 hours the workday simply stays `OPEN`. The periodic check therefore also covers finished shifts whose workday is still `OPEN`, and it skips suspended tenants like the other checks. An employee whose shift has no `in` at all is not a missing clock-out (that is a `late`/`uncovered_post` case).

### Alerts

Fixed thresholds for now (constants in code, not configurable):

| Type | Opens when | Auto-resolves |
|------|-----------|---------------|
| `late` | The shift has an assigned employee who has no `in` 10 minutes after the shift start | When that employee's `in` arrives |
| `uncovered_post` | Nobody has an `in` for the shift 15 minutes after its start (also when the shift has no employee) | When any `in` arrives |
| `out_of_geofence` | A clock event is accepted outside the geofence | Never automatically |
| `missing_clock_out` | The shift end + 2 hours passed and the employee has an `in` but no `out` | When a clock-out is added (manual by a supervisor, or a late `out` of the employee) |

Lifecycle: `open` → `acknowledged` (by a supervisor of the site or an admin) → `resolved` (manually, or automatically as above). At most one alert per `(shift, type)` for `late`, `uncovered_post` and `missing_clock_out`, and one per clock event for `out_of_geofence` (idempotent creation).

Alerts are a `pro` feature of the tenant's plan; the HTTP layer of this service gates the alert routes and the domain detects them only for tenants whose local `features.alerts` is true (see Plan gating inside the service).

Alerts are triggered from two places: the shift events of `organization` (they keep the local shift copy current) and a periodic check every minute over the shifts in progress. Both must be idempotent.

### Torre de Control (tower)

- On every clock event or alert change, emit `t.<tenant>.attendance.site_summary_updated` with the site summary: `siteId`, `expected` (assigned employees of shifts in progress), `present` (clocked in and not clocked out; a break still counts as present) and `openAlerts` (open or acknowledged alerts).
- This service forwards the event to the Socket.IO room of that site (see Control Tower WebSocket). NATS is never exposed to the browser. The Torre de Control is a `pro` feature: the HTTP layer gates its WebSocket and `attendance.tower.snapshot`, and the service emits `site_summary_updated` only for tenants whose local `features.tower` is true.
- The initial state comes from `attendance.tower.snapshot`, filtered by the actor's sites: owner/admin get every site of the tenant, a supervisor only `siteIds`.

### Shift data

This service needs shift data to match clock events and to evaluate alerts. Decision (simplest consistent approach):

1. Keep a local copy, `ShiftSnapshot`, fed by the `organization` shift events. Events carry a full snapshot, so no callback is needed. The copy is updated only when the incoming `version` is newer than the stored one.
2. On a cache miss (event not yet received, for example a freshly created shift), send the NATS request `organization.shift.get` (answered by `core`) once and store the result.
3. Sites (geofence, QR) are NOT copied: send the NATS request `organization.site.get` (answered by `core`) and cache the answer in memory for a short time; drop the cache entry on `site_updated`.

This keeps the periodic check as local SQL and avoids a request per shift per minute, while a lost event is repaired by the fallback request.

### Plan gating inside the service

Basic-plan tenants have no alerts and no Torre de Control. The HTTP layer blocks the routes, but the automatic work is done in the domain, so the service keeps a local copy of the tenant's `features` (`TenantFeatures`), fed by `t.<tenant>.billing.subscription_created` and `t.<tenant>.billing.plan_changed`:

- The copy is updated only when the event's `effectiveAt` (or `occurredAt` for `subscription_created`) is newer than the stored one; the same event twice is a no-op.
- No copy yet means no pro features (fail closed).
- Without `features.alerts`: no alert detection (neither the periodic check nor the event-driven one) and no alert is opened, including `out_of_geofence` (the clock event is still accepted and flagged). Without `features.tower`: no `site_summary_updated` is emitted.
- Clock events, workdays and the missing clock-out marking of the workday (not its alert) belong to `basic` and keep working.
- On a downgrade, existing alerts stay stored and can still be resolved; nothing new is opened. On an upgrade, detection starts again for shifts still in progress.

### Tenant suspension and cancellation

Consume `t.<tenant>.auth.tenant_suspended` / `tenant_cancelled` / `tenant_reactivated`. While suspended or cancelled, the periodic alert check skips the tenant and no new automatic alerts are opened. Clock events are still stored if they reach the domain (the HTTP layer decides who can call; see Tenant status). Data is kept. On reactivation the check resumes; it opens alerts only for shifts that are still in progress.

### Tenant data purge

Consume `t.<tenant>.billing.data_retention_expired` (emitted 90 days after the tenant was cancelled). It permanently deletes ALL the tenant's data in this service: shift snapshots, clock events and their corrections, workdays, alerts, tenant state, the features copy and processed events. It is idempotent (a second delivery finds nothing and is a no-op), runs in one transaction per table group, and emits nothing.

## Stack

- NestJS 12 over HTTP (`@nestjs/platform-express`) plus `@nestjs/websockets` + `@nestjs/platform-socket.io`; NATS client (`@nestjs/microservices`) for the `auth.token.verify` / `organization.*.get` requests; the JetStream wrapper pattern of `core` for events.
- PostgreSQL + Prisma 7 with its own `prisma/schema.prisma` in the `attendance` schema of the shared `teamworkflow` database, accessed with its own `attendance_svc` role that cannot read other schemas (see `backend/STEPS.md` S1.1). Not installed yet.
- `class-validator` + `class-transformer` with a global `ValidationPipe`. `@nestjs/throttler` for rate limiting. Not installed yet.
- Scheduling for the periodic check (for example `@nestjs/schedule`). Not installed yet.
- Env validation with joi in `src/config/envs.ts`, same pattern as `core`.
- Jest for tests.

Ask before installing any dependency.

## Current Status (READ FIRST)

The folder contains only this `AGENTS.md` and the `README.md`. The `telemetry` service does not exist yet: no `package.json`, no `src/`, no Prisma, no Dockerfile, no entry in `backend/docker-compose.yml`, no reverse-proxy routing. It is built after `backend/core` (task T6 creates `core`; building `telemetry` is planned separately, see `docs/architecture.md` Migration step 4). Port: 3003 (decided in `backend/STEPS.md`).

First tasks, in order (ask before each install):

- [ ] Scaffold the Nest app (HTTP + WebSocket + NATS client, `src/config/envs.ts`, `.env.example`) on port 3003.
- [ ] Prisma schema and first migration (`ShiftSnapshot`, `ClockEvent`).
- [ ] HTTP layer: guard through `auth.token.verify`, actor, role/plan/tenant-status checks, error filter.
- [ ] Modules `clock-ins`, `workdays`, `alerts`, `tower`, with their HTTP controllers and operation-name constants.
- [ ] Consumers of `organization`, `auth` and `billing` events, and the periodic check.
- [ ] Socket.IO Torre de Control (moved from the former gateway design).
- [ ] Add the service to `backend/docker-compose.yml` and the reverse-proxy routes (`/api/v1/telemetry`, `/ws`).

## NATS Contract

Operation names follow `attendance.<resource>.<action>` and carry NO tenant: the tenant comes from the actor. Domain events follow `t.<tenant>.attendance.<event>` (JetStream, snake_case names; stream `ATTENDANCE_EVENTS`).

In `telemetry` the operations below are served by the modules' HTTP controllers (route map above); they are NOT NATS responders. Telemetry answers no NATS requests. Keep the names in constants files (to create: `src/<module>/<module>.patterns.ts`).

Requests this service MAKES to `core` over NATS request-reply (answered by `core`, see `backend/core/AGENTS.md`): `auth.token.verify`, `organization.employee.get`, `organization.site.get`, `organization.shift.get`. These are the only synchronous dependencies on `core`.

### Operations (served over HTTP)

"actor" = `{ userId, tenantId, role, siteIds }` from `auth.token.verify`. Lists return `{ items, total }`.

| Operation | Caller | Payload | Returns |
|---------|--------|---------|---------|
| `attendance.clock-event.create` | HTTP controller (employee) | actor, `clientEventId`, `type`, `method`, `deviceTime`, `latitude`, `longitude`, `qrCode` (optional by method) | stored clock event with `outOfGeofence` |
| `attendance.clock-event.create-manual` | HTTP controller (supervisor/admin) | actor, `employeeId`, `shiftId`, `type`, `time`, `reason` | clock event (also used to add the missing clock-out) |
| `attendance.clock-event.correct` | HTTP controller (supervisor/admin) | actor, `clockEventId`, new `type` / `time`, `reason` | clock event |
| `attendance.clock-event.list` | HTTP controller | actor, filter by `shiftId`, `employeeId`, `siteId`, `page`, `pageSize` | clock events |
| `attendance.workday.get` / `list` | HTTP controller | actor, `shiftId` or filters | workday(s) |
| `attendance.alert.list` | HTTP controller | actor, filter by `siteId`, `status`, `type` | alerts visible to the actor |
| `attendance.alert.acknowledge` | HTTP controller (supervisor/admin) | actor, `alertId` | alert |
| `attendance.alert.resolve` | HTTP controller (supervisor/admin) | actor, `alertId`, optional `note` | alert |
| `attendance.tower.snapshot` | HTTP controller (supervisor/admin) | actor | summaries of the actor's sites with their open alerts |

An `employee` actor can only create clock events for themselves and read their own events and workdays. A supervisor acts only on `siteIds`; resources outside them answer 404.

### Events emitted (JetStream)

| Event subject | Payload |
|---------------|---------|
| `t.<tenant>.attendance.clock_event_recorded` | `eventId`, `tenantId`, `clockEventId`, `shiftId`, `employeeId`, `siteId`, `type`, `method`, `outOfGeofence`, `occurredAt` |
| `t.<tenant>.attendance.clock_event_corrected` | `eventId`, `tenantId`, `clockEventId`, `shiftId`, `actorId`, `occurredAt` |
| `t.<tenant>.attendance.workday_closed` | Named in `docs/architecture.md` (consumed by future reports in `core`). Payload NOT specified yet (gap): define it when the workday close is implemented; at minimum `eventId`, `tenantId`, `workdayId`, `shiftId`, `employeeId`, `siteId`, `occurredAt` |
| `t.<tenant>.attendance.alert_opened` | `eventId`, `tenantId`, `alertId`, `type`, `siteId`, `shiftId`, `employeeId` (nullable), `occurredAt` |
| `t.<tenant>.attendance.alert_acknowledged` | `eventId`, `tenantId`, `alertId`, `siteId`, `actorId`, `occurredAt` |
| `t.<tenant>.attendance.alert_resolved` | `eventId`, `tenantId`, `alertId`, `siteId`, `resolvedBy` (`user` or `system`), `occurredAt` |
| `t.<tenant>.attendance.site_summary_updated` | `eventId`, `tenantId`, `siteId`, `expected`, `present`, `openAlerts`, `occurredAt` |

- `occurredAt` is ISO-8601 UTC. Every event carries a unique `eventId` so consumers deduplicate.
- Emit events only after the database transaction commits. An outbox table is possible future hardening, not a requirement.

### Events consumed (JetStream, durable consumer, explicit ack)

| Event subject | Producer | Handling |
|---------------|----------|----------|
| `t.<tenant>.organization.shift_created` / `shift_updated` / `shift_cancelled` | `organization` (`core`) | Upsert the `ShiftSnapshot` if the `version` is newer. |
| `t.<tenant>.organization.shift_started` / `shift_ended` | `organization` | Update the snapshot status; on `shift_ended` close the workday. |
| `t.<tenant>.organization.shift_starting` | `organization` | Ensure the snapshot exists (fetch on miss). |
| `t.<tenant>.organization.site_updated` | `organization` | Drop the cached site. |
| `t.<tenant>.auth.tenant_suspended` / `tenant_cancelled` / `tenant_reactivated` | `auth` | Pause or resume the periodic check for the tenant. |
| `t.<tenant>.billing.subscription_created` / `plan_changed` | `billing` | Store the tenant's `features` (idempotent, ignore stale events). |
| `t.<tenant>.billing.data_retention_expired` | `billing` | Permanently delete every row of the tenant (idempotent). |

The tenant of a consumed event comes from the subject and is checked against the payload. Handlers are idempotent (deduplicate by `eventId` or by natural key). Errors in an event handler never reach the producer: catch and log them. Consumers of the events emitted above: `core` modules (`notifications` consumes `alert_opened`; future reports consume `clock_event_recorded`, `clock_event_corrected`, `workday_closed`) and this service itself (`site_summary_updated`).

### Errors

Throw errors with `{ status, code, message }` (see `teamworkflow-nest`); the HTTP exception filter of this service maps them to HTTP `{ detail, code }`. Codes owned by the HTTP layer are listed in HTTP and WebSocket Layer: `feature_not_in_plan` (403), `rate_limited` (429), `csrf_invalid` (403), `invalid_token` (401), `tenant_suspended` / `tenant_cancelled` (403), `upstream_timeout` (504), `upstream_unavailable` (503).

| code | status | When |
|------|--------|------|
| `forbidden` | 403 | Role not allowed |
| `no_matching_shift` | 404 | No shift of the employee matches (an `in` outside 60 min before start until shift end, or an `out`/break with no open `in`) |
| `alert_not_found` / `clock_event_not_found` | 404 | Missing or outside tenant or sites |
| `clock_too_old` | 422 | Offline event older than 24 hours |
| `invalid_qr` | 422 | The QR does not match the site |
| `alert_invalid_transition` | 409 | For example resolving an already resolved alert |
| `validation_error` | 422 | DTO validation failed (missing reason, no GPS and no QR, ...) |

## Data Model (Prisma, to create)

Models are PascalCase, fields camelCase, tables plural snake_case through `@@map` / `@map`. Every model has `tenantId`.

- `ShiftSnapshot`: `shiftId`, `tenantId`, `siteId`, `postId`, `employeeId` (nullable), `startsAt`, `endsAt`, `status`, `version`.
- `ClockEvent`: `id`, `tenantId`, `shiftId`, `employeeId`, `siteId`, `type` (`IN` | `OUT` | `BREAK_START` | `BREAK_END`), `method` (`GPS` | `QR` | `MANUAL`), `latitude`, `longitude`, `distanceMeters`, `outOfGeofence`, `clientEventId` (unique per tenant), `deviceTime`, `receivedAt`, `createdByUserId` (null when the employee clocked), `reason` (manual).
- `ClockEventCorrection`: `id`, `tenantId`, `clockEventId`, `before` (json), `after` (json), `reason`, `correctedByUserId`, `createdAt`.
- `Workday`: `id`, `tenantId`, `shiftId` (unique per tenant), `employeeId`, `siteId`, `workedMinutes`, `overtimeMinutes`, `lateMinutes`, `status` (`OPEN` | `CLOSED` | `MISSING_CLOCK_OUT`), `updatedAt`.
- `Alert`: `id`, `tenantId`, `type` (`LATE` | `UNCOVERED_POST` | `OUT_OF_GEOFENCE` | `MISSING_CLOCK_OUT`), `status` (`OPEN` | `ACKNOWLEDGED` | `RESOLVED`), `siteId`, `shiftId`, `employeeId`, `clockEventId` (for geofence alerts), `acknowledgedBy`, `acknowledgedAt`, `resolvedBy`, `resolvedAt`, `createdAt`. Unique `(tenantId, shiftId, type)` for `LATE`, `UNCOVERED_POST` and `MISSING_CLOCK_OUT` (partial unique index) and `(tenantId, clockEventId)` for geofence alerts.
- `TenantState`: `tenantId`, `isSuspended` (true while suspended or cancelled), `updatedAt`. No row means active.
- `TenantFeatures`: `tenantId`, `features` (json), `effectiveAt`. No row means no pro features.
- `ProcessedEvent`: `eventId` (unique), `processedAt`.

Every query filters by `tenantId`. Indexes for the real lookups: clock events by `(tenantId, shiftId, deviceTime)`, shifts in progress by `(status, startsAt)`, alerts by `(tenantId, siteId, status)` (`teamworkflow-postgres`). The periodic check is the only code that reads across tenants; it still works one tenant at a time and skips suspended ones.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NATS_SERVER` | Comma-separated NATS URLs |
| `ATTENDANCE_DATABASE_URL` | PostgreSQL connection string for this service (schema `attendance`, role `attendance_svc`) |
| `PORT` | HTTP and WebSocket port. Default 3003 |
| `WEB_ORIGIN` | Allowed web origin for CORS and Socket.IO (credentials enabled) |
| `NATS_TIMEOUT_MS` | Timeout of the requests to `core`. Initial value: `5000` |
| `RATE_LIMIT_AUTH_TTL_MS` / `RATE_LIMIT_AUTH_LIMIT` | Authenticated routes per user. Values to be defined from expected clock-in traffic |

Thresholds (10 and 15 minutes, 24 hours, 60 minutes before a shift for clock-in, 2 hours after shift end for the missing clock-out) are constants in code for now.

Validate all variables in `src/config/envs.ts` and list them in `.env.example`. Never commit `.env`.

## Security Rules (non-negotiable)

1. `tenantId`, `role` and `siteIds` always come from the verified actor, never from client input.
2. Every query filters by `tenantId`; a test proves tenant isolation.
3. An employee can only create events for their own employee record; a supervisor only for employees of their sites.
4. Corrections and manual events always carry a reason and an audit row.
5. Never log precise coordinates together with the employee name; never log QR values.
6. Never read another service's or module's tables; ask `core` over NATS or consume its events.
7. The actor comes only from `auth.token.verify`; never trust headers, body or query for tenant, role, sites, plan or features. Never return upstream error internals to the client.

## Tests

- Unit tests for every use case with Prisma and the NATS client (requests to `core`) mocked (`pnpm test`).
- Always covered: tenant isolation; supervisor limited to `siteIds` (404 outside); clock-in matching window (accepted at 60 minutes before start and until shift end, `no_matching_shift` before it and after it, manual event added by a supervisor); `out` attached to the shift with an open `in`; missing clock-out (workday marked after shift end + 2 hours with 0 counted minutes, one alert only, manual clock-out recalculates, closes the workday and resolves the alert); inside geofence valid, outside accepted with the flag and an alert, QR valid with failed GPS, wrong QR rejected; duplicate `clientEventId` ignored; `clock_too_old` after 24 hours; correction keeps before/after and requires a reason; workday arithmetic (worked, overtime, late, with breaks); alert thresholds at 10 and 15 minutes, no duplicate alerts, auto-resolve on clock-in, acknowledge/resolve transitions; late employee `out` after `MISSING_CLOCK_OUT` (closes the workday, recalculates and resolves the alert; still `clock_too_old` after 24 hours); site summary emitted on clock events and alert changes; snapshot filtered by actor sites; shift copy only updated by newer versions; suspended and cancelled tenants skipped by the check; plan gating (basic tenant: no alert detection and no `site_summary_updated`; pro tenant: both; `subscription_created`/`plan_changed` idempotent and stale events ignored; downgrade keeps existing alerts); tenant data purge (`data_retention_expired` deletes every row of the tenant, leaves other tenants untouched and is idempotent); idempotent handling of every consumed event.
- HTTP layer (same coverage as the former gateway design, for these routes): guard (no token, invalid token, actor only from the verify result), cookie vs bearer, CSRF, CORS, role decorators, plan gating (`alerts`, `tower`), tenant status, `platform_admin` refused, error mapping (verify timeout 504, no responder 503, validation 422), throttling.
- WebSocket: supervisor joins only its `siteIds`; owner/admin join all sites; a basic-plan tenant or an employee is disconnected; an event for another tenant or site never reaches the room; the socket is disconnected when the access token expires.
- E2E tests (to create in `test/`) once the transport and the database are set up, against a dedicated test database.

## Before Finishing a Task

- [ ] `pnpm lint`, `pnpm test` and `pnpm build` pass.
- [ ] Schema changes come with a reviewed Prisma migration.
- [ ] If you changed a pattern, event or payload, you updated this file, `backend/core/AGENTS.md` and the consuming modules' docs, and called it out in the PR description.
- [ ] No secrets, tokens or personal data in logs, tests or fixtures.
