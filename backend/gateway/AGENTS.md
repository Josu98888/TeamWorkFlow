# AGENTS.md — `gateway`

Guide for coding agents working on this service. Read it fully before making changes. It overrides the root `AGENTS.md` when they conflict. Code patterns (ClientProxy, timeouts, error filter, joi envs, ValidationPipe) live in `skills/teamworkflow-nest`.

## What this service is

`gateway` is the only HTTP and WebSocket entry point of TeamWorkFlow, a multitenant SaaS for managing field staff across many sites. The web app and the mobile app talk to it; NATS is never exposed to the internet. If this service has a bug, every tenant is exposed: treat every change as security-sensitive.

Responsibilities:

- Translate each HTTP request into a NATS request-reply message (`<service>.<resource>.<action>`) through `ClientProxy`, with a timeout.
- Authenticate every protected request by calling `auth.token.verify` and build the actor from that result only.
- Apply coarse checks before forwarding: role, plan feature, tenant status, rate limit.
- Manage session transport: cookies and CSRF for the web, `Authorization: Bearer` for mobile.
- Map `RpcException { status, code, message }` to HTTP `{ detail, code }`.
- Serve the Control Tower WebSocket (Socket.IO) and forward `site_summary_updated` events to site rooms.
- Expose the public Mercado Pago webhook route and forward it untouched to `billing`.

Out of scope (do NOT implement here):

- Business logic, validation of business rules, or any decision a domain service owns. Fine-grained role/site rules stay in each service, which receives the actor.
- A database, or NATS KV for domain data. The gateway has none.
- A BFF split: one REST API serves web and mobile in the MVP. Mobile-specific endpoints are added only when needed.
- Identity (passwords, tokens issuing, invitations): `auth`. Payments and plans: `billing`.
- Sending emails or push notifications: `notifications`.

## Rules

### Actor (non-negotiable)

- The actor `{ userId, tenantId, role, siteIds, tenantStatus, plan, features }` is built ONLY from the `auth.token.verify` result. Never read `tenantId`, `role`, `siteIds`, `plan` or `features` from the body, query, path or headers.
- Forward to services the actor fields they document (`{ userId, tenantId, role }`, plus `siteIds` where the service lists it) together with the validated DTO. Strip any `tenantId`/`actor` field the client sent.
- For `platform_admin`, `tenantId`, `tenantStatus`, `plan` and `features` are `null`. It may only use platform routes (`billing.admin.*`); every tenant route refuses it (403 `forbidden`).

### Auth guard

- A global guard runs on every route that is not marked `@Public()`. It extracts the access token (see Tokens and cookies), calls `auth.token.verify` and attaches the actor to the request.
- Public routes (no guard): register, login, refresh, accept invitation, password-reset confirm, the Mercado Pago webhook and, if `billing` defines it as public, the plans list. Today `billing.plan.list` is documented as owner/admin only, so it is NOT public.
- Missing token or `invalid_token` from `auth` answers 401. Never cache the verify result across requests: deactivation and suspension must take effect immediately.

### Tokens and cookies

- Web: the gateway sets the access and refresh tokens in `httpOnly`, `Secure`, `SameSite` cookies on login, refresh and invitation acceptance (and on register, which also returns a token pair), and clears them on logout. Tokens are not returned in the JSON body for web clients.
- Mobile: `Authorization: Bearer <accessToken>` header; the token pair is returned in the JSON body; the app keeps the refresh token in secure storage and sends it in the body of `/auth/refresh`.
- How the gateway tells them apart (initial rule, to be implemented): a request that carries the access cookie is a web request; a request with an `Authorization` header and no cookie is a mobile request. If both are present, the `Authorization` header wins and CSRF is not required (a bearer token is not sent automatically by the browser). For public auth routes the client states its type explicitly with a header (for example `X-Client: web` or `X-Client: mobile`), because there is no cookie yet; default to the web behaviour when the header is missing so tokens never leak into a body by accident.
- Never log tokens, cookies or `Authorization` headers.

### CSRF

- Cookie-authenticated state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require CSRF protection. Initial design: double-submit token. The gateway sets a non-`httpOnly` CSRF cookie at login/refresh and the web client echoes it in an `X-CSRF-Token` header; the gateway compares both in constant time.
- Bearer-authenticated requests (mobile) skip CSRF.
- The webhook route is exempt (it has its own authenticity checks in `billing`).

### CORS

- Allow only the origin in `WEB_ORIGIN`, with `credentials: true`, explicit allowed methods and headers (including `X-CSRF-Token`). Never use `*` together with credentials. Mobile apps are not subject to browser CORS.
- The Socket.IO gateway uses the same origin and credentials policy.

