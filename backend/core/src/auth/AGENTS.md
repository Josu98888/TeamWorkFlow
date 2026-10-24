# AGENTS.md — `auth` module (`backend/core`)

Guide for coding agents working on the `auth` module of `backend/core`. Read `backend/core/AGENTS.md` (core-wide rules: module boundaries, HTTP layer, event bus) and then this file fully before making changes. This file overrides the root `AGENTS.md` and `backend/core/AGENTS.md` for the `auth` domain rules when they conflict. Code patterns live in `skills/teamworkflow-nest`; migrations in `skills/teamworkflow-prisma-migrations`.

## What this module is

`auth` is the identity module of TeamWorkFlow, a multitenant SaaS for managing field staff across many sites. Each tenant is an organization; every user belongs to exactly one tenant. If this module has a bug, every tenant is exposed: treat every change as security-sensitive.

`auth` is a module of the `backend/core` modular monolith (`src/auth/`, `AuthModule`). Other core modules reach it only through its exported facade service or its events; `telemetry` (a separate service) verifies tokens through the NATS request `auth.token.verify`, which this module answers. It can be extracted to its own service later without changing its event consumers (`docs/architecture.md`).

Responsibilities:

- Registration: a new user creates a new tenant and becomes its `owner`.
- Login with email + password (the same flow for every role, employees included).
- Session tokens: short-lived access JWT + rotating, revocable refresh token.
- Token verification for the HTTP layer of `core` (in-process facade call `auth.token.verify`) and for `telemetry` (the same operation answered as a NATS request).
- Invitations: `owner`/`admin` invite people to their tenant through a single-use link. Employee invitations are also created automatically from the `organization` module's events (see Invitations).
- Roles inside a tenant: `owner`, `admin`, `supervisor`, `employee` (fixed, not configurable), plus the platform role `platform_admin`, which belongs to no tenant.
- Site scope of supervisors (`User.siteIds`): which sites (owned by `organization`) each supervisor can see.
- Tenant access status (`active` | `past_due` | `suspended` | `cancelled` | `deleted`), driven by `billing` events (see Tenant status).
- The tenant's current plan and features (`plan`, `features`), kept from `billing` events and returned by `auth.token.verify` so the HTTP layer of `core` can gate routes.
- Admin-generated password reset links.
- Deactivating users.

Out of scope (do NOT implement here):

- User profile data (name, phone, avatar) and the employee record (legajo): owned by the employees sub-module of the `organization` module. There is no `users` module. `auth` only receives the name at registration or invitation acceptance and forwards it in the `t.<tenant>.auth.user_created` event; `organization` creates or links the profile.
- Sending emails. There is no email provider yet: invitation and reset links are returned to the caller, who shares them.
- Self-service "forgot password" by email, MFA, social login/SSO. Future work; ask before adding.
- Sites, shifts, attendance, tasks and any other business domain: owned by their own modules (or by `telemetry`, for attendance).
- Payments, invoices, plans and prices: owned by `billing`. `auth` only reacts to its events to change the tenant status, to store the tenant's current plan and features and to purge the tenant's identity data when retention expires.
- A backoffice and creating tenants by a platform admin (future). Today a tenant is created only through `auth.register`; the only platform-level user is `platform_admin`, created by seed/CLI.
- The employee record (legajo): owned by `organization`. `auth` only keeps the login identity.
- Real-time Torre de Control connections: the `telemetry` service handles the WebSocket; `auth` only verifies tokens (answering `auth.token.verify` over NATS) and provides `siteIds`.

## Business Rules

### Tenants and registration

1. `auth.register` creates a `Tenant` (status `active`) and its first `User` with role `owner` in one transaction.
2. Email is unique across the whole system (one user, one tenant). Store it trimmed and lowercased.
3. A tenant has exactly one `owner` at all times.
4. Right after the commit, `auth.register` emits `tenant_created` (consumed by `billing`, which starts the trial subscription). Until `billing` emits `subscription_created`, the tenant has no `plan`/`features` stored (see Plan and features).

### Roles

- `platform_admin`: platform operator. Belongs to NO tenant (`tenantId` is null). Created ONLY by a seed or a CLI command, never through registration or invitations, and it cannot be created, promoted or demoted by any request. Logs in with email + password like everybody else. It can only use platform routes (`billing.admin.*`, routed by the HTTP layer of `core`); every tenant route refuses it. It is not affected by any tenant status.
- `owner`: everything in the tenant. Only one per tenant.
- `admin`: manages supervisors and employees (invite, deactivate, reset link, change role between `supervisor` and `employee`, assign sites to supervisors). Only the `owner` manages admins.
- `supervisor`: scoped to its assigned sites: sees the Torre de Control of those sites, handles alerts and corrects attendance (business actions of other modules and `telemetry`). Cannot manage users.
- `employee`: operational staff, uses the mobile app: clock in/out, own shifts, tasks, forms and emergency offers. Cannot manage users.

