# STEPS_notificaciones.md — backend / core: notifications module

Follow /STEPS.rules.md. Order: /STEPS.index.md (row B7). Backend conventions: /backend/STEPS.template.md.

**Status:** last verified: — · next: S0.1 · in progress: — · blocked: —

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

- [ ] **S0.1** Branch check & dependency verification in `/STEPS.index.md`:
  - Ensure the active branch is `feat/core-notifications-module` (created from `develop`, never from `main`/`master`).
  - Verify that row B7 (`core: notifications module`) dependencies are accounted for: B1 (`auth`), B3 (`billing`), B4 (`organization`), B5 (`telemetry`), B6 (`tasks`).
  Check: `git branch --show-current` outputs `feat/core-notifications-module`; `git branch --show-current` is not `main` or `master`.
- [ ] **S0.2** Toolchain and test environment check:
  - Check Node.js, `pnpm`, Docker Compose test stack (`backend/docker-compose.test.yml`).
  Check: `pnpm --version && docker compose version` print clean outputs; test database container responds via `docker compose -f ../docker-compose.test.yml exec postgres-test pg_isready`.
- [ ] **S0.3** Contract inventory and alignment check:
  - Inventory all 5 facade operations (`notifications.push-token.register`, `notifications.push-token.unregister`, `notifications.notification.list`, `notifications.notification.unread-count`, `notifications.notification.mark-read`).
  - Inventory 0 emitted domain events (deliveries logged to database).
  - Inventory 6 consumed events (`notifications.send`, `attendance.alert_opened`, `tasks.task_assigned`, `auth.tenant_*`, `billing.subscription_created` / `plan_changed`, `billing.data_retention_expired`).
  - Inventory inter-module facade dependencies: `auth.user.list-recipients` (from Auth module) and `organization.employee.get` (from Organization module).
  - Verify route map in `backend/core/AGENTS.md` § Route map (notifications section).
  Check: All operations and events mapped with zero missing contracts.

---

## Phase 1 — Foundation (Dependencies, config, exceptions, patterns, JetStream & FCM abstraction)

Commits: —

- [ ] **S1.1** Dependencies for Notifications module:
  - Verify `firebase-admin` for Firebase Cloud Messaging (FCM).
  - Verify `@nestjs/schedule` (already installed in core) for the push notification retry job.
  Check: `pnpm ls firebase-admin @nestjs/schedule` confirms packages are present; `<build>` passes.
- [ ] **S1.2** Environment variables in `src/config/envs.ts` and `src/config/env.schema.ts` (AGENTS § Environment Variables):
  - `NOTIFICATIONS_DATABASE_URL` (uri postgres, required).
  - `FCM_PROJECT_ID` (string, optional in test/dev, required in prod).
  - `FCM_CREDENTIALS` (string, path or base64 JSON, optional in test/dev, never committed).
  - `FCM_ENABLED` (boolean, default `false` in test/dev to allow mock provider).
  - Update `backend/core/.env.example` with placeholders only.
  Check: `<test> envs` passes: missing required database URL throws; defaults apply; `rg -n "FCM_CREDENTIALS=.{5,}" .env.example` has no matches.
- [ ] **S1.3** Domain exceptions hierarchy in `src/common/exceptions/app.exceptions.ts`:
  - Ensure all error codes from Notifications AGENTS § Errors are declared with their exact HTTP/RPC status codes:
    - `notification_not_found` (404)
    - `invalid_push_token` (422)
    - `validation_error` (422)
  Check: `<test> app.exceptions` passes: unit tests assert exact status and code for each notifications domain exception.
- [ ] **S1.4** Operation patterns in `src/notifications/notifications.patterns.ts`:
  - Declare constants for all 5 operations:
    - `notifications.push-token.register`
    - `notifications.push-token.unregister`
    - `notifications.notification.list`
    - `notifications.notification.unread-count`
    - `notifications.notification.mark-read`
  Check: `rg -n "notifications\." src/notifications/notifications.patterns.ts` contains all pattern constants; no raw strings used outside patterns file.
