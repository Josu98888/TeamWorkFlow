# STEPS_notificaciones.md — backend / core: notifications module

Follow /STEPS.rules.md. Order: /STEPS.index.md (row B7). Backend conventions: /backend/STEPS.template.md.

**Status:** last verified: S12.6 (lint/build/unit: 114/114 suites, 1441/1441 tests) · blocked · next: run Docker Compose/migrate/E2E on host with Docker · in progress: — · blocked: S0.2, S2.1, S2.4, S11.1, S11.2, S12.2

Source of truth: `backend/core/src/notifications/AGENTS.md` and `backend/core/AGENTS.md`. Commands run from `backend/core/`.

---

## Git Workflow & Commit Rules

> **CRITICAL REPOSITORY RULES:**
> 1. **Branching:** Work MUST be done on a dedicated feature branch (e.g. `feat/core-notifications-module`) branched from the current working branch (`develop`), **NEVER from `main` or `master`**.
> 2. **Commit frequency & size:** Maximum **3 files per commit**. Any large file (>200 lines modified or new file >300 lines) **MUST be committed alone**.
> 3. **Commit format:** Conventional Commits: `<type>(notifications): <description>` (`feat`, `test`, `fix`, `chore`, `docs`, `refactor`).
> 4. **No staging shortcuts:** NEVER use `git add .` or `git commit -a`. Always stage files explicitly.
> 5. **No AI attribution:** Never include `Co-Authored-By` or AI model tags in commit messages.
> 6. **Hash tracking:** After executing each phase, record the resulting commit hashes in the `Commits:` line below the phase title.

---

## Phase 0 — Contract and prerequisites

Commits: (none, read-only phase)

- [x] **S0.1** Branch check & dependency verification in `/STEPS.index.md`:
  - Ensure the active branch is `feat/core-notifications-module` (created from `develop`, never from `main`/`master`).
  - Verify that row B7 (`core: notifications module`) dependencies are accounted for: B1 (`auth`), B3 (`billing`), B4 (`organization`), B5 (`telemetry`), B6 (`tasks`).
  Check: `git branch --show-current` outputs `feat/core-notifications-module`; `git branch --show-current` is not `main` or `master`.
- [!] **S0.2** Toolchain and test environment check *(blocked on host Docker)*:
  - Check Node.js, `pnpm`, Docker Compose test stack (`backend/docker-compose.test.yml`).
  Check: `pnpm` verified cleanly after `allowBuilds` config (`e91a106`); `docker compose` / live `postgres-test` container blocked because Docker is not available on this host.
- [x] **S0.3** Contract inventory and alignment check:
  - Inventory all 5 facade operations (`notifications.push-token.register`, `notifications.push-token.unregister`, `notifications.notification.list`, `notifications.notification.unread-count`, `notifications.notification.mark-read`).
  - Inventory 0 emitted domain events (deliveries logged to database).
  - Inventory 6 consumed events (`notifications.send`, `attendance.alert_opened`, `tasks.task_assigned`, `auth.tenant_*`, `billing.subscription_created` / `plan_changed`, `billing.data_retention_expired`).
  - Inventory inter-module facade dependencies: `auth.user.list-recipients` (from Auth module) and `organization.employee.get` (from Organization module).
  - Verify route map in `backend/core/AGENTS.md` § Route map (notifications section).
  Check: All operations and events mapped with zero missing contracts.

---

## Phase 1 — Foundation (Dependencies, config, exceptions, patterns, JetStream & FCM abstraction)

Commits: `4f5d761`, `7a79bff`, `e91a106`, `50a86e2`, `e50d245`, `88be5bf`, `8bcd414`, `a5b383b`, `ba198de`, `994a3b0`, `fc5b7c6`

