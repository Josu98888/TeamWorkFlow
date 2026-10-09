# AGENTS.md — `notifications` microservice

Guide for coding agents working on this service. Read it fully before making changes. It overrides the root `AGENTS.md` when they conflict. Code patterns live in `skills/teamworkflow-nest`; migrations in `skills/teamworkflow-prisma-migrations`.

## What this service is

`notifications` delivers messages to people: a push notification to the mobile app (FCM) and an in-app notification stored and listed for the web. It has NO business logic beyond routing: it decides who receives what, renders a template, stores it, sends it and logs the result.

It is one NestJS 12 app with internal modules `push-tokens`, `routing` and `delivery`. In the 16-service target architecture of the root README it may be split later.

Responsibilities:

- Register and unregister the device push tokens of the mobile app.
- Accept sends from any service through the generic event `t.<tenant>.notifications.send`.
- Route domain events from other services to their recipients.
- Store in-app notifications and expose list, unread count and mark-as-read for the web.
- Deliver push notifications through FCM, log every send and retry failures up to 3 times.

Out of scope (do NOT implement here):

- Email, SMS and WhatsApp. Future work. This is consistent with `auth`: invitation and reset links are copied by the admin, never sent.
- Business rules of any domain (what is late, what is overdue): owned by the producing service. This service only maps "event X goes to recipients Y with template Z".
- User, role and site data: owned by `auth` and `organization`. This service never reads their tables.
- User notification preferences, quiet hours, digests, complex backoff or dead-letter processing. Future work; ask before adding.

## Business Rules

### Channels

1. **Push (FCM):** to every active device token of the recipient.
2. **In-app:** every notification is stored as a `Notification` row for the recipient and listed by the web. The in-app row is created even when the user has no push token.
3. No other channel exists.

### Generic send

`t.<tenant>.notifications.send` is the way any service asks for a notification:

- Payload: `eventId`, `tenantId`, `recipientUserIds` (list), `templateCode`, `data` (key-value used by the template), `occurredAt`.
- Examples of producers: `billing` sending its payment notices (see below), or any service with a one-off message.
- An unknown `templateCode` is logged and acknowledged without sending (never retried forever).
- Idempotent per `eventId`. Producers that re-run jobs (like `billing`) use a deterministic `eventId` per notice so a re-run never sends twice.

**Billing notices.** `billing` resolves the recipients itself (`auth.user.list-recipients` for `owner` and `admin`) and publishes `notifications.send` with these template codes:

| Template code | When (decided by `billing`) | `data` |
|---------------|-----------------------------|--------|
| `billing_invoice_issued` | An invoice is issued | `invoiceId`, `period`, `total`, `dueDate` |
| `billing_due_soon` | 3 days before the due date | `invoiceId`, `total`, `dueDate` |
| `billing_overdue_notice` | Days 1, 4 and 6 of delay | `invoiceId`, `total`, `delayDay` |
| `billing_suspended` | Day 7 of delay, the subscription is suspended | `invoiceId` |
| `billing_data_deletion_warning` | 7 days before the data of a cancelled tenant is deleted | `deletionDate` |

These are plain generic sends: there is no domain-event route for them in this service. Amounts in `data` are decimal strings.

### Templates and language

- Templates live in code (`src/templates`), keyed by `(templateCode, locale)`, and each renders `title` and `body` from `data`.
- Today there is ONE locale, `es` (Spanish), exposed as the constant `DEFAULT_LOCALE`. Every template is written in Spanish.
- The `locale` is part of the template key and of the stored `Notification` row, so more languages can be added later (new templates, and a way to choose the locale per user or tenant) WITHOUT changing the data model. Until a locale selection exists, always render with `DEFAULT_LOCALE`.
- A template that does not exist for a locale falls back to `DEFAULT_LOCALE`.

### Routing from domain events

The service consumes events of other services and maps them to recipients and a template code:

| Event | Recipients | Template code |
|-------|------------|---------------|
| `t.<tenant>.attendance.alert_opened` | Supervisors of the alert's site | `attendance_alert_opened` |
| `t.<tenant>.tasks.task_assigned` | The assigned employee (only when `employeeId` is present) | `task_assigned` |
| `t.<tenant>.notifications.send` from `billing` | The `recipientUserIds` that `billing` sends | `billing_invoice_issued`, `billing_due_soon`, `billing_overdue_notice`, `billing_suspended`, `billing_data_deletion_warning` |

