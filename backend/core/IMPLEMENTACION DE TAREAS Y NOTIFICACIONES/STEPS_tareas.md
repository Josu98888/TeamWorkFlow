# STEPS_tareas.md — backend / core: tasks module

Follow /STEPS.rules.md. Order: /STEPS.index.md (row B6). Backend conventions: /backend/STEPS.template.md.

**Status:** last verified: — · next: S0.1 · in progress: — · blocked: —

Source of truth: `backend/core/src/tasks/AGENTS.md` and `backend/core/AGENTS.md`. Commands run from `backend/core/`.

---

## Git Workflow & Commit Rules

> **CRITICAL REPOSITORY RULES:**
> 1. **Branching:** Work MUST be done on a dedicated feature branch (e.g. `feat/core-tasks-module`) branched from the current working branch (`develop`), **NEVER from `main` or `master`**.
> 2. **Commit frequency & size:** Maximum **3 files per commit**. Any large file (>200 lines modified or new file >300 lines) **MUST be committed alone**.
> 3. **Commit format:** Conventional Commits: `<type>(tasks): <description>` (`feat`, `test`, `fix`, `chore`, `docs`, `refactor`).
> 4. **No staging shortcuts:** NEVER use `git add .` or `git commit -a`. Always stage files explicitly.
> 5. **No AI attribution:** Never include `Co-Authored-By` or AI model tags in commit messages.
> 6. **Hash tracking:** After executing each phase, record the resulting commit hashes in the `Commits:` line below the phase title.

---

## Phase 0 — Contract and prerequisites

Commits: (none, read-only phase)

- [ ] **S0.1** Branch check & dependency verification in `/STEPS.index.md`:
  - Ensure the active branch is `feat/core-tasks-module` (created from `develop`, never from `main`/`master`).
  - Verify that row B6 (`core: tasks module`) dependencies are accounted for: B1 (`auth`), B2 (`HTTP layer`), B3 (`billing`), B4 (`organization`).
  Check: `git branch --show-current` outputs `feat/core-tasks-module`; `git branch --show-current` is not `main` or `master`.
- [ ] **S0.2** Toolchain and test environment check:
  - Check Node.js, `pnpm`, Docker Compose test stack (`backend/docker-compose.test.yml`), and MinIO local storage availability.
  Check: `pnpm --version && docker compose version` print clean outputs; test database container responds via `docker compose -f ../docker-compose.test.yml exec postgres-test pg_isready`.
- [ ] **S0.3** Contract inventory and alignment check:
  - Inventory all 11 facade operations (`tasks.form.create`, `tasks.form.update`, `tasks.form.publish`, `tasks.form.get`, `tasks.form.list`, `tasks.task-template.create`, `tasks.task-template.update`, `tasks.task-template.list`, `tasks.task.create`, `tasks.task.get`, `tasks.task.list`, `tasks.task.claim`, `tasks.task.answer`, `tasks.task.review`, `tasks.media.request-upload`, `tasks.media.get-url`).
  - Inventory 3 emitted domain events (`task_assigned`, `task_completed`, `task_expired`).
  - Inventory 5 consumed events (`organization.shift_started`, `organization.shift_cancelled`, `auth.tenant_*`, `billing.subscription_created` / `plan_changed`, `billing.data_retention_expired`).
  - Verify route map in `backend/core/AGENTS.md` § Route map (tasks section).
  Check: All operations and events mapped with zero missing contracts.

---

## Phase 1 — Foundation (Dependencies, config, exceptions, patterns, JetStream & S3 client)

Commits: —

- [ ] **S1.1** Dependencies for Tasks module:
  - Verify `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` for S3/MinIO presigned URLs.
  - Verify `@nestjs/schedule` (already installed in core) for the task expiration job.
  Check: `pnpm ls @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @nestjs/schedule` confirms packages are present; `<build>` passes.
- [ ] **S1.2** Environment variables in `src/config/envs.ts` and `src/config/env.schema.ts` (AGENTS § Environment Variables):
  - `TASKS_DATABASE_URL` (uri postgres, required).
  - `S3_ENDPOINT` (uri or string, default `http://localhost:9000` for MinIO).
  - `S3_REGION` (string, default `us-east-1`).
  - `S3_BUCKET` (string, default `teamworkflow-tasks`).
  - `S3_ACCESS_KEY` (string, required in production, default `minioadmin` for local).
  - `S3_SECRET_KEY` (string, required in production, default `minioadmin` for local).
  - `S3_FORCE_PATH_STYLE` (boolean, default `true` for MinIO).
  - `MEDIA_URL_TTL_SECONDS` (number, integer, default `300`).
  - Update `backend/core/.env.example` with placeholders only.
  Check: `<test> envs` passes: missing required database URL throws; defaults apply; `rg -n "S3_SECRET_KEY=.{5,}" .env.example` has no matches.