- [ ] **S1.5** Event definitions in `src/notifications/events/notifications.events.ts`:
  - Typed payload interfaces for consumed events:
    - `t.<tenant>.notifications.send` (`eventId`, `tenantId`, `recipientUserIds`, `templateCode`, `data`, `occurredAt`).
    - `t.<tenant>.attendance.alert_opened` (`eventId`, `tenantId`, `alertId`, `siteId`, `ruleCode`, `occurredAt`).
    - `t.<tenant>.tasks.task_assigned` (`eventId`, `tenantId`, `taskId`, `employeeId`, `siteId`, `title`, `deadline`, `occurredAt`).
    - `t.<tenant>.auth.tenant_suspended`, `tenant_cancelled`, `tenant_reactivated`.
    - `t.<tenant>.billing.subscription_created`, `plan_changed`, `data_retention_expired`.
  Check: `<typecheck>` passes; event interfaces cleanly typed.
- [ ] **S1.6** JetStream consumers setup in `src/notifications/events/notifications-events.service.ts` + `notifications-events.module.ts`:
  - On module startup, creates durable consumers:
    - `notifications-billing` (filtered to `t.*.billing.>`)
    - `notifications-telemetry` (filtered to `t.*.attendance.>`)
    - `notifications-tasks` (filtered to `t.*.tasks.>`)
    - `notifications-auth` (filtered to `t.*.auth.>`)
    - `notifications-generic` (filtered to `t.*.notifications.send`)
  Check: `<test> notifications-events` passes: consumer creation handles missing producer streams with backoff.
- [ ] **S1.7** FCM Provider abstraction `src/notifications/delivery/fcm-provider.interface.ts`:
  - `send(token: string, title: string, body: string, data?: Record<string, string>): Promise<FcmSendResult>`
  - Return type `FcmSendResult`: `{ success: boolean; isUnregistered?: boolean; error?: string }`.
  - Fake FCM provider `fake-fcm-provider.service.ts` for deterministic tests and development without external credentials.
  - Production `firebase-admin-provider.service.ts` initializing `firebase-admin/messaging` when `FCM_ENABLED=true`.
  Check: `<test> fcm-provider` passes: fake provider returns expected mock responses; invalid token flags `isUnregistered: true`.

---

## Phase 2 — Data model (Prisma schema, migrations, PrismaService)

Commits: —

- [ ] **S2.1** Prisma configuration:
  - Create `prisma.notifications.config.ts` pointing to `src/notifications/prisma/schema.prisma`, migrations at `src/notifications/prisma/migrations`, and datasource `NOTIFICATIONS_DATABASE_URL`.
  - Add package scripts in `backend/core/package.json`:
    - `prisma:notifications:generate`
    - `prisma:notifications:migrate:dev`
    - `prisma:notifications:migrate:deploy`
    - `prisma:notifications:migrate:status`
  Check: `pnpm run prisma:notifications:migrate:status` connects or reports status against the configured test database.
- [ ] **S2.2** Schema definition in `src/notifications/prisma/schema.prisma` per AGENTS § Data Model:
  - Enums:
    - `Platform` (`ANDROID`, `IOS`)
    - `NotificationChannel` (`PUSH`, `IN_APP`)
    - `DeliveryStatus` (`PENDING`, `SENT`, `FAILED`)
  - Models:
    - `DeviceToken`: `id`, `tenantId` (`Uuid`), `userId` (`Uuid`), `token` (`String`), `platform` (`Platform`), `isActive` (`Boolean`), `lastSeenAt` (`DateTime`), `createdAt` (`DateTime`).
    - `Notification`: `id`, `tenantId` (`Uuid`), `userId` (`Uuid`), `templateCode` (`String`), `locale` (`String`, default `"es"`), `title` (`String`), `body` (`String`), `data` (Json), `readAt` (`DateTime?`), `sourceEventId` (`String`), `createdAt` (`DateTime`).
    - `NotificationDelivery`: `id`, `tenantId` (`Uuid`), `notificationId` (`Uuid`), `channel` (`NotificationChannel`), `status` (`DeliveryStatus`), `attempts` (`Int`), `lastError` (`String?`), `lastAttemptAt` (`DateTime?`), `sentAt` (`DateTime?`).
    - `TenantState`: `tenantId` (`Uuid`), `isSuspended` (`Boolean`), `updatedAt` (`DateTime`).
    - `TenantFeatures`: `tenantId` (`Uuid`), `features` (Json), `effectiveAt` (`DateTime`).
    - `ProcessedEvent`: `eventId` (`String`), `processedAt` (`DateTime`).
  - Apply `@@map` and `@map` for snake_case table and column mapping, schema `notifications`.
  Check: `pnpm exec prisma validate --config prisma.notifications.config.ts` passes.
