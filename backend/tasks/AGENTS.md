# AGENTS.md — `tasks` microservice

Guide for coding agents working on this service. Read it fully before making changes. It overrides the root `AGENTS.md` when they conflict. Code patterns live in `skills/teamworkflow-nest`; migrations in `skills/teamworkflow-prisma-migrations`.

## What this service is

`tasks` owns the work that employees must do and prove: configurable forms, the tasks that use them, supervisor review, and the photos attached to answers. It is one NestJS 12 app with three internal modules: `forms`, `tasks` and `media`. In the 16-service target architecture of the root README these may be split later, so keep modules separable: a module never reads another module's tables, it calls the other module's exported service.

Responsibilities:

- **forms:** form definitions with typed fields, draft editing and immutable published versions.
- **tasks:** single tasks and per-shift tasks, claiming of site/post tasks, answers (including offline ones), expiration, cancellation with the shift and supervisor review.
- **media:** presigned uploads of photos to S3-compatible storage and their metadata.

Plans: tasks and forms are a `pro` feature. The gateway blocks every `tasks.*` route of a tenant whose plan lacks the `tasks` feature (403 `feature_not_in_plan`, from `auth.token.verify`), and this service ALSO keeps a local copy of the tenant's `features` and refuses or skips the pro work for tenants without it (see Plan gating inside the service).

Out of scope (do NOT implement here):

- Sites, employees, shifts: owned by `organization`. `tasks` asks it over NATS and reacts to its events.
- Notifications: owned by `notifications`, which consumes `task_assigned`, `task_completed` and `task_expired`.
- Clock-ins and alerts: owned by `attendance`.
- Thumbnails, automatic retention or deletion of photos, video, document uploads. Future work; ask before adding.

## Business Rules

### Forms

1. Field types: `text`, `number`, `yes_no`, `select`, `checklist`, `photo`, `qr`. Each field has a stable `key`, a `label`, a `required` flag and type-specific options (`select`/`checklist` have a list of options; `number` can have min/max).
2. A form is a `draft` while editable. Publishing freezes an immutable `FormVersion` (number 1, 2, ...) and the draft keeps being editable for the next version. Published versions are never modified or deleted.
3. Tasks and answers reference the `FormVersion` they used, so changing a form never alters past answers.
4. Only `owner` and `admin` manage forms.

### Tasks

1. Two kinds:
   - **single:** has a `deadline`, a published form version, and is assigned either to an employee, or to a site/post (see Site/post tasks and claiming).
   - **per-shift:** generated automatically when `t.<tenant>.organization.shift_started` arrives, for the shift's post, from a task template (see below). It is assigned to the shift's employee and linked to the `shiftId`, and its deadline is the shift end by default.
2. States: `pending`, `completed`, `expired`, `cancelled`. A job marks as `expired` the `pending` tasks whose deadline passed. `cancelled` is set only when the shift of a per-shift task is cancelled (see Shift cancellation). `completed`, `expired` and `cancelled` are final.
3. Per-shift generation is idempotent per `(shiftId, templateId)`: the same `shift_started` event twice creates one task. If the shift has no employee, the task is created assigned to the site/post.
4. A task template links `(siteId, postId)` with a published form version and a deadline rule (minutes after shift start, or the shift end). Only `owner` and `admin` manage them.
5. If the task defines an `expectedQr`, the answer to a `qr` field must match it; otherwise the answer is rejected with `qr_mismatch` (422).
6. Completing a task requires all `required` fields answered and valid for their type. Answering an `expired`, `cancelled` or already `completed` task answers `task_not_open` (409).

### Site/post tasks and claiming

A task with no `employeeId` (assigned to a site/post: a single task created that way, or a per-shift task of a shift with no employee) can be completed by ANY employee who has a shift `in_progress` at that site and post:

1. The employee claims it with `tasks.task.claim`, or simply answers it: `tasks.task.answer` on an unassigned task claims and completes it in the same transaction.
2. The service resolves the employee (`organization.employee.get` by `userId`) and checks, over NATS (`organization.shift.list` filtered by `employeeId` and `day`), that the employee has a shift with status `in_progress` whose `siteId` and `postId` match the task. Otherwise `no_shift_in_progress` (403).
3. The FIRST claim wins: the update is a compare-and-set (`employeeId` is null and status `pending`), and that employee becomes the assignee. Any other employee then gets `task_already_claimed` (409) and can no longer complete it.
4. A claim never changes the deadline or the state; only the assignee can answer from then on.
5. Claim and answer are idempotent for the same employee (claiming a task you already hold succeeds).

