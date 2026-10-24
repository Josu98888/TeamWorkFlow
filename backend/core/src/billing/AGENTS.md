# AGENTS.md — `billing` module (`backend/core`)

Guide for coding agents working on the `billing` module of `backend/core`. Read `backend/core/AGENTS.md` (core-wide rules: module boundaries, HTTP layer, event bus) and then this file fully before making changes. This file overrides the root `AGENTS.md` and `backend/core/AGENTS.md` for the `billing` domain rules when they conflict. Code patterns live in `skills/teamworkflow-nest`; migrations in `skills/teamworkflow-prisma-migrations`.

## What this module is

`billing` charges for the platform. It knows which plan each tenant has, what it owes and whether it paid. When a tenant does not pay it announces it so `auth` can restrict access; when it pays it announces that too. It is a module of the `backend/core` modular monolith (`src/billing/`, `BillingModule`) with internal sub-modules `plans`, `subscriptions`, `invoicing`, `payments` and `collections`. Other core modules reach it only through its exported facade service or its events; it can be extracted to its own service later without changing its event consumers (`docs/architecture.md`). Keep the sub-modules separable (a sub-module never reads another sub-module's tables, it calls the other's exported service).

Responsibilities:

- **plans:** the catalog (`basic`, `pro`) with a FIXED monthly price in ARS and the features each plan enables.
- **subscriptions:** one subscription per tenant: trial, active, past due, suspended or cancelled, plan changes and cancellation. The state machine is a pure domain module.
- **invoicing:** the monthly close, in arrears, that computes and issues one invoice per tenant.
- **payments:** Mercado Pago payment links and webhook, manual payments registered by the platform admin, daily reconciliation. Everything behind a `PaymentProvider` interface.
- **collections:** reminders, overdue handling, suspension and reactivation signals, and the data retention countdown of cancelled tenants. Notices go through `notifications`.

Out of scope (do NOT implement here):

- Tenants and users: owned by `auth`. Billing only knows the `tenantId`.
- Deleting the identity data and the operational data of a cancelled tenant: each module of `core` and `telemetry` purge their own when they consume `data_retention_expired` (billing only decides WHEN, and purges its own data).
- Delivering notifications (push, in-app): owned by `notifications`. Billing asks for them with `t.<tenant>.notifications.send`.
- Emails and SMS: there are none in the platform for now.
- Fiscal e-invoice (ARCA): out of the MVP. An invoice here is an internal statement; a person issues the fiscal receipt elsewhere and a platform admin stores its external number.
- Automatic card debit, annual plans, usage metering, per-employee pricing, add-ons, other currencies, coupons and the Enterprise plan. Future work; ask before adding.
- Storing or handling card data. Payment happens in Mercado Pago.

## Stack

- NestJS 12 module inside `backend/core`; HTTP controllers for this module's endpoints (including the public Mercado Pago webhook) live in `src/billing/` (see `backend/core/AGENTS.md`). NATS is used for JetStream events only: this module answers no NATS requests.
- PostgreSQL + Prisma 7 with its own `prisma/schema.prisma` in the `billing` schema of the shared `teamworkflow` database, accessed through its own Prisma client with its own `billing_svc` role that cannot read other schemas (see `backend/STEPS.md` S1.1). Not installed yet.
- `class-validator` + `class-transformer` with the global `ValidationPipe` of `core` (422 `validation_error`). Not installed yet.
- Scheduling for the jobs (for example `@nestjs/schedule`). Not installed yet.
- Mercado Pago access behind the `PaymentProvider` interface (an own HTTP client or the official SDK; ask before installing anything).
- Env validation with joi in `src/config/envs.ts`, same pattern as the rest of `core`.
- Jest for tests.

Ask before installing any dependency.

## Current Status (READ FIRST)

`backend/core` exists (scaffold, HTTP layer and `auth` module) but this module is not built. This folder contains only this `AGENTS.md`: there is no `BillingModule`, no Prisma schema, no controllers.

First tasks, in order (ask before each install):

