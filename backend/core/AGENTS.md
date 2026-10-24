# AGENTS.md — `core`

Guide for coding agents working on `backend/core`. Read it fully before making changes. It overrides the root `AGENTS.md` when they conflict. Each module has its own `src/<module>/AGENTS.md` with the domain rules; those override this file for their domain. Code patterns (error filter, joi envs, ValidationPipe, Prisma access) live in `skills/teamworkflow-nest`. Architecture decision: `docs/architecture.md` (accepted ADR).

## What this service is

`core` is the modular monolith of TeamWorkFlow, a multitenant SaaS for managing field staff across many sites. It contains the modules `auth`, `organization`, `tasks`, `notifications` and `billing`, and it is the public HTTP API (the role of the former `gateway`). The web app and the mobile app talk to it; NATS is never exposed to the internet. If this service has a bug, every tenant is exposed: treat every change as security-sensitive.

The other backend service is `telemetry` (`backend/telemetry/AGENTS.md`): the whole `attendance` domain (clock-in ingestion, corrections, workdays, alerts, Torre de Control WebSocket). Both are published under one public origin by a reverse proxy: `/api/...` goes to `core`, `/api/v1/telemetry/...` and `/ws` go to `telemetry`. `core` never registers routes under `/api/v1/telemetry`.

### Current status (READ FIRST)

`backend/core` has the scaffold (T6.1), the domain errors, filters and validation pipe (T6.2), the `auth` data layer (T6.3) and, since T6.4a, the `auth` HTTP routes (`POST /api/auth/register|login|refresh|logout`; since T6.4b also the invitations, users and password-reset routes of the route map below), the global `AuthGuard` (`src/http/guards/auth.guard.ts`: in-process `auth.token.verify`, `Authorization: Bearer` only) with `@Public()` and `@CurrentActor()` (`src/http/decorators/`), and a hybrid `main.ts` (HTTP plus a NATS microservice) with the `auth.token.verify` responder (`src/auth/auth-token.responder.ts`). Task T6 of `odd/tasks/two-service-architecture.md` is merging `backend/gateway` and `backend/auth` into it ([src/auth/STEPS.md](src/auth/STEPS.md) holds the auth steps); those folders keep their code until T7. Since T6.5 the `auth` event consumers (JetStream durable consumers `auth-organization` and `auth-billing`), the tenant handlers and the platform admin seed (`pnpm seed:platform-admin`) live in `src/auth/` too. Still missing: cookies, CSRF, CORS, the `@Roles` decorator (the owner/admin rules of the auth routes are enforced today by the auth services, which answer 403 `forbidden`), plan gating and rate limiting, and the real e2e suite (T6.6). The other modules (`organization`, `tasks`, `notifications`, `billing`) are documented but not built. Everything below is the target design; check what exists before importing or assuming.

### Modules

Each module is a NestJS `Module` in `src/<module>/`. The module's `AGENTS.md` is the source of truth for its domain.

| Module | Folder | Domain | Guide |
|--------|--------|--------|-------|
| `auth` | `src/auth/` | Identity: tenants, users, roles, sessions, invitations, tenant status, plan and features | [AGENTS.md](src/auth/AGENTS.md) · [STEPS.md](src/auth/STEPS.md) |
| `organization` | `src/organization/` | Sites, posts, employees, shift templates and shifts | [AGENTS.md](src/organization/AGENTS.md) |
| `tasks` | `src/tasks/` | Forms, tasks, supervisor review, photos (S3-compatible storage) | [AGENTS.md](src/tasks/AGENTS.md) |
| `notifications` | `src/notifications/` | Push (FCM) and in-app notifications | [AGENTS.md](src/notifications/AGENTS.md) |
| `billing` | `src/billing/` | Plans, subscriptions, invoices, payments (Mercado Pago behind `PaymentProvider`) | [AGENTS.md](src/billing/AGENTS.md) |

Naming note: module docs refer to the attendance domain as `attendance`. It lives in the `telemetry` service, not in `core`.