### Role checks

- Routes declare the allowed roles with a decorator (for example `@Roles('owner', 'admin')`). Use it for coarse checks only, taken from the route map below. Examples: `billing.admin.*` only `platform_admin`; `auth.invitation.*` only `owner`/`admin`.
- Fine-grained rules (admin vs admin, supervisor site scope, ownership of a resource) are enforced by the service that receives the actor. Do not duplicate them here.
- Where a service lists the caller only as "gateway" with no role, the gateway lets any authenticated tenant role through and the service decides.

### Plan gating

- Route metadata declares the required feature (`@RequiresFeature('tasks' | 'alerts' | 'tower')`). If `actor.features` lacks it (or is `null`), answer 403 `feature_not_in_plan`.
- Mapping from the service docs: every `tasks.*` route needs `tasks`; `attendance.alert.*` needs `alerts`; `attendance.tower.snapshot` and the Control Tower WebSocket need `tower`.

### Tenant status

- `active` and `past_due`: normal access (`past_due` only shows a banner in the frontend, which reads `tenantStatus` from verify).
- `suspended` or `cancelled`: only `owner` and `admin` may use the routes marked "billing" or "export" in the route map; everything else answers 403 `tenant_suspended` or `tenant_cancelled` (matching the status). `supervisor` and `employee` are already rejected by `auth.token.verify`.
  - `suspended`: `billing.subscription.get`, `billing.invoice.*` (including `payment-link`).
  - `cancelled`: the same, plus `billing.plan.list` and `billing.subscription.resubscribe`.
  - Data export routes: no service defines export patterns yet; when one does, it is allowed in both states and is added to the route map.
- `platform_admin` is never affected by a tenant status.

### Rate limiting

- `@nestjs/throttler` with the in-memory store. Public routes are limited per IP; authenticated routes per user (`userId`), with a generous limit. Login, register, accept invitation and password-reset confirm get a stricter limit than the rest.
- Behind a proxy or load balancer, configure trusted proxy settings so the IP is the client's, not the proxy's.
- Redis store only when the gateway runs more than one replica (future); do not add it before.
- Over the limit answers 429 with `{ detail, code: "rate_limited" }`.

### Webhooks

- `POST /api/v1/webhooks/mercadopago`: no auth guard, rate limited per IP, no CSRF. Forward the RAW body and the headers to `billing.webhook.mercadopago` without parsing, trusting or logging them. `billing` validates the signature and deduplicates. Respond fast (`{ ok: true }` from billing, or a quick 2xx) and keep the timeout short.
- The raw body requires enabling raw body capture for this route only.

### Control Tower WebSocket

- Socket.IO through `@nestjs/websockets`, same origin/credentials policy as HTTP.
- On connection: take the access token (cookie for web, `auth` handshake field or `Authorization` header for mobile if ever used), call `auth.token.verify`, require feature `tower` and role `owner`, `admin` or `supervisor`. Otherwise disconnect with a typed error (`invalid_token`, `feature_not_in_plan`, `forbidden`, `tenant_suspended`, `tenant_cancelled`).
- Rooms: one room per allowed site, named `{tenantId}:{siteId}`. Supervisor: the `siteIds` from verify. Owner/admin: every site of the tenant, obtained with `organization.site.list` (iterate pages). Never accept room names or site ids from the client.
- Initial state: request `attendance.tower.snapshot` with the actor and send it to the socket.
- Live updates: subscribe server-side (once per gateway process, not per socket) to `t.*.attendance.site_summary_updated` and emit each message to the room `{tenantId}:{siteId}` built from the event subject tenant and the payload `siteId`. The browser never talks to NATS. Check that the subject tenant matches the payload `tenantId` before emitting.
- Token expiry rule (initial): the gateway disconnects the socket when the access token expires (use `exp` from the token; do not verify again on a timer). The client reconnects with its refreshed token, which runs verify again.
- Known limitation: a supervisor's site assignment change applies on reconnect, not live.
- If the load of open connections becomes a problem, the connection can move to a dedicated `tower` service without changing the frontend.

### Error mapping

- A global exception filter maps `RpcException` `{ status, code, message }` to the HTTP status with body `{ detail, code }`. Known codes from the services include `invalid_credentials` (401), `invalid_token` (401), `forbidden` (403), `tenant_suspended` (403), `tenant_cancelled` (403), `email_taken` (409), `validation_error` (422). Gateway-own codes: `feature_not_in_plan` (403), `rate_limited` (429), `csrf_invalid` (403), `upstream_timeout` (504), `upstream_unavailable` (503).
- Unknown errors answer 500 `{ detail: "Internal error", code: "internal_error" }`; never leak stack traces or upstream messages that were not meant for clients.
- Global `ValidationPipe` (whitelist, forbid non-whitelisted, transform) on every DTO; a validation failure answers 422 `validation_error`.

