# STEPS.md — backend / billing

Follow /STEPS.rules.md. Order: /STEPS.index.md (row B3). Backend conventions: /backend/STEPS.template.md.

**Status:** last verified: — · next: S0.1 · in progress: — · blocked: —

Source of truth: `backend/core/src/billing/AGENTS.md` and `backend/core/AGENTS.md`. Commands run from `backend/core/`.

---

## Phase 0 — Contract and prerequisites

Commits: (none, read-only phase)

- [ ] **S0.1** Confirm in `/STEPS.index.md` that row B3 (`core: billing module`) is ready to start and its dependencies (B0 backend foundation, B1 auth module, B2 HTTP layer) are fulfilled.
  Check: `rg -n "^\| B[0-2] " STEPS.index.md` (from repo root) confirms dependencies; row B3 is set to `planned` or `in progress`.
- [ ] **S0.2** Toolchain and backend test stack availability check: Git Bash, `rg`, `pnpm`, Docker compose test stack (`backend/docker-compose.test.yml`).
  Check: `rg --version && pnpm --version && docker compose version` all print clean version output; test database on port 5433 is reachable via `docker compose -f ../docker-compose.test.yml exec postgres-test pg_isready`.
- [ ] **S0.3** Contract inventory: review all 17 facade operations, 9 emitted events, 2 consumed events, and the 5 cron jobs documented in `src/billing/AGENTS.md` and the route map in `backend/core/AGENTS.md`.
  Check: verify no missing operations between `src/billing/AGENTS.md` § NATS Contract and `backend/core/AGENTS.md` § Route map (billing section).

---

## Phase 1 — Foundation (Dependencies, config, exceptions, patterns, JetStream)

Commits: —

- [ ] **S1.1** Verify and install required billing dependencies (approved per rules §6): `@nestjs/schedule` (already installed), Mercado Pago SDK or HTTP client helper, ensure `decimal.js` or Prisma `Decimal` support is active.
  Check: `pnpm ls @nestjs/schedule @prisma/client` lists installed versions; `<build>` passes.
- [ ] **S1.2** Environment variables in `src/config/envs.ts` and `src/config/env.schema.ts` (AGENTS § Environment Variables): `BILLING_DATABASE_URL` (uri postgres), `PAYMENT_PROVIDER` (`mercadopago` | `fake`, default `fake`), `MP_ACCESS_TOKEN` (string, optional when fake), `MP_WEBHOOK_SECRET` (string, optional when fake), `BILLING_TZ` (default `America/Argentina/Buenos_Aires`), `VAT_PERCENT` (default `21`), `TRIAL_DAYS` (default `14`), `DUE_DAYS` (default `10`), `GRACE_DAYS` (default `7`), `DATA_RETENTION_DAYS` (default `90`), `APP_URL` (default `http://localhost:3002`). Update `backend/core/.env.example` with placeholders only.
  Check: `<test> envs` passes: missing required database URL throws; defaults are applied; `rg -n "MP_ACCESS_TOKEN=.{10,}" .env.example` is empty.
- [ ] **S1.3** Domain exceptions hierarchy in `src/common/exceptions/app.exceptions.ts`: ensure all error codes from AGENTS § Errors are present with their exact status codes: `subscription_not_found` (404), `invoice_not_found` (404), `plan_not_found` (404), `invalid_subscription_transition` (409), `invalid_plan_change` (409), `no_pending_cancellation` (409), `invoice_not_payable` (409), `invoice_exists` (409), `invalid_webhook_signature` (401), `payment_provider_error` (502).
  Check: `<test> app.exceptions` passes: one unit test per billing error code asserts exact status and error code.
- [ ] **S1.4** Operation patterns in `src/billing/billing.patterns.ts`: declare constants for all 17 facade operations (`billing.plan.list`, `billing.subscription.get`, `billing.subscription.change-plan`, `billing.subscription.cancel`, `billing.subscription.cancel-undo`, `billing.subscription.resubscribe`, `billing.invoice.list`, `billing.invoice.get`, `billing.invoice.payment-link`, `billing.webhook.mercadopago`, `billing.admin.plan.update`, `billing.admin.subscription.list`, `billing.admin.subscription.extend-trial`, `billing.admin.invoice.list`, `billing.admin.invoice.void`, `billing.admin.invoice.issue`, `billing.admin.invoice.set-fiscal-receipt`, `billing.admin.payment.register`).
  Check: `rg -n "billing\." src/billing/billing.patterns.ts` contains all 17 pattern constants; no raw strings used outside patterns file.