- [ ] Create `BillingModule` in `backend/core/src/billing/` (needs `backend/core` from T6), its config in `src/config/envs.ts` and `.env.example`.
- [ ] Pure domain module: money calculation and subscription state machine, with table tests.
- [ ] Prisma schema and first migration (`Plan`, `Subscription`, `Invoice`).
- [ ] Consumer of `auth.tenant_created`, plans and subscriptions sub-modules.
- [ ] Invoicing (monthly close), payments (`fake` provider first, then Mercado Pago) and collections jobs.
- [ ] Expose the module routes through its HTTP controllers in `core` (including the public webhook route, with raw body capture) and wire the plan gating in the HTTP layer of `core`.

## Money rules (non-negotiable)

1. NEVER use `number`/floating point for money. Use Prisma `Decimal` (`numeric(12,2)` in PostgreSQL) and decimal arithmetic with half-up rounding.
2. Round half-up to 2 decimals PER LINE. The total is the sum of the already rounded lines.
3. An issued invoice is immutable. To correct it, void it (with a reason) and issue a new one.
4. Each invoice copies the prices it used (plan price, VAT percent). Changing a price never alters existing invoices.
5. Single currency in the MVP: `ARS`.
6. Never receive, store or log card data.
7. Never trust the amount or status carried by a webhook: ALWAYS fetch the payment from the Mercado Pago API.

## Business Rules

### Plans

| Plan | Features | Price |
|------|----------|-------|
| `basic` | sites, employees, shifts, attendance | fixed monthly ARS price |
| `pro` | everything in `basic` + tasks and forms, alerts and the Torre de Control | fixed monthly ARS price |

- The price is per plan, NOT per employee, and there is no usage metering.
- Features are stored per plan as a JSON object, for example `{ "tasks": true, "alerts": true, "tower": true }` (`basic` has them all `false`). The HTTP layer of `core` maps routes to feature keys (see Plan gating).
- Enterprise is future work.
- A price change applies from the NEXT invoice issued; invoices already issued keep the price they copied. Only a `platform_admin` can change prices and features.

### Subscription lifecycle

States: `trial`, `active`, `past_due`, `suspended`, `cancelled`.

```text
trial ──(trial ends)──▶ active ──(invoice overdue)──▶ past_due ──(grace ends)──▶ suspended
                          ▲                              │                           │
                          └──────────(full payment)──────┴───────────────────────────┘
any state ──(cancellation effective at month end)──▶ cancelled
```

- Allowed transitions: `trial→active`, `active→past_due`, `past_due→suspended`, `past_due→active`, `suspended→active`, and `trial|active|past_due|suspended→cancelled`. `cancelled` is terminal for that subscription: resubscribing creates a NEW subscription (see Plan change and cancellation). Anything else is `invalid_subscription_transition` (409): never force a state.
- The validation lives in a pure domain module (no I/O, no Prisma, no Nest) with one test per allowed and per forbidden transition.
- **Creation:** on `t.<tenant>.auth.tenant_created`, create the subscription in `trial` with plan `pro` and `trialEndsAt = now + TRIAL_DAYS` (14). Idempotent: a tenant that already has a subscription is a no-op. Emit `subscription_created`.
- **Trial end:** a job moves `trial` to `active` when `trialEndsAt` passes (no payment method is asked). The plan stays `pro` unless the tenant changed it. Trial days are never billed.
- **Platform admin** can extend the trial (`billing.admin.subscription.extend-trial`) while the subscription is still in `trial`.

### Plan change and cancellation