Adding a route is a code change in the `routing` module with its test; routes are not configurable by tenants.

Plan gating: alert routing is a `pro` feature. The service keeps a local copy of the tenant's `features` (`TenantFeatures`), fed by `t.<tenant>.billing.subscription_created` and `t.<tenant>.billing.plan_changed` (idempotent; an event older than the stored `effectiveAt`, or `occurredAt` for `subscription_created`, is ignored; no copy yet means no pro features). The `attendance_alert_opened` route is acknowledged and dropped for a tenant without `features.alerts`. The gateway still blocks the routes; this only stops the automatic work. Task and billing sends are not affected by the copy (`task_assigned` is only emitted by `tasks` for tenants that have the feature).

### Recipient resolution (decision)

The service does not own users, roles or site scope, so it asks the owner at the time it routes:

- **Supervisors of a site and owners/admins of a tenant:** request `auth.user.list-recipients` (internal service call, see NATS Contract) with `tenantId`, `roles` and optional `siteId`. `auth` owns roles and the `user_sites` assignments.
- **An employee as recipient:** the event carries `employeeId`; request `organization.employee.get` by `employeeId` to obtain the `userId`.
- Nothing is cached beyond the processing of one event: assignments and roles change without events, so a stale copy would notify the wrong people. Revisit only if the request volume proves to be a problem.
- If the owner service does not answer, the event is NOT acknowledged and is redelivered by JetStream; processing is idempotent so redelivery is safe.

`auth.user.list-recipients` is part of the `auth` contract (internal services only, never the gateway); it must exist in `auth` before the routing of `alert_opened` can work.

### Delivery log and retries

- Every send is logged in `NotificationDelivery` with status `pending`, `sent` or `failed`, the number of attempts and the last error (never the token).
- A failed push is retried up to 3 attempts in total, by a job every minute that picks failed deliveries with fewer than 3 attempts. No exponential backoff, no dead-letter queue. After the third failure the delivery stays `failed`.
- An FCM answer that says the token is invalid or unregistered deactivates that token; it is not retried.
- A delivery of channel `in_app` is `sent` as soon as the row exists.

### Device tokens

- The app registers its token with `notifications.push-token.register` (`token`, `platform`) and removes it with `notifications.push-token.unregister`. Registering an existing token reassigns it to the current user (a device changes hands) and reactivates it.
- A user can have many tokens (several devices).
- The actor is always the owner of the token; one user cannot register or remove another user's token.

### In-app notifications

- List the actor's own notifications paginated, newest first; count the unread ones; mark one or all as read. A user only sees their own.

### Tenant suspension and cancellation

Consume `t.<tenant>.auth.tenant_suspended` / `tenant_cancelled` / `tenant_reactivated`. While a tenant is suspended or cancelled, no new automatic sends happen for it: routed events and generic sends are acknowledged and dropped, and the retry job skips its pending deliveries. Decision: generic sends whose `templateCode` starts with `billing_` are still delivered in both states, because `owner` and `admin` can log in to pay or resubscribe, `billing_suspended` is sent right when the suspension starts and `billing_data_deletion_warning` is sent to a cancelled tenant. Data is kept. On reactivation the retry job resumes the pending deliveries that have attempts left.

### Tenant data purge

Consume `t.<tenant>.billing.data_retention_expired` (emitted 90 days after the tenant was cancelled). It permanently deletes ALL the tenant's data in this service: device tokens, notifications, deliveries, tenant state, features copy and processed events. It is idempotent (a second delivery finds nothing and is a no-op) and emits nothing.

## Stack

- NestJS 12 microservice over NATS (`@nestjs/microservices`).
- PostgreSQL + Prisma 7 with its own `prisma/schema.prisma` in the `notifications` schema of the shared `teamworkflow` database, accessed with its own `notifications_svc` role that cannot read other schemas (see `backend/STEPS.md` S1.1). Not installed yet.
- FCM through the Firebase Admin SDK (`firebase-admin`). Not installed yet.
- `class-validator` + `class-transformer` with a global `ValidationPipe` throwing `RpcException`. Not installed yet.
- Scheduling for the retry job (for example `@nestjs/schedule`). Not installed yet.
- Env validation with joi in `src/config/envs.ts`, same pattern as the gateway.
- Jest for tests.