| Action | owner | admin | supervisor | employee |
|--------|:-----:|:-----:|:----------:|:--------:|
| Invite a `supervisor` or `employee` | ✅ | ✅ | ❌ | ❌ |
| Invite an `admin` | ✅ | ❌ | ❌ | ❌ |
| List pending invitations (`auth.invitation.list`) | ✅ | ✅ | ❌ | ❌ |
| Regenerate the link of a pending `supervisor`/`employee` invitation | ✅ | ✅ | ❌ | ❌ |
| Regenerate the link of a pending `admin` invitation | ✅ | ❌ | ❌ | ❌ |
| Change a user's role (`supervisor` ↔ `employee`) | ✅ | ✅ | ❌ | ❌ |
| Change a user's role to or from `admin` (promote/demote) | ✅ | ❌ | ❌ | ❌ |
| Assign sites to a `supervisor` | ✅ | ✅ | ❌ | ❌ |
| Deactivate a `supervisor` or `employee` | ✅ | ✅ | ❌ | ❌ |
| Deactivate an `admin` | ✅ | ❌ | ❌ | ❌ |
| Generate a password reset link for a `supervisor` or `employee` | ✅ | ✅ | ❌ | ❌ |
| Generate a password reset link for an `admin` | ✅ | ❌ | ❌ | ❌ |

- The table above covers the roles of a tenant. `platform_admin` has none of these actions: it cannot invite, change roles, assign sites, deactivate users or reset passwords of any tenant, and nobody can act on a `platform_admin` through these actions (it is managed only by seed/CLI).
- Nobody can deactivate or demote the `owner`. Ownership transfer is out of scope for now.
- Nobody can act on themselves through these admin actions (no self-deactivation, no self-role change).
- Every check compares the actor's `tenantId` with the target's. A user can NEVER read or modify a user of another tenant, whatever their role.

### Supervisor site scope (`User.siteIds`)

- `User.siteIds` (`String[]`, column `site_ids`, default `[]`) stores the site ids of a supervisor (references to sites of `organization`, no foreign key across schemas). There is no separate table.
- Only users with role `supervisor` can have a non-empty `siteIds`; every other role has `[]`. `auth.user.assign-sites` replaces the full array of one supervisor (site ids are deduplicated in the application before saving). It is allowed for `owner` and `admin`, within the same tenant.
- `auth` does not validate that a `siteId` exists in `organization` (that data is not ours). The caller (the frontend, through the HTTP layer of `core`) is responsible for sending real site ids of the tenant.
- When a supervisor changes role, its `siteIds` is set to `[]`.
- `owner` and `admin` see every site of the tenant: their `siteIds` is `[]` and it is not returned for them.
- Site ids are NOT put in the JWT: they change without re-login and could make the token large. They come from `auth.token.verify`.

### Invitations

- An invitation has: `email`, `role` (`admin` | `supervisor` | `employee`), `tenantId`, `invitedById` (null when created from the `organization` event), a single-use token, and `expiresAt` = 7 days.
- `auth.invitation.create` returns the link token to the caller; the frontend shows a copyable link. Supervisors and admins are invited directly through it.
- `auth.invitation.list` (owner/admin) returns the pending invitations of the tenant as metadata only (`invitationId`, `email`, `role`, `expiresAt`). It can NOT return links: tokens are stored only as hashes.
- `auth.invitation.regenerate` (owner/admin, same role rules as creating that invitation) revokes a pending invitation and issues a new token with a fresh 7-day expiry, returned once so the frontend can show the copyable link. This is how the admin gets the link of an invitation created from the `organization` event, or of a lost link.
- Employee onboarding: the admin creates the employee record (legajo) in the employees module of `organization` with the email. `organization` emits `t.<tenant>.organization.employee_created`. `auth` consumes it and creates an invitation with role `employee` for that email. Handling is idempotent: the same event twice (same `eventId`) creates one invitation, and an email that already has a pending invitation or an existing user is not duplicated.
- The invited email must not belong to an existing user. Creating a new invitation for the same email in the same tenant revokes the previous pending one.
- `auth.invitation.accept` receives the token, name and password; it creates the user in the inviting tenant with the invited role and marks the invitation as used. Expired, used or revoked tokens fail with a generic error.
- Employees then log in with email + password, like everybody else.