- [ ] **S1.5** Event definitions in `src/billing/events/billing.events.ts`: subject builders and typed payload interfaces for all 9 emitted domain events (`subscription_created`, `plan_changed`, `invoice_issued`, `payment_overdue`, `subscription_expired`, `payment_received`, `subscription_cancelled`, `subscription_reactivated`, `data_retention_expired`), the notification event `t.<tenant>.notifications.send`, and consumed subjects.
  Check: `<typecheck>` passes; event builder functions prepend `t.<tenant>.billing.` and enforce `eventId` (UUID) and `occurredAt` (ISO-8601 UTC).
- [ ] **S1.6** JetStream setup in `src/billing/events/billing-events.service.ts` + `billing-events.module.ts`: on module startup, creates or updates stream `BILLING_EVENTS` capturing `t.*.billing.>` (file storage, max_age 7 days) and creates durable consumer `billing-auth` (filtered to `t.*.auth.tenant_created`), retrying with backoff if the producer stream does not yet exist.
  Check: `<test> billing-events` passes: stream creation config verified; durable consumer creation handles missing stream without crashing.
- [ ] **S1.7** Time abstraction in `src/billing/common/clock.service.ts`: injectable clock service (`now(): Date`) with test implementation allowing simulated time travel for jobs and delay calculations.
  Check: `<test> clock` passes: mock clock allows advancing time deterministically.

---

## Phase 2 — Data model (Prisma schema, migrations, PrismaService)

Commits: —

- [ ] **S2.1** Prisma configuration: create `prisma.billing.config.ts` pointing to `src/billing/prisma/schema.prisma`, migrations at `src/billing/prisma/migrations`, and datasource `BILLING_DATABASE_URL`. Add package scripts in `package.json`: `prisma:billing:generate`, `prisma:billing:migrate:dev`, `prisma:billing:migrate:deploy`, `prisma:billing:migrate:status`.
  Check: `pnpm run prisma:billing:status` connects or reports status against the configured test database.
- [ ] **S2.2** Schema definition in `src/billing/prisma/schema.prisma` per AGENTS § Data Model:
  - Enums: `PlanCode` (`BASIC`, `PRO`), `SubscriptionStatus` (`TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`), `InvoiceStatus` (`ISSUED`, `PAID`, `VOID`), `InvoiceLineKind` (`PLAN`, `VAT`), `PaymentProviderType` (`MERCADOPAGO`, `MANUAL`), `PaymentStatus` (`APPROVED`, `NEEDS_REVIEW`, `REJECTED`).
  - Models: `Plan`, `Subscription`, `SubscriptionPlanChange`, `Invoice`, `InvoiceLine`, `Payment`, `WebhookNotification`, `ProcessedEvent`.
  - Field rules: `tenantId` mapped to `tenant_id` (`@db.Uuid`), money fields as `Decimal @db.Decimal(12, 2)`, timestamps as `@db.Timestamptz(3)`. All tables and columns mapped to snake_case via `@@map` and `@map`.
  Check: `pnpm exec prisma validate --config prisma.billing.config.ts` passes.
- [ ] **S2.3** Schema indexes and constraints in `src/billing/prisma/schema.prisma` and raw SQL migration (`teamworkflow-postgres`):
  - Partial unique index on `subscriptions(tenant_id)` where `status <> 'CANCELLED'`.
  - Partial unique index on `invoices(tenant_id, period)` where `status <> 'VOID'`.
  - Unique constraint on `payments(provider, provider_payment_id)`.
  - Unique constraint on `webhook_notifications(notification_id)`.
  - Unique constraint on `processed_events(event_id)`.
  - Performance indexes: `invoices(tenant_id, status, due_date)`, `invoices(tenant_id, period)`, `subscriptions(status, trial_ends_at)`, `payments(invoice_id)`.
  Check: migration SQL file contains the two partial unique indexes (`CREATE UNIQUE INDEX ... WHERE status <> ...`).
- [ ] **S2.4** First migration `init_billing`: run migration against dev and test databases.
  Check: `pnpm run prisma:billing:migrate:dev --name init_billing` succeeds; `pnpm run prisma:billing:migrate:status` reports database schema up to date.