- [ ] **S1.3** Domain exceptions hierarchy in `src/common/exceptions/app.exceptions.ts`:
  - Ensure all error codes from Tasks AGENTS § Errors are declared with their exact HTTP/RPC status codes:
    - `form_not_found` (404)
    - `task_not_found` (404)
    - `media_not_found` (404)
    - `form_not_published` (409)
    - `task_not_open` (409)
    - `task_already_claimed` (409)
    - `no_shift_in_progress` (403)
    - `qr_mismatch` (422)
    - `answer_too_old` (422)
    - `media_too_large` (422)
    - `media_type_not_allowed` (422)
    - `media_not_uploaded` (422)
    - `feature_not_in_plan` (403)
  Check: `<test> app.exceptions` passes: unit tests assert exact status and code for each tasks domain exception.
- [ ] **S1.4** Operation patterns in `src/tasks/tasks.patterns.ts`:
  - Declare constants for all 11 operations: `tasks.form.create`, `tasks.form.update`, `tasks.form.publish`, `tasks.form.get`, `tasks.form.list`, `tasks.task-template.create`, `tasks.task-template.update`, `tasks.task-template.list`, `tasks.task.create`, `tasks.task.get`, `tasks.task.list`, `tasks.task.claim`, `tasks.task.answer`, `tasks.task.review`, `tasks.media.request-upload`, `tasks.media.get-url`.
  Check: `rg -n "tasks\." src/tasks/tasks.patterns.ts` contains all pattern constants; no raw strings used outside patterns file.
- [ ] **S1.5** Event definitions in `src/tasks/events/tasks.events.ts`:
  - Typed payload interfaces and subject builder functions for emitted events:
    - `t.<tenant>.tasks.task_assigned` (`eventId`, `tenantId`, `taskId`, `employeeId` (nullable), `siteId`, `postId`, `shiftId` (nullable), `title`, `deadline`, `occurredAt`).
    - `t.<tenant>.tasks.task_completed` (`eventId`, `tenantId`, `taskId`, `employeeId`, `siteId`, `occurredAt`).
    - `t.<tenant>.tasks.task_expired` (`eventId`, `tenantId`, `taskId`, `employeeId` (nullable), `siteId`, `occurredAt`).
  - Typed interfaces for consumed subjects (`shift_started`, `shift_cancelled`, `tenant_suspended`, etc.).
  Check: `<typecheck>` passes; event builders enforce ISO-8601 UTC `occurredAt` and UUID `eventId`.
- [ ] **S1.6** JetStream stream and consumers setup in `src/tasks/events/tasks-events.service.ts` + `tasks-events.module.ts`:
  - On module startup, creates or verifies stream `TASKS_EVENTS` capturing `t.*.tasks.>` (file storage, max_age 7 days).
  - Creates durable consumers:
    - `tasks-organization` (filtered to `t.*.organization.>`)
    - `tasks-auth` (filtered to `t.*.auth.>`)
    - `tasks-billing` (filtered to `t.*.billing.>`)
  Check: `<test> tasks-events` passes: stream configuration matches spec; consumer creation handles missing producer streams with backoff.
- [ ] **S1.7** S3 / MinIO Storage Client Service `src/tasks/media/storage.service.ts`:
  - Initializes `@aws-sdk/client-s3` using envs (`S3_ENDPOINT`, `S3_REGION`, credentials, path-style).
  - `getPresignedPutUrl(storageKey: string, mime: string, sizeBytes: number, ttlSeconds: number): Promise<string>`.
  - `getPresignedGetUrl(storageKey: string, ttlSeconds: number): Promise<string>`.
  - `checkObjectExistsAndSize(storageKey: string, expectedSizeBytes: number): Promise<boolean>` using `HeadObjectCommand`.
  - `deleteObjectsByPrefix(prefix: string): Promise<number>` for tenant data retention purge.
  Check: `<test> storage.service` passes with S3 client mocked: validates URL generation, HeadObject verification, and prefix-based batch deletion.