- **Upgrade to `pro`:** immediate. The change is recorded with its effective time, `plan_changed` is emitted, and that month is billed as `pro` (highest plan active that month).
- **Downgrade to `basic`:** stored as `nextPlan` and applied by the monthly job at the start of the next period, which then emits `plan_changed`. Until then the tenant keeps `pro`.
- **Cancel:** sets `cancelAtPeriodEnd`. Cancellation ALWAYS takes effect at the end of the month (decision): the subscription stays as it is until then, the last invoice is a full month (or the prorated first month if it started that month), and there is NO mid-month prorating or early end, not even by a platform admin. The last invoice is issued by the monthly close and only then the status becomes `cancelled` (`endedAt` = the cancellation date), emitting `subscription_cancelled`. `auth` then sets the tenant `cancelled` (see `auth`). Data is kept for 90 days (see Data retention).
- **Undo a pending cancellation:** while the close has not yet cancelled the subscription, an owner/admin can undo it with `billing.subscription.cancel-undo` (clears `cancelAtPeriodEnd`, no event). Without a pending cancellation it answers `no_pending_cancellation` (409).
- **Resubscribe:** a tenant whose subscription is `cancelled` (and whose data was not yet deleted) can be reactivated by an owner/admin choosing a plan with `billing.subscription.resubscribe`. Decision: reactivation does NOT wait for a payment. Billing creates a NEW subscription in `active` with the chosen plan (no trial: the trial is only for new tenants), keeps the cancelled one as history, and emits `plan_changed` (with the plan and `features`, `previousPlan` = the plan of the cancelled subscription, `effectiveAt` = now) followed by `subscription_reactivated`. `auth` then sets the tenant `active` and emits `tenant_reactivated`. The first invoice is prorated from the resubscription day (that day counts) to the end of that month and issued by the next monthly close like any other; unpaid invoices of the cancelled period stay payable and the usual collections rules apply to them from then on.

### Data retention

After `cancelled` the data is kept for 90 days (`DATA_RETENTION_DAYS`, counted from `endedAt`). A daily job (09:00 in `BILLING_TZ`):

- 7 days before the deletion date, if the subscription is still `cancelled`: sends the notice `billing_data_deletion_warning` (`data.deletionDate`) to owner/admins, deterministic `eventId` `billing:billing_data_deletion_warning:<subscriptionId>` so it is sent once.
- When the 90 days pass and the subscription is still `cancelled` (a resubscription means a new active subscription, so nothing is emitted), emits `t.<tenant>.billing.data_retention_expired` once (marked with `dataRetentionExpiredAt`). EVERY service consumes it and permanently deletes the tenant's data: `auth`, `organization`, `attendance`, `tasks` (including the stored photos), `notifications` and `billing` itself.
- Billing's own purge deletes the tenant's plan change history, processed events, webhook notifications and payment links. It KEEPS the invoices (with lines) and payments for legal and accounting reasons, plus the minimum subscription reference they need (`id`, `tenantId`, `plan`, `status`, `endedAt`). The purge is idempotent.

### Monthly invoicing (in arrears)

- Period = calendar month in `BILLING_TZ` (`America/Argentina/Buenos_Aires`). On day 1 (03:00) the job closes the PREVIOUS month for every subscription that was billable in it, then applies scheduled downgrades and cancellations (in that order: the closed month keeps the plan it had).
- Plan billed = the highest plan active during that month.
- Billable days = days of the period in which the tenant had a subscription past the trial and not yet cancelled. If zero, no invoice is issued. `factor = billableDays / daysInPeriod`. Only the first billed month (after the trial) and the month of a resubscription (counted from the resubscription day, that day included) have a factor below 1; the last month before a cancellation is a full month because the cancellation takes effect at month end.
- Lines: (1) plan line = `round(price × factor)`; (2) VAT line = `round(planLine × VAT_PERCENT / 100)` (21%, its own line); total = sum of lines.
- Example with fictitious numbers: plan price ARS 100000.00, 18 billable days of 30: plan line 60000.00, VAT 12600.00, total 72600.00. Full month: 100000.00 + 21000.00 = 121000.00.
- Due date = issue date + `DUE_DAYS` (10).
- The close is idempotent: a unique index on `(tenantId, period)` for invoices that are not `void` means running it twice issues one invoice. Prisma cannot declare a partial unique index: add it in the migration SQL.
- Issuing happens in one transaction (invoice + lines + plan application); events are emitted after the commit: `invoice_issued` and a notice request.
- Void: `billing.admin.invoice.void` with a mandatory reason. A void invoice frees its period; `billing.admin.invoice.issue` then runs the same close for that tenant and period with the current prices.
- A platform admin may store the external fiscal receipt number on an invoice (`billing.admin.invoice.set-fiscal-receipt`); it does not change any amount.

### Collections

A daily job (09:00 in `BILLING_TZ`) applies, with the due date as the last day to pay:

| When | Action |
|------|--------|
| Invoice issued | Notice `billing_invoice_issued` to owner/admins |
| 3 days before the due date | Notice `billing_due_soon` |
| Delay day 1 (first day after the due date), still unpaid | Subscription `past_due`, emit `payment_overdue`, notice `billing_overdue_notice` |
| Delay days 4 and 6 | Notice `billing_overdue_notice` |
| Delay day 7 (`GRACE_DAYS`) | Subscription `suspended`, emit `subscription_expired`, notice `billing_suspended` |
| Full payment of the last overdue invoice | Subscription back to `active`, emit `payment_received` |

- The due date is the LAST day to pay (decision): delay day 1 is the day after it, so an invoice paid on its due date is never overdue.
- Delay is measured from the oldest overdue unpaid invoice.
- `payment_received` is emitted ONLY when an invoice becomes fully paid and no other overdue unpaid invoice remains (decision, not once per paid invoice). `auth` reactivates a `past_due` or `suspended` tenant on it (see `auth`); it never reactivates a `cancelled` one.
- A `cancelled` subscription is not touched by collections: no `past_due`, no suspension and no overdue notices (its unpaid invoices stay payable and a platform admin follows them up).
- Notices are requests to `notifications`: billing resolves the recipients with `auth.user.list-recipients` (`roles: ['owner','admin']`) and publishes `t.<tenant>.notifications.send` with a deterministic `eventId` (for example `billing:<templateCode>:<invoiceId>:<delayDay>`), so a job that runs twice never sends twice. Billing sends no email. The same mechanism sends `billing_data_deletion_warning` (see Data retention).

### Payments

Every payment is recorded in `Payment` and only a payment that is approved, in `ARS`, with an amount EQUAL to the invoice balance marks the invoice `paid`. Any mismatch (partial, excess, other currency, invoice of another tenant, void invoice) is stored with status `needs_review` and does not change the invoice; a platform admin resolves it manually.

**Mercado Pago**

- The `PaymentProvider` interface (always used, never the HTTP client directly) has: `createPaymentLink(invoice)`, `getPayment(paymentId)`, `searchPaymentsByReference(invoiceId)` and `validateWebhook(headers, rawBody)`. Providers: `mercadopago` and `fake` (local and tests: generates links and simulates approved/rejected payments and webhooks). `PAYMENT_PROVIDER` selects one.
- **Payment link:** one per invoice, `external_reference` = `invoiceId`, total = balance, expiry = due date + `GRACE_DAYS`. Owner/admin get it in the app with `billing.invoice.payment-link`, which regenerates it when expired.
- **Webhook:** Mercado Pago calls the public route `POST /api/v1/webhooks/mercadopago` (no JWT, rate limited), served by the billing HTTP controller, which hands the RAW body and the headers to the facade operation `billing.webhook.mercadopago` untouched. Billing: (1) validates the signature with `MP_WEBHOOK_SECRET` following the current Mercado Pago documentation (verify it before implementing); invalid signature = reject without processing; (2) deduplicates by notification id in `WebhookNotification`; (3) ALWAYS fetches the payment from the Mercado Pago API; (4) applies the payment rule above; (5) is idempotent by `(provider, providerPaymentId)` and answers fast.
- **Reconciliation:** a daily job (06:00) uses `searchPaymentsByReference` for every issued unpaid invoice, in case a webhook was lost.

**Manual payment (bank transfer):** `billing.admin.payment.register` (`platform_admin` only) with invoice, amount, date and bank reference; it follows the same rules as a Mercado Pago payment.

### Roles

| Action | platform_admin | owner / admin | supervisor / employee |
|--------|:--------------:|:-------------:|:---------------------:|
| Manage plans, prices and features | ✅ | ❌ | ❌ |
| Register manual payments, void invoices, set fiscal receipt numbers, extend trials | ✅ any tenant | ❌ | ❌ |
| See own plan, status and invoices | ✅ any tenant | ✅ own tenant | ❌ |
| Get a payment link | ❌ | ✅ own tenant | ❌ |
| Change plan, cancel, undo a pending cancellation, resubscribe | ❌ | ✅ own tenant | ❌ |