- [ ] **S2.5** Database access layer in `src/billing/prisma/prisma.service.ts` + `prisma.module.ts`: instantiate PrismaClient using `@prisma/adapter-pg` connecting to schema `billing` via `billing_svc` role.
  Check: `<test> billing-prisma` connects to test database, executes a basic query, and disconnects cleanly on shutdown.
- [ ] **S2.6** Catalog seed in `src/billing/prisma/seed-plans.ts`: seeds `Plan` table with `BASIC` (ARS fixed price, `{ tasks: false, alerts: false, tower: false }`) and `PRO` (ARS fixed price, `{ tasks: true, alerts: true, tower: true }`).
  Check: `<test> seed-plans` executes idempotently (running twice results in exactly 2 plans).

---

## Phase 3 — Pure domain: Money calculation and subscription state machine

Commits: —

- [ ] **S3.1** Money arithmetic and invoice calculation engine `src/billing/domain/money-calculator.ts` (AGENTS § Money rules):
  - Pure TypeScript, zero I/O, zero float arithmetic (`Prisma.Decimal` or `decimal.js` only).
  - Billable days factor: `billableDays / daysInPeriod`.
  - Plan line: `round(price * factor, 2, HALF_UP)`.
  - VAT line: `round(planLine * (VAT_PERCENT / 100), 2, HALF_UP)`.
  - Total: exact sum of already rounded lines.
  Check: `<test> money-calculator` passes table-driven cases: full month (factor 1.0), prorated mid-month (18/30 days), resubscription prorating, rounding boundary cases (half-up at .005); `rg -n "number" src/billing/domain/money-calculator.ts <EXCL>` shows zero floating point arithmetic.
- [ ] **S3.2** Subscription lifecycle state machine `src/billing/domain/subscription-state-machine.ts` (AGENTS § Subscription lifecycle):
  - Pure domain transition validator.
  - Allowed transitions: `TRIAL -> ACTIVE`, `ACTIVE -> PAST_DUE`, `PAST_DUE -> SUSPENDED`, `PAST_DUE -> ACTIVE`, `SUSPENDED -> ACTIVE`, and `(TRIAL | ACTIVE | PAST_DUE | SUSPENDED) -> CANCELLED`.
  - `CANCELLED` is strictly terminal: any transition from `CANCELLED` throws `invalid_subscription_transition` (409).
  - Any other invalid transition throws `invalid_subscription_transition` (409).
  Check: `<test> subscription-state-machine` passes: matrix test covers every allowed transition and asserts failure for every forbidden transition.

---

## Phase 4 — Plans sub-module

Commits: —

- [ ] **S4.1** `billing.plan.list`: retrieves all active plans with ARS monthly prices and JSON feature flags. Accessible by owner and admin.
  Check: `<test> plan.list` passes: returns array of plans containing `{ code, name, monthlyPrice, features }`.
- [ ] **S4.2** `billing.admin.plan.update`: platform admin operation to update `monthlyPrice` and `features` of a plan.
  Check: `<test> admin.plan.update` passes: non-platform-admin actor gets `forbidden` (403); platform_admin updates price; verifies that existing invoices are not altered.

---

## Phase 5 — Subscriptions sub-module & trial lifecycle

Commits: —

- [ ] **S5.1** `billing.subscription.get`: returns current subscription for actor's tenant: `plan`, `status`, `trialEndsAt`, `nextPlan`, `cancelAtPeriodEnd`, `features`.
  Check: `<test> subscription.get` passes: tenant A actor cannot see tenant B subscription; returns full feature flags.
- [ ] **S5.2** `billing.subscription.change-plan`:
  - Upgrade to `PRO`: applies immediately, records `SubscriptionPlanChange` with `effectiveAt = now()`, emits `t.<tenant>.billing.plan_changed` with updated features.
  - Downgrade to `BASIC`: sets `nextPlan = BASIC` without changing active plan or features until period end close.
  - Same plan selected throws `invalid_plan_change` (409).
  Check: `<test> subscription.change-plan` passes: upgrade emits event and applies immediately; downgrade sets `nextPlan` without immediate event.
- [ ] **S5.3** `billing.subscription.cancel`: sets `cancelAtPeriodEnd = true`. Does not terminate subscription immediately; status stays unchanged until period close.
  Check: `<test> subscription.cancel` passes: `cancelAtPeriodEnd` becomes true; subscription status remains active; no immediate `subscription_cancelled` event is emitted.