### Timeouts

- Every `ClientProxy.send` goes through `firstValueFrom(client.send(...).pipe(timeout(NATS_TIMEOUT_MS), catchError(...)))`. A timeout maps to 504 `upstream_timeout`; a NATS connection failure or no responder maps to 503 `upstream_unavailable`.
- Never retry non-idempotent requests automatically.

## Route map

Target map built only from the patterns documented in each service's `AGENTS.md`. Paths are the proposed REST shape under `/api/v1`; the NATS pattern and the auth column are the contract. "any" means any authenticated tenant role (the service decides the rest). "billing" marks routes that stay open to `owner`/`admin` while the tenant is suspended or cancelled (see Tenant status).

### auth

| Method + path | NATS pattern | Auth | Feature |
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

`auth.token.verify` is called by the guard and the WebSocket, not exposed as a route. `auth.user.list-recipients` is internal only: never expose it.

### organization

| Method + path | NATS pattern | Auth | Feature |
|---|---|---|---|
| `POST /sites`, `PATCH /sites/:siteId` | `organization.site.create` / `update` | owner, admin | - |
| `GET /sites/:siteId` | `organization.site.get` | any | - |
| `GET /sites` | `organization.site.list` | any | - |
| `POST /sites/:siteId/rotate-qr` | `organization.site.rotate-qr` | owner, admin | - |
| `POST /sites/:siteId/posts`, `PATCH /posts/:postId`, `GET /sites/:siteId/posts` | `organization.post.create` / `update` / `list` | any (service decides) | - |
| `POST /employees` | `organization.employee.create` | owner, admin | - |
| `PATCH /employees/:employeeId` | `organization.employee.update` | owner, admin | - |
| `GET /employees/:employeeId`, `GET /employees` | `organization.employee.get` / `list` | any | - |
| `GET /shifts/:shiftId/available-employees` | `organization.employee.list-available` | owner, admin, supervisor | - |
| `POST/PATCH /shift-templates`, `POST /shift-templates/:id/deactivate`, `GET /shift-templates` | `organization.shift-template.create` / `update` / `deactivate` / `list` | owner, admin | - |
| `POST /shifts`, `PATCH /shifts/:shiftId`, `POST /shifts/:shiftId/reassign`, `POST /shifts/:shiftId/cancel` | `organization.shift.create` / `update` / `reassign` / `cancel` | owner, admin, supervisor | - |
| `GET /shifts/:shiftId`, `GET /shifts` | `organization.shift.get` / `list` | any | - |

### attendance

| Method + path | NATS pattern | Auth | Feature |
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

The documented caller for manual, correct, acknowledge, resolve and snapshot is "supervisor/admin". The gateway also lets `owner` through (owner can do everything an admin can); confirm with the service owner if this should change.

### tasks (every route needs feature `tasks`)

| Method + path | NATS pattern | Auth |
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

| Method + path | NATS pattern | Auth | Feature |
|---|---|---|---|
| `POST /push-tokens`, `DELETE /push-tokens` | `notifications.push-token.register` / `unregister` | any | - |
| `GET /notifications` | `notifications.notification.list` | any | - |
| `GET /notifications/unread-count` | `notifications.notification.unread-count` | any | - |
| `POST /notifications/:id/read` | `notifications.notification.mark-read` | any | - |

### billing

| Method + path | NATS pattern | Auth | Notes |
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

### WebSocket

| Endpoint | Source of data | Auth | Feature |
|---|---|---|---|
| Socket.IO connection (Control Tower) | `attendance.tower.snapshot`, `organization.site.list` (owner/admin), event `t.*.attendance.site_summary_updated` | owner, admin, supervisor | `tower` |

## Stack

- NestJS 12 over HTTP (`@nestjs/platform-express`), NATS client through `@nestjs/microservices`.
- Env validation with joi in `src/config/envs.ts` (already used).
- To add (ask before installing any dependency): `@nestjs/throttler`, `@nestjs/websockets` + `@nestjs/platform-socket.io`, `class-validator` + `class-transformer`, `cookie-parser`.
- Tests: Jest + supertest (installed).

## Current Status (READ FIRST)

What exists today:

- `src/main.ts`: `NestFactory.create`, global prefix `api` (no versioning), listens on `PORT`.
- `src/transport/nats.module.ts`: `ClientsModule` registering a NATS client named `NATS_SERVICE`, servers from `NATS_SERVER`.
- `src/config/`: joi validation for `PORT` and `NATS_SERVER` only.
- `src/auth/auth.controller.ts`: `POST login` sends `{ cmd: 'login' }` with an empty payload (does not match `auth.login`); `logout`, `register` and `refresh-token` are placeholders returning fixed messages.