- `platform_admin` is a platform role created by `auth` (seed/CLI), belongs to no tenant (`tenantId` is null in the actor) and only reaches `billing.admin.*` routes. These operations take the target `tenantId` in the payload; they are the ONLY place where a tenant comes from a payload, and only when the actor is `platform_admin`.
- Everything else takes `tenantId` from the actor. Resources of another tenant answer 404.

### Plan gating (decision)

Billing does NOT expose any shared key-value store. `auth` keeps the tenant's current plan and features, fed by `subscription_created` and `plan_changed`, and `auth.token.verify` returns `plan` and `features`. The HTTP layer of `core` blocks the routes whose feature the plan lacks with 403 `feature_not_in_plan`. The modules and services that own pro work (`attendance` in `telemetry`, `tasks`, `notifications`) also keep a local per-tenant copy of `features`, fed by the same two events, to skip the automatic pro work for basic tenants. Other modules and services never ask `billing` whether a feature is enabled, so `subscription_created` and `plan_changed` must always carry the full `features`.

While a tenant is `suspended` the HTTP layer of `core` only lets owner/admin use the billing routes needed to pay (`billing.subscription.get`, `billing.invoice.*`) and data export; see `auth`. While it is `cancelled` the same applies, plus `billing.plan.list` and `billing.subscription.resubscribe`.

## NATS Contract

Operation names follow `billing.<resource>.<action>` and carry NO tenant: the tenant comes from the actor. Domain events follow `t.<tenant>.billing.<event>` (JetStream, snake_case names).

In `core` every operation below is an **in-process call** to the module's facade service (invoked by the module's HTTP controllers); the pattern string is kept as the operation's stable name. `telemetry` consumes billing's plan events but does not request anything from this module, so there are **no NATS request-reply responders** here. Keep the names in a constants file (to create: `src/billing/billing.patterns.ts`).

### Operations (module facade) and NATS responders

"actor" = `{ userId, tenantId, role }` from `auth.token.verify` (`tenantId` is null for `platform_admin`). Lists return `{ items, total }`.

| Operation | Caller | Payload | Returns |
|---------|--------|---------|---------|
| `billing.plan.list` | HTTP controller (owner/admin) | actor | plans with price and features |
| `billing.subscription.get` | HTTP controller (owner/admin) | actor | plan, status, `trialEndsAt`, `nextPlan`, `cancelAtPeriodEnd`, features |
| `billing.subscription.change-plan` | HTTP controller (owner/admin) | actor, `plan` | subscription |
| `billing.subscription.cancel` | HTTP controller (owner/admin) | actor | subscription |
| `billing.subscription.cancel-undo` | HTTP controller (owner/admin) | actor | subscription |
| `billing.subscription.resubscribe` | HTTP controller (owner/admin, also while the tenant is `cancelled`) | actor, `plan` | the new subscription |
| `billing.invoice.list` / `get` | HTTP controller (owner/admin) | actor, `invoiceId` or filters, `page`, `pageSize` | invoice(s) with lines and payments |
| `billing.invoice.payment-link` | HTTP controller (owner/admin) | actor, `invoiceId` | `{ url, expiresAt }` (regenerated if expired) |
| `billing.webhook.mercadopago` | HTTP controller only (public route) | raw body, headers | `{ ok: true }` |
| `billing.admin.plan.update` | HTTP controller (platform_admin) | actor, `plan`, `monthlyPrice`, `features` | plan (applies from the next invoice) |
| `billing.admin.subscription.list` | HTTP controller (platform_admin) | actor, filters, `page`, `pageSize` | subscriptions of every tenant |
| `billing.admin.subscription.extend-trial` | HTTP controller (platform_admin) | actor, `tenantId`, `trialEndsAt` | subscription |
| `billing.admin.invoice.list` | HTTP controller (platform_admin) | actor, `tenantId`, filters | invoices |
| `billing.admin.invoice.void` | HTTP controller (platform_admin) | actor, `invoiceId`, `reason` | invoice |
| `billing.admin.invoice.issue` | HTTP controller (platform_admin) | actor, `tenantId`, `period` | invoice |
| `billing.admin.invoice.set-fiscal-receipt` | HTTP controller (platform_admin) | actor, `invoiceId`, `receiptNumber` | invoice |
| `billing.admin.payment.register` | HTTP controller (platform_admin) | actor, `invoiceId`, `amount`, `paidAt`, `reference` | payment |