- [ ] **S5.4** `billing.subscription.cancel-undo`: clears `cancelAtPeriodEnd`. If `cancelAtPeriodEnd` was not true, throws `no_pending_cancellation` (409).
  Check: `<test> subscription.cancel-undo` passes: clears flag; calling on subscription without pending cancellation returns 409 `no_pending_cancellation`.
- [ ] **S5.5** `billing.subscription.resubscribe`: valid ONLY when tenant has a `CANCELLED` subscription. Creates a NEW subscription in `ACTIVE` status (no trial), chosen plan, emits `plan_changed` and `subscription_reactivated`. Rejects if current subscription is not `CANCELLED`.
  Check: `<test> subscription.resubscribe` passes: active subscription returns `invalid_subscription_transition`; cancelled subscription creates new row, emits `plan_changed` and `subscription_reactivated`.
- [ ] **S5.6** Platform admin subscription operations:
  - `billing.admin.subscription.list`: returns paginated subscriptions across all tenants.
  - `billing.admin.subscription.extend-trial`: extends `trialEndsAt` for target tenant while in `TRIAL`. Fails with 409 if status is not `TRIAL`.
  Check: `<test> admin.subscription` passes: non-platform-admin gets 403; extend-trial updates `trialEndsAt`; extending active subscription fails with 409.
- [ ] **S5.7** Trial expiration background job: hourly scheduled job. Finds subscriptions in `TRIAL` where `trialEndsAt <= now()`. Transitions them to `ACTIVE` status without billing trial days.
  Check: `<test> trial-job` passes: subscriptions with future `trialEndsAt` remain `TRIAL`; expired trials become `ACTIVE`.

---

## Phase 6 — Monthly invoicing sub-module

Commits: —

- [ ] **S6.1** Monthly close engine `src/billing/invoicing/monthly-close.service.ts`:
  - Runs on day 1 of each month at 03:00 `BILLING_TZ`.
  - Closes the previous calendar month for all billable subscriptions.
  - Calculates highest plan active during the period using `SubscriptionPlanChange` history.
  - Computes billable days and calls `money-calculator` (S3.1).
  - Inserts `Invoice` and `InvoiceLine` items in a single database transaction.
  - Emits `t.<tenant>.billing.invoice_issued` and notice request `t.<tenant>.notifications.send` (`billing_invoice_issued`) after commit.
  - Due date set to issue date + `DUE_DAYS` (10 days).
  Check: `<test> monthly-close` passes: happy path creates invoice with lines; running twice for the same period is idempotent (second run skips or fails gracefully on unique index); zero billable days produces no invoice.
- [ ] **S6.2** Transition application in monthly close:
  - After invoice generation, if `nextPlan` is present, applies downgrade and emits `t.<tenant>.billing.plan_changed`.
  - If `cancelAtPeriodEnd` is true, sets status `CANCELLED`, `endedAt = periodEnd`, and emits `t.<tenant>.billing.subscription_cancelled`.
  Check: `<test> monthly-close-transitions` passes: closed month is billed at the pre-downgrade / pre-cancel rate; events emitted only after database commit.
- [ ] **S6.3** `billing.admin.invoice.issue`: platform admin manual trigger to issue invoice for target `tenantId` and `period`. Fails with `invoice_exists` (409) if a non-void invoice exists for that period.
  Check: `<test> admin.invoice.issue` passes: generates invoice; second call for same period returns 409 `invoice_exists`.
- [ ] **S6.4** `billing.admin.invoice.void`: platform admin voids invoice with mandatory `reason`. Updates status to `VOID`, records `voidedAt`, `voidReason`, and `voidedByUserId`. Frees the period for re-issuance.
  Check: `<test> admin.invoice.void` passes: invoice marked `VOID`; period can now be re-issued; missing reason throws 422 `validation_error`.
- [ ] **S6.5** `billing.admin.invoice.set-fiscal-receipt`: platform admin attaches external fiscal receipt identifier (`receiptNumber`). Does not modify any financial totals.
  Check: `<test> admin.invoice.set-fiscal-receipt` passes: stores `fiscalReceiptNumber`; totals remain strictly untouched.

---

## Phase 7 — Payments & PaymentProvider (Mercado Pago + Fake)

Commits: —

