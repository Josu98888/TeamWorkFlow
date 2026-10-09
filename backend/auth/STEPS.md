# STEPS.md — backend / auth

Follow /STEPS.rules.md. Order: /STEPS.index.md. Backend conventions: /backend/STEPS.template.md.

**Status:** last verified: 2026-10-09 (S1.2) · next: S1.3 · in progress: — · blocked: S1.6 (TODO(auth) contract rename)

Source of truth: `backend/auth/AGENTS.md`. Placeholders (`<lint>`, `<test>`, `<EXCL>`…) are defined in the backend template, run from `backend/auth/`.

---

## Phase 0 — Contract and prerequisites

Commits: (none, read-only phase)

- [x] **S0.1** Confirm in `/STEPS.index.md` that `auth` is next and has no pending dependency.
  Check: `rg -n "auth" STEPS.index.md` (from repo root) shows `auth` as the current domain with no unmet dependency.
- [x] **S0.2** Inventory the scaffold to replace: `src/main.ts` (HTTP), `src/auth/auth.controller.ts` (CRUD patterns), `src/auth/entities/auth.entity.ts`, `src/auth/dto/*-auth.dto.ts`, both scaffold specs.
  Check: `rg -n "createAuth|findAllAuth|NestFactory.create\(" src` lists exactly these files (baseline for S1.6 / S1.3).

## Phase 1 — Foundation (transport, config, errors, validation)

Commits: 58cd5b3, d12199f, 7bfa96b

- [x] **S1.1** Install dependencies (approved 2026-10-09, see Decisions): `@nestjs/jwt`, `argon2`, `class-validator`, `class-transformer`, `joi`, `dotenv`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `@nats-io/jetstream`, dev `prisma`, `@types/pg`.
  Check: `pnpm ls @nestjs/jwt argon2 class-validator class-transformer joi @prisma/client prisma @nats-io/jetstream` lists every package with a version.
- [x] **S1.2** `src/config/envs.ts` + `src/config/index.ts` with joi, same pattern as the gateway. Variables: AGENTS § Environment Variables (`NATS_SERVER`, `DATABASE_URL`, `JWT_SECRET` min 32 chars, `ACCESS_TOKEN_TTL` default `15m`, `REFRESH_TOKEN_TTL` default `7d`). Create `backend/auth/.env.example` with placeholders only.
  Check: `<test> envs` passes with cases: missing `JWT_SECRET` throws; `JWT_SECRET` of 31 chars throws; TTL defaults applied. `rg -n "JWT_SECRET=.{32,}" .env.example` is empty.
- [ ] **S1.3** `src/main.ts` becomes `NestFactory.createMicroservice` with `Transport.NATS` and `servers: envs.natsServers` (skill § Microservice bootstrap). Remove `PORT` usage.
  Check: `rg -n "NestFactory.create\(|app.listen" src --glob '!**/*.spec.ts'` is empty; `<build>` passes.
- [ ] **S1.4** `src/common/exceptions/app.exceptions.ts`: `RpcException` hierarchy emitting `{ status, code, message }` for every code in AGENTS § Errors (`invalid_credentials` 401, `invalid_token` 401, `forbidden` 403, `tenant_suspended` 403, `tenant_cancelled` 403, `email_taken` 409, `validation_error` 422).
  Check: `<test> app.exceptions` passes; one case per code asserts the exact `status` and `code`.
- [ ] **S1.5** Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) whose `exceptionFactory` throws the `validation_error` exception from S1.4.
  Check: `<test> validation` passes: a payload with an unknown field and one with a missing required field both produce `{ status: 422, code: 'validation_error' }`.
- [!] **S1.6** `src/auth/auth.patterns.ts` with every request-reply pattern in AGENTS § Request-reply, and delete the CRUD scaffold (`createAuth`… handlers, `create-auth.dto.ts`, `update-auth.dto.ts`, `entities/auth.entity.ts`, scaffold specs). TODO(auth) The gateway currently sends `{ cmd: 'login' }`; renaming it is a public contract change (rules §6). Confirm the rename; the gateway side is wired in S9.1.
  Check: `rg -n "createAuth|findAllAuth|findOneAuth|updateAuth|removeAuth|cmd: 'login'" backend/auth/src` (from repo root) is empty; `<build>` passes.
- [ ] **S1.7** Lint script works without a `test/` folder (today `oxlint --type-aware src/ test/` points at a missing dir). Fixed for free when S10.1 creates `test/`; if lint fails before that, this step stays `[~]` until S10.1.
  Check: `<lint>` passes.