- [x] **S1.1** Dependencies for Notifications module:
  - Verify `firebase-admin` for Firebase Cloud Messaging (FCM).
  - Verify `@nestjs/schedule` (already installed in core) for the push notification retry job.
  Check: `pnpm ls firebase-admin @nestjs/schedule` confirms `firebase-admin@14.5.0` & `@nestjs/schedule@6.1.3`; `<build>` passes.
- [x] **S1.2** Environment variables in `src/config/envs.ts` and `src/config/env.schema.ts` (AGENTS § Environment Variables):
  - `NOTIFICATIONS_DATABASE_URL` (uri postgres, required).
  - `FCM_PROJECT_ID` (string, optional in test/dev, required in prod).
  - `FCM_CREDENTIALS` (string, path or base64 JSON, optional in test/dev, never committed).
  - `FCM_ENABLED` (boolean, default `false` in test/dev to allow mock provider).
  - Update `backend/core/.env.example` with placeholders only.
  Check: `envs.spec.ts` passes (19/19); `FCM_CREDENTIALS` empty placeholder in `.env.example`.
- [x] **S1.3** Domain exceptions hierarchy in `src/common/exceptions/app.exceptions.ts`:
  - Ensure all error codes from Notifications AGENTS § Errors are declared with their exact HTTP/RPC status codes:
    - `notification_not_found` (404)
    - `invalid_push_token` (422)
    - `validation_error` (422)
  Check: `app.exceptions.spec.ts` passes (39/39); `AppErrorCode` includes all codes (`994a3b0`).
- [x] **S1.4** Operation patterns in `src/notifications/notifications.patterns.ts`:
  - Declare constants for all 5 operations:
    - `notifications.push-token.register`
    - `notifications.push-token.unregister`
    - `notifications.notification.list`
    - `notifications.notification.unread-count`
    - `notifications.notification.mark-read`
  Check: All pattern constants declared in `notifications.patterns.ts`.
- [x] **S1.5** Event definitions in `src/notifications/events/notifications.events.ts`:
  - Typed payload interfaces for consumed events:
    - `t.<tenant>.notifications.send` (`eventId`, `tenantId`, `recipientUserIds`, `templateCode`, `data`, `occurredAt`).
    - `t.<tenant>.attendance.alert_opened` (`eventId`, `tenantId`, `alertId`, `siteId`, `type`, `occurredAt`).
    - `t.<tenant>.tasks.task_assigned` (`eventId`, `tenantId`, `taskId`, `employeeId`, `siteId`, `title`, `deadline`, `occurredAt`).
    - `t.<tenant>.auth.tenant_suspended`, `tenant_cancelled`, `tenant_reactivated`.
    - `t.<tenant>.billing.subscription_created`, `plan_changed`, `data_retention_expired`.
  Check: `notifications.events.spec.ts` (5/5) and `<build>` pass.
- [x] **S1.6** JetStream consumers setup in `src/notifications/events/notifications-events.service.ts` + `notifications-events.module.ts`:
  - Ensures `NOTIFICATIONS_EVENTS` stream (`t.*.notifications.>`) and registers durable consumers:
    - `notifications-billing` (on `BILLING_EVENTS`)
    - `notifications-telemetry` (on `ATTENDANCE_EVENTS`)
    - `notifications-tasks` (on `TASKS_EVENTS`)
    - `notifications-auth` (on `AUTH_EVENTS`)
    - `notifications-generic` (`t.*.notifications.send` on `NOTIFICATIONS_EVENTS`)
  Check: `notifications-events.service.spec.ts` passes (4/4): consumer creation, retry backoff & DLQ term verified.
- [x] **S1.7** FCM Provider abstraction `src/notifications/providers/fcm-provider.interface.ts`:
  - `send(input: FcmSendInput): Promise<FcmSendResult>` (`{ success, messageId?, isUnregistered?, error? }`).
  - Fake FCM provider `fake-fcm-provider.service.ts` for deterministic tests and development without external credentials.
  - Production `firebase-admin-provider.service.ts` initializing `firebase-admin/messaging` when `FCM_ENABLED=true`.
  Check: `fcm-provider.service.spec.ts` passes (7/7): fake provider and firebase-admin invalid/unregistered detection verified.