- [ ] **S7.1** `PaymentProvider` interface definition `src/billing/payments/payment-provider.interface.ts`:
  - `createPaymentLink(invoice: Invoice): Promise<{ url: string; expiresAt: Date }>`
  - `getPayment(paymentId: string): Promise<ProviderPaymentDetails>`
  - `searchPaymentsByReference(invoiceId: string): Promise<ProviderPaymentDetails[]>`
  - `validateWebhook(headers: Record<string, string>, rawBody: Buffer | string): Promise<{ isValid: boolean; notificationId: string; paymentId?: string }>`
  Check: `<typecheck>` passes; interface is cleanly decoupled from NestJS HTTP controller.
- [ ] **S7.2** Fake payment provider implementation `src/billing/payments/fake-payment-provider.service.ts`: provides deterministic simulation for tests and local development (`PAYMENT_PROVIDER=fake`).
  Check: `<test> fake-payment-provider` passes: generates mock URLs, validates test signatures, and returns simulated payment objects.
- [ ] **S7.3** Mercado Pago payment provider implementation `src/billing/payments/mercadopago-provider.service.ts`:
  - Payment link with `external_reference = invoice.id`, `currency = 'ARS'`, expiry = `dueDate + GRACE_DAYS`.
  - Signature validation adhering strictly to official Mercado Pago HMAC-SHA256 documentation using `MP_WEBHOOK_SECRET`.
  - Direct fetch of payment details via Mercado Pago REST API (`v1/payments/{id}`). Never trusts webhook payload.
  Check: `<test> mercadopago-provider` passes: valid HMAC passes; tampered payload or signature fails; payment fetch handles API errors cleanly (`payment_provider_error` 502).
- [ ] **S7.4** `billing.invoice.payment-link`: retrieves or generates payment link for issued unpaid invoice. Regenerates link if previous one expired.
  Check: `<test> payment-link` passes: returns `{ url, expiresAt }`; paid or void invoice returns `invoice_not_payable` (409); expired link is regenerated.
- [ ] **S7.5** `billing.webhook.mercadopago`:
  - Receives raw body and headers.
  - Validates signature: throws 401 `invalid_webhook_signature` on invalid signature.
  - Idempotent deduplication via `WebhookNotification` table by `notificationId`.
  - Fetches payment details from provider.
  - Validates: status `APPROVED`, currency `ARS`, amount equals invoice balance, and target invoice belongs to same tenant.
  - If valid: records `Payment` (`APPROVED`), marks `Invoice` as `PAID` with `paidAt`, and emits `payment_received` (if no other overdue unpaid invoices remain for tenant).
  - If mismatch (partial, overpayment, currency mismatch, wrong tenant): records `Payment` (`NEEDS_REVIEW`) and leaves invoice unchanged.
  Check: `<test> webhook.mercadopago` passes: invalid signature returns 401; duplicate webhook is no-op (returns ok); matching payment marks invoice paid and emits `payment_received`; mismatching amount sets `NEEDS_REVIEW` and leaves invoice unpaid.
- [ ] **S7.6** `billing.admin.payment.register`: platform admin manual registration of bank transfer. Requires `invoiceId`, `amount`, `paidAt`, `reference`. Applies same payment approval rules as S7.5.
  Check: `<test> admin.payment.register` passes: non-platform-admin gets 403; correct amount marks invoice `PAID`; amount mismatch flags `NEEDS_REVIEW`.
- [ ] **S7.7** Mercado Pago daily reconciliation job (06:00 `BILLING_TZ`): queries `searchPaymentsByReference` for all issued unpaid invoices to capture payments missed due to lost webhooks.
  Check: `<test> reconciliation-job` passes: finds unpaid invoices, checks provider, and reconciles approved payments.

---

## Phase 8 — Collections sub-module

Commits: —

- [ ] **S8.1** `billing.invoice.list` and `billing.invoice.get`:
  - `billing.invoice.list`: paginated list of invoices for caller's tenant with status and period filters.
  - `billing.invoice.get`: detailed invoice by ID including line items and payments.
  Check: `<test> invoice.queries` passes: tenant isolation verified (tenant A cannot view tenant B invoice -> 404 `invoice_not_found`).