- [!] **S1.8** Event publishing and consuming over JetStream (AGENTS § Events emitted / consumed: durable consumer, explicit ack). Streams and consumers per backend S1.2: on startup auth creates or updates `AUTH_EVENTS` (`t.*.auth.>`) and its durables `auth-billing` and `auth-organization` (filtered to the subjects in AGENTS § Events consumed), retrying while those streams do not exist yet. Client per backend S1.3: `src/events/jetstream.service.ts` on `@nats-io/jetstream`; Nest's NATS transport does not create durable JetStream consumers. Needs NATS with JetStream on (backend S2.1).
  Check: `<test> jetstream` passes: publish is called with subject `t.<tenantId>.auth.<event>` and a payload with `eventId` (uuid) and ISO-8601 `occurredAt`; a handler that throws does not ack.
- [ ] **S1.9** `src/events/auth.events.ts`: subject builders and payload types for every emitted event (AGENTS § Events emitted) and every consumed subject. Single owner of event names inside `auth`.
  Check: `rg -n "\.auth\.(user|tenant)_" src <EXCL> --glob '!src/events/**'` is empty (event names only built in `src/events/`).

## Phase 2 — Data model

Commits: —

- [ ] **S2.1** Database for local dev and tests. Uses the `auth` schema of the shared `teamworkflow` database and the `auth_svc` role (see backend S1.1, S2.2). Backend S2.2 is done. TEST database: `backend/docker-compose.test.yml` (backend S1.4, S2.5).
  Check: `docker compose -f ../docker-compose.yml config --services` lists the auth database service; `pnpm exec prisma migrate status` connects.
- [ ] **S2.2** `prisma/schema.prisma` + `prisma.config.ts` per skill § Database Access, models per AGENTS § Data Model: `Tenant`, `User` (with `siteIds String[]` mapped to `site_ids`, default `[]`), `RefreshToken`, `Invitation`, `PasswordResetToken`, `ProcessedEvent`. `@@map`/`@map` to snake_case. `src/generated/prisma/` in `.gitignore`.
  Check: `pnpm exec prisma validate` passes; `rg -n "src/generated" .gitignore` has one hit.
- [ ] **S2.3** Indexes for every lookup path (`teamworkflow-postgres`): `users.email` unique, token hashes unique, `users(tenant_id, role)`, `invitations(tenant_id, email)` partial on pending, `refresh_tokens(user_id)`, GIN index on `users.site_ids` (`@@index([siteIds], type: Gin)`).
  Check: the migration from S2.5 contains each `CREATE (UNIQUE) INDEX` listed here (`rg -n "CREATE (UNIQUE )?INDEX" prisma/migrations` shows all six).
- [ ] **S2.4** Check constraint: `role = 'PLATFORM_ADMIN'` ⇔ `tenant_id IS NULL` (AGENTS § Data Model). Added as raw SQL in the migration (`--create-only`, then edit).
  Check: `<e2e> db-constraints` (or S10 suite) inserts a `SUPERVISOR` with null tenant and gets a constraint violation; a `PLATFORM_ADMIN` with a tenant also fails.
- [ ] **S2.5** First migration `init_auth`, reviewed per `teamworkflow-prisma-migrations`.
  Check: `pnpm exec prisma migrate dev --name init_auth` on the dev database succeeds and `pnpm exec prisma migrate deploy` on the TEST database (backend S2.5) succeeds; `pnpm exec prisma migrate status` reports "up to date".
- [ ] **S2.6** `src/prisma/prisma.module.ts` + `prisma.service.ts` (driver adapter `@prisma/adapter-pg`, `onModuleInit` connect). Dockerfile runs `prisma generate` before `nest build`.
  Check: `<build>` passes; `rg -n "prisma generate" dockerfile` has one hit.

## Phase 3 — Sessions (register, login, tokens)

Commits: —

- [ ] **S3.1** Crypto helpers `src/common/crypto/`: Argon2id hash/verify, random opaque token (32 bytes, base64url), SHA-256 hash, constant-time compare. DEFAULT(auth): `argon2` library defaults for argon2id.
  Check: `<test> crypto` passes: hash starts with `$argon2id$`; same token hashes equal; `timingSafeEqual` used (`rg -n "timingSafeEqual" src/common/crypto` has a hit).
- [ ] **S3.2** Token service: access JWT (claims exactly `sub`, `tenantId`, `role`, `jti`, `iat`, `exp`; TTL from envs) and refresh token (opaque, stored only as hash, TTL from envs). Token pair `{ accessToken, refreshToken, expiresIn }`.
  Check: `<test> token.service` passes: decoded JWT has exactly those claim keys (no `email`, `name`, `siteIds`, `plan`); DB row stores the hash, never the raw token.