- [ ] **S2.3** Schema indexes and constraints in `src/notifications/prisma/schema.prisma`:
  - Unique constraint on `device_tokens(token)`.
  - Unique constraint on `notifications(tenant_id, user_id, source_event_id)` (prevents duplicate notification for same recipient on event redelivery).
  - Unique constraint on `processed_events(event_id)`.
  - Performance indexes:
    - `notifications(tenant_id, user_id, created_at)`
    - `notifications(tenant_id, user_id, read_at)` for unread count lookups.
    - `notification_deliveries(status, attempts)` for retry background job.
    - `device_tokens(tenant_id, user_id, is_active)`
  Check: `prisma:notifications:generate` compiles client successfully without schema errors.
- [ ] **S2.4** First migration `init_notifications`:
  - Run `prisma migrate dev` to generate initial migration file.
  - Verify migration SQL creates schema `notifications` and all declared tables, constraints, and indexes.
  Check: `pnpm run prisma:notifications:migrate:dev --name init_notifications` executes; `pnpm run prisma:notifications:migrate:status` reports schema up to date.
- [ ] **S2.5** Database access layer in `src/notifications/prisma/prisma.service.ts` + `prisma.module.ts`:
  - Extends PrismaClient using `@prisma/adapter-pg` connecting to schema `notifications` via `notifications_svc` role.
  Check: `<test> notifications-prisma` passes: connects to test database and disconnects cleanly.

---

## Phase 3 — Pure domain: Template rendering and localization

Commits: —

- [ ] **S3.1** Template registry & engine `src/notifications/templates/template-registry.ts`:
  - Constants: `DEFAULT_LOCALE = 'es'`.
  - Templates map keyed by `(templateCode, locale)`.
  - Implements required templates (in Spanish):
    - `attendance_alert_opened`: Title: `"Alerta en puesto"`, Body: `"Se ha abierto una alerta en {siteName}: {ruleDescription}"`.
    - `task_assigned`: Title: `"Nueva tarea asignada"`, Body: `"Tenés una nueva tarea pendiente: {title}"`.
    - `billing_invoice_issued`: Title: `"Factura emitida"`, Body: `"Tu factura de {period} por ${total} está disponible. Vence el {dueDate}"`.
    - `billing_due_soon`: Title: `"Próximo vencimiento de factura"`, Body: `"Tu factura de ${total} vence en 3 días ({dueDate})"`.
    - `billing_overdue_notice`: Title: `"Aviso de pago vencido"`, Body: `"Tu factura de ${total} está vencida hace {delayDay} días"`.
    - `billing_suspended`: Title: `"Servicio suspendido"`, Body: `"Tu suscripción ha sido suspendida por falta de pago"`.
    - `billing_data_deletion_warning`: Title: `"Aviso de eliminación de datos"`, Body: `"Tus datos serán eliminados permanentemente el {deletionDate}"`.
  - Logic: Fallback to `DEFAULT_LOCALE` if requested locale not found. If templateCode missing, logs warning and returns null (does not throw or retry indefinitely).
  Check: `<test> template-registry` passes: all templates render expected Spanish title and body with data substitution; fallback to `es` verified; missing templateCode handled gracefully.

---

## Phase 4 — Sub-module Push Tokens

Commits: —