- [ ] **S8.2** Collections daily background job (09:00 `BILLING_TZ`):
  - Invoices due in 3 days: send notice `billing_due_soon` via `t.<tenant>.notifications.send`.
  - Delay day 1 (first day after due date): if still unpaid, set subscription status to `PAST_DUE`, emit `payment_overdue`, send notice `billing_overdue_notice` (`delayDay: 1`).
  - Delay days 4 and 6: send notice `billing_overdue_notice` (`delayDay: 4` or `6`).
  - Delay day 7 (`GRACE_DAYS`): transition subscription to `SUSPENDED`, emit `subscription_expired`, send notice `billing_suspended`.
  - Deterministic event IDs (`billing:<templateCode>:<invoiceId>:<delayDay>`) to ensure idempotency.
  - Cancelled subscriptions are skipped by collections.
  Check: `<test> collections-job` passes: tests each delay threshold (days -3, 1, 4, 6, 7); verified that due date is the last day to pay (delay day 1 is day after due date); cancelled subscriptions untouched.
- [ ] **S8.3** Reactivation on payment: when an overdue invoice is fully paid, check if any other overdue unpaid invoice exists for the tenant. If none remain, transition subscription back to `ACTIVE` and emit `t.<tenant>.billing.payment_received`.
  Check: `<test> collections-reactivation` passes: paying 1 of 2 overdue invoices does not reactivate; paying the last overdue invoice transitions `PAST_DUE` / `SUSPENDED` back to `ACTIVE` and emits `payment_received`.

---

## Phase 9 — Data retention sub-module

Commits: —

- [ ] **S9.1** Data retention background job (09:00 `BILLING_TZ`):
  - 7 days before retention expiration (`endedAt + 83 days`): sends warning notice `billing_data_deletion_warning` with deterministic event ID.
  - At 90 days (`endedAt + DATA_RETENTION_DAYS`): emits `t.<tenant>.billing.data_retention_expired` once and records `dataRetentionExpiredAt`.
  - If tenant resubscribed (has a new active subscription), nothing is emitted.
  Check: `<test> data-retention-job` passes: warning sent at day 83; event emitted at day 90; resubscribed tenant skipped.
- [ ] **S9.2** Internal billing purge handler (consumes `t.<tenant>.billing.data_retention_expired`):
  - Purges tenant's `SubscriptionPlanChange`, `ProcessedEvent`, `WebhookNotification`, and payment links.
  - Retains `Invoice`, `InvoiceLine`, `Payment`, and minimal `Subscription` stub (`id`, `tenantId`, `plan`, `status`, `endedAt`) for legal/accounting records.
  - Idempotent execution.
  Check: `<test> billing-purge` passes: transient data deleted; invoices and payments preserved; other tenants completely untouched.

---

## Phase 10 — HTTP Controllers, Facade & HTTP Layer Wiring

Commits: —

- [ ] **S10.1** Facade service `src/billing/billing.service.ts`: implement and export facade methods for all 17 operations declared in `src/billing/billing.patterns.ts`. No internal repositories or Prisma services are exported outside `BillingModule`.
  Check: `<test> billing.service` passes: facade coordinates sub-modules cleanly; only facade is exported from `BillingModule`.
- [ ] **S10.2** Tenant HTTP controller `src/billing/http/billing.controller.ts`:
  - `GET /api/v1/billing/plans` -> `billing.plan.list` (owner, admin)
  - `GET /api/v1/billing/subscription` -> `billing.subscription.get` (owner, admin)
  - `POST /api/v1/billing/subscription/change-plan` -> `billing.subscription.change-plan` (owner, admin)
  - `POST /api/v1/billing/subscription/cancel` -> `billing.subscription.cancel` (owner, admin)
  - `POST /api/v1/billing/subscription/cancel-undo` -> `billing.subscription.cancel-undo` (owner, admin)
  - `POST /api/v1/billing/subscription/resubscribe` -> `billing.subscription.resubscribe` (owner, admin)
  - `GET /api/v1/billing/invoices` -> `billing.invoice.list` (owner, admin)
  - `GET /api/v1/billing/invoices/:invoiceId` -> `billing.invoice.get` (owner, admin)
  - `POST /api/v1/billing/invoices/:invoiceId/payment-link` -> `billing.invoice.payment-link` (owner, admin)
  - Enforces `@Roles('owner', 'admin')`; passes validated actor `{ userId, tenantId, role }` to facade.
  Check: `<test> billing.controller` passes: role guard blocks supervisor/employee (403 `forbidden`); actor tenant is passed to facade.