Ask before installing any dependency.

## Current Status (READ FIRST)

The folder contains only this `AGENTS.md` and the `README.md`. There is no Nest app yet: no `package.json`, no `src/`, no Prisma, no Dockerfile, no entry in `backend/docker-compose.yml`.

First tasks, in order (ask before each install):

- [ ] Scaffold the Nest app (microservice bootstrap with `Transport.NATS`, `src/config/envs.ts`, `.env.example`).
- [ ] Prisma schema and first migration (`DeviceToken`, `Notification`, `NotificationDelivery`).
- [ ] Device token and in-app notification request-reply handlers.
- [ ] Generic send consumer and routing for the three events above.
- [ ] FCM integration and the retry job.
- [ ] Make sure `auth.user.list-recipients` is implemented in `auth` (it is already in the `auth` contract).
- [ ] Add the service to `backend/docker-compose.yml` and the gateway routes.

## NATS Contract

Request-reply patterns follow `notifications.<resource>.<action>` and carry NO tenant in the subject: the tenant comes from the actor. Domain events follow `t.<tenant>.<service>.<event>` (JetStream, snake_case names). Keep the pattern names in constants files (to create: `src/<module>/<module>.patterns.ts`) and keep the gateway side in sync.

### Request-reply (`@MessagePattern`)

"actor" = `{ userId, tenantId, role, siteIds }` from `auth.token.verify`. Lists return `{ items, total }`.

| Pattern | Caller | Payload | Returns |
|---------|--------|---------|---------|
| `notifications.push-token.register` | gateway (mobile app) | actor, `token`, `platform` (`android` \| `ios`) | `{ ok: true }` |
| `notifications.push-token.unregister` | gateway (mobile app) | actor, `token` | `{ ok: true }` |
| `notifications.notification.list` | gateway (web) | actor, `unreadOnly`, `page`, `pageSize` | the actor's notifications |
| `notifications.notification.unread-count` | gateway (web) | actor | `{ count }` |
| `notifications.notification.mark-read` | gateway (web) | actor, `notificationId` or `all: true` | `{ ok: true }` |

### Requests this service makes to other services

| Pattern | Owner | Payload | Returns |
|---------|-------|---------|---------|
| `auth.user.list-recipients` | `auth` | `tenantId`, `roles`, optional `siteId` | `{ userIds }` of active users; for supervisors only those assigned to `siteId` |
| `organization.employee.get` | `organization` | `tenantId`, `employeeId` | employee with `userId` |

These are service-to-service calls without a user actor, so they carry an explicit `tenantId` taken from the subject of the consumed event, never from a client.

### Events emitted

None. Delivery results are logged in the database. Add events only when another service needs them.

### Events consumed (JetStream, durable consumer, explicit ack)

| Event subject | Producer | Handling |
|---------------|----------|----------|
| `t.<tenant>.notifications.send` | any service (for example `billing`) | Generic send (see Business Rules). |
| `t.<tenant>.attendance.alert_opened` | `attendance` | Notify supervisors of the site. |
| `t.<tenant>.tasks.task_assigned` | `tasks` | Notify the assigned employee. |
| `t.<tenant>.auth.tenant_suspended` / `tenant_cancelled` / `tenant_reactivated` | `auth` | Pause or resume sends for the tenant. |
| `t.<tenant>.billing.subscription_created` / `plan_changed` | `billing` | Store the tenant's `features` (idempotent, ignore stale events). |
| `t.<tenant>.billing.data_retention_expired` | `billing` | Permanently delete every row of the tenant (idempotent). |

The tenant of a consumed event comes from the subject and is checked against the payload. Handlers are idempotent (deduplicate by `eventId` in `ProcessedEvent`): the same event twice never produces two notifications. Errors in an `@EventPattern` handler never reach the producer: catch and log them, and let JetStream redeliver only when a retry is meaningful.

### Errors

Throw `RpcException` with `{ status, code, message }` (see `teamworkflow-nest`). The gateway maps it to HTTP `{ detail, code }`.