---

## Phase 2 — Data model (Prisma schema, migrations, PrismaService)

Commits: —

- [ ] **S2.1** Prisma configuration:
  - Create `prisma.tasks.config.ts` pointing to `src/tasks/prisma/schema.prisma`, migrations at `src/tasks/prisma/migrations`, and datasource `TASKS_DATABASE_URL`.
  - Add package scripts in `backend/core/package.json`:
    - `prisma:tasks:generate`
    - `prisma:tasks:migrate:dev`
    - `prisma:tasks:migrate:deploy`
    - `prisma:tasks:migrate:status`
  Check: `pnpm run prisma:tasks:migrate:status` connects or reports status against the configured test database.
- [ ] **S2.2** Schema definition in `src/tasks/prisma/schema.prisma` per AGENTS § Data Model:
  - Enums:
    - `DeadlineMode` (`AFTER_START`, `AT_SHIFT_END`)
    - `TaskKind` (`SINGLE`, `PER_SHIFT`)
    - `TaskStatus` (`PENDING`, `COMPLETED`, `EXPIRED`, `CANCELLED`)
    - `MediaStatus` (`PENDING`, `UPLOADED`)
    - `ReviewResult` (`NONE`, `APPROVED`, `OBSERVED`)
  - Models:
    - `Form`: `id`, `tenantId`, `name`, `draftFields` (Json), `createdBy` (`Uuid`), `createdAt`, `updatedAt`.
    - `FormVersion`: `id`, `tenantId`, `formId`, `version` (`Int`), `name`, `fields` (Json), `publishedAt`, `publishedBy` (`Uuid`).
    - `TaskTemplate`: `id`, `tenantId`, `siteId` (`Uuid`), `postId` (`Uuid`), `formVersionId` (`Uuid`), `deadlineMode` (`DeadlineMode`), `deadlineMinutes` (`Int?`), `isActive` (`Boolean`).
    - `Task`: `id`, `tenantId`, `kind` (`TaskKind`), `status` (`TaskStatus`), `formVersionId` (`Uuid`), `title`, `deadline` (`DateTime`), `employeeId` (`Uuid?`), `claimedAt` (`DateTime?`), `siteId` (`Uuid`), `postId` (`Uuid`), `shiftId` (`Uuid?`), `templateId` (`Uuid?`), `expectedQr` (`String?`), `createdBy` (`Uuid?`), `createdAt`, `updatedAt`.
    - `TaskAnswer`: `id`, `tenantId`, `taskId` (`Uuid`), `formVersionId` (`Uuid`), `answers` (Json), `clientAnswerId` (`String`), `deviceTime` (`DateTime`), `receivedAt` (`DateTime`), `submittedByUserId` (`Uuid`), `reviewResult` (`ReviewResult`), `reviewNote` (`String?`), `reviewedBy` (`Uuid?`), `reviewedAt` (`DateTime?`).
    - `Media`: `id`, `tenantId`, `storageKey`, `mime`, `sizeBytes` (`Int`), `sha256`, `takenAt` (`DateTime`), `uploadedByUserId` (`Uuid`), `status` (`MediaStatus`), `createdAt`.
    - `TenantState`: `tenantId` (`Uuid`), `isSuspended` (`Boolean`), `updatedAt` (`DateTime`).
    - `TenantFeatures`: `tenantId` (`Uuid`), `features` (Json), `effectiveAt` (`DateTime`).
    - `ProcessedEvent`: `eventId` (`String`), `processedAt` (`DateTime`).
  - Apply `@@map` and `@map` for snake_case table and column mapping, schema `tasks`.
  Check: `pnpm exec prisma validate --config prisma.tasks.config.ts` passes.
- [ ] **S2.3** Schema indexes and constraints in `src/tasks/prisma/schema.prisma`:
  - Unique constraint on `form_versions(form_id, version)`.
  - Unique constraint on `task_answers(task_id)`.
  - Unique constraint on `task_answers(tenant_id, client_answer_id)`.
  - Unique constraint on `processed_events(event_id)`.
  - Partial or conditional unique index: `tasks(tenant_id, shift_id, template_id)` where `shift_id IS NOT NULL AND template_id IS NOT NULL` for idempotent per-shift generation.
  - Performance indexes:
    - `tasks(tenant_id, employee_id, status)`
    - `tasks(tenant_id, site_id, status)`
    - `tasks(status, deadline)` for expiration job.
    - `forms(tenant_id, created_at)`
    - `media(tenant_id, created_at)`
  Check: `prisma:tasks:generate` compiles client successfully without schema errors.