### Shift cancellation

On `t.<tenant>.organization.shift_cancelled`, every `pending` per-shift task of that shift becomes `cancelled`. `completed` tasks are untouched (their answers stay), and `expired` ones too. The handler is idempotent (a second delivery matches nothing) and applies to claimed and unclaimed tasks alike. Cancelled tasks are not listed as pending and the expiration job ignores them.

### Supervisor review

- After completion a supervisor (only for tasks of their sites) or admin reviews the answer: `approved` or `observed` (with a mandatory note). A task starts with review `none`.
- Review never changes the task state; it is recorded on the answer with reviewer and time.

### Offline answers

Same rule as attendance: the app sends a client-generated unique `clientAnswerId` and the device time. Duplicates are ignored and return the stored answer. Device time is accepted when the answer reaches the server within 24 hours; older answers are rejected with `answer_too_old` (422). Note an answer received after the deadline but with a device time before the deadline is accepted and the task is completed, not expired, as long as it is within 24 hours.

### Photos and storage

1. Storage is S3-compatible (MinIO locally). The service never receives the file bytes.
2. Flow: the app calls `tasks.media.request-upload` with `mime`, `sizeBytes`, `sha256` and `takenAt`; the service validates the limits, creates a `Media` row (`pending`) and returns `{ mediaId, uploadUrl, expiresAt }` with a presigned PUT URL. The app uploads directly to storage and then submits the answer with the `mediaId` in the `photo` field.
3. When the answer is submitted, the service checks that each referenced media belongs to the tenant, was requested by the same user, and the object exists with the declared size; then marks it `uploaded`. Otherwise `media_not_uploaded` (422).
4. Limits: 10 MB, `image/jpeg`, `image/png`, `image/webp`. Rejected otherwise (`media_too_large`, `media_type_not_allowed`, 422).
5. Stored metadata: `mime`, `sizeBytes`, `sha256`, `takenAt`, `uploadedByUserId`, `storageKey`. Storage keys start with the tenant (`<tenantId>/...`) and are never guessable or returned as public URLs. Reads go through short-lived presigned GET URLs (`tasks.media.get-url`), checked against the actor's tenant and sites.
6. No thumbnails and no automatic retention yet (future).

### Plan gating inside the service

Basic-plan tenants have no tasks. The gateway blocks the routes, but the automatic work is done here, so the service keeps a local copy of the tenant's `features` (`TenantFeatures`), fed by `t.<tenant>.billing.subscription_created` and `t.<tenant>.billing.plan_changed`:

- The copy is updated only when the event's `effectiveAt` (or `occurredAt` for `subscription_created`) is newer than the stored one; the same event twice is a no-op.
- No copy yet means no pro features (fail closed).
- Without `features.tasks`: `tasks.task.create` (and the creation of forms and task templates) answers `feature_not_in_plan` (403), and `shift_started` generates NO per-shift tasks (the event is acknowledged).
- On a downgrade, existing forms, tasks and photos are kept and stay readable; nothing new is created. The expiration job keeps running for the tasks that are still `pending`. On an upgrade, generation starts again with the next `shift_started`.

### Tenant suspension and cancellation

Consume `t.<tenant>.auth.tenant_suspended` / `tenant_cancelled` / `tenant_reactivated`. While suspended or cancelled: per-shift generation and the expiration job skip the tenant; incoming shift events for it are acknowledged without creating tasks. Data is kept. After reactivation the expiration job resumes and expires what is overdue.

### Tenant data purge

Consume `t.<tenant>.billing.data_retention_expired` (emitted 90 days after the tenant was cancelled). It permanently deletes ALL the tenant's data in this service: first the stored photos (every object under the `<tenantId>/` prefix of the bucket, listed and deleted in batches), then the database rows (media, answers, tasks, templates, form versions and forms, tenant state, features copy and processed events). Photos go first so the `Media` rows stay as the record of what is left if the storage call fails: in that case the event is not acknowledged and JetStream redelivers it. It is idempotent (a second delivery finds no objects and no rows and is a no-op) and emits nothing.