---

## Phase 2 — Data model (Prisma schema, migrations, PrismaService)

Commits: `aa86912`, `188a187`, `dc26aeb`, `754b614`

- [!] **S2.1** Prisma configuration *(config/scripts created; live DB status blocked on Docker)*:
  - Created `prisma.notifications.config.ts` and `package.json` scripts (`prisma:notifications:generate`, `migrate:dev`, `migrate:deploy`, `migrate:status`).
  Check: `prisma validate` passed; live `migrate:status` pending Docker PostgreSQL.
- [x] **S2.2** Schema definition in `src/notifications/prisma/schema.prisma` per AGENTS § Data Model:
  - Enums: `DevicePlatform` (`ANDROID`, `IOS`), `NotificationChannel` (`PUSH`, `IN_APP`), `DeliveryStatus` (`PENDING`, `SENT`, `FAILED`).
  - Models: `DeviceToken`, `Notification`, `NotificationDelivery`, `TenantState`, `TenantFeatures`, `ProcessedEvent` (including `tenantId` for tenant retention purge).
  Check: `pnpm exec prisma validate --config prisma.notifications.config.ts` passed.
- [x] **S2.3** Schema indexes and constraints in `src/notifications/prisma/schema.prisma`:
  - Unique constraints & lookup indexes defined; `pnpm prisma:notifications:generate` generated client cleanly.
- [!] **S2.4** First migration `init_notifications` *(offline SQL generated; live DB apply blocked on Docker)*:
  - Generated `src/notifications/prisma/migrations/20261112234500_init_notifications/migration.sql` via `prisma migrate diff --from-empty --to-schema ... --script` (stripped `CREATE SCHEMA IF NOT EXISTS "public"`). Live `migrate:deploy`/`migrate:status` pending Docker PostgreSQL.
- [x] **S2.5** Database access layer in `src/notifications/prisma/prisma.service.ts` + `prisma.module.ts`:
  - `NotificationsPrismaService` + `NotificationsPrismaModule` using `@prisma/adapter-pg` for schema `notifications`.
  Check: `prisma.service.spec.ts` passes (2/2, 0 lint warnings).

---

## Phase 3 — Pure domain: Template rendering and localization

Commits: `3d2d31e`

- [x] **S3.1** Template registry & engine `src/notifications/templates/template-registry.ts`:
  - `DEFAULT_LOCALE = 'es'`, 7 templates (`alert_opened`, `task_assigned`, `billing_invoice_issued`, `billing_due_soon`, `billing_overdue_notice`, `billing_suspended`, `billing_data_deletion_warning`), locale normalization/fallback, and null return + warn on unknown code.
  Check: `template-registry.spec.ts` passes (4/4).

---

## Phase 4 — Sub-module Push Tokens

Commits: `3de7a49`

- [x] **S4.1** `notifications.push-token.register` (`src/notifications/push-tokens/push-tokens.service.ts`):
  - Validates trimmed non-empty token and platform (`android` | `ios`, throws 422 `invalid_push_token`), upserts/reassigns/reactivates, returns safe summary omitting raw token.
  Check: `push-tokens.service.spec.ts` passes.
- [x] **S4.2** `notifications.push-token.unregister` (`src/notifications/push-tokens/push-tokens.service.ts`):
  - Deactivates only when `(token, tenantId, userId, isActive: true)` matches.
  Check: `push-tokens.service.spec.ts` passes (3/3).

---

## Phase 5 — Sub-module In-App Notifications

Commits: `f3f711c`

- [x] **S5.1** `notifications.notification.list` (`src/notifications/in-app/in-app-notifications.service.ts`):
  - Paginated newest-first (`createdAt desc`, `id desc`), optional `unreadOnly`, strict `(tenantId, userId)` scope.