- [ ] **S2.4** First migration `init_tasks`:
  - Run `prisma migrate dev` to generate initial migration file.
  - Verify migration SQL creates schema `tasks` and all declared tables, constraints, and indexes.
  Check: `pnpm run prisma:tasks:migrate:dev --name init_tasks` executes; `pnpm run prisma:tasks:migrate:status` reports schema up to date.
- [ ] **S2.5** Database access layer in `src/tasks/prisma/prisma.service.ts` + `prisma.module.ts`:
  - Extends PrismaClient using `@prisma/adapter-pg` connecting to schema `tasks` via `tasks_svc` role.
  Check: `<test> tasks-prisma` passes: connects to test database and disconnects cleanly.

---

## Phase 3 — Pure domain engines (Form validation, answers validation, deadline engine)

Commits: —

- [ ] **S3.1** Form & field validator `src/tasks/domain/form-validator.ts`:
  - Validates form field definitions against allowed types: `text`, `number`, `yes_no`, `select`, `checklist`, `photo`, `qr`.
  - Enforces field structure: unique `key` per form, non-empty `label`, boolean `required`.
  - Enforces type options: `select` and `checklist` require non-empty `options` list; `number` optionally accepts `min` and `max`.
  - Rejects unknown field types or invalid options with `validation_error` (422).
  Check: `<test> form-validator` passes with table-driven tests for every field type and edge cases (duplicate keys, empty options).
- [ ] **S3.2** Task answer validator `src/tasks/domain/answer-validator.ts`:
  - Pure validator comparing submitted answers payload against `FormVersion.fields`:
    - All `required` fields must be present and non-empty.
    - Value types must match field definitions (e.g. number is numeric, photo is a valid UUID `mediaId`, qr is string).
    - Expected QR check: if `Task.expectedQr` is set, the answer to `qr` field must match exactly; otherwise throws `qr_mismatch` (422).
    - Offline answer age: device timestamp must not be older than 24 hours (`now - deviceTime <= 24h`); otherwise throws `answer_too_old` (422).
    - Offline answer with deviceTime before deadline is accepted even if received after deadline (completes task, does not expire).
  Check: `<test> answer-validator` passes covering: required field missing, type mismatch, QR match & mismatch, deviceTime within 24h vs older than 24h.
- [ ] **S3.3** Deadline calculator `src/tasks/domain/deadline-calculator.ts`:
  - Calculates task deadline given shift start/end times and template rule:
    - `AFTER_START`: `shiftStart + deadlineMinutes`.
    - `AT_SHIFT_END`: `shiftEnd`.
  Check: `<test> deadline-calculator` passes table-driven test cases for shift start offset and shift end.

---

## Phase 4 — Sub-module Forms (Drafts & Immutable Versions)

Commits: —

- [ ] **S4.1** `tasks.form.create` and `tasks.form.update`:
  - `create`: Owner/Admin creates a new form with `name` and initial `draftFields` (validated by S3.1).
  - `update`: Owner/Admin updates form name and `draftFields`. Does NOT affect existing published versions.
  - Tenant isolation: form belonging to another tenant returns 404 `form_not_found`.
  Check: `<test> form.create-update` passes: draft form created and edited; non-owner/admin rejected (403); cross-tenant access returns 404.
- [ ] **S4.2** `tasks.form.publish`:
  - Owner/Admin publishes form. Freezes current `draftFields` into a new `FormVersion` row with auto-incremented `version` (1, 2, ...).
  - Published version is immutable; draft remains editable for subsequent revisions.
  Check: `<test> form.publish` passes: version 1 created; subsequent publish creates version 2; draft remains editable; versions are immutable.
- [ ] **S4.3** `tasks.form.get` and `tasks.form.list`:
  - `get`: returns form details along with all its published versions.
  - `list`: returns paginated forms for the tenant.
  Check: `<test> form.get-list` passes: tenant isolation verified (tenant A cannot view tenant B forms).

---

## Phase 5 — Sub-module Task Templates

Commits: —