- [ ] **S3.3** `auth.register` (AGENTS § Tenants and registration): one transaction creates `Tenant` (`ACTIVE`) + `User` (`OWNER`); email trimmed + lowercased; `email_taken` on duplicate; after commit emits `tenant_created` and `user_created`. Role is never taken from the payload.
  Check: `<test> register` passes: duplicate email (different case/spaces) → `email_taken` 409; events published only after the transaction resolves; a payload with `role: 'platform_admin'` is rejected by validation (422).
- [ ] **S3.4** `auth.login` (AGENTS § Brute-force protection, § Tenant status): generic `invalid_credentials` for wrong email, wrong password, locked and inactive; 5 failures lock 15 min; success resets counter; `tenant_suspended`/`tenant_cancelled` for supervisor/employee only after a correct password; owner/admin and `platform_admin` log in.
  Check: `<test> login` passes with one case per rule above (clock controlled with `jest.useFakeTimers` / injected clock for the 15-minute lock).
- [ ] **S3.5** `auth.token.refresh`: rotation (old token revoked, new pair issued); rejects revoked, expired, unknown, deactivated user, and supervisor/employee of suspended/cancelled tenant.
  Check: `<test> refresh` passes; reusing the old refresh token returns `invalid_token` 401.
- [ ] **S3.6** `auth.logout`: revokes the given refresh token, returns `{ ok: true }`.
  Check: `<test> logout` passes; a refresh with that token afterwards returns `invalid_token`.
- [ ] **S3.7** `auth.token.verify` (AGENTS § Sessions and tokens): signature + expiry + user exists and active + tenant status; returns `{ userId, tenantId, role, siteIds, tenantStatus, plan, features }`; `siteIds` only for supervisor; nulls for `platform_admin`; owner/admin of suspended/cancelled tenant pass with `tenantStatus` set.
  Check: `<test> verify` passes, including: supervisor gets `siteIds`, admin has no `siteIds` key, `platform_admin` gets null `tenantId`/`tenantStatus`/`plan`/`features`, deactivated user → `invalid_token`.
- [ ] **S3.8** No secrets in logs (AGENTS § Security Rules 1).
  Check: `rg -n "(log|warn|error|debug)\(.*(password|token|hash)" src -i <EXCL>` is empty.

## Phase 4 — Invitations

Commits: —

- [ ] **S4.1** `auth.invitation.create`: role table (AGENTS § Roles), same-tenant only, email not an existing user (`email_taken`), revokes the previous pending invitation for that email in the tenant, 7-day expiry, token stored as hash and returned once. `invitedById` = actor.
  Check: `<test> invitation.create` passes: admin inviting admin → `forbidden`; supervisor/employee inviting → `forbidden`; `platform_admin` actor → `forbidden`; second invitation revokes the first.
- [ ] **S4.2** `auth.invitation.list`: pending only, metadata only (`invitationId`, `email`, `role`, `expiresAt`), tenant-filtered.
  Check: `<test> invitation.list` passes: response objects have exactly those keys (no `token`, no `tokenHash`); invitations of tenant B never appear for tenant A.
- [ ] **S4.3** `auth.invitation.regenerate`: same role rules as create; revokes and issues a new token with fresh 7-day expiry.
  Check: `<test> invitation.regenerate` passes: old token no longer accepted; admin regenerating an `admin` invitation → `forbidden`.
- [ ] **S4.4** `auth.invitation.accept`: creates the user in the inviting tenant with the invited role, marks used, emits `user_created` after commit; expired/used/revoked → `invalid_token`.
  Check: `<test> invitation.accept` passes, one case per invalid state.

## Phase 5 — User management and password reset

Commits: —

- [ ] **S5.1** Shared authorization guard `src/users/user-policy.ts`: same tenant, role table, no self-action, never on `owner` for deactivate/demote, never on or by `platform_admin`.
  Check: `<test> user-policy` passes: table-driven cases for every row of the AGENTS § Roles table plus tenant A actor → tenant B target = `forbidden`.
- [ ] **S5.2** `auth.user.change-role` (uses S5.1); removing supervisor role sets its `siteIds` to `[]`; emits `user_role_changed`.
  Check: `<test> change-role` passes; supervisor → employee leaves an empty `siteIds` for that user.
- [ ] **S5.3** `auth.user.assign-sites`: replaces the full set for a `supervisor` only, same tenant; non-supervisor target → `forbidden`.
  Check: `<test> assign-sites` passes; second call with a different set leaves exactly the new set; verify (S3.7) returns it.