## Roles in this service

| Action | owner / admin | supervisor | employee |
|--------|:-------------:|:----------:|:--------:|
| Manage forms and task templates | ✅ | ❌ | ❌ |
| Create single tasks | ✅ | ✅ only `siteIds` | ❌ |
| Review answers | ✅ | ✅ only `siteIds` | ❌ |
| List and read tasks | ✅ all | ✅ only `siteIds` | own tasks |
| Answer a task, request photo uploads | ❌ | ❌ | ✅ own tasks, or a site/post task after claiming it while on a shift in progress there |
| Claim a site/post task | ❌ | ❌ | ✅ only with a shift in progress at that site/post |

The actor (`userId`, `tenantId`, `role`, `siteIds`) comes from the gateway, which got it from `auth.token.verify`. Resources outside the actor's tenant or sites answer 404 (never 403). The employee of an actor is resolved through `organization.employee.get` by `userId`.

## Stack

- NestJS 12 microservice over NATS (`@nestjs/microservices`).
- PostgreSQL + Prisma 7 with its own `prisma/schema.prisma` (whether it shares a database with other services is decided later). Not installed yet.
- S3-compatible client for presigned URLs (for example `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) against MinIO locally. Not installed yet.
- `class-validator` + `class-transformer` with a global `ValidationPipe` throwing `RpcException`. Not installed yet.
- Scheduling for the expiration job (for example `@nestjs/schedule`). Not installed yet.
- Env validation with joi in `src/config/envs.ts`, same pattern as the gateway.
- Jest for tests.

Ask before installing any dependency.

## Current Status (READ FIRST)

The folder contains only this `AGENTS.md` and the `README.md`. There is no Nest app yet: no `package.json`, no `src/`, no Prisma, no Dockerfile, no MinIO container, no entry in `backend/docker-compose.yml`.

First tasks, in order (ask before each install):

- [ ] Scaffold the Nest app (microservice bootstrap with `Transport.NATS`, `src/config/envs.ts`, `.env.example`).
- [ ] Prisma schema and first migration (`Form`, `FormVersion`).
- [ ] Modules `forms`, `tasks`, `media`, with their patterns constants.
- [ ] Consumers of `organization` and `auth` events and the expiration job.
- [ ] MinIO in `backend/docker-compose.yml` and the gateway routes.

## NATS Contract

Request-reply patterns follow `tasks.<resource>.<action>` and carry NO tenant in the subject: the tenant comes from the actor. Domain events follow `t.<tenant>.tasks.<event>` (JetStream, snake_case names). Keep the pattern names in constants files (to create: `src/<module>/<module>.patterns.ts`) and keep the gateway side in sync.

### Request-reply (`@MessagePattern`)

"actor" = `{ userId, tenantId, role, siteIds }` from `auth.token.verify`. Lists return `{ items, total }`.

| Pattern | Caller | Payload | Returns |
|---------|--------|---------|---------|
| `tasks.form.create` / `update` | gateway (owner/admin) | actor, `name`, `fields` (and `formId` on update, draft only) | form (draft) |
| `tasks.form.publish` | gateway (owner/admin) | actor, `formId` | new `FormVersion` |
| `tasks.form.get` / `list` | gateway | actor, `formId` / filters | form with its versions / forms |
| `tasks.task-template.create` / `update` / `list` | gateway (owner/admin) | actor, `siteId`, `postId`, `formVersionId`, deadline rule | template / templates |
| `tasks.task.create` | gateway (owner/admin/supervisor) | actor, `formVersionId`, `deadline`, `employeeId` or `siteId` + `postId`, optional `expectedQr` | task |
| `tasks.task.get` / `list` | gateway | actor, `taskId` / filters (`status`, `employeeId`, `siteId`), `page`, `pageSize` | task(s) |
| `tasks.task.claim` | gateway (employee) | actor, `taskId` | task with the employee as assignee |
| `tasks.task.answer` | gateway (employee) | actor, `taskId`, `clientAnswerId`, `deviceTime`, `answers` | completed task (claims an unassigned site/post task first) |
| `tasks.task.review` | gateway (owner/admin/supervisor) | actor, `taskId`, `result` (`approved` \| `observed`), `note` | task |
| `tasks.media.request-upload` | gateway (employee) | actor, `mime`, `sizeBytes`, `sha256`, `takenAt` | `{ mediaId, uploadUrl, expiresAt }` |
| `tasks.media.get-url` | gateway | actor, `mediaId` | `{ url, expiresAt }` |

### Events emitted (JetStream)

| Event subject | Payload |
|---------------|---------|
| `t.<tenant>.tasks.task_assigned` | `eventId`, `tenantId`, `taskId`, `employeeId` (nullable), `siteId`, `postId`, `shiftId` (nullable), `title`, `deadline`, `occurredAt` |
| `t.<tenant>.tasks.task_completed` | `eventId`, `tenantId`, `taskId`, `employeeId`, `siteId`, `occurredAt` |
| `t.<tenant>.tasks.task_expired` | `eventId`, `tenantId`, `taskId`, `employeeId` (nullable), `siteId`, `occurredAt` |

- `occurredAt` is ISO-8601 UTC. Every event carries a unique `eventId` so consumers deduplicate.
- Emit events only after the database transaction commits. An outbox table is possible future hardening, not a requirement.

### Events consumed (JetStream, durable consumer, explicit ack)

| Event subject | Producer | Handling |
|---------------|----------|----------|
| `t.<tenant>.organization.shift_started` | `organization` | Generate the per-shift tasks of the shift's post (idempotent). |
| `t.<tenant>.organization.shift_cancelled` | `organization` | Cancel the `pending` per-shift tasks of that shift (idempotent). |
| `t.<tenant>.auth.tenant_suspended` / `tenant_cancelled` / `tenant_reactivated` | `auth` | Pause or resume generation and expiration for the tenant. |
| `t.<tenant>.billing.subscription_created` / `plan_changed` | `billing` | Store the tenant's `features` (idempotent, ignore stale events). |
| `t.<tenant>.billing.data_retention_expired` | `billing` | Delete the tenant's photos in S3 and every row of the tenant (idempotent). |

The tenant of a consumed event comes from the subject and is checked against the payload. Handlers are idempotent (deduplicate by `eventId` or by natural key). Errors in an `@EventPattern` handler never reach the producer: catch and log them.

### Errors

Throw `RpcException` with `{ status, code, message }` (see `teamworkflow-nest`). The gateway maps it to HTTP `{ detail, code }`.

| code | status | When |
|------|--------|------|
| `forbidden` | 403 | Role not allowed |
| `feature_not_in_plan` | 403 | The tenant's plan lacks the `tasks` feature (creating tasks, forms or templates) |
| `form_not_found` / `task_not_found` / `media_not_found` | 404 | Missing or outside tenant or sites |
| `form_not_published` | 409 | Creating a task with an unpublished form |
| `task_not_open` | 409 | Answering or claiming an expired, cancelled or completed task |
| `task_already_claimed` | 409 | Another employee claimed the site/post task first |
| `no_shift_in_progress` | 403 | The employee has no shift in progress at the task's site/post |
| `qr_mismatch` | 422 | QR answer differs from the expected QR |
| `answer_too_old` | 422 | Offline answer older than 24 hours |
| `media_too_large` / `media_type_not_allowed` / `media_not_uploaded` | 422 | Photo limits or missing object |
| `validation_error` | 422 | DTO or answer validation failed |

## Data Model (Prisma, to create)

Models are PascalCase, fields camelCase, tables plural snake_case through `@@map` / `@map`. Every model has `tenantId`.

- `Form`: `id`, `tenantId`, `name`, `draftFields` (json), `createdBy`, timestamps.
- `FormVersion`: `id`, `tenantId`, `formId`, `version`, `name`, `fields` (json, immutable), `publishedAt`, `publishedBy`. Unique `(formId, version)`.
- `TaskTemplate`: `id`, `tenantId`, `siteId`, `postId`, `formVersionId`, `deadlineMode` (`AFTER_START` | `AT_SHIFT_END`), `deadlineMinutes`, `isActive`.
- `Task`: `id`, `tenantId`, `kind` (`SINGLE` | `PER_SHIFT`), `status` (`PENDING` | `COMPLETED` | `EXPIRED` | `CANCELLED`), `formVersionId`, `title`, `deadline`, `employeeId` (nullable until someone claims a site/post task), `claimedAt` (nullable), `siteId`, `postId`, `shiftId` (nullable), `templateId` (nullable), `expectedQr` (nullable), `createdBy` (null for generated). Unique `(tenantId, shiftId, templateId)` for generated tasks.
- `TaskAnswer`: `id`, `tenantId`, `taskId` (unique), `formVersionId`, `answers` (json), `clientAnswerId` (unique per tenant), `deviceTime`, `receivedAt`, `submittedByUserId`, `reviewResult` (`NONE` | `APPROVED` | `OBSERVED`), `reviewNote`, `reviewedBy`, `reviewedAt`.
- `Media`: `id`, `tenantId`, `storageKey`, `mime`, `sizeBytes`, `sha256`, `takenAt`, `uploadedByUserId`, `status` (`PENDING` | `UPLOADED`), `createdAt`.
- `TenantState`: `tenantId`, `isSuspended` (true while suspended or cancelled), `updatedAt`. No row means active.
- `TenantFeatures`: `tenantId`, `features` (json), `effectiveAt`. No row means no pro features.
- `ProcessedEvent`: `eventId` (unique), `processedAt`.

Every query filters by `tenantId`. Indexes for the real lookups: tasks by `(tenantId, employeeId, status)`, by `(tenantId, siteId, status)` and by `(status, deadline)` for the expiration job (`teamworkflow-postgres`). The expiration job is the only code that reads across tenants; it works one tenant at a time and skips suspended ones.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NATS_SERVER` | Comma-separated NATS URLs |
| `DATABASE_URL` | PostgreSQL connection string for this service |
| `S3_ENDPOINT` | Storage endpoint (MinIO URL locally) |
| `S3_REGION` | Storage region |
| `S3_BUCKET` | Bucket for photos |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Storage credentials |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO |
| `MEDIA_URL_TTL_SECONDS` | Presigned URL lifetime. Default `300` |

Validate all of them in `src/config/envs.ts` and list them in `.env.example`. Never commit `.env`.

## Security Rules (non-negotiable)

1. `tenantId`, `role` and `siteIds` always come from the verified actor, never from client input.
2. Every query filters by `tenantId`; a test proves tenant isolation.
3. Storage keys are namespaced by tenant; presigned URLs are short-lived and issued only after checking the actor's tenant and sites.
4. Never log storage credentials, presigned URLs or answer contents.
5. An employee only answers tasks assigned to them and only requests uploads for their own answers.
6. Never read another service's tables; ask over NATS.

## Tests

- Unit tests for every use case with Prisma, `ClientProxy` and the S3 client mocked (`pnpm test`).
- Always covered: tenant isolation on forms, tasks and media; supervisor limited to `siteIds`; site/post task claimed by an employee with a shift in progress there (and refused with `no_shift_in_progress` otherwise), first claim wins and the second gets `task_already_claimed`, answer on an unassigned task claiming it in one step, only the assignee can answer afterwards; `shift_cancelled` cancelling pending per-shift tasks only (completed and expired untouched), idempotent, and answering a cancelled task giving `task_not_open`; draft editable and publish creating an immutable version; answers referencing the version used; every field type validated; required fields; QR answer matching and mismatch; per-shift generation on `shift_started` (idempotent for the same event twice, one task per template); expiration job; review `approved`/`observed` (note mandatory for observed); offline duplicates ignored and `answer_too_old` after 24 hours; photo limits (size, mime), media ownership and `media_not_uploaded`; suspended and cancelled tenants skipped by generation and expiration; plan gating (basic tenant: `tasks.task.create` answers `feature_not_in_plan` and `shift_started` generates no tasks; pro tenant: both work; `subscription_created`/`plan_changed` idempotent and stale events ignored; downgrade keeps existing tasks); tenant data purge (`data_retention_expired` deletes the tenant's S3 objects and rows, leaves other tenants untouched, is idempotent, and is redelivered when the storage call fails); idempotent handling of every consumed event.
- E2E tests (to create in `test/`) once the transport, the database and MinIO are set up, against a dedicated test database and bucket.

## Before Finishing a Task

- [ ] `pnpm lint`, `pnpm test` and `pnpm build` pass.
- [ ] Schema changes come with a reviewed Prisma migration.
- [ ] If you changed a pattern, event or payload, you updated this file, the gateway and the consuming services' docs, and called it out in the PR description.
- [ ] No secrets, presigned URLs or personal data in logs, tests or fixtures.