- [ ] **S10.3** Platform admin HTTP controller `src/billing/http/billing-admin.controller.ts`:
  - `PUT /api/v1/billing/admin/plans/:plan` -> `billing.admin.plan.update`
  - `GET /api/v1/billing/admin/subscriptions` -> `billing.admin.subscription.list`
  - `POST /api/v1/billing/admin/subscriptions/:tenantId/extend-trial` -> `billing.admin.subscription.extend-trial`
  - `GET /api/v1/billing/admin/invoices` -> `billing.admin.invoice.list`
  - `POST /api/v1/billing/admin/invoices/:invoiceId/void` -> `billing.admin.invoice.void`
  - `POST /api/v1/billing/admin/invoices` -> `billing.admin.invoice.issue`
  - `PUT /api/v1/billing/admin/invoices/:invoiceId/fiscal-receipt` -> `billing.admin.invoice.set-fiscal-receipt`
  - `POST /api/v1/billing/admin/payments` -> `billing.admin.payment.register`
  - Enforces `@Roles('platform_admin')`; accepts target `tenantId` in payload/path for platform_admin only.
  Check: `<test> billing-admin.controller` passes: tenant roles receive 403 `forbidden`; platform_admin executes all operations.
- [ ] **S10.4** Webhook HTTP controller `src/billing/http/billing-webhook.controller.ts`:
  - `POST /api/v1/webhooks/mercadopago`: marked `@Public()`, raw body capture enabled, CSRF exempted, rate limited per IP.
  - Hands raw body buffer and headers to `billing.webhook.mercadopago`.
  Check: `<test> webhook.controller` passes: accessible without JWT; passes raw body and headers to facade.
- [ ] **S10.5** Plan feature gating integration in HTTP layer (`backend/core/AGENTS.md` § Plan gating): verify `@RequiresFeature()` decorator in `src/http/decorators/` against `actor.features` populated by `auth.token.verify`. Returns 403 `feature_not_in_plan` when feature is absent or false.
  Check: `<test> feature-gating` passes: routes with `@RequiresFeature('tasks')` allow PRO tenant and return 403 `feature_not_in_plan` for BASIC tenant.

---

## Phase 11 — Events consumed (JetStream)

Commits: —

- [ ] **S11.1** Consumes `t.<tenant>.auth.tenant_created`:
  - Handler receives event with `tenantId`.
  - Creates trial subscription in status `TRIAL` with plan `PRO`, `trialEndsAt = now + TRIAL_DAYS`.
  - Emits `t.<tenant>.billing.subscription_created` carrying full features dictionary.
  - Idempotent: duplicate event with same `eventId` or existing subscription is a no-op.
  Check: `<test> tenant-created-consumer` passes: subscription created with PRO plan and trial period; duplicate `eventId` skips creation; tenant mismatch between subject and payload throws and does not ack.
- [ ] **S11.2** Consumes `t.<tenant>.billing.data_retention_expired`:
  - Consumes self-published data retention event.
  - Executes internal billing purge (S9.2).
  Check: `<test> data-retention-consumer` passes: handles event, runs purge, records deduplication in `ProcessedEvent`.

---

## Phase 12 — Close the loop

Commits: —

- [ ] **S12.1** Wire `BillingModule` in `backend/core/src/app.module.ts`: import `BillingModule` alongside `AuthModule` and `OrganizationModule`.
  Check: `<build>` passes cleanly; `rg -n "BillingModule" src/app.module.ts` has a hit in imports.
- [ ] **S12.2** Docker compose environment and init scripts:
  - Add `BILLING_DATABASE_URL` in `backend/docker-compose.yml` and `backend/docker-compose.test.yml`.
  - Ensure init script grants proper schema ownership for `billing_svc` on schema `billing`.
  Check: `docker compose -f ../docker-compose.yml config` passes validation; schema isolation check: `psql -U billing_svc -d teamworkflow -c "select 1 from auth.users"` fails with permission denied.
- [ ] **S12.3** Cross-module contract validation: verify that `auth` module consumes `billing.subscription_created` and `billing.plan_changed` to update tenant plan and features, and verify `auth.user.list-recipients` facade call works in-process.
  Check: `<test> billing-auth-contract` passes: mock `auth.user.list-recipients` returns recipients; billing events carry `{ plan, features }`.