- [x] **S5.2** `notifications.notification.unread-count`:
  - Counts unread rows scoped to `(tenantId, userId)`.
- [x] **S5.3** `notifications.notification.mark-read`:
  - Marks single notification idempotently (404 `notification_not_found` across users/tenants) or bulk marks unread when `all: true`.
  Check: `in-app-notifications.service.spec.ts` passes (4/4).

---

## Phase 6 — Sub-module Delivery Engine & FCM Integration

Commits: `88ffb6f`, `05cc840`

- [x] **S6.1** Delivery dispatcher `src/notifications/delivery/delivery.service.ts`:
  - `stageDeliveries` creates `Notification` + `IN_APP` (`SENT`) + `PUSH` (`PENDING`) inside caller transaction; `dispatchPushes` sends via `FcmProvider` after commit, updates `SENT`/`FAILED`, deactivates `isUnregistered` tokens immediately.
  Check: `delivery.service.spec.ts` passes (3/3).
- [x] **S6.2** Delivery retry scheduled job `src/notifications/jobs/delivery-retry.job.ts`:
  - `@Cron(CronExpression.EVERY_MINUTE)` retries `PUSH` `FAILED` rows with `attempts < 3`, skips suspended tenants & inactive tokens, deactivates invalid tokens, stops after 3 attempts.
  Check: `delivery-retry.job.spec.ts` passes (4/4).

---

## Phase 7 — Sub-module Event Routing & Recipient Resolution

Commits: `f00bf75`

- [x] **S7.1** Generic send consumer `t.<tenant>.notifications.send` (`ConsumedEventsProcessor.handleNotificationSend`):
  - Deduplicates via `ProcessedEvent`, delivers `billing_*` while suspended, resolves empty `recipientUserIds` for `billing_*` to `owner`/`admin` via `AuthService.listRecipients`, drops non-billing sends while suspended.
- [x] **S7.2** Route `t.<tenant>.attendance.alert_opened` (`ConsumedEventsProcessor.handleAlertOpened`):
  - Checks `TenantState` & `TenantFeatures.alerts === true`, resolves `['owner', 'admin', 'supervisor']` scoped to `siteId`, dispatches `alert_opened`.
- [x] **S7.3** Route `t.<tenant>.tasks.task_assigned` (`ConsumedEventsProcessor.handleTaskAssigned`):
  - Skips null `employeeId` or missing/inactive `userId`, resolves employee via `OrganizationService.getEmployeeForTenant`, handles 404 gracefully and bubbles transient errors for JetStream retry.

---

## Phase 8 — Tenant Lifecycle & Data Purge

Commits: `f00bf75`

- [x] **S8.1** Consumes `t.<tenant>.auth.tenant_suspended`, `tenant_cancelled`, `tenant_reactivated`.
- [x] **S8.2** Consumes `t.<tenant>.billing.subscription_created` and `plan_changed` with `effectiveAt` ordering.
- [x] **S8.3** Consumes `t.<tenant>.billing.data_retention_expired` (single-transaction tenant purge across all tables + `ProcessedEvent`).
  Check (Phases 7 & 8): `consumed-events.processor.spec.ts` passes (7/7).

---

## Phase 9 — HTTP Controllers & Facade Wiring

Commits: `814b4ef`, `08dad79`, `3c7a344`, `b84a525`

- [x] **S9.1** Facade service `src/notifications/notifications.service.ts`:
  - Implements and exports `NotificationsService` (`pushTokenRegister`, `pushTokenUnregister`, `notificationList`, `notificationUnreadCount`, `notificationMarkRead`).
  - Only `NotificationsService` exported outside `NotificationsModule`.
  Check: `notifications.service.spec.ts` passes.
- [x] **S9.2** Push tokens HTTP Controller `src/notifications/http/push-tokens.controller.ts`:
  - `POST /api/v1/push-tokens`, `DELETE /api/v1/push-tokens`, rejecting `platform_admin` with 403 and using verified `actor`.
  Check: `push-tokens.controller.spec.ts` passes.