What is missing (not implemented):

- URI versioning (`/api/v1`), CORS, global `ValidationPipe`.
- Auth guard, actor building, role and feature decorators, tenant status checks.
- Cookie handling, bearer/cookie detection and CSRF.
- Exception filter for `RpcException`, timeouts and `catchError` helper.
- Rate limiting (`@nestjs/throttler`).
- Mercado Pago webhook route with raw body.
- Socket.IO Control Tower gateway.
- Routes for every service in the route map, and the shared pattern constants file.
- Tests (no `test/` folder yet).

Do not change source code under `src/` unless the user asks for it.

## Environment Variables

| Variable | Status | Description |
|----------|--------|-------------|
| `PORT` | exists | HTTP port |
| `NATS_SERVER` | exists | Comma-separated NATS URLs |
| `WEB_ORIGIN` | to add | Allowed web origin for CORS and Socket.IO (credentials enabled) |
| `COOKIE_SECURE` | to add | `true` in production; if absent, derive from `NODE_ENV` (`true` unless `development`) |
| `NATS_TIMEOUT_MS` | to add | Request-reply timeout. Initial value: `5000` |
| `RATE_LIMIT_PUBLIC_TTL_MS` / `RATE_LIMIT_PUBLIC_LIMIT` | to add | Public routes per IP. Initial values: `60000` / `30` |
| `RATE_LIMIT_AUTH_TTL_MS` / `RATE_LIMIT_AUTH_LIMIT` | to add | Authenticated routes per user. Initial values: `60000` / `300` |

All defaults are initial values to tune with real traffic. Validate every variable in `src/config/envs.ts` and list them in `.env.example`. Never commit `.env`.

## Security Rules (non-negotiable)

1. The actor comes only from `auth.token.verify`. Never from body, query, path or headers.
2. Never log passwords, tokens, cookies, `Authorization` headers, raw webhook bodies or full login/register payloads.
3. Auth cookies are `httpOnly`, `Secure` (outside local development) and `SameSite`; state-changing cookie requests need CSRF.
4. CORS allows only `WEB_ORIGIN`; never `*` with credentials.
5. Never expose `auth.user.list-recipients` or any internal-only pattern.
6. Never trust the webhook: forward it raw and let `billing` validate it.
7. Never put a tenant in a NATS subject; the tenant travels in the actor payload.
8. Never return upstream error internals to the client; map known codes only.

## Tests

- Unit tests with `ClientProxy` mocked; e2e with supertest and a mocked NATS client.
- Always covered:
  - Guard: no token, invalid token, valid token builds the actor only from the verify result (a body/header `tenantId` is ignored).
  - Cookie path vs bearer path; mobile refresh through the body; cookies set on login/refresh/accept and cleared on logout.
  - CSRF: cookie request without or with a wrong token is rejected; bearer request skips CSRF; webhook is exempt.
  - CORS: only `WEB_ORIGIN` allowed.
  - Role decorators: `billing.admin.*` rejects every role but `platform_admin`; `platform_admin` is refused on tenant routes.
  - Plan gating: missing or `null` feature answers 403 `feature_not_in_plan` for `tasks`, `alerts` and `tower` routes.
  - Tenant status: `suspended` and `cancelled` allow only the billing routes for owner/admin (with the `cancelled` extras) and answer 403 `tenant_suspended` / `tenant_cancelled` elsewhere; `past_due` is unrestricted.
  - Error mapping: `RpcException` to `{ detail, code }`, timeout to 504, no responder to 503, validation to 422.
  - Throttling: public per IP, authenticated per user, 429 after the limit.
  - Webhook forwarding: raw body and headers reach `billing.webhook.mercadopago` unchanged; no auth required.
  - Socket rooms: supervisor joins only its `siteIds`; owner/admin join all sites from `organization.site.list`; a basic-plan tenant or an employee is disconnected; an event for another tenant or site never reaches the room; the socket is disconnected when the access token expires.

## Before Finishing a Task

- [ ] `pnpm lint`, `pnpm test` and `pnpm build` pass.
- [ ] If you added or changed a route, the route map above, the README and the matching service `AGENTS.md` agree.
- [ ] If you changed a pattern, payload or error code, you updated this file and the affected services, and called it out in the PR description (it affects other services).
- [ ] New environment variables are validated in `src/config/envs.ts` and listed in `.env.example`.
- [ ] No secrets, tokens, cookies or personal data in logs, tests or fixtures.