- [ ] **S5.4** `auth.user.deactivate`: `isActive=false`, revoke all refresh tokens, emit `user_deactivated`.
  Check: `<test> deactivate` passes; login/refresh/verify for that user then fail (`invalid_credentials` / `invalid_token`).
- [ ] **S5.5** `auth.user.list-recipients` (internal only): active users of the tenant with requested roles; with `siteId`, supervisors only if assigned; owner/admin always included when requested.
  Check: `<test> list-recipients` passes, including inactive users excluded and supervisor of another site excluded.
- [ ] **S5.6** `auth.password-reset.create` (role table) and `auth.password-reset.confirm` (1 h expiry, single use, revokes all refresh tokens).
  Check: `<test> password-reset` passes: admin creating a reset for an admin → `forbidden`; used or expired token → `invalid_token`; previous refresh tokens rejected after confirm.

## Phase 6 — Platform admin

Commits: —

- [ ] **S6.1** CLI seed that creates the `platform_admin` reading email and password from the operator at run time (AGENTS § Environment Variables). DEFAULT(auth): `prisma/seed-platform-admin.ts` run by a `seed:platform-admin` package script, interactive prompt, no CLI arguments for the password.
  Check: `<test> seed-platform-admin` passes (prompt mocked): creates `PLATFORM_ADMIN` with null tenant; refuses if the email exists. `rg -n "PLATFORM_ADMIN|platform_admin" .env.example` is empty.
- [ ] **S6.2** No request path can create or target a `platform_admin`.
  Check: `rg -n "PLATFORM_ADMIN" src <EXCL> --glob '!src/generated/**'` hits only the policy (S5.1), verify (S3.7), login (S3.4) and the role enum; tests in S3.3, S4.1, S5.1 cover the rejection.

## Phase 7 — Tenant status and plan (consumed billing events)

Commits: —

All handlers: tenant taken from the subject AND checked against the payload; deduplicated by `eventId` in `ProcessedEvent` (DEFAULT(auth): one table for every consumer); explicit ack only after commit.

- [ ] **S7.1** `payment_overdue`, `subscription_expired`, `payment_received` transitions (AGENTS § Tenant status table), revoking supervisor/employee refresh tokens on suspension, emitting `tenant_past_due` / `tenant_suspended` / `tenant_reactivated`.
  Check: `<test> tenant-status.billing` passes: each transition, no-op cases (same state, `payment_received` while `cancelled`, `payment_overdue`/`subscription_expired` while `cancelled`) emit nothing; duplicate `eventId` is a no-op.
- [ ] **S7.2** `subscription_cancelled` and `subscription_reactivated`, emitting `tenant_cancelled` / `tenant_reactivated`.
  Check: `<test> tenant-status.cancel` passes: cancel accepted from any state except `deleted`; reactivation only from `cancelled`; supervisor/employee blocked, owner/admin pass verify with `tenantStatus: 'cancelled'`.
- [ ] **S7.3** `subscription_created` and `plan_changed` store `plan` and `features`, ignoring stale events (`occurredAt` / `effectiveAt` vs `planUpdatedAt`).
  Check: `<test> tenant-plan` passes: an older event after a newer one leaves the newer plan; verify (S3.7) returns the stored `plan` and `features`.
- [ ] **S7.4** `data_retention_expired` purge (AGENTS § Tenant data purge): only when `cancelled`; deletes users, tokens, invitations, reset tokens, processed events of that tenant; keeps tombstone (`id`, `name`, `DELETED`); idempotent.
  Check: `<test> tenant-purge` passes: other tenants and `platform_admin` untouched; event ignored when not `cancelled`; the purged email can register again.
- [ ] **S7.5** Subject/payload tenant mismatch is rejected (not applied, acked as poison and logged without payload).
  Check: `<test> tenant-mismatch` passes for one billing event and `employee_created`.

## Phase 8 — Organization events

Commits: —

- [ ] **S8.1** `t.<tenant>.organization.employee_created` creates an `employee` invitation (`invitedById` null), idempotent by `eventId`, no duplicate when the email already has a pending invitation or a user.
  Check: `<test> employee-created` passes: same event twice → one invitation; existing user → no invitation.

## Phase 9 — Close the loop

Commits: —