- [x] **S9.3** Notifications HTTP Controller `src/notifications/http/notifications.controller.ts`:
  - `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/:id/read` (single UUID or `'all'` / `{ all: true }`).
  Check: `notifications.controller.spec.ts` passes.

---

## Phase 10 — Close the loop

Commits: `213da6a`, `8daa57a`, `bea12b6`

- [x] **S10.1** Module registration in `src/app.module.ts` & Docker (`docker-compose.yml`, `dockerfile`):
  - Imported `NotificationsModule` into `AppModule` and added `NOTIFICATIONS_DATABASE_URL`, `FCM_*`, and `prisma:notifications:generate` to container build/env.
  Check: `pnpm build` passes cleanly; `NotificationsModule` registered in `src/app.module.ts`.
- [x] **S10.2** Inter-module facade contract with `auth`:
  - Exposed `listRecipients(dto)` on `AuthService` (`auth.user.list-recipients`) delegating to `UserListRecipientsService`.
  Check: `src/auth/` (50/50 suites, 932/932 tests) + `consumed-events.processor.spec.ts` pass.
- [x] **S10.3** Inter-module facade contract with `organization`:
  - Wired `OrganizationService.getEmployeeForTenant(tenantId, { employeeId })` into `ConsumedEventsProcessor.handleTaskAssigned`.
  Check: `consumed-events.processor.spec.ts` passes.

---

## Phase 11 — E2E Tests

Commits: `5b7b98d`, `a249265` *(code written; live execution blocked on host Docker)*

- [!] **S11.1** E2E test harness in `test/e2e/notifications.e2e-spec.ts` + `test/support/`:
  - Wired `NOTIFICATIONS_DATABASE_URL`, `FCM_ENABLED=false`, `prisma.notifications.config.ts` deploy, `notificationsDb()`, and `notifications` truncation in `test/support/`.
  - Wrote full E2E suite in `test/e2e/notifications.e2e-spec.ts` (`oxlint` 0 errors, `tsc` 0 errors on E2E spec). Live `pnpm test:e2e` blocked because Docker PostgreSQL & NATS are unavailable on this host.
- [!] **S11.2** Complete notifications lifecycle E2E flow:
  - Implemented end-to-end assertions for register/reassign/unregister tokens, generic JetStream delivery + deduplication, list/unread-count/mark-read + cross-user/cross-tenant 404 isolation, and `DeliveryRetryJob` + unregistered token deactivation. Pending live Docker stack execution.

---

## Phase 12 — Done checks

Commits: docs update commit

- [x] **S12.1** Grep plant check:
  - Planted hit in `src/__plant.ts`, verified match via `Select-String`, deleted `src/__plant.ts`.
- [!] **S12.2** Quality gate *(lint/build/unit passed; live E2E blocked on Docker)*:
  - `pnpm lint`: 0 errors (10 pre-existing unrelated warnings, 0 in `src/notifications/`) across 310 files.
  - `pnpm build`: passed (exit 0).
  - `pnpm test`: 114/114 suites, 1441/1441 tests passed.
  - `pnpm test:e2e`: blocked on host Docker.
- [x] **S12.3** Tenant & user isolation sweep:
  - Covered in `in-app-notifications.service.spec.ts`, `push-tokens.service.spec.ts`, `consumed-events.processor.spec.ts`, and `notifications.e2e-spec.ts`.
- [x] **S12.4** No push tokens or credentials in logs:
  - Audited all `logger.*` calls in `src/notifications/`: zero tokens, credentials, or PII logged.
- [x] **S12.5** No leftover markers:
  - Verified `TODO(notifications)` scan across `src/` is empty.
- [x] **S12.6** Documentation & status update:
  - Updated `STEPS.index.md` row B7, `src/notifications/AGENTS.md` § Current Status, and `STEPS_notificaciones.md`.