| code | status | When |
|------|--------|------|
| `notification_not_found` | 404 | The notification does not exist or is not the actor's |
| `invalid_push_token` | 422 | Token empty or malformed |
| `validation_error` | 422 | DTO validation failed |

## Data Model (Prisma, to create)

Models are PascalCase, fields camelCase, tables plural snake_case through `@@map` / `@map`. Every model has `tenantId`.

- `DeviceToken`: `id`, `tenantId`, `userId`, `token` (unique), `platform` (`ANDROID` | `IOS`), `isActive`, `lastSeenAt`, `createdAt`.
- `Notification`: `id`, `tenantId`, `userId`, `templateCode`, `locale` (default `es`), `title`, `body`, `data` (json), `readAt`, `sourceEventId`, `createdAt`. Unique `(tenantId, userId, sourceEventId)` so a redelivered event does not duplicate it.
- `NotificationDelivery`: `id`, `tenantId`, `notificationId`, `channel` (`PUSH` | `IN_APP`), `status` (`PENDING` | `SENT` | `FAILED`), `attempts`, `lastError`, `lastAttemptAt`, `sentAt`.
- `TenantState`: `tenantId`, `isSuspended` (true while suspended or cancelled), `updatedAt`. No row means active.
- `TenantFeatures`: `tenantId`, `features` (json), `effectiveAt`. No row means no pro features.
- `ProcessedEvent`: `eventId` (unique), `processedAt`.

Templates live in code (`src/templates`), keyed by `(templateCode, locale)`, each rendering `title` and `body` from `data` (see Templates and language). Every query filters by `tenantId`. Indexes for the real lookups: notifications by `(tenantId, userId, createdAt)`, unread by `(tenantId, userId, readAt)`, deliveries by `(status, attempts)` for the retry job (`teamworkflow-postgres`). The retry job is the only code that reads across tenants; it works one tenant at a time and skips suspended ones.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NATS_SERVER` | Comma-separated NATS URLs |
| `DATABASE_URL` | PostgreSQL connection string for this service |
| `FCM_PROJECT_ID` | Firebase project id |
| `FCM_CREDENTIALS` | Service account credentials (path or base64 JSON; never committed) |

Validate all of them in `src/config/envs.ts` and list them in `.env.example`. Never commit `.env` or credentials.

## Security Rules (non-negotiable)

1. `tenantId` and `userId` always come from the verified actor or the consumed event, never from client input.
2. Every query filters by `tenantId`; a test proves tenant isolation.
3. A user only lists, counts and marks as read their own notifications, and only manages their own tokens.
4. Never log push tokens, FCM credentials or notification bodies with personal data.
5. A token is never returned by any endpoint.
6. Never read another service's tables; ask over NATS.

## Tests

- Unit tests for every use case with Prisma, `ClientProxy` and the FCM client mocked (`pnpm test`).
- Always covered: tenant isolation; a user cannot see or mark another user's notifications; token register (reassign and reactivate) and unregister; generic send with recipients and unknown template; each route resolving recipients correctly (supervisors of the site only, assigned employee, owner and admins); in-app row created without tokens; delivery log `pending`/`sent`/`failed`; retry up to 3 attempts and then stop; invalid FCM token deactivated; suspended and cancelled tenant sends dropped and retries paused; plan gating (alert routing dropped for a tenant without `features.alerts`, working with it; `subscription_created`/`plan_changed` idempotent and stale events ignored); tenant data purge (`data_retention_expired` deletes every row of the tenant, leaves other tenants untouched and is idempotent); idempotent handling of every consumed event (no duplicate notification); each `billing_*` template (including `billing_data_deletion_warning`) rendering in Spanish with its `data`; templates rendered with the `es` locale stored on the notification and the fallback to `DEFAULT_LOCALE`; `billing_*` sends delivered while the tenant is suspended or cancelled.

- E2E tests (to create in `test/`) once the transport and the database are set up, against a dedicated test database.

## Before Finishing a Task

- [ ] `pnpm lint`, `pnpm test` and `pnpm build` pass.
- [ ] Schema changes come with a reviewed Prisma migration.
- [ ] If you changed a pattern, event or payload, you updated this file, the gateway and the producing services' docs, and called it out in the PR description.
- [ ] No tokens, credentials or personal data in logs, tests or fixtures.