- [ ] **S4.1** `notifications.push-token.register`:
  - Mobile app registers FCM device token with `{ token, platform }`.
  - Validates token is non-empty string and platform is `android` or `ios` (throws 422 `invalid_push_token` if malformed).
  - Upsert logic:
    - If token exists: updates `userId = actor.userId`, `tenantId = actor.tenantId`, `isActive = true`, `lastSeenAt = now()`. (Handles device reassignment when a phone changes hands).
    - If token does not exist: creates new `DeviceToken` row.
  - Returns `{ ok: true }`.
  - Never returns the token or leaks other users' tokens.
  Check: `<test> push-token.register` passes: creates token; reassigns existing token to new user; validates platform enum; invalid token throws 422.
- [ ] **S4.2** `notifications.push-token.unregister`:
  - Mobile app unregisters device token with `{ token }`.
  - Finds `DeviceToken` matching `token` and `userId = actor.userId` and `tenantId = actor.tenantId`.
  - Updates `isActive = false` or removes token.
  - Returns `{ ok: true }`.
  - Cannot unregister another user's token.
  Check: `<test> push-token.unregister` passes: deactivates token; attempting to unregister another user's token has no effect on other user.

---

## Phase 5 — Sub-module In-App Notifications

Commits: —

- [ ] **S5.1** `notifications.notification.list`:
  - Retrieves paginated notifications for `actor.userId` and `actor.tenantId`.
  - Order: `createdAt DESC` (newest first).
  - Optional filter: `unreadOnly: true` (filters `readAt IS NULL`).
  - Returns `{ items, total }`.
  - Strict isolation: a user sees ONLY their own notifications.
  Check: `<test> notification.list` passes: pagination works; unread filter works; user A cannot see user B notifications.
- [ ] **S5.2** `notifications.notification.unread-count`:
  - Returns count of unread notifications for `actor.userId` and `actor.tenantId`: `{ count: number }`.
  Check: `<test> notification.unread-count` passes: counts only unread notifications of the calling user.
- [ ] **S5.3** `notifications.notification.mark-read`:
  - Input: `{ notificationId?: string, all?: boolean }`.
  - If `all: true`: updates `readAt = now()` for all unread notifications of `actor.userId`.
  - If `notificationId` given: updates `readAt = now()` for that specific notification. If not found or belongs to another user/tenant, throws 404 `notification_not_found`.
  - Returns `{ ok: true }`.
  Check: `<test> notification.mark-read` passes: marks single notification read; marks all read; wrong user returns 404.

---

## Phase 6 — Sub-module Delivery Engine & FCM Integration

Commits: —

- [ ] **S6.1** Delivery dispatcher `src/notifications/delivery/delivery.service.ts`:
  - `dispatch(tenantId: string, recipientUserId: string, templateCode: string, data: Record<string, any>, sourceEventId: string): Promise<void>`
  - In a single database transaction:
    - Renders template via `TemplateRegistry` (S3.1).
    - Creates `Notification` row for recipient.
    - Creates `NotificationDelivery` row for channel `IN_APP` with status `SENT`.
    - Queries active `DeviceToken` rows for recipient (`userId`, `tenantId`, `isActive = true`).
    - For each active token: creates `NotificationDelivery` row for channel `PUSH` with status `PENDING`.
  - After commit, for each push delivery:
    - Calls `FcmProvider.send`.
    - If success: updates delivery `status = 'SENT'`, `sentAt = now()`.
    - If failure:
      - If `isUnregistered` or invalid token: updates `DeviceToken.isActive = false` immediately (no retry).
      - Otherwise: updates delivery `status = 'FAILED'`, `attempts = 1`, `lastError = error.message`.
  Check: `<test> delivery.service` passes: in-app notification created even with 0 tokens; active token triggers push; invalid token deactivates token immediately; failures logged with attempts.
- [ ] **S6.2** Delivery retry scheduled job `src/notifications/jobs/delivery-retry.job.ts`:
  - Scheduled via `@nestjs/schedule` (e.g. `@Cron('* * * * *')`, every 1 minute).
  - Queries `NotificationDelivery` where `status = 'FAILED' AND attempts < 3 AND channel = 'PUSH'`.
  - Skips deliveries for tenants where `TenantState.isSuspended === true`.
  - For each failed delivery:
    - Increments `attempts`.
    - Calls `FcmProvider.send`.
    - If success: marks `status = 'SENT'`, `sentAt = now()`.
    - If fail: updates `lastError`, leaves `status = 'FAILED'`.
    - If 3rd attempt fails, status stays permanently `FAILED`.
  Check: `<test> delivery-retry-job` passes: retries failed pushes up to 3 times; stops retrying after 3 failures; suspended tenants skipped.