- [ ] **S5.1** `tasks.task-template.create` & `update`:
  - Owner/Admin creates/updates a task template linking `(siteId, postId)` with a published `formVersionId`, `deadlineMode`, and `deadlineMinutes`.
  - Verifies `formVersionId` exists and belongs to the tenant. If form version is unpublished or invalid, throws 409 `form_not_published`.
  Check: `<test> task-template.crud` passes: validates `formVersionId`; rejects non-existent or unpublished version with 409; tenant isolation enforced.
- [ ] **S5.2** `tasks.task-template.list`:
  - Lists task templates for the tenant, filterable by `siteId` and `postId`.
  Check: `<test> task-template.list` passes: filters by site/post correctly.

---

## Phase 6 — Sub-module Media (Presigned Uploads & Photo Verification)

Commits: —

- [ ] **S6.1** `tasks.media.request-upload`:
  - Employee requests upload URL with `{ mime, sizeBytes, sha256, takenAt }`.
  - Enforces limits: max 10 MB (10,485,760 bytes), allowed mime: `image/jpeg`, `image/png`, `image/webp`. Otherwise throws `media_too_large` (422) or `media_type_not_allowed` (422).
  - Generates storage key: `<tenantId>/<mediaId>.<ext>`.
  - Creates `Media` row in status `PENDING`.
  - Calls `StorageService` to generate presigned PUT URL.
  - Returns `{ mediaId, uploadUrl, expiresAt }`.
  Check: `<test> media.request-upload` passes: oversize image returns 422; invalid mime returns 422; valid payload creates Media row and returns presigned PUT URL.
- [ ] **S6.2** `tasks.media.get-url`:
  - Generates short-lived presigned GET URL for a given `mediaId`.
  - Validates media belongs to actor's tenant and matches actor's site scope. If missing or cross-tenant, returns 404 `media_not_found`.
  Check: `<test> media.get-url` passes: returns `{ url, expiresAt }`; cross-tenant request returns 404 `media_not_found`.
- [ ] **S6.3** Media answer verification helper `src/tasks/media/media-verification.service.ts`:
  - When a task answer includes a photo (`mediaId`):
    - Validates `Media` row exists, matches `tenantId`, was requested by the same user (`uploadedByUserId === actor.userId`), and is in `PENDING` status.
    - Calls `StorageService.checkObjectExistsAndSize` to confirm object was uploaded to S3 with declared size.
    - Updates `Media` status to `UPLOADED`.
    - If object missing in S3 or wrong size: throws 422 `media_not_uploaded`.
  Check: `<test> media-verification` passes: missing S3 object throws 422; mismatched user throws 422; valid media updates status to `UPLOADED`.

---

## Phase 7 — Sub-module Tasks (Single Tasks, Claiming & Answering)

Commits: —

- [ ] **S7.1** `tasks.task.create` (Single task creation):
  - Owner/Admin/Supervisor creates single task with `formVersionId`, `deadline`, and assignee (`employeeId` or `siteId` + `postId`), optional `expectedQr`.
  - Verifies tenant has `features.tasks` (from local `TenantFeatures` copy); otherwise throws 403 `feature_not_in_plan`.
  - Supervisor restricted to own assigned `siteIds` (404/403 if outside).
  - Inserts `Task` in status `PENDING`, kind `SINGLE`.
  - After database commit, emits `t.<tenant>.tasks.task_assigned`.
  Check: `<test> task.create` passes: single task created; event published with correct payload; supervisor limited to assigned sites; basic-plan tenant rejected with 403.
- [ ] **S7.2** `tasks.task.get` and `tasks.task.list`:
  - `get`: returns task with answer details if completed.
  - `list`: lists tasks with filters (`status`, `employeeId`, `siteId`), pagination (`page`, `pageSize`).
  - Roles: Owner/Admin see all tasks; Supervisor sees only tasks in their `siteIds`; Employee sees only tasks assigned to them or unassigned at their current shift site/post.
  Check: `<test> task.queries` passes: role filtering verified; supervisor cannot list tasks of other sites; employee sees only their assigned tasks.