### Sessions and tokens

- Access token: JWT, 15 minutes. Claims: `sub` (user id), `tenantId` (absent/null for `platform_admin`), `role`, `jti`, `iat`, `exp`. No personal data (no email, no name), no site ids and no plan data.
- Refresh token: random opaque value, 7 days. Stored ONLY as a SHA-256 hash in `RefreshToken`.
- `auth.token.refresh` rotates: the used refresh token is revoked and a new pair is issued.
- `auth.logout` revokes the current refresh token. The access token stays valid until it expires (max 15 minutes); this is accepted for the token itself, but `auth.token.verify` rechecks the user and the tenant on every call (below), so deactivation and suspension take effect immediately.
- Revoked tokens stay in `auth`: revocation means refresh tokens revoked in the `auth` database. There is no revocation list in NATS KV.
- `auth.token.verify` (called by the HTTP layer of `core` on every authenticated request and on every WebSocket connection) checks signature, expiry, that the user still exists and is active, and that the tenant status allows access (see Tenant status). It returns `{ userId, tenantId, role, siteIds, tenantStatus, plan, features }`. `siteIds` is returned only for `supervisor`. For `platform_admin`, `tenantId`, `tenantStatus`, `plan` and `features` are `null` (it has no tenant and is never blocked by a tenant status). `plan` and `features` are the tenant's current ones (see Plan and features); they are `null` until the first `subscription_created` arrives.
- The HTTP layer of `core` MUST take `tenantId`, `role`, `siteIds`, `plan` and `features` from the verified result, never from the request body, query or headers. It blocks routes whose feature the plan lacks with 403 `feature_not_in_plan`, and routes `billing.admin.*` only to `platform_admin`.

### Tenant status (past due, suspension, cancellation)

`auth` owns the tenant status; `billing` (part of the MVP) owns payments, invoices, the 7-day grace timing and the cancellation timing. `Tenant.status` is `active` | `past_due` | `suspended` | `cancelled` | `deleted`, with `pastDueSince`, `suspendedAt` and `cancelledAt`.

| Event consumed (JetStream) | Effect in `auth` | Event emitted |
|----------------------------|------------------|---------------|
| `t.<tenant>.billing.payment_overdue` (invoice unpaid after its due date) | Status `past_due`, set `pastDueSince`. Everything keeps working. | `t.<tenant>.auth.tenant_past_due` |
| `t.<tenant>.billing.subscription_expired` (day 7 unpaid) | Status `suspended`, set `suspendedAt`, revoke ALL refresh tokens of `supervisor` and `employee` users. | `t.<tenant>.auth.tenant_suspended` |
| `t.<tenant>.billing.payment_received` (while `past_due` or `suspended`) | Status `active`, clear `pastDueSince` and `suspendedAt`. | `t.<tenant>.auth.tenant_reactivated` |
| `t.<tenant>.billing.subscription_cancelled` (a cancelled subscription reached month end) | Status `cancelled`, set `cancelledAt`, revoke ALL refresh tokens of `supervisor` and `employee` users. | `t.<tenant>.auth.tenant_cancelled` |
| `t.<tenant>.billing.subscription_reactivated` (the owner/admin resubscribed) | Status `active`, clear `cancelledAt`. Plan and features come from the `plan_changed` that `billing` emits together with it. | `t.<tenant>.auth.tenant_reactivated` |
| `t.<tenant>.billing.data_retention_expired` (90 days after `cancelled`, only if still cancelled) | Purge the tenant's identity data (see Tenant data purge); status `deleted`. | none |

- While `past_due`: no restriction. The frontend shows a banner to `owner`/`admin` reading `tenantStatus` from verify. Billing sends the warning notifications on days 1, 4 and 6 through `t.<tenant>.notifications.send`; `auth` does not send them.
- While `suspended`:
  - `supervisor` and `employee` cannot log in, refresh or pass `auth.token.verify`: they get `tenant_suspended` (403). On login this code is returned ONLY after the password is correct, so it leaks nothing to someone guessing credentials.
  - `owner` and `admin` can log in. `verify` succeeds and returns `tenantStatus: "suspended"`; the HTTP layer of `core` only allows billing (pay) and data export routes and answers 403 `tenant_suspended` to everything else.
  - Other modules and `telemetry` pause automatic processes for the tenant when they consume `tenant_suspended`, and resume on `tenant_reactivated`. Data is never deleted while suspended.