---

## Phase 7 — Sub-module Event Routing & Recipient Resolution

Commits: —

- [ ] **S7.1** Generic send consumer `t.<tenant>.notifications.send`:
  - Consumes generic notice requests (e.g. from `billing`).
  - Deduplicates by `eventId` in `ProcessedEvent`.
  - For each `recipientUserId` in `recipientUserIds`:
    - Dispatches notification via `DeliveryService` (S6.1).
  - Special rule: If `templateCode` starts with `billing_`, delivery proceeds even if tenant is suspended or cancelled.
  Check: `<test> generic-send-consumer` passes: dispatches to multiple recipients; duplicate eventId deduplicated; billing templates delivered during tenant suspension.
- [ ] **S7.2** Route `t.<tenant>.attendance.alert_opened`:
  - Checks if tenant has `features.alerts` from local `TenantFeatures` copy. If absent, acknowledges and drops event without sending.
  - Resolves recipients: calls `auth.user.list-recipients` facade with `{ tenantId, roles: ['supervisor', 'admin', 'owner'], siteId }`.
  - Dispatches `attendance_alert_opened` template to each resolved supervisor/admin.
  - If facade call fails: handler throws and JetStream redelivers (idempotent).
  Check: `<test> alert-opened-consumer` passes: resolves supervisors for site; basic plan drops alert; pro plan dispatches to supervisors.
- [ ] **S7.3** Route `t.<tenant>.tasks.task_assigned`:
  - Only processes event if `employeeId` is present (skips unassigned site/post tasks).
  - Resolves recipient: calls `organization.employee.get` facade with `{ tenantId, employeeId }` to obtain `userId`.
  - Dispatches `task_assigned` template to that `userId`.
  Check: `<test> task-assigned-consumer` passes: resolves employee userId; dispatches task assigned notice; unassigned task skipped.

---

## Phase 8 — Tenant Lifecycle & Data Purge

Commits: —

- [ ] **S8.1** Consumes `t.<tenant>.auth.tenant_suspended`, `tenant_cancelled`, `tenant_reactivated`:
  - Upserts `TenantState` (`isSuspended = true` for suspended/cancelled, `false` for reactivated).
  - While suspended/cancelled: routed events and non-billing generic sends are dropped; retry job pauses.
  Check: `<test> tenant-state-consumer` passes: sets isSuspended; non-billing sends dropped; resumes on reactivation.
- [ ] **S8.2** Consumes `t.<tenant>.billing.subscription_created` and `plan_changed`:
  - Upserts `TenantFeatures` copy with `features` json and `effectiveAt`.
  - Ignores stale events where `effectiveAt <= stored.effectiveAt`.
  Check: `<test> plan-features-consumer` passes: updates local features copy; enables/disables alert routing.
- [ ] **S8.3** Consumes `t.<tenant>.billing.data_retention_expired` (Tenant data purge):
  - In a database transaction, permanently deletes all tenant records:
    - `DeviceToken`
    - `NotificationDelivery`
    - `Notification`
    - `TenantState`
    - `TenantFeatures`
    - `ProcessedEvent`
  - Idempotent: second delivery finds 0 rows and completes cleanly.
  Check: `<test> data-retention-consumer` passes: all tenant rows deleted; other tenants untouched; idempotent on redelivery.

---

## Phase 9 — HTTP Controllers & Facade Wiring

Commits: —

- [ ] **S9.1** Facade service `src/notifications/notifications.service.ts`:
  - Implements and exports facade methods for all 5 operations:
    - `registerPushToken`
    - `unregisterPushToken`
    - `listNotifications`
    - `getUnreadCount`
    - `markAsRead`
  - No repositories or Prisma services exported outside `NotificationsModule`.
  Check: `<test> notifications.service` passes: facade coordinates token and notification operations cleanly.