- [ ] **S7.3** `tasks.task.claim` (Site/post task claiming):
  - Employee claims an unassigned task (`employeeId` is null, status `PENDING`).
  - Resolves employee by `actor.userId` via `organization.employee.get`.
  - Verifies employee has a shift in status `in_progress` whose `siteId` and `postId` match the task (calls `organization.shift.list`). If not, throws 403 `no_shift_in_progress`.
  - Atomic compare-and-set update: updates `employeeId = employee.id`, `claimedAt = now()` where `id = taskId AND employeeId IS NULL AND status = 'PENDING'`.
  - If another employee claimed it first: throws 409 `task_already_claimed`.
  - If task status is not `PENDING`: throws 409 `task_not_open`.
  - Idempotent: claiming a task already claimed by the same employee succeeds.
  Check: `<test> task.claim` passes: happy path claims task; second claimer gets 409 `task_already_claimed`; employee without active shift gets 403 `no_shift_in_progress`; idempotent for same employee.
- [ ] **S7.4** `tasks.task.answer` (Task completion):
  - Employee submits answer with `{ taskId, clientAnswerId, deviceTime, answers }`.
  - Validates task exists and belongs to tenant (404 `task_not_found`).
  - If task is expired, cancelled or already completed: throws 409 `task_not_open`.
  - Deduplication: if `clientAnswerId` already exists for this tenant, returns the stored answer idempotently.
  - If task is unassigned (`employeeId` is null): verifies active shift and claims task to this employee in the same transaction.
  - If task is assigned: verifies `task.employeeId === employee.id`.
  - Validates answers using `AnswerValidator` (S3.2) and `MediaVerificationService` (S6.3).
  - In a single database transaction:
    - Inserts `TaskAnswer` row (`reviewResult: NONE`).
    - Updates `Task` status to `COMPLETED`.
  - After commit, emits `t.<tenant>.tasks.task_completed`.
  Check: `<test> task.answer` passes: valid answer completes task and emits event; unassigned task claims and completes; invalid QR throws 422; duplicate clientAnswerId returns stored answer; completed task rejects second answer with 409.
- [ ] **S7.5** `tasks.task.review` (Supervisor review):
  - Supervisor (for own sites) or Owner/Admin reviews completed task answer with `{ result: 'approved' | 'observed', note }`.
  - If result is `observed`, `note` is mandatory (non-empty string); otherwise throws 422 `validation_error`.
  - Updates `TaskAnswer` fields: `reviewResult`, `reviewNote`, `reviewedBy = actor.userId`, `reviewedAt = now()`.
  - Task status remains `COMPLETED` (review does not alter task state).
  Check: `<test> task.review` passes: approved review succeeds; observed review without note fails (422); supervisor outside site scope rejected.

---

## Phase 8 — Events consumed (Per-shift generation, shift cancellation & tenant lifecycle)

Commits: —

- [ ] **S8.1** Consumes `t.<tenant>.organization.shift_started`:
  - Verifies tenant has `features.tasks` and is not suspended/cancelled; skips silently if absent.
  - Queries active `TaskTemplate` rows for `(siteId, postId)` of the shift.
  - For each template:
    - Computes deadline using `DeadlineCalculator` (S3.3).
    - Inserts `Task` in status `PENDING`, kind `PER_SHIFT`, linked to `shiftId`, `templateId`, `employeeId` (from shift). If shift has no employee, `employeeId` is null.
    - Deduplication: uses unique constraint `(tenant_id, shift_id, template_id)`. If duplicate event arrives, ignores conflict (idempotent).
    - Records `ProcessedEvent`.
    - Emits `t.<tenant>.tasks.task_assigned` for each created task after commit.
  Check: `<test> shift-started-consumer` passes: generates per-shift tasks; duplicate event does not create duplicate tasks; basic plan generates no tasks.
- [ ] **S8.2** Consumes `t.<tenant>.organization.shift_cancelled`:
  - Finds all `PENDING` per-shift tasks linked to `shiftId`.
  - Updates their status to `CANCELLED`.
  - Leaves `COMPLETED` and `EXPIRED` tasks untouched.
  - Idempotent: duplicate event finds 0 pending tasks and completes cleanly.
  Check: `<test> shift-cancelled-consumer` passes: pending tasks cancelled; completed tasks intact; idempotent on redelivery.
- [ ] **S8.3** Consumes `t.<tenant>.auth.tenant_suspended`, `tenant_cancelled`, `tenant_reactivated`:
  - Upserts `TenantState` (`isSuspended = true` for suspended/cancelled, `false` for reactivated).
  - Skips generation and expiration jobs while `isSuspended` is true.
  Check: `<test> tenant-state-consumer` passes: sets isSuspended flag; tasks generation ignores suspended tenant.