### Calls this module makes to other modules

| Operation (facade of the owner) | Owner | Payload | Returns |
|---------|-------|---------|---------|
| `auth.user.list-recipients` | `auth` | `tenantId`, `roles`, optional `siteId` | `{ userIds }` of active users |

Module-to-module facade calls (in-process, no NATS) carry an explicit `tenantId` taken from the data being processed, never from a client.

### Events emitted (JetStream)

| Event subject | Payload |
|---------------|---------|
| `t.<tenant>.billing.subscription_created` | `eventId`, `tenantId`, `plan`, `features`, `status`, `trialEndsAt`, `occurredAt` |
| `t.<tenant>.billing.plan_changed` | `eventId`, `tenantId`, `plan`, `features`, `previousPlan`, `effectiveAt`, `occurredAt` |
| `t.<tenant>.billing.invoice_issued` | `eventId`, `tenantId`, `invoiceId`, `period`, `total`, `dueDate`, `occurredAt` |
| `t.<tenant>.billing.payment_overdue` | `eventId`, `tenantId`, `invoiceId`, `dueDate`, `occurredAt` |
| `t.<tenant>.billing.subscription_expired` | `eventId`, `tenantId`, `occurredAt` |
| `t.<tenant>.billing.payment_received` | `eventId`, `tenantId`, `invoiceId`, `occurredAt` |
| `t.<tenant>.billing.subscription_cancelled` | `eventId`, `tenantId`, `occurredAt` |
| `t.<tenant>.billing.subscription_reactivated` | `eventId`, `tenantId`, `plan`, `occurredAt` |
| `t.<tenant>.billing.data_retention_expired` | `eventId`, `tenantId`, `occurredAt` |

- Money amounts travel as decimal strings, never as JSON numbers with fractions.
- `occurredAt` is ISO-8601 UTC. Every event carries a unique `eventId` so consumers deduplicate.
- Emit events only after the database transaction commits. Failing to emit must not roll back the data; the job or retry that re-runs re-emits (consumers are idempotent). An outbox table is possible future hardening, not a requirement.

It also publishes `t.<tenant>.notifications.send` (payload per `notifications`: `eventId`, `tenantId`, `recipientUserIds`, `templateCode`, `data`, `occurredAt`) with these template codes: `billing_invoice_issued`, `billing_due_soon`, `billing_overdue_notice` (with `delayDay` 1, 4 or 6 in `data`), `billing_suspended` and `billing_data_deletion_warning` (with `deletionDate`). `billing_overdue_notice` of delay day 1 is the only overdue notice: `notifications` no longer routes anything from `auth.tenant_past_due`.

### Events consumed (JetStream, durable consumer, explicit ack)

| Event subject | Producer | Handling |
|---------------|----------|----------|
| `t.<tenant>.auth.tenant_created` | `auth` | Create the trial subscription (idempotent). |
| `t.<tenant>.billing.data_retention_expired` | `billing` (itself) | Purge the tenant's billing data except invoices and payments (idempotent). |

The tenant of a consumed event comes from the subject and is checked against the payload. Handlers are idempotent: deduplicate by `eventId` in `ProcessedEvent` or by the natural unique key (one subscription per tenant). Errors in an `@EventPattern` handler never reach the producer: catch and log them and let JetStream redeliver when a retry is meaningful.

### Errors

Throw an `AppException` subclass from `src/common/exceptions/` (see `teamworkflow-nest`). The HTTP exception filter of `core` maps it to HTTP `{ detail, code }`; NATS responders map it to `{ status, code, message }` via `NatsErrorFilter`.