- [ ] **S9.2** Push tokens HTTP Controller `src/notifications/http/push-tokens.controller.ts`:
  - `POST /api/v1/push-tokens` -> `notifications.push-token.register` (any authenticated role)
  - `DELETE /api/v1/push-tokens` -> `notifications.push-token.unregister` (any authenticated role)
  - Passes actor `{ userId, tenantId }` to facade.
  Check: `<test> push-tokens.controller` passes: valid token registers; invalid token fails validation; actor passed correctly.
- [ ] **S9.3** Notifications HTTP Controller `src/notifications/http/notifications.controller.ts`:
  - `GET /api/v1/notifications` -> `notifications.notification.list` (any authenticated role)
  - `GET /api/v1/notifications/unread-count` -> `notifications.notification.unread-count` (any authenticated role)
  - `POST /api/v1/notifications/:id/read` -> `notifications.notification.mark-read` (any authenticated role)
  Check: `<test> notifications.controller` passes: lists notifications; marks read; actor passed correctly.

---

## Phase 10 — Close the loop

Commits: —

- [ ] **S10.1** Module registration in `src/app.module.ts`:
  - Import `NotificationsModule` into `AppModule`.
  Check: `<build>` passes cleanly; `rg -n "NotificationsModule" src/app.module.ts` has a hit.
- [ ] **S10.2** Inter-module facade contract with `auth`:
  - Verify `auth.user.list-recipients` facade method is available in `AuthService` and callable in-process:
    - Returns `{ userIds: string[] }` for given `tenantId`, `roles`, and optional `siteId`.
  Check: `<test> auth-notifications-contract` passes: mock call to `auth.user.list-recipients` returns supervisors and admins.
- [ ] **S10.3** Inter-module facade contract with `organization`:
  - Verify `organization.employee.get` facade method is callable in-process:
    - Returns employee with `userId`.
  Check: `<test> organization-notifications-contract` passes: mock call resolves employee userId accurately.

---

## Phase 11 — E2E Tests

Commits: —

- [ ] **S11.1** E2E test harness in `test/e2e/notifications.e2e-spec.ts`:
  - Sets up supertest client against real `AppModule` with test database and mock FCM provider.
  Check: `<e2e> notifications.e2e-spec` executes and connects to test database and NATS instance.
- [ ] **S11.2** Complete notifications lifecycle E2E flow:
  1. User registers device push token via `POST /api/v1/push-tokens`.
  2. Generic send event published (`billing_invoice_issued`) -> notification created.
  3. User lists notifications via `GET /api/v1/notifications` -> finds new notification.
  4. User checks unread count via `GET /api/v1/notifications/unread-count` -> returns 1.
  5. User marks notification as read via `POST /api/v1/notifications/:id/read`.
  6. Unread count becomes 0.
  7. User unregisters push token via `DELETE /api/v1/push-tokens`.
  Check: Full flow passes cleanly from HTTP down to JetStream consumer and database.

---

## Phase 12 — Done checks

Commits: —

- [ ] **S12.1** Grep plant check:
  - Plant a hit in `src/__plant.ts`, confirm grep finds it, delete the file.
  Check: `test ! -e src/__plant.ts`.
- [ ] **S12.2** Quality gate:
  - Run lint, typecheck, unit tests, build, and E2E.
  Check: `<lint>`, `<typecheck>`, `<test>`, `<build>` and `<e2e>` pass without errors or warnings.
- [ ] **S12.3** Tenant & user isolation sweep:
  - Automated test verifying user A of tenant A cannot read, mark read, or count notifications of user B.
  Check: `<test> notifications-isolation` passes 100%.
- [ ] **S12.4** No push tokens or credentials in logs:
  - Confirm tokens and FCM service credentials never reach logger output.
  Check: `rg -n -i "(log|warn|error|debug)\(.*(fcm|token|credential)" src/notifications <EXCL>` is empty.
- [ ] **S12.5** No leftover markers:
  Check: `rg -n "TODO\(notifications\)" src <EXCL>` is empty.
- [ ] **S12.6** Documentation & status update:
  - Update `STEPS.index.md` row B7 to reflect completed status.
  - Update `backend/core/src/notifications/AGENTS.md` § Current Status.