- While `cancelled`: exactly the same access rules as `suspended`. `supervisor` and `employee` get `tenant_cancelled` (403) on login (after a correct password), refresh and verify, and their refresh tokens were revoked when the status changed. `owner` and `admin` can log in; `verify` returns `tenantStatus: "cancelled"` and the HTTP layer of `core` only allows the billing routes (plan, invoices and `billing.subscription.resubscribe`) and data export, and answers 403 `tenant_cancelled` to everything else. Other modules and `telemetry` pause automatic processes when they consume `tenant_cancelled` exactly as with `tenant_suspended`, and resume on `tenant_reactivated`.
- Reactivation of a `cancelled` tenant happens ONLY through `subscription_reactivated` (the owner/admin resubscribed, see `billing`). A `payment_received` that arrives while the tenant is `cancelled` (for example the last invoice paid after cancelling) is a no-op: paying does not reactivate access.
- Event handling is idempotent: the same event twice, or an event that does not change the state (for example `payment_overdue` when already `past_due`, `payment_received` when already `active`), is a no-op and emits nothing new (also `subscription_cancelled` when already `cancelled`). A `subscription_expired` received while `active` also suspends, and `subscription_cancelled` is accepted from any state except `deleted`. `payment_overdue` and `subscription_expired` received while `cancelled` are ignored.
- After reactivation the revoked refresh tokens stay revoked; users simply log in again.
- `platform_admin` is never affected by a tenant status.

### Tenant data purge

- On `t.<tenant>.billing.data_retention_expired`, if the tenant is still `cancelled`, `auth` permanently deletes the tenant's users, refresh tokens, invitations, password reset tokens and processed events, and sets the tenant status `deleted`. This is the only hard deletion of users (see Deactivation): the retention period ended.
- It keeps a minimal tombstone: the `Tenant` row with only `id`, `name` and status `deleted` (plan, features and dates are cleared), so the `tenantId` that `billing` still references in its invoices and payments stays consistent. Nothing else is kept.
- Idempotent: a second delivery finds the tenant already `deleted` and is a no-op. An event for a tenant that is not `cancelled` (for example it resubscribed meanwhile) is ignored.
- The email of a deleted user becomes free: it can register again as a new tenant.
- `platform_admin` is never affected.

### Plan and features

- `Tenant` stores `plan` (`basic` | `pro`) and `features` (an object such as `{ tasks, alerts, tower }`), both nullable until the first plan event arrives.
- They are updated from the consumed `t.<tenant>.billing.subscription_created` and `t.<tenant>.billing.plan_changed` events, which carry `plan` and `features`. Handling is idempotent (same `eventId` twice is a no-op) and a stale event must not overwrite a newer one (compare `occurredAt`, or `effectiveAt` for `plan_changed`).
- `auth` does NOT decide what a plan includes: it stores what `billing` sends and returns it from `auth.token.verify`. The HTTP layer of `core` enforces it.
- `auth` does not expose plan-changing patterns; only `billing` events change them.

### Password reset (admin-generated)

- `auth.password-reset.create` returns a single-use token that expires in 1 hour, following the role table above.
- `auth.password-reset.confirm` sets the new password, marks the token as used and revokes all the user's refresh tokens.

### Brute-force protection

- 5 consecutive failed logins lock the account for 15 minutes (`failedLoginAttempts`, `lockedUntil`). A successful login resets the counter.
- Login errors are always generic (`invalid_credentials`): never reveal whether the email exists, the account is locked, or the user is deactivated. The only exception is `tenant_suspended`, returned after a correct password.

### Deactivation

- Deactivating sets `isActive = false`, revokes all the user's refresh tokens and emits `t.<tenant>.auth.user_deactivated`.
- Users are never hard-deleted while their tenant exists: other modules and `telemetry` keep referencing their id. The only deletion is the tenant data purge.
- Deactivated users cannot log in, refresh, or pass `auth.token.verify`.

## Stack

- NestJS 12 module inside `backend/core`; HTTP controllers for this module's endpoints live in `src/auth/` (see `backend/core/AGENTS.md`). NATS is used for JetStream events and for the one request responder `telemetry` needs (`auth.token.verify`).
- PostgreSQL + Prisma 7 (own `src/auth/prisma/schema.prisma`, migrations and generated client, colocated in the module; Prisma config `backend/core/prisma.auth.config.ts`, scripts `pnpm prisma:auth:generate` / `prisma:auth:migrate:dev` / `prisma:auth:migrate:deploy` / `prisma:auth:migrate:status`; `auth` schema of the shared `teamworkflow` database, accessed with the `auth_svc` role that cannot read other schemas; see `backend/STEPS.md` S1.1). `PrismaService` is private to `AuthModule`.
- Password hashing: Argon2id (`argon2` package).
- JWT: `@nestjs/jwt`.
- Validation: `class-validator` + `class-transformer` with the global `ValidationPipe` of `core` (422 `validation_error`); the NATS responder binds the same pipe itself.
- Env validation with joi in `src/config/envs.ts`, same pattern as the rest of `core`.