- [ ] **S8.4** Consumes `t.<tenant>.billing.subscription_created` and `plan_changed`:
  - Upserts `TenantFeatures` copy with `features` json and `effectiveAt`.
  - Ignores stale events where `effectiveAt <= stored.effectiveAt`.
  Check: `<test> plan-features-consumer` passes: stores features; rejects stale timestamps; pro tenant enables task creation.
- [ ] **S8.5** Consumes `t.<tenant>.billing.data_retention_expired` (Tenant data purge):
  - First, deletes all S3 objects under prefix `<tenantId>/` using `StorageService.deleteObjectsByPrefix`.
  - Second, in database transaction, deletes all tenant rows: `Media`, `TaskAnswer`, `Task`, `TaskTemplate`, `FormVersion`, `Form`, `TenantState`, `TenantFeatures`, `ProcessedEvent`.
  - If S3 call fails, handler throws, transaction does not commit, and JetStream redelivers.
  - Idempotent: second delivery finds 0 objects and 0 rows, succeeds cleanly.
  Check: `<test> data-retention-consumer` passes: S3 deleted first; all DB rows purged; other tenants untouched.

---

## Phase 9 — Background Expiration Job

Commits: —

- [ ] **S9.1** Expiration scheduled job `src/tasks/jobs/task-expiration.job.ts`:
  - Scheduled via `@nestjs/schedule` (e.g. `@Cron('*/5 * * * *')`, every 5 minutes).
  - Queries `Task` where `status = 'PENDING' AND deadline <= now()`.
  - Groups tasks by `tenantId`, skips tenants where `TenantState.isSuspended === true`.
  - Updates status to `EXPIRED`.
  - Emits `t.<tenant>.tasks.task_expired` for each expired task after transaction commit.
  Check: `<test> task-expiration-job` passes: overdue pending tasks marked expired and event emitted; tasks with future deadline untouched; suspended tenants skipped.

---

## Phase 10 — HTTP Controllers & Facade Wiring

Commits: —

- [ ] **S10.1** Facade service `src/tasks/tasks.service.ts`:
  - Implements and exports facade methods for all 11 operations declared in `tasks.patterns.ts`.
  - Coordinates internal sub-modules (`forms`, `templates`, `tasks`, `media`).
  - No repositories or Prisma services exported outside `TasksModule`.
  Check: `<test> tasks.service` passes: facade methods execute use cases cleanly; only facade is exported.
- [ ] **S10.2** Forms HTTP Controller `src/tasks/http/forms.controller.ts`:
  - `POST /api/v1/forms` -> `tasks.form.create` (`@Roles('owner', 'admin')`, `@RequiresFeature('tasks')`)
  - `PATCH /api/v1/forms/:formId` -> `tasks.form.update` (`@Roles('owner', 'admin')`, `@RequiresFeature('tasks')`)
  - `POST /api/v1/forms/:formId/publish` -> `tasks.form.publish` (`@Roles('owner', 'admin')`, `@RequiresFeature('tasks')`)
  - `GET /api/v1/forms/:formId` -> `tasks.form.get` (`@RequiresFeature('tasks')`)
  - `GET /api/v1/forms` -> `tasks.form.list` (`@RequiresFeature('tasks')`)
  Check: `<test> forms.controller` passes: role checks enforce owner/admin for mutations; feature gating returns 403 `feature_not_in_plan` when feature missing.
- [ ] **S10.3** Task Templates HTTP Controller `src/tasks/http/task-templates.controller.ts`:
  - `POST /api/v1/task-templates` -> `tasks.task-template.create` (`@Roles('owner', 'admin')`, `@RequiresFeature('tasks')`)
  - `PATCH /api/v1/task-templates/:id` -> `tasks.task-template.update` (`@Roles('owner', 'admin')`, `@RequiresFeature('tasks')`)
  - `GET /api/v1/task-templates` -> `tasks.task-template.list` (`@RequiresFeature('tasks')`)
  Check: `<test> task-templates.controller` passes: role guard and feature gating enforced.