- [!] **S9.1** Gateway uses the patterns from S1.6 (today it sends `{ cmd: 'login' }`). Owned by the gateway: TODO(auth) blocked on S1.6. The gateway keeps a mirror `backend/gateway/src/auth/auth.patterns.ts` (only the patterns it calls; never `auth.user.list-recipients`).
  Check: from repo root, `rg -n "cmd: 'login'" backend/gateway/src` is empty and `rg -n "auth.user.list-recipients" backend/gateway/src` is empty.
- [!] **S9.2** `billing` and `organization` produce the consumed events. Waits for `billing S?` and `organization S?` (not built yet). Those domains wire back and tick this step.
  Check: S10.3 runs against the real producers.

## Phase 10 — E2E

Commits: —

- [ ] **S10.1** `test/jest-e2e.json` and a harness that targets `backend/docker-compose.test.yml` (backend S2.5: NATS 4223, PostgreSQL 5433) and applies the `auth` migrations there before the suite. Fake data only.
  Check: `<e2e>` runs and reports 0 failed.
- [ ] **S10.2** E2E over NATS: register → login → verify → refresh (old rejected) → logout; invitation create → accept → login; tenant isolation (admin A on user B → `forbidden`).
  Check: `<e2e> session` and `<e2e> isolation` pass. Covers: S3.3–S3.7, S4.1, S4.4, S5.1.
- [!] **S10.3** E2E for consumed events through JetStream (publish a billing event, assert verify changes). Blocked by S1.8.
  Check: `<e2e> events` passes. Covers: S7.1–S7.4, S8.1.

## Phase 11 — Done checks

Commits: —

- [ ] **S11.0** Prove the grep checks work: plant `const x = "cmd: 'login' t.x.auth.user_created"; console.log(password);` in `src/__plant.ts`, run the S1.6, S3.8 and S1.9 greps, confirm each finds it, delete the file.
  Check: `test ! -e src/__plant.ts` after the run.
- [ ] **S11.1** Quality gate.
  Check: `<lint>`, `<test>`, `<build>` and `<e2e>` pass.
- [ ] **S11.2** Every AGENTS § Tests "Always covered" item has a test that names its step (`Covers: Sx.y`).
  Check: `rg -c "Covers: S" src test` totals at least one hit per step in Phases 3–8.
- [ ] **S11.3** Tenant filter sweep: no Prisma query on `user`, `invitation`, `refreshToken`, `passwordResetToken` without `tenantId` except the login/refresh/verify lookups by email or token hash.
  Check: `<test> tenant-isolation` passes (one case per repository method, tenant A vs B).
- [ ] **S11.4** README `Estado actual` and AGENTS `Current Status` reflect what was built.
  Check: `rg -n "scaffold" README.md AGENTS.md` is empty.
- [ ] **S11.5** No leftover markers.
  Check: `rg -n "TODO\(auth\)" src <EXCL>` is empty.

---

## Blocked

| Step | Waits for |
|------|-----------|
| S1.1 | done (approved 2026-10-09) |
| S1.2, S1.4–S1.5, S1.8, Phases 2–8, S10 | S1.1 (need the installed deps) |
| S1.6 | TODO(auth) contract rename approval |
| S9.1 | S1.6, gateway owner |
| S1.8 | S1.1 (`@nats-io/jetstream`), backend S2.1 (JetStream on) |
| Phases 7–8 (event delivery), S10.3 | S1.8 |
| S2.2–S2.6, Phases 3–8 (persistence), S10 | S2.1 |
| S9.2 | `billing` and `organization` domains |

## Decisions

- 2026-10-09 S1.1: dependency set approved as listed. `prisma` CLI pinned to 7.10.0 to match `@prisma/client` (pnpm resolved 8.0.0-rc.22). `pnpm-workspace.yaml` allows build scripts for `prisma` and `@prisma/engines`; `argon2` runs from its bundled prebuild.

## Defaults to confirm

- DEFAULT(auth): `argon2` library defaults for argon2id (S3.1).
- DEFAULT(auth): JWT signed with HS256 using `JWT_SECRET` (S3.2).
- DEFAULT(auth): events published right after commit, no outbox; a failed publish is logged without payload and not retried (S1.8, S3.3, S4.4, S5.2, S5.4, Phase 7).
- DEFAULT(auth): one `ProcessedEvent` table (`eventId` PK) for every consumer (Phase 7, S8.1).
- DEFAULT(auth): platform admin seed as `prisma/seed-platform-admin.ts` + `seed:platform-admin` script with interactive prompt (S6.1).
- DEFAULT(auth): source layout `src/auth/` (sessions), `src/invitations/`, `src/users/`, `src/password-reset/`, `src/tenants/`, `src/events/`, `src/common/`, `src/prisma/`.