| code | status | When |
|------|--------|------|
| `forbidden` | 403 | Role not allowed |
| `subscription_not_found` / `invoice_not_found` / `plan_not_found` | 404 | Missing, or outside the actor's tenant |
| `invalid_subscription_transition` | 409 | The state machine forbids it |
| `invalid_plan_change` | 409 | Same plan, or a change pending already |
| `no_pending_cancellation` | 409 | Undoing a cancellation when none is pending |
| `invoice_not_payable` | 409 | The invoice is paid or void |
| `invoice_exists` | 409 | Issuing a period that already has a non-void invoice |
| `invalid_webhook_signature` | 401 | Webhook signature check failed |
| `payment_provider_error` | 502 | Mercado Pago did not answer or refused |
| `validation_error` | 422 | DTO validation failed |

## Data Model (Prisma, to create)

Models are PascalCase, fields camelCase, tables plural snake_case through `@@map` / `@map`. Every tenant-owned model has `tenantId`. Money fields are `Decimal @db.Decimal(12, 2)`.

- `Plan`: `code` (`BASIC` | `PRO`, unique), `name`, `monthlyPrice`, `features` (json), `isActive`, `updatedAt`. Global (no `tenantId`); seeded with the two plans.
- `Subscription`: `id`, `tenantId`, `plan`, `status` (`TRIAL` | `ACTIVE` | `PAST_DUE` | `SUSPENDED` | `CANCELLED`), `trialEndsAt`, `nextPlan` (nullable), `cancelAtPeriodEnd`, `endedAt` (nullable), `dataRetentionWarningSentAt` (nullable), `dataRetentionExpiredAt` (nullable), `createdAt`, `updatedAt`. A tenant has at most ONE non-cancelled subscription (partial unique index on `tenantId` where `status <> 'CANCELLED'`, SQL in the migration); cancelled ones stay as history, so a resubscription adds a new row.
- `SubscriptionPlanChange`: `id`, `tenantId`, `subscriptionId`, `fromPlan`, `toPlan`, `effectiveAt`. History used to find the highest plan of a month.
- `Invoice`: `id`, `tenantId`, `subscriptionId`, `period` (for example `2026-09`), `periodStart`, `periodEnd`, `plan`, `billableDays`, `daysInPeriod`, `subtotal`, `vatPercent`, `vatAmount`, `total`, `currency`, `status` (`ISSUED` | `PAID` | `VOID`; overdue is derived from `dueDate`), `issuedAt`, `dueDate`, `paidAt`, `voidedAt`, `voidReason`, `voidedByUserId`, `fiscalReceiptNumber`, `paymentLinkUrl`, `paymentLinkExpiresAt`. Unique `(tenantId, period)` where `status <> 'VOID'` (SQL in the migration).
- `InvoiceLine`: `id`, `tenantId`, `invoiceId`, `kind` (`PLAN` | `VAT`), `description`, `quantity`, `unitPrice`, `amount`.
- `Payment`: `id`, `tenantId`, `invoiceId`, `provider` (`MERCADOPAGO` | `MANUAL`), `providerPaymentId` (unique per provider), `amount`, `currency`, `status` (`APPROVED` | `NEEDS_REVIEW` | `REJECTED`), `registeredByUserId` (manual), `paidAt`, `createdAt`.
- `WebhookNotification`: `id`, `notificationId` (unique), `receivedAt`, `result`. NEVER store the full body or the signature.
- `ProcessedEvent`: `eventId` (unique), `processedAt`.

Every query filters by `tenantId` (admin operations filter by the explicit target tenant). Indexes for the real lookups: invoices by `(tenantId, status, dueDate)` for collections, by `(tenantId, period)`; subscriptions by `(status, trialEndsAt)` for the trial job; payments by `(invoiceId)` (`teamworkflow-postgres`). The jobs are the only code that reads across tenants; they process one tenant at a time.

## Jobs

All idempotent by unique keys or compare-and-set on the status, so two replicas or a late run never duplicate work. A job that did not run catches up on the next execution.

| Job | Frequency |
|-----|-----------|
| Trial end | Hourly |
| Monthly close (invoices, then downgrades and cancellations) | Day 1, 03:00 `BILLING_TZ` |
| Mercado Pago reconciliation | Daily, 06:00 |
| Collections (notices, overdue, suspension) | Daily, 09:00 |
| Data retention (deletion warning at day 83, `data_retention_expired` at day 90 after `cancelled`) | Daily, 09:00 |