- [ ] **S10.4** Tasks HTTP Controller `src/tasks/http/tasks.controller.ts`:
  - `POST /api/v1/tasks` -> `tasks.task.create` (`@Roles('owner', 'admin', 'supervisor')`, `@RequiresFeature('tasks')`)
  - `GET /api/v1/tasks/:taskId` -> `tasks.task.get` (`@RequiresFeature('tasks')`)
  - `GET /api/v1/tasks` -> `tasks.task.list` (`@RequiresFeature('tasks')`)
  - `POST /api/v1/tasks/:taskId/claim` -> `tasks.task.claim` (`@Roles('employee')`, `@RequiresFeature('tasks')`)
  - `POST /api/v1/tasks/:taskId/answer` -> `tasks.task.answer` (`@Roles('employee')`, `@RequiresFeature('tasks')`)
  - `POST /api/v1/tasks/:taskId/review` -> `tasks.task.review` (`@Roles('owner', 'admin', 'supervisor')`, `@RequiresFeature('tasks')`)
  Check: `<test> tasks.controller` passes: role guard blocks unauthorized operations; actor passed to facade.
- [ ] **S10.5** Media HTTP Controller `src/tasks/http/media.controller.ts`:
  - `POST /api/v1/media/uploads` -> `tasks.media.request-upload` (`@Roles('employee')`, `@RequiresFeature('tasks')`)
  - `GET /api/v1/media/:mediaId/url` -> `tasks.media.get-url` (`@RequiresFeature('tasks')`)
  Check: `<test> media.controller` passes: endpoint permissions and feature gating verified.

---

## Phase 11 — Close the loop

Commits: —

- [ ] **S11.1** Docker Compose MinIO configuration:
  - Add MinIO container in `backend/docker-compose.yml` and `backend/docker-compose.test.yml`:
    - Service `minio` on port 9000 (API) and 9001 (Console).
    - Persistent volume `minio_data`.
    - Automatic bucket creation script / init container for `teamworkflow-tasks`.
  Check: `docker compose -f ../docker-compose.yml config` passes validation; MinIO starts and bucket exists.
- [ ] **S11.2** Module registration in `src/app.module.ts`:
  - Import `TasksModule` into `AppModule`.
  Check: `<build>` passes cleanly; `rg -n "TasksModule" src/app.module.ts` has a hit.
- [ ] **S11.3** Inter-module facade wiring:
  - Validate that `organization.employee.get` and `organization.shift.list` are exported and callable in-process by `TasksModule`.
  Check: `<test> tasks-organization-contract` passes: mock calls to organization facade resolve employee and shift status accurately.

---

## Phase 12 — E2E Tests

Commits: —

- [ ] **S12.1** E2E test harness in `test/e2e/tasks.e2e-spec.ts`:
  - Sets up supertest client against real `AppModule` with test database and test MinIO bucket.
  Check: `<e2e> tasks.e2e-spec` executes and connects to test database and NATS instance.
- [ ] **S12.2** Complete lifecycle E2E flow:
  1. Owner creates form draft -> publishes version 1.
  2. Owner creates task template for site/post.
  3. Emit `organization.shift_started` -> verifies per-shift task is generated for employee.
  4. Employee requests upload -> presigned PUT URL generated -> mock file uploaded to MinIO.
  5. Employee submits answer with photo and QR -> task marked `COMPLETED` -> `task_completed` emitted.
  6. Supervisor reviews answer as `approved`.
  Check: Full flow passes cleanly from HTTP down to MinIO and JetStream events.

---

## Phase 13 — Done checks

Commits: —

- [ ] **S13.1** Grep plant check:
  - Plant a hit in `src/__plant.ts`, confirm grep finds it, delete the file.
  Check: `test ! -e src/__plant.ts`.
- [ ] **S13.2** Quality gate:
  - Run lint, typecheck, unit tests, build, and E2E.
  Check: `<lint>`, `<typecheck>`, `<test>`, `<build>` and `<e2e>` pass without errors or warnings.
- [ ] **S13.3** Tenant isolation sweep:
  - Automated test verifying an actor of tenant A cannot read, answer, claim, or review tasks/forms/media of tenant B.
  Check: `<test> tasks-tenant-isolation` passes 100%.
- [ ] **S13.4** No secrets or presigned URLs in logs:
  - Confirm credentials and presigned URLs never reach logger output.
  Check: `rg -n -i "(log|warn|error|debug)\(.*(secret|access_key|presigned|aws)" src/tasks <EXCL>` is empty.
- [ ] **S13.5** No leftover markers:
  Check: `rg -n "TODO\(tasks\)" src <EXCL>` is empty.
- [ ] **S13.6** Documentation & status update:
  - Update `STEPS.index.md` row B6 to reflect completed status.
  - Update `backend/core/src/tasks/AGENTS.md` § Current Status.