Responsibilities of `core` as a whole (beyond each module's domain):

- Public HTTP API: validate input, authenticate, apply coarse checks (role, plan feature, tenant status, rate limit, CSRF, CORS) and call the module facade (see HTTP layer).
- Session transport: cookies and CSRF for the web, `Authorization: Bearer` for mobile.
- Map domain errors `{ status, code, message }` to HTTP `{ detail, code }`.
- Answer the NATS requests that `telemetry` needs (see NATS request responders).
- Publish and consume domain events on NATS JetStream (see Event bus).

Out of scope (do NOT implement here):

- The `attendance` domain and the Torre de Control WebSocket: `telemetry`.
- A BFF split: one REST API serves web and mobile in the MVP. Mobile-specific endpoints are added only when needed.
- A shared database access layer across modules (see Module boundaries).

## Module boundaries (non-negotiable)

- Each module exports ONLY a facade service (its public API). Another module never imports its repositories, its Prisma client, its DTO internals or any other class.
- A module never reads another module's tables or uses another module's Prisma client. Synchronous reads needed inside a request go through the other module's exported facade service.
- Reactions between domains happen BY EVENTS, not direct calls. Example: `billing.plan_changed` makes `auth` update the tenant's plan. Facade calls are reserved for reads that a request needs.
- A module must be extractable to its own service without changing its event consumers. Keep module code free of references to sibling module internals.
- Operation names (`<module>.<resource>.<action>`, for example `organization.shift.get`) stay as the stable names of facade operations, defined in each module's patterns constants file. In `core` they are in-process calls, EXCEPT the NATS responders below.
- The HTTP controllers of a module live inside the module (`src/<module>/`), not in a shared controller layer.
- The checks that apply to all routes (guard, actor, roles, plan, tenant status, rate limit, CSRF, CORS, error filter) live in a shared HTTP layer (`src/http/`, to create) used by every module controller.

Errors: modules throw transport-agnostic `AppException` subclasses (`{ status, code, message }`, plus `errors` for `validation_error`) and never `RpcException` or `HttpException`. The HTTP edge maps them to `{ detail, code }` (`HttpErrorFilter`), the NATS edge to `{ status, code, message }` (`NatsErrorFilter`). See `src/common/exceptions/app.exceptions.ts`, `src/common/pipes/validation.pipe.ts`, `src/http/filters/http-exception.filter.ts`, `src/common/filters/nats-exception.filter.ts` and `src/app.config.ts` (`configureApp`).

## Event bus

- NATS JetStream is the ONLY domain event bus: between `core` modules and between `core` and `telemetry`.
- Subjects: `t.<tenant>.<module>.<event>` with snake_case event names (the attendance domain keeps the module name `attendance`). One stream per owning module (`<MODULE>_EVENTS` on `t.*.<module>.>`), created by that module on startup. Durable consumers are named `<consumer>-<producer>`, with explicit ack. Details in `backend/STEPS.md` S1.2.
- Every event carries a unique `eventId` and an ISO-8601 UTC `occurredAt`. Consumers deduplicate with a `ProcessedEvent` row written in the same transaction as the handler. Emit only after the database transaction commits.
- The tenant of a consumed event comes from the subject and is checked against the payload.
- JetStream client: the official `@nats-io/jetstream` v3 wrapped in a `JetStreamService`, see `backend/STEPS.md` S1.3.
- Events that cross the process boundary: `core` publishes `organization.*`, `auth.*` and `billing.*` events that `telemetry` consumes (`ShiftSnapshot`, `TenantState`, `TenantFeatures`); `core` consumes `attendance.*` events published by `telemetry` (`alert_opened` by `notifications`; `clock_event_recorded`, `clock_event_corrected`, `workday_closed` by future reports). `site_summary_updated` is consumed only by `telemetry`.

## NATS request responders (for telemetry)

Synchronous cross-process calls use NATS request-reply with patterns `<module>.<resource>.<action>` and NO tenant in the subject. `core` answers ONLY these, because `telemetry` is a separate service:

| Pattern | Module | Used by `telemetry` for |
|---------|--------|-------------------------|
| `auth.token.verify` | `auth` | Verify the token of every HTTP request and WebSocket connection; returns the actor (`userId`, `tenantId`, `role`, `siteIds`, `tenantStatus`, `plan`, `features`) |
| `organization.employee.get` | `organization` | Map the actor `userId` to the employee |
| `organization.site.get` | `organization` | Geofence and QR of a site |
| `organization.shift.get` | `organization` | Shift data on a local-copy miss |

Rules:

- Responders are thin: they call the module facade and return its result. No extra logic.
- Never add a responder without updating this table, `docs/architecture.md` and the consuming service's docs.
- Never expose `auth.user.list-recipients` or any internal-only operation as a responder or HTTP route.
- Open decision (gap): the Torre de Control needs the list of all sites of a tenant for owner/admin rooms; `organization.site.list` is not in the ADR's responder list. Decide whether to add it or derive the sites in `telemetry`.

## HTTP layer

Rules inherited from the former gateway design. They apply to every route of every module in `core`.

### Actor (non-negotiable)

- The actor `{ userId, tenantId, role, siteIds, tenantStatus, plan, features }` is built ONLY from the `auth.token.verify` result (an in-process facade call here). Never read `tenantId`, `role`, `siteIds`, `plan` or `features` from the body, query, path or headers.
- Pass to module operations the actor fields they document (`{ userId, tenantId, role }`, plus `siteIds` where the module lists it) together with the validated DTO. Strip any `tenantId`/`actor` field the client sent.
- For `platform_admin`, `tenantId`, `tenantStatus`, `plan` and `features` are `null`. It may only use platform routes (`billing.admin.*`); every tenant route refuses it (403 `forbidden`).

### Auth guard

- A global guard runs on every route that is not marked `@Public()`. It extracts the access token (see Tokens and cookies), runs `auth.token.verify` and attaches the actor to the request.
- Public routes (no guard): register, login, refresh, accept invitation, password-reset confirm and the Mercado Pago webhook. Today `billing.plan.list` is documented as owner/admin only, so it is NOT public.
- Missing token or `invalid_token` answers 401. Never cache the verify result across requests: deactivation and suspension must take effect immediately.

### Tokens and cookies

- Web: `core` sets the access and refresh tokens in `httpOnly`, `Secure`, `SameSite` cookies on login, refresh and invitation acceptance (and on register, which also returns a token pair), and clears them on logout. Tokens are not returned in the JSON body for web clients.
- Mobile: `Authorization: Bearer <accessToken>` header; the token pair is returned in the JSON body; the app keeps the refresh token in secure storage and sends it in the body of `/auth/refresh`.
- How the two are told apart (initial rule, to be implemented): a request that carries the access cookie is a web request; a request with an `Authorization` header and no cookie is a mobile request. If both are present, the `Authorization` header wins and CSRF is not required. For public auth routes the client states its type with a header (for example `X-Client: web` or `X-Client: mobile`); default to the web behavior when the header is missing so tokens never leak into a body by accident.
- `telemetry` reads the same access cookie or bearer token; the cookie is set by `core` on the shared origin.
- Never log tokens, cookies or `Authorization` headers.

### CSRF

- Cookie-authenticated state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require CSRF protection. Initial design: double-submit token. `core` sets a non-`httpOnly` CSRF cookie at login/refresh and the web client echoes it in an `X-CSRF-Token` header; both are compared in constant time.
- Bearer-authenticated requests (mobile) skip CSRF. The webhook route is exempt (it has its own authenticity checks in `billing`).

### CORS

- Allow only the origin in `WEB_ORIGIN`, with `credentials: true`, explicit allowed methods and headers (including `X-CSRF-Token`). Never use `*` together with credentials. Mobile apps are not subject to browser CORS.

### Role checks

- Routes declare the allowed roles with a decorator (for example `@Roles('owner', 'admin')`). Use it for coarse checks only, taken from the route map below. Examples: `billing.admin.*` only `platform_admin`; `auth.invitation.*` only `owner`/`admin`.
- Fine-grained rules (admin vs admin, supervisor site scope, ownership of a resource) are enforced by the module that receives the actor. Do not duplicate them in the HTTP layer.
- Where a module lists the caller only as "HTTP controller" with no role, the HTTP layer lets any authenticated tenant role through and the module decides.

### Plan gating

- Route metadata declares the required feature (`@RequiresFeature('tasks')`). If `actor.features` lacks it (or is `null`), answer 403 `feature_not_in_plan`. Every `tasks.*` route needs `tasks`. (`alerts` and `tower` gating applies to `telemetry` routes, which `telemetry` enforces itself.)

### Tenant status

- `active` and `past_due`: normal access (`past_due` only shows a banner in the frontend, which reads `tenantStatus` from verify).
- `suspended` or `cancelled`: only `owner` and `admin` may use the routes marked "billing" or "export" in the route map; everything else answers 403 `tenant_suspended` or `tenant_cancelled` (matching the status). `supervisor` and `employee` are already rejected by `auth.token.verify`.
  - `suspended`: `billing.subscription.get`, `billing.invoice.*` (including `payment-link`).
  - `cancelled`: the same, plus `billing.plan.list` and `billing.subscription.resubscribe`.
  - Data export routes: no module defines export operations yet; when one does, it is allowed in both states and is added to the route map.
- `platform_admin` is never affected by a tenant status.

### Rate limiting

- `@nestjs/throttler` with the in-memory store. Public routes are limited per IP; authenticated routes per user (`userId`), with a generous limit. Login, register, accept invitation and password-reset confirm get a stricter limit than the rest.
- Behind a proxy or load balancer, configure trusted proxy settings so the IP is the client's, not the proxy's.
- Redis store only when `core` runs more than one replica (future); do not add it before.
- Over the limit answers 429 with `{ detail, code: "rate_limited" }`.

### Webhooks

- `POST /api/v1/webhooks/mercadopago`: no auth guard, rate limited per IP, no CSRF. Hand the RAW body and the headers to the `billing` facade operation `billing.webhook.mercadopago` without parsing, trusting or logging them. `billing` validates the signature and deduplicates. Respond fast and keep any timeout short.
- The raw body requires enabling raw body capture for this route only.

### Error mapping

- A global exception filter maps domain errors `{ status, code, message }` to the HTTP status with body `{ detail, code }`. Known codes from the modules include `invalid_credentials` (401), `invalid_token` (401), `forbidden` (403), `tenant_suspended` (403), `tenant_cancelled` (403), `email_taken` (409), `validation_error` (422). HTTP-layer codes: `feature_not_in_plan` (403), `rate_limited` (429), `csrf_invalid` (403).
- Unknown errors answer 500 `{ detail: "Internal server error", code: "internal_error" }`; never leak stack traces or internal messages that were not meant for clients.
- Global `ValidationPipe` (whitelist, forbid non-whitelisted, transform) on every DTO; a validation failure answers 422 `validation_error`.

## Route map

Target map built from the operations documented in each module's `AGENTS.md`. Paths are the proposed REST shape under `/api/v1`; the operation name and the auth column are the contract. "any" means any authenticated tenant role (the module decides the rest). "billing" marks routes that stay open to `owner`/`admin` while the tenant is suspended or cancelled (see Tenant status). The attendance routes (clock events, workdays, alerts, tower snapshot) are NOT in `core`: they live in `backend/telemetry/AGENTS.md`.

### auth

| Method + path | Operation | Auth | Feature |
|---|---|---|---|
| `POST /auth/register` | `auth.register` | public | - |
| `POST /auth/login` | `auth.login` | public | - |
| `POST /auth/refresh` | `auth.token.refresh` | public | - |
| `POST /auth/logout` | `auth.logout` | any | - |
| `POST /auth/invitations` | `auth.invitation.create` | owner, admin | - |
| `GET /auth/invitations` | `auth.invitation.list` | owner, admin | - |
| `POST /auth/invitations/:invitationId/regenerate` | `auth.invitation.regenerate` | owner, admin | - |
| `POST /auth/invitations/accept` | `auth.invitation.accept` | public | - |
| `PATCH /auth/users/:userId/role` | `auth.user.change-role` | owner, admin | - |
| `PUT /auth/users/:userId/sites` | `auth.user.assign-sites` | owner, admin | - |
| `POST /auth/users/:userId/deactivate` | `auth.user.deactivate` | owner, admin | - |
| `POST /auth/users/:userId/password-reset` | `auth.password-reset.create` | owner, admin | - |
| `POST /auth/password-reset/confirm` | `auth.password-reset.confirm` | public | - |

`auth.token.verify` is called by the guard (and answered over NATS for `telemetry`), not exposed as a route. `auth.user.list-recipients` is internal only: never expose it.

### organization

| Method + path | Operation | Auth | Feature |
|---|---|---|---|
| `POST /sites`, `PATCH /sites/:siteId` | `organization.site.create` / `update` | owner, admin | - |
| `GET /sites/:siteId` | `organization.site.get` | any | - |
| `GET /sites` | `organization.site.list` | any | - |
| `POST /sites/:siteId/rotate-qr` | `organization.site.rotate-qr` | owner, admin | - |
| `POST /sites/:siteId/posts`, `PATCH /posts/:postId`, `GET /sites/:siteId/posts` | `organization.post.create` / `update` / `list` | any (module decides) | - |
| `POST /employees` | `organization.employee.create` | owner, admin | - |
| `PATCH /employees/:employeeId` | `organization.employee.update` | owner, admin | - |
| `GET /employees/:employeeId`, `GET /employees` | `organization.employee.get` / `list` | any | - |
| `GET /shifts/:shiftId/available-employees` | `organization.employee.list-available` | owner, admin, supervisor | - |
| `POST/PATCH /shift-templates`, `POST /shift-templates/:id/deactivate`, `GET /shift-templates` | `organization.shift-template.create` / `update` / `deactivate` / `list` | owner, admin | - |
| `POST /shifts`, `PATCH /shifts/:shiftId`, `POST /shifts/:shiftId/reassign`, `POST /shifts/:shiftId/cancel` | `organization.shift.create` / `update` / `reassign` / `cancel` | owner, admin, supervisor | - |
| `GET /shifts/:shiftId`, `GET /shifts` | `organization.shift.get` / `list` | any | - |

### tasks (every route needs feature `tasks`)

| Method + path | Operation | Auth |
|---|---|---|
| `POST /forms`, `PATCH /forms/:formId` | `tasks.form.create` / `update` | owner, admin |
| `POST /forms/:formId/publish` | `tasks.form.publish` | owner, admin |
| `GET /forms/:formId`, `GET /forms` | `tasks.form.get` / `list` | any |
| `POST /task-templates`, `PATCH /task-templates/:id`, `GET /task-templates` | `tasks.task-template.create` / `update` / `list` | owner, admin |
| `POST /tasks` | `tasks.task.create` | owner, admin, supervisor |
| `GET /tasks/:taskId`, `GET /tasks` | `tasks.task.get` / `list` | any |
| `POST /tasks/:taskId/claim` | `tasks.task.claim` | employee |
| `POST /tasks/:taskId/answer` | `tasks.task.answer` | employee |
| `POST /tasks/:taskId/review` | `tasks.task.review` | owner, admin, supervisor |
| `POST /media/uploads` | `tasks.media.request-upload` | employee |
| `GET /media/:mediaId/url` | `tasks.media.get-url` | any |

### notifications

| Method + path | Operation | Auth | Feature |
|---|---|---|---|
| `POST /push-tokens`, `DELETE /push-tokens` | `notifications.push-token.register` / `unregister` | any | - |
| `GET /notifications` | `notifications.notification.list` | any | - |
| `GET /notifications/unread-count` | `notifications.notification.unread-count` | any | - |
| `POST /notifications/:id/read` | `notifications.notification.mark-read` | any | - |

### billing

| Method + path | Operation | Auth | Notes |
|---|---|---|---|
| `GET /billing/plans` | `billing.plan.list` | owner, admin | billing (only while `cancelled`) |
| `GET /billing/subscription` | `billing.subscription.get` | owner, admin | billing |
| `POST /billing/subscription/change-plan` | `billing.subscription.change-plan` | owner, admin | - |
| `POST /billing/subscription/cancel` | `billing.subscription.cancel` | owner, admin | - |
| `POST /billing/subscription/cancel-undo` | `billing.subscription.cancel-undo` | owner, admin | - |
| `POST /billing/subscription/resubscribe` | `billing.subscription.resubscribe` | owner, admin | billing (only while `cancelled`) |
| `GET /billing/invoices`, `GET /billing/invoices/:invoiceId` | `billing.invoice.list` / `get` | owner, admin | billing |
| `POST /billing/invoices/:invoiceId/payment-link` | `billing.invoice.payment-link` | owner, admin | billing |
| `POST /webhooks/mercadopago` | `billing.webhook.mercadopago` | public | raw body + headers |
| `PUT /billing/admin/plans/:plan` | `billing.admin.plan.update` | platform_admin | - |
| `GET /billing/admin/subscriptions` | `billing.admin.subscription.list` | platform_admin | - |
| `POST /billing/admin/subscriptions/:tenantId/extend-trial` | `billing.admin.subscription.extend-trial` | platform_admin | - |
| `GET /billing/admin/invoices` | `billing.admin.invoice.list` | platform_admin | - |
| `POST /billing/admin/invoices/:invoiceId/void` | `billing.admin.invoice.void` | platform_admin | - |
| `POST /billing/admin/invoices` | `billing.admin.invoice.issue` | platform_admin | - |
| `PUT /billing/admin/invoices/:invoiceId/fiscal-receipt` | `billing.admin.invoice.set-fiscal-receipt` | platform_admin | - |
| `POST /billing/admin/payments` | `billing.admin.payment.register` | platform_admin | - |

For `billing.admin.*` the `tenantId` in the path or body is a legitimate input (the platform admin targets a tenant); it is accepted only on these routes and only for `platform_admin`.

## Database

- One PostgreSQL database `teamworkflow`. Each module has its own schema (`auth`, `organization`, `tasks`, `notifications`, `billing`), its own role (`<module>_svc`), its own Prisma schema, client and migrations (see `backend/STEPS.md` S1.1 and `skills/teamworkflow-prisma-migrations`).
- Isolation is enforced by PostgreSQL roles, not only by convention: `core` opens one connection per module with that module's role, which cannot read other schemas.
- No foreign keys across schemas. Never read another module's tables.
- Prisma folders are colocated per module: `backend/core/src/<module>/prisma/` (schema, migrations, generated client, gitignored). One Prisma config per module schema at the `backend/core` root (`prisma.<module>.config.ts`, e.g. `prisma.auth.config.ts`), reading `<MODULE>_DATABASE_URL`; scripts `pnpm prisma:<module>:generate` and `prisma:<module>:migrate:*` pass `--config`.

## Stack

- NestJS 12 over HTTP (`@nestjs/platform-express`), NATS client and JetStream through `@nestjs/microservices` and `@nats-io/jetstream` v3.
- PostgreSQL + Prisma 7, one client per module.
- Env validation with joi in `src/config/envs.ts`.
- To add (ask before installing any dependency): `@nestjs/throttler`, `class-validator` + `class-transformer`, `cookie-parser`, `@nestjs/schedule` (module jobs).
- Tests: Jest + supertest.

## Environment Variables

Shared by `core` (each module adds its own, listed in its `AGENTS.md`; final names and the per-module database URL convention are defined with `backend/.env.example` in T4/T6):

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port |
| `NATS_SERVER` | Comma-separated NATS URLs |
| `WEB_ORIGIN` | Allowed web origin for CORS (credentials enabled) |
| `COOKIE_SECURE` | `true` in production; if absent, derive from `NODE_ENV` (`true` unless `development`) |
| `RATE_LIMIT_PUBLIC_TTL_MS` / `RATE_LIMIT_PUBLIC_LIMIT` | Public routes per IP. Initial values: `60000` / `30` |
| `RATE_LIMIT_AUTH_TTL_MS` / `RATE_LIMIT_AUTH_LIMIT` | Authenticated routes per user. Initial values: `60000` / `300` |

All defaults are initial values to tune with real traffic. Validate every variable in `src/config/envs.ts` and list them in `.env.example`. Never commit `.env`.

## Security Rules (non-negotiable)

1. The actor comes only from `auth.token.verify`. Never from body, query, path or headers.
2. Never log passwords, tokens, cookies, `Authorization` headers, raw webhook bodies or full login/register payloads.
3. Auth cookies are `httpOnly`, `Secure` (outside local development) and `SameSite`; state-changing cookie requests need CSRF.
4. CORS allows only `WEB_ORIGIN`; never `*` with credentials.
5. Never expose `auth.user.list-recipients` or any internal-only operation.
6. Never trust the webhook: hand it raw to `billing` and let it validate.
7. Never put a tenant in a NATS subject for requests; the tenant travels in the actor payload.
8. Never return internal error details to the client; map known codes only.
9. A module never reads another module's tables or uses its Prisma client.

## Tests

- Unit tests per module with Prisma and the facades of other modules mocked; HTTP layer tests with supertest.
- HTTP layer, always covered:
  - Guard: no token, invalid token, valid token builds the actor only from the verify result (a body/header `tenantId` is ignored).
  - Cookie path vs bearer path; mobile refresh through the body; cookies set on login/refresh/accept and cleared on logout.
  - CSRF: cookie request without or with a wrong token is rejected; bearer request skips CSRF; webhook is exempt.
  - CORS: only `WEB_ORIGIN` allowed.
  - Role decorators: `billing.admin.*` rejects every role but `platform_admin`; `platform_admin` is refused on tenant routes.
  - Plan gating: missing or `null` feature answers 403 `feature_not_in_plan` for `tasks` routes.
  - Tenant status: `suspended` and `cancelled` allow only the billing routes for owner/admin (with the `cancelled` extras) and answer 403 `tenant_suspended` / `tenant_cancelled` elsewhere; `past_due` is unrestricted.
  - Error mapping: domain errors to `{ detail, code }`, validation to 422, unknown to 500 without leaking internals.
  - Throttling: public per IP, authenticated per user, 429 after the limit.
  - Webhook forwarding: raw body and headers reach `billing.webhook.mercadopago` unchanged; no auth required.
- NATS responders: `auth.token.verify` and `organization.*.get` answer through the module facade with the same results as in-process calls.
- Module boundary check: a test or lint rule proves no module imports another module's internals or Prisma client (to create).
- Existing auth unit and e2e specs move with the code in T6 and stay green.

## Before Finishing a Task

- [ ] `pnpm lint`, `pnpm test`, `pnpm test:e2e` and `pnpm build` pass.
- [ ] If you added or changed a route, the route map above, the README and the matching module `AGENTS.md` agree.
- [ ] If you changed an operation, event, payload or error code, you updated this file, the affected module docs and `backend/telemetry/AGENTS.md` when `telemetry` consumes it, and called it out in the PR description.
- [ ] If you added or changed a NATS responder, you updated the table above and `docs/architecture.md`.
- [ ] New environment variables are validated in `src/config/envs.ts` and listed in `.env.example`.
- [ ] No secrets, tokens, cookies or personal data in logs, tests or fixtures.