---

## Phase 13 — E2E

Commits: —

- [ ] **S13.1** E2E test harness for billing in `test/e2e/billing.e2e-spec.ts`: setup test harness running against `backend/docker-compose.test.yml` with clean database seeding and fake payment provider.
  Check: `<e2e> billing.e2e-spec` executes and connects to test database and NATS test instance.
- [ ] **S13.2** Complete lifecycle E2E flow:
  1. Tenant registers -> `tenant_created` -> billing creates trial subscription (`subscription_created`).
  2. Trial expires -> subscription becomes `active`.
  3. Monthly close executes -> invoice issued with lines (plan + VAT) -> payment link generated.
  4. Webhook arrives from Mercado Pago -> payment approved -> invoice marked `paid` -> `payment_received` emitted.
  5. Plan upgrade to PRO -> `plan_changed` emitted immediately -> next month billed at PRO rate.
  6. Cancellation requested -> stays active until end of month -> monthly close runs -> subscription status becomes `cancelled`.
  Check: `<e2e> billing` passes all steps in sequence on the real HTTP and event transport.

---

## Phase 14 — Done checks

Commits: —

- [ ] **S14.1** Grep plant check: plant a hit for each grep check in `src/__plant.ts`, confirm each grep finds it, delete the file.
  Check: `test ! -e src/__plant.ts`.
- [ ] **S14.2** Quality gate: lint, typecheck, unit tests, build, and E2E all pass.
  Check: `<lint>`, `<typecheck>`, `<test>`, `<build>` and `<e2e>` pass without errors or warnings.
- [ ] **S14.3** Tenant isolation sweep: automated test for every query and mutation asserting that an actor of tenant A cannot read or mutate tenant B billing resources.
  Check: `<test> billing-tenant-isolation` passes with 100% assertions satisfied.
- [ ] **S14.4** Zero float check: verify no JavaScript `number` floating-point arithmetic is used anywhere in money calculations.
  Check: `rg -n "(\+|-|\*|/)\s*[0-9]+(\.[0-9]+)?" src/billing/domain <EXCL>` is empty; all calculations use `Decimal`.
- [ ] **S14.5** No secrets or tokens in logs: confirm no credentials, webhook signatures, tokens, or card data reach logger.
  Check: `rg -n -i "(log|warn|error|debug)\(.*(password|token|hash|secret|signature|card)" src/billing <EXCL>` is empty.
- [ ] **S14.6** No leftover markers: check for unresolved billing TODOs.
  Check: `rg -n "TODO\(billing\)" src <EXCL>` is empty.
- [ ] **S14.7** Update documentation and indices: update `/STEPS.index.md` row B3 status, and ensure `backend/core/src/billing/AGENTS.md` and `backend/core/README.md` reflect the built module.
  Check: `rg -n "^\| B3 " STEPS.index.md` reflects current status.

---

## Blocked

| Step | Waits for |
|------|-----------|
| — | — |

## Decisions

- **2026-10-24 · user · Architecture decision.** Billing is a module of `backend/core` (modular monolith), not a standalone service. HTTP controllers live in `src/billing/http/`. JetStream is used for events; no NATS request-reply responders are exposed by billing (operations are in-process facade calls).
- **2026-10-24 · user · Money & Currency.** Single currency `ARS`. Half-up rounding per line. Zero floating point numbers in monetary calculations (`Prisma.Decimal` used everywhere).
- **2026-10-24 · user · Cancellation timing.** Cancellation always takes effect at the end of the period. The final invoice covers the full month (or prorated first month). No mid-month early termination or mid-month prorating.
- **2026-10-24 · user · Resubscription.** Reactivation does not wait for a payment. Creates a new active subscription with the selected plan without trial. First invoice is prorated from the day of resubscription to end of month.
- **2026-10-24 · user · Due date & delay.** Due date is the last day to pay. Delay day 1 is the day after due date.

## Defaults to confirm

- DEFAULT(billing): Mercado Pago webhook verification uses HMAC-SHA256 according to latest Mercado Pago Webhooks v1 specifications.
- DEFAULT(billing): Invoicing period aligns with calendar months in `America/Argentina/Buenos_Aires` (`BILLING_TZ`).
- DEFAULT(billing): Notifications are requested via `t.<tenant>.notifications.send` with deterministic `eventId`s. Billing does not send direct emails or SMS.