Use an injectable clock so tests control time.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NATS_SERVER` | Comma-separated NATS URLs (shared by all of `core`) |
| `DATABASE_URL` | PostgreSQL connection string for this module (its own role and schema) |
| `PAYMENT_PROVIDER` | `mercadopago` or `fake` |
| `MP_ACCESS_TOKEN` | Mercado Pago access token (required when the provider is `mercadopago`) |
| `MP_WEBHOOK_SECRET` | Key to validate webhook signatures (required with `mercadopago`) |
| `BILLING_TZ` | Billing time zone. Default `America/Argentina/Buenos_Aires` |
| `VAT_PERCENT` | Default `21` |
| `TRIAL_DAYS` | Default `14` |
| `DUE_DAYS` | Days from issue to due date. Default `10` |
| `GRACE_DAYS` | Days of delay before suspension. Default `7` |
| `DATA_RETENTION_DAYS` | Days between `cancelled` and the deletion of the tenant's data. Default `90` |
| `APP_URL` | Base URL of the web app, used for the payment return URLs |

Variable names are provisional until the shared `core` config exists (T4/T6): in `core` each module has its own database URL for its own role. Validate all of them in `src/config/envs.ts` and list them in `.env.example`. Never commit `.env` or secrets.

## Security Rules (non-negotiable)

1. `tenantId` and `role` always come from the verified actor or the database; the only exception is the explicit target tenant of `billing.admin.*` calls made by a `platform_admin`.
2. Every query filters by `tenantId`; a test proves tenant isolation.
3. Never log access tokens, signatures, full webhook bodies, payment provider payloads or card data.
4. Validate the webhook signature before any processing; never trust webhook amounts or status.
5. Never read another module's tables or use its Prisma client; call its exported facade service or consume its events.
6. No `float` in any money calculation.

## Tests

- Unit tests for every use case with Prisma, the facades of other modules and the payment provider mocked (`pnpm test`); use the `fake` provider for payment flows.
- The pure domain has table tests for the invoice calculation: full month, prorated first month after the trial, prorated last month, VAT as its own line, half-up rounding per line, price change between invoices, highest plan of the month.
- The state machine has one test per allowed and per forbidden transition.
- Always covered: tenant isolation; `tenant_created` twice creates one subscription; close executed twice issues one invoice; void then re-issue; upgrade immediate vs downgrade next period; cancel issuing the last invoice (a full month) before `cancelled`, with no mid-month prorating; undo of a pending cancellation (and `no_pending_cancellation`); resubscribe creating a new active subscription without trial, emitting `plan_changed` and `subscription_reactivated`, with the first invoice prorated from the resubscription day, and refused unless the subscription is `cancelled`; due date as the last day to pay (delay day 1 is the day after); collections ignoring cancelled subscriptions; data retention (warning 7 days before, `data_retention_expired` emitted once at day 90, nothing emitted if the tenant resubscribed) and billing's own purge keeping invoices and payments (idempotent, other tenants untouched); webhook with invalid signature, duplicate webhook, payment amount different from the balance (`needs_review`), non-approved payment, payment of an invoice of another tenant; manual payment with the same rules; reconciliation finding a lost payment; payment link regenerated when expired; collections on delay days 1, 4, 6 and 7 with no duplicate notices; `payment_received` only when no overdue invoice remains; `platform_admin` allowed on `billing.admin.*` and every other role refused; no float anywhere in money code.
- E2E tests (to create in `test/`) once the transport and the database are set up, against a dedicated test database.

## Before Finishing a Task

- [ ] `pnpm lint`, `pnpm test` and `pnpm build` pass.
- [ ] No floating point in any money calculation.
- [ ] No issued invoice is ever modified; only voided.
- [ ] Schema changes come with a reviewed Prisma migration.
- [ ] If you changed a pattern, event or payload, you updated this file, `backend/core/AGENTS.md` and the consuming modules' and services' docs (`auth`, `notifications`, `telemetry`), and called it out in the PR description.
- [ ] No secrets, tokens, signatures or payment data in logs, tests or fixtures.