Ask before installing any dependency.

## Current Status (READ FIRST)

Task T6 of `odd/tasks/two-service-architecture.md` is merging `backend/auth` (a NATS microservice with `@MessagePattern` handlers; step status in [STEPS.md](STEPS.md)) and `backend/gateway` into `backend/core`: handlers become HTTP controllers calling the same services, and `auth.token.verify` is also kept as a NATS responder for `telemetry`. Done in `src/auth/` so far: Prisma layout, crypto, wire and tenant access (T6.3); in T6.4a, `AuthService` (register, login, refresh, logout, verify), `TokenService`, the register/login/refresh/logout/verify DTOs, the HTTP controller (`POST /api/auth/register|login|refresh|logout`; `refresh` replaces the gateway's `refresh-token`), the `auth.token.verify` NATS responder, `JetStreamService` (`src/auth/events/`) and `AuthModule` (exports only `AuthService`); in T6.4b, invitations, users and password reset (services, policies, DTOs, specs and HTTP controllers, see Routes); and, in T6.5, the consumed-event side: `ConsumedEventProcessor` (`src/auth/events/`), the handlers `employee-created.handlers.ts` (`src/auth/invitations/`) and `tenant-status.billing.handlers.ts`, `tenant-plan.handlers.ts`, `tenant-purge.handlers.ts` with `tenant-status.transitions.ts` (`src/auth/tenants/`), all providers of `AuthModule` that register on `JetStreamService` in `onModuleInit` (the durable consumers `auth-organization` on `ORGANIZATION_EVENTS` and `auth-billing` on `BILLING_EVENTS` start when the app initializes, same names as `backend/auth`; the producer stream is `AUTH_EVENTS`), and the platform admin seed (`src/auth/platform-admin/`, run with `pnpm seed:platform-admin`, reads `AUTH_DATABASE_URL`). Nothing of `backend/auth/src` remains unmoved except what the merge replaces on purpose: its `app.module.ts`, `main.ts` and `prisma.module.ts` (core has its own), the `@MessagePattern` controllers (now HTTP controllers) and `common/pipes`, `common/exceptions` and `config` (core has its own in `src/common` and `src/config`).

Layout (all under `src/auth/`, all providers of `AuthModule`; none is exported):

- `invitations/`: `InvitationsService` (create, list, regenerate), `InvitationAcceptService`, `invitation-policy.ts`, `InvitationsController`, `dto/`.
- `users/`: `UserChangeRoleService`, `UserAssignSitesService`, `UserDeactivateService`, `UserListRecipientsService` (internal, registered but without route or facade method yet), `user-policy.ts`, `UsersController`, `dto/`.
- `password-reset/`: `PasswordResetCreateService`, `PasswordResetConfirmService`, `PasswordResetController`, `dto/`.
- `service-actor.ts`: `toServiceActor()` reduces the verified actor to `{ userId, tenantId, role }` for the services.

### Routes (prefix `/api`)

| Method + path | Operation | Auth | Roles |
|---|---|---|---|
| `POST /auth/invitations` | `auth.invitation.create` | guarded | owner, admin (admin only for `supervisor`/`employee`) |
| `GET /auth/invitations` | `auth.invitation.list` | guarded | owner, admin |
| `POST /auth/invitations/:invitationId/regenerate` | `auth.invitation.regenerate` | guarded | owner, admin (admin only for non-admin invitations) |
| `POST /auth/invitations/accept` | `auth.invitation.accept` | `@Public()` | - |
| `PATCH /auth/users/:userId/role` | `auth.user.change-role` | guarded | owner, admin (see role table) |
| `PUT /auth/users/:userId/sites` | `auth.user.assign-sites` | guarded | owner, admin |
| `POST /auth/users/:userId/deactivate` | `auth.user.deactivate` | guarded | owner, admin (admin only for non-admin targets) |
| `POST /auth/users/:userId/password-reset` | `auth.password-reset.create` | guarded | owner, admin (admin only for non-admin targets) |
| `POST /auth/password-reset/confirm` | `auth.password-reset.confirm` | `@Public()` | - |

Rules for these controllers: the actor comes only from `@CurrentActor()`; body DTOs (`*BodyDto`) never declare `actor` or `tenantId` (the global pipe answers 422 if a client sends them); path params are validated by DTOs (`UserIdParamDto`, `InvitationIdParamDto`: uuid, 422 otherwise); the controller builds `{ ...body, ...params, actor }` and the service applies the role and tenant rules (there is no `@Roles` decorator yet, so the services' 403 `forbidden` is the role check). `auth.user.list-recipients` has no route.

NOTE (gap): `POST /auth/logout` is guarded, but `AuthService.logout` does not check that the refresh token belongs to the actor (behavior moved unchanged); decide whether to scope it. Web cookies and CSRF are not implemented: the guard reads `Authorization: Bearer` only and tokens are returned in the JSON body.

Do not change the code in `backend/auth` or `backend/gateway` for the merge without the user asking for it (T6).

## NATS Contract

Operation names follow `<module>.<resource>.<action>` and carry NO tenant prefix: the tenant comes from the verified actor. Domain events follow the platform convention `t.<tenant>.<module>.<event>` (JetStream), so auth events are `t.<tenant>.auth.<event>` with snake_case event names.

In `core` the operations below are **in-process calls** to the module's facade service (invoked by the module's HTTP controllers and by other core modules); the pattern string is kept as the operation's stable name. Only `auth.token.verify` is also a **NATS request-reply responder**, because `telemetry` (a separate service) needs it. Keep the names in a constants file (to create: `src/auth/auth.patterns.ts`).

### Operations (module facade) and NATS responders

| Operation | Caller | Payload | Returns |
|---------|--------|---------|---------|
| `auth.register` | HTTP controller (public) | `tenantName`, `name`, `email`, `password` | token pair |
| `auth.login` | HTTP controller (public) | `email`, `password` | token pair |
| `auth.token.refresh` | HTTP controller (public) | `refreshToken` | token pair |
| `auth.logout` | HTTP controller | `refreshToken` | `{ ok: true }` |
| `auth.token.verify` | HTTP guard of `core` (facade call); `telemetry` for its HTTP guard and WebSocket connections (NATS responder) | `accessToken` | `{ userId, tenantId, role, siteIds, tenantStatus, plan, features }` |
| `auth.invitation.create` | HTTP controller (owner/admin) | actor, `email`, `role` | `{ invitationId, token, expiresAt }` |
| `auth.invitation.list` | HTTP controller (owner/admin) | actor | pending invitations (`invitationId`, `email`, `role`, `expiresAt`) |
| `auth.invitation.regenerate` | HTTP controller (owner/admin) | actor, `invitationId` | `{ invitationId, token, expiresAt }` |
| `auth.invitation.accept` | HTTP controller (public) | `token`, `name`, `password` | token pair |
| `auth.user.change-role` | HTTP controller (owner/admin, see role table) | actor, `userId`, `role` | `{ ok: true }` |
| `auth.user.assign-sites` | HTTP controller (owner/admin) | actor, `userId`, `siteIds` | `{ ok: true }` |
| `auth.user.deactivate` | HTTP controller (owner/admin) | actor, `userId` | `{ ok: true }` |
| `auth.user.list-recipients` | internal to `core` modules only (e.g. `notifications`, facade call); never exposed as an HTTP route or a NATS responder | `tenantId`, `roles[]`, optional `siteId` | `{ userIds: string[] }`: ACTIVE users of that tenant with one of the roles; with `siteId`, supervisors only if assigned to that site (owner/admin always included when their role is requested) |
| `auth.password-reset.create` | HTTP controller (owner/admin) | actor, `userId` | `{ token, expiresAt }` |
| `auth.password-reset.confirm` | HTTP controller (public) | `token`, `password` | `{ ok: true }` |

"actor" = `{ userId, tenantId, role }` taken by the HTTP layer of `core` from `auth.token.verify` (`tenantId` is null for `platform_admin`). Token pair = `{ accessToken, refreshToken, expiresIn }`. `siteIds` in the verify result is present only for `supervisor`. `auth.login`, `auth.token.refresh` and `auth.token.verify` also work for `platform_admin`; no `auth.*` pattern with a tenant actor accepts it.

### Events emitted

| Event subject | Payload |
|---------------|---------|
| `t.<tenant>.auth.user_created` | `userId`, `tenantId`, `email`, `name`, `role`, `occurredAt` |
| `t.<tenant>.auth.user_role_changed` | `userId`, `tenantId`, `role`, `actorId`, `occurredAt` |
| `t.<tenant>.auth.user_deactivated` | `userId`, `tenantId`, `actorId`, `occurredAt` |
| `t.<tenant>.auth.tenant_created` | `tenantId`, `name`, `ownerId`, `occurredAt` |
| `t.<tenant>.auth.tenant_past_due` | `tenantId`, `pastDueSince`, `occurredAt` |
| `t.<tenant>.auth.tenant_suspended` | `tenantId`, `suspendedAt`, `occurredAt` |
| `t.<tenant>.auth.tenant_cancelled` | `tenantId`, `cancelledAt`, `occurredAt` |
| `t.<tenant>.auth.tenant_reactivated` | `tenantId`, `occurredAt` |

- `occurredAt` is ISO-8601 UTC. Every event carries a unique `eventId` so consumers can deduplicate.
- Consumers (for example `organization`, `tasks`, `notifications` and `telemetry`) must be idempotent: the same event can arrive twice.
- Emit events only after the database transaction commits.

### Events consumed (JetStream, durable consumer, explicit ack)

| Event subject | Producer | Handling |
|---------------|----------|----------|
| `t.<tenant>.organization.employee_created` | `organization` | Create an `employee` invitation for the employee email (idempotent). |
| `t.<tenant>.billing.subscription_created` | `billing` | Store the tenant's `plan` and `features` (idempotent). |
| `t.<tenant>.billing.plan_changed` | `billing` | Update the tenant's `plan` and `features` (idempotent, ignore stale events). |
| `t.<tenant>.billing.payment_overdue` | `billing` | Tenant to `past_due`. |
| `t.<tenant>.billing.subscription_expired` | `billing` | Tenant to `suspended`, revoke supervisor/employee refresh tokens. |
| `t.<tenant>.billing.payment_received` | `billing` | Tenant to `active` (only from `past_due`/`suspended`; no-op when `cancelled`). |
| `t.<tenant>.billing.subscription_cancelled` | `billing` | Tenant to `cancelled`, revoke supervisor/employee refresh tokens. |
| `t.<tenant>.billing.subscription_reactivated` | `billing` | Tenant from `cancelled` to `active`. |
| `t.<tenant>.billing.data_retention_expired` | `billing` | Purge the tenant's users, tokens and invitations; keep the tombstone (status `deleted`). |

The tenant of a consumed event comes from the subject and is checked against the payload; never trust only one of them. `auth` emits `tenant_created`, which `billing` consumes to start the 14-day `pro` trial.

### Errors

Throw an `AppException` subclass from `src/common/exceptions/` (see `teamworkflow-nest`). The HTTP exception filter of `core` maps it to HTTP `{ detail, code }`; NATS responders map it to `{ status, code, message }` via `NatsErrorFilter`.

| code | status | When |
|------|--------|------|
| `invalid_credentials` | 401 | Any login failure (wrong email/password, locked, inactive) |
| `invalid_token` | 401 | Bad, expired or revoked access/refresh/invitation/reset token |
| `forbidden` | 403 | Role or tenant check failed |
| `tenant_suspended` | 403 | Supervisor/employee of a suspended tenant on login (after a correct password), refresh or verify; also returned by the HTTP layer of `core` to owner/admin on routes other than billing and data export |
| `tenant_cancelled` | 403 | Same as `tenant_suspended`, for a cancelled tenant (the HTTP layer of `core` also allows `billing.subscription.resubscribe`) |
| `email_taken` | 409 | Registration or invitation for an existing email |
| `validation_error` | 422 | DTO validation failed |

## Data Model (Prisma, to create)

- `Tenant`: `id`, `name`, `status` (`ACTIVE` | `PAST_DUE` | `SUSPENDED` | `CANCELLED` | `DELETED`), `pastDueSince`, `suspendedAt`, `cancelledAt`, `plan` (nullable: `BASIC` | `PRO`), `features` (json, nullable), `planUpdatedAt` (to ignore stale events), `createdAt`.
- `User`: `id`, `tenantId` (nullable ONLY for `PLATFORM_ADMIN`; a check constraint enforces that every other role has a tenant and `PLATFORM_ADMIN` has none), `email` (unique), `passwordHash`, `role` (`OWNER` | `ADMIN` | `SUPERVISOR` | `EMPLOYEE` | `PLATFORM_ADMIN`), `isActive`, `failedLoginAttempts`, `lockedUntil`, `siteIds` (`String[]`, column `site_ids`, default `[]`; only `SUPERVISOR` may have a non-empty value; ref. to sites of `organization`), `createdAt`, `updatedAt`.
- `RefreshToken`: `id`, `userId`, `tokenHash` (unique), `expiresAt`, `revokedAt`, `createdAt`.
- `Invitation`: `id`, `tenantId`, `email`, `role` (`ADMIN` | `SUPERVISOR` | `EMPLOYEE`), `tokenHash` (unique), `invitedById` (nullable: system), `expiresAt`, `usedAt`, `revokedAt`, `createdAt`.
- `PasswordResetToken`: `id`, `userId`, `tokenHash` (unique), `createdById`, `expiresAt`, `usedAt`, `createdAt`.
- A processed-events table (`eventId`) to deduplicate consumed events, if the idempotency of a handler cannot rely on a natural unique key.

Every query on users, invitations and tokens filters by `tenantId` (or by a `userId` already checked against the actor's tenant). The only queries without `tenantId` are the login/refresh/verify lookups by email or token hash, which must still never return a user across tenants to a tenant actor. Add indexes for every lookup path (`teamworkflow-postgres`), including a GIN index on `users.site_ids` (`@@index([siteIds], type: Gin)`) for `auth.user.list-recipients` by `siteId` (query `siteIds has <siteId>` together with `tenantId`; the tenant filter uses the existing users tenant index). `auth.token.verify` reads `siteIds` from the user row (no join).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NATS_SERVER` | Comma-separated NATS URLs (shared by all of `core`) |
| `AUTH_DATABASE_URL` | PostgreSQL connection string for the `teamworkflow` database, `auth` schema (`?schema=auth`), `auth_svc` role |
| `JWT_SECRET` | Access token signing secret (at least 32 random bytes) |
| `ACCESS_TOKEN_TTL` | Default `15m` |
| `REFRESH_TOKEN_TTL` | Default `7d` |

The `platform_admin` is created by a seed/CLI command (to create) that reads its email and password from the operator at run time; never store them in the repository or in `.env.example`.

Validate all of them in `src/config/envs.ts` and list them in `.env.example`. Never commit `.env`.

## Security Rules (non-negotiable)

1. Never log passwords, tokens (any kind), password hashes or full login/register payloads.
2. Hash passwords with Argon2id. Store refresh, invitation and reset tokens only as SHA-256 hashes; compare in constant time.
3. Generic login errors only (see Errors), except `tenant_suspended` / `tenant_cancelled` after a correct password.
4. `tenantId` always comes from the verified token or from the database, never from client input. `platform_admin` is never creatable through any request.
5. `JWT_SECRET` comes from the environment, never from the repository.
6. Every query that can cross tenants is filtered by `tenantId`, and a test proves it.

## Tests

- Unit tests for every use case with Prisma and the facades of other modules mocked (`pnpm test`).
- Always covered: tenant isolation (admin of tenant A acting on a user of tenant B), role table (including admin vs admin/owner and supervisor/employee being unable to manage users), lockout after 5 failures, generic login errors, refresh rotation (old token rejected), deactivated user rejected by login/refresh/verify, expired/used invitation and reset tokens, owner cannot be deactivated or demoted, `siteIds` returned only for supervisors and replaced by `auth.user.assign-sites`, suspended tenant blocks supervisor/employee (login after correct password, refresh, verify) while owner/admin can log in and get `tenantStatus: "suspended"`, reactivation restores access, a cancelled tenant behaving like a suspended one (supervisor/employee blocked and their refresh tokens revoked, owner/admin allowed with `tenantStatus: "cancelled"`), `payment_received` being a no-op while cancelled, `subscription_reactivated` restoring access, the tenant data purge (`data_retention_expired` deletes users, tokens and invitations of that tenant only, keeps the tombstone with status `deleted`, is ignored when the tenant is not `cancelled`, is idempotent, and leaves other tenants and `platform_admin` untouched), and idempotent handling of `employee_created`, `payment_overdue`, `subscription_expired`, `subscription_cancelled` and `payment_received` (duplicates produce no second invitation or event). Also covered: `platform_admin` can log in and pass `verify` with null `tenantId`, `tenantStatus`, `plan` and `features`, is never blocked by a tenant status, cannot be created by registration or invitation, cannot be acted on by the user-management actions and cannot use tenant actions; the database constraint rejecting a non-platform user without tenant; `subscription_created` and `plan_changed` storing `plan` and `features` idempotently and ignoring stale events; `verify` returning `plan` and `features`; and `auth.user.list-recipients` returning only active users of the requested roles (and supervisors of the site).
- E2E tests (to create in `test/`) once the HTTP layer, the NATS connection and the database are set up.

## Before Finishing a Task

- [ ] `pnpm lint`, `pnpm test` and `pnpm build` pass.
- [ ] Schema changes come with a reviewed Prisma migration.
- [ ] If you changed a pattern, event or payload, you updated this file, `backend/core/AGENTS.md` and the HTTP layer of `core`, and called it out in the PR description (it affects other modules and `telemetry`).
- [ ] No secrets, tokens or personal data in logs, tests or fixtures.
