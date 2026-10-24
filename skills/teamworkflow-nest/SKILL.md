---
name: teamworkflow-nest
description: "Trigger: creating or editing code in backend/ (core modules and HTTP layer, telemetry): controllers, DTOs, module facades, NATS patterns and events, Prisma data access, errors, config, tests. NestJS 12 modular monolith + telemetry patterns for TeamWorkFlow."
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "1.1"
  scope: [root, backend]
  auto_invoke:
    - "Creating endpoints, DTOs or modules in backend/"
    - "Writing business logic or database access in backend/"
    - "Adding or changing NATS patterns or events between core and telemetry"
    - "Writing backend tests"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# TeamWorkFlow – NestJS Backend (core + telemetry)

Architecture source of truth: `docs/architecture.md` (accepted ADR). Service guides: `backend/core/AGENTS.md`, `backend/core/src/<module>/AGENTS.md`, `backend/telemetry/AGENTS.md`. This skill holds the code patterns; those files hold the domain rules and win on conflict.

## Project Status (READ FIRST)

The target backend is exactly 2 services:

- `core` (`backend/core`, port 3000, HTTP prefix `/api`): NestJS modular monolith with the modules `auth`, `organization`, `tasks`, `notifications`, `billing` plus the public HTTP API (the former gateway).
- `telemetry` (`backend/telemetry`, port 3003): the whole `attendance` domain, HTTP `/api/v1/telemetry` and Socket.IO `/ws`.

A reverse proxy publishes both under one origin. Verify against the real files before writing code, because the migration is in progress.

### What EXISTS today

| Piece | State |
|-------|-------|
| `backend/core` | Real code since T6: scaffold, `src/common` (errors, pipe, filters), `src/http` (global `AuthGuard`, `@Public()`, `@CurrentActor()`), `src/auth` (HTTP controllers, services, Prisma, JetStream events, `auth.token.verify` responder, platform admin seed) and `test/e2e`. The other four modules (`organization`, `tasks`, `notifications`, `billing`) are docs only (`src/<module>/AGENTS.md`). It replaced the legacy `backend/gateway` and `backend/auth` apps, removed in T7 |
| `backend/telemetry` | Docs only (`AGENTS.md`, `README.md`). No code, no `package.json`, no Prisma |
| Tooling | pnpm per app (no root workspace), TypeScript, Jest (+ ts-jest), supertest, oxlint (`--type-aware`), prettier |
| `backend/docker-compose.yml` | `nats-server` (4222, 8222), `postgres` and `core` (3000, built from `backend/core`, hot reload, `JWT_SECRET` required from `backend/.env`). Migrations do not run on start: `docker compose exec core pnpm prisma:auth:migrate:deploy`. `telemetry` is added when it exists |

### What does NOT exist yet

- Any code under `backend/core` and `backend/telemetry`; the module facades; the shared HTTP layer of core (`src/http/`: guard, actor, roles, plan gating, tenant status, CSRF, throttling, error filter); the NATS responders for telemetry.
- The `organization`, `tasks`, `notifications` and `billing` modules, and the `attendance` domain. Only their design docs exist.
- Decided in T6: modules in `core` throw transport-agnostic `AppException` subclasses (`backend/core/src/common/exceptions/app.exceptions.ts`); the HTTP body stays `{ detail, code }`. Prisma folders are colocated per module in `backend/core/src/<module>/prisma/`.
- Pagination DTOs and a shared library between apps do not exist (each app duplicates its own constants).

### Rules for working in this state

1. Map the existing structure first (Glob `backend/**/*.ts`, excluding `node_modules`, `dist` and `src/generated`).
2. New code follows this skill (the target layout). Existing code in `core` is NOT moved or restructured without asking; propose a plan instead of mixing styles silently.
3. NEVER import a package that is not installed in that app. Check its `package.json` first. `class-validator`, `class-transformer`, `joi`, `dotenv`, Prisma 7, `pg`, `argon2`, `@nestjs/jwt` and `@nats-io/jetstream` are in `core`. Anything else (for example `@nestjs/throttler`, `cookie-parser`, `@nestjs/schedule`) needs asking the user before `pnpm add` inside the app folder.
4. Files this skill describes but that do not exist are marked "(to create)".
5. Mark pending work with `// TODO(<feature>):` and report it.

---

## Related Skills (who owns what)

| Topic | Owner skill |
|-------|-------------|
| Backend structure, module facades, controllers, DTOs, services, NATS contracts, errors, config, tests | **teamworkflow-nest** (this skill) |
| Prisma Migrate workflow, SQL review, expand/contract, backfills | teamworkflow-prisma-migrations |
| Index design, `EXPLAIN`, query performance, monitoring | teamworkflow-postgres |
| Frontend types mirroring these DTOs | teamworkflow-typescript |
| Frontend validation mirroring these constraints | teamworkflow-zod |

---

## Stack

| Component | Library | Notes |
|-----------|---------|-------|
| Framework | NestJS 12 (`@nestjs/common`, `@nestjs/core`) | Express platform; `core` over HTTP, `telemetry` over HTTP + Socket.IO |
| Transport | `@nestjs/microservices` + NATS (`@nats-io/transport-node`), `@nats-io/jetstream` v3 | Request/reply between `core` and `telemetry`; JetStream for domain events |
| Validation | `class-validator` + `class-transformer` | Global `ValidationPipe` |
| Env config | `joi` + `dotenv` | Pattern: `src/config/envs.ts` per app (`auth` splits the schema into `env.schema.ts`) |
| ORM | Prisma 7 + `@prisma/adapter-pg` | One client per data owner, see "Database Access" |
| Database | PostgreSQL; one shared database `teamworkflow`, one PostgreSQL schema + role + Prisma schema + migration history per owner (`auth`, `organization`, `tasks`, `notifications`, `billing` in `core`; `attendance` in `telemetry`) | No cross-schema foreign keys |
| Tests | Jest, `@nestjs/testing`, supertest | Run through the `test` scripts of each app |
| Lint / format | oxlint (`pnpm lint`), prettier (`pnpm format`) | |
| Package manager | pnpm | Run commands from the app folder (`backend/core`, `backend/telemetry`) |

---

## Critical Rules

- Two services: **`core`** (modular monolith + public HTTP API) and **`telemetry`** (the `attendance` domain). The frontend talks only to their public HTTP API and the `/ws` WebSocket, behind one origin. It never calls NATS.
- The HTTP layer of `core` has NO business logic: it validates input, authenticates, applies coarse checks (role, plan feature, tenant status, rate limit) and calls the owning module's facade service once.
- Each `core` module exports ONLY a public facade service. A module never imports another module's repositories, Prisma client, DTO internals or any other class. Cross-domain reactions go through events; synchronous facade calls are reserved for reads needed inside a request.
- Each data owner (`auth`, `organization`, `tasks`, `notifications`, `billing`, `attendance`) has its OWN PostgreSQL schema, role, Prisma client and migrations in the shared `teamworkflow` database (`backend/STEPS.md` S1.1). Never read another owner's tables.
- Layers inside a module: **controller -> facade/service -> (repository) -> PrismaService**. Never skip or invert layers.
- Services hold business logic and own transactions. They throw domain errors carrying `{ status, code, message }` (`AppException`, see "Errors"), NEVER raw `HttpException` from services.
- Only the HTTP layer of each service turns errors into HTTP responses (global exception filter, body `{ detail, code }`).
- Every NATS payload and every HTTP body is a DTO class with `class-validator` decorators. Never pass `any` or a raw `Request` body downstream.
- Never return Prisma models containing secrets (password hashes, tokens). Map to a response DTO / use `select`.
- The actor (`userId`, `tenantId`, `role`, `siteIds`, plan, features) comes ONLY from `auth.token.verify`. Never read it from body, query, path or headers.
- Config only through the `envs` object of each app. Never scatter `process.env` in code.
- Patterns and events are contracts: change the producer and every consumer (including the other service's docs) in the same change.
- Every `schema.prisma` change ships with a reviewed migration (teamworkflow-prisma-migrations). Indexes are designed from real queries (teamworkflow-postgres).
- No blocking calls in request paths; always `await` / `firstValueFrom`.
- New dependencies are added only after asking the user, with `pnpm add`, in the app that needs them.
- JSON contract with the frontend: camelCase fields, `null` for empty optionals, ISO-8601 datetimes, no trailing slashes.

---

## Project Structure (target)

```text
backend/
├── docker-compose.yml                    # exists: nats, postgres, core (+ telemetry once it exists)
├── core/                                 # (exists since T6; port 3000, prefix /api)
│   └── src/
│       ├── main.ts                       # HTTP app + NATS listener for the responders
│       ├── app.module.ts
│       ├── config/                       # envs.ts, services.ts, index.ts
│       ├── http/                         # shared HTTP layer: guard, actor, roles, plan, tenant status, throttling, filters
│       │   ├── filters/
│       │   ├── decorators/               # @Public(), @Roles(), @RequiresFeature(), @CurrentActor()
│       │   └── dto/                      # pagination.dto.ts, page.dto.ts
│       ├── events/                       # JetStreamService, consumed-event processor (today in src/auth/events/)
│       └── <module>/                     # auth | organization | tasks | notifications | billing
│           ├── AGENTS.md                 # exists: domain rules of the module
│           ├── <module>.module.ts        # exports ONLY the facade service
│           ├── <module>.facade.ts        # public service other modules and responders call
│           ├── <module>.controller.ts    # HTTP controller (lives in the module)
│           ├── <module>.patterns.ts      # operation names <module>.<resource>.<action>
│           ├── <domain>.service.ts       # business logic, one use case per method
│           ├── <domain>.repository.ts    # optional, see "Data Access"
│           ├── dto/
│           └── prisma/                   # Prisma schema, migrations, client output (gitignored), PrismaService
├── telemetry/                            # (to create; port 3003)
│   ├── prisma/                           # schema.prisma (schema `attendance`) + migrations
│   ├── prisma.config.ts
│   └── src/
│       ├── main.ts                       # HTTP + Socket.IO + NATS client
│       ├── config/envs.ts
│       ├── http/                         # guard through auth.token.verify, filters
│       └── <module>/                     # clock-ins | workdays | alerts | tower
```

Create each file when a feature needs it. Small domains may skip `repository` until needed, never skip the service. Module docs live in `backend/core/src/<module>/AGENTS.md`; read the one for the module you touch.

---

## Decision Trees

### Where does this code go?

```text
HTTP route, status code, params, Swagger metadata?   -> core/src/<module>/<module>.controller.ts
Check shared by every route (guard, roles, plan, rate limit, CSRF)? -> core/src/http/
HTTP error mapping to { detail, code }?              -> core/src/http/filters/ (same idea in telemetry/src/http/)
Request/response shape (HTTP) or payload (NATS)?     -> <module>/dto/
Business rule / orchestration / transaction?         -> <module>/<domain>.service.ts
Need data from another core module in a request?     -> that module's exported facade service (never its repository or Prisma)
React to another module's change?                    -> JetStream event (t.<tenant>.<module>.<event>), not a direct call
Prisma query (findMany, create, filters)?            -> service (small) or <domain>.repository.ts (queries grow)
Table definition?                                    -> the owner's schema.prisma + migration
Index for a query?                                   -> @@index in schema.prisma (design: teamworkflow-postgres)
Env variable?                                        -> <app>/src/config/envs.ts (+ .env.example + docker-compose)
Enum / limit / literal used in 2+ places?            -> <domain>.constants.ts (or the Prisma enum)
Domain error?                                        -> <module>/<module>.exceptions.ts (base in common/exceptions)
Operation name string?                               -> <module>.patterns.ts (one source per owner)
Telemetry needs core data synchronously?             -> NATS request to one of the core responders (auth.token.verify, organization.employee.get, organization.site.get, organization.shift.get)
Slow endpoint or query?                              -> teamworkflow-postgres
```

### Which status code (set in the HTTP layer)?

```text
GET    -> 200
POST   -> 201 (returns created resource)   (login/refresh: @HttpCode(200))
PATCH  -> 200 (returns updated resource)
DELETE -> 204 (no body)  (@HttpCode(204))
Validation error                         -> 422 (ValidationPipe errorHttpStatusCode / validation_error)
Not found / not allowed to see           -> 404
Conflict (duplicate, invalid transition) -> 409
Unauthorized                             -> 401
Forbidden (role, plan feature, tenant status) -> 403
Rate limited                             -> 429
Upstream (NATS request) unavailable / timeout -> 503 / 504
```

### Which DTO?

```text
HTTP POST body         -> Create<Model>Dto   (in the module)
HTTP PATCH body        -> Update<Model>Dto   (PartialType of Create)
NATS request payload   -> DTO owned by the responding module; the caller redeclares the shape (core and telemetry do not share code)
Response               -> <Model>ResponseDto (explicit fields, no secrets)
Query filters          -> <Model>FiltersDto extends PaginationDto
```

---

## Config (env validation with joi)

Validate once at import time, export a typed `envs` object, fail fast. `core` and `telemetry` each have their own `src/config/envs.ts`.

```typescript
// core/src/config/envs.ts (exists: see core/src/config/env.schema.ts for the real schema)
import 'dotenv/config';
import * as joi from 'joi';

interface EnvVars {
  PORT: number;
  NATS_SERVER: string[];
  WEB_ORIGIN: string;
  AUTH_DATABASE_URL: string;
  // ORGANIZATION_, TASKS_, NOTIFICATIONS_, BILLING_DATABASE_URL: one per module that exists
}

const postgresUrl = joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required();

const envsSchema = joi
  .object({
    PORT: joi.number().required(),
    NATS_SERVER: joi.array().items(joi.string()).required(),
    WEB_ORIGIN: joi.string().uri().required(),
    AUTH_DATABASE_URL: postgresUrl,
  })
  .unknown(true);

const { error, value } = envsSchema.validate({
  ...process.env,
  NATS_SERVER: process.env.NATS_SERVER?.split(','),
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const envVars: EnvVars = value;

export const envs = {
  port: envVars.PORT,
  natsServer: envVars.NATS_SERVER,
  webOrigin: envVars.WEB_ORIGIN,
  authDatabaseUrl: envVars.AUTH_DATABASE_URL,
};
```

```bash
# backend/.env.example (placeholders only; committed)
PORT=3000
NATS_SERVER=nats://localhost:4222
AUTH_DATABASE_URL=postgresql://auth_svc:password@localhost:5432/teamworkflow?schema=auth
```

- One connection string per data owner, named `<OWNER>_DATABASE_URL`: `AUTH_`, `ORGANIZATION_`, `TASKS_`, `NOTIFICATIONS_`, `BILLING_` (all in `core`) and `ATTENDANCE_DATABASE_URL` (in `telemetry`). Passwords stay `<OWNER>_DB_PASSWORD` (`backend/STEPS.md` S2.4). Each owner's role can only read its own schema.
- `core` reads `AUTH_DATABASE_URL` (the legacy single `DATABASE_URL` disappeared with `backend/auth` in T7). `docker-compose.yml` builds it from `AUTH_DB_PASSWORD` and takes `JWT_SECRET` from `backend/.env` with a `:?` guard so compose fails fast when it is missing.
- `telemetry` uses `PORT=3003` and `ATTENDANCE_DATABASE_URL`; its other variables are listed in `backend/telemetry/AGENTS.md`.
- `NATS_SERVER` is a comma-separated list split into `string[]`.
- In `docker-compose.yml` each service's `environment` must also receive its database URLs (host = the postgres service name, not `localhost`).
- `.env` is never committed. Do not add a second config mechanism (`@nestjs/config`) without asking; extend `envs.ts`.

---

## NATS Contract (core <-> telemetry) and events

Two mechanisms, both on NATS. Never mix them up.

| Mechanism | Naming | Use |
|-----------|--------|-----|
| Request/reply (`@MessagePattern`, `client.send`) | `<module>.<resource>.<action>` (no tenant in the subject) | Synchronous reads across the process boundary; telemetry asks core |
| JetStream events | `t.<tenant>.<module>.<event>` (snake_case event), stream `<MODULE>_EVENTS` per owning module | Every domain reaction, between core modules and between core and telemetry |

### Request/reply

`core` answers ONLY these requests (table in `backend/core/AGENTS.md`; update it and `docs/architecture.md` before adding another):

| Pattern | Used by telemetry for |
|---------|-----------------------|
| `auth.token.verify` | Verify the token of every HTTP request and WebSocket connection; returns the actor |
| `organization.employee.get` | Map the actor `userId` to the employee |
| `organization.site.get` | Geofence and QR of a site |
| `organization.shift.get` | Shift data on a local-copy miss |

Pattern constants live in one file per owner (`<module>.patterns.ts`). `backend/core/src/auth/auth.patterns.ts` is the existing example:

```typescript
export const AUTH_PATTERNS = {
  login: 'auth.login',
  tokenVerify: 'auth.token.verify',
  tokenRefresh: 'auth.token.refresh',
  // ...
} as const;
```

- Inside `core` the same operation names stay as the names of facade operations (in-process calls); only the four responders above travel over NATS.
- Responders are thin: a `@MessagePattern` handler takes the `@Payload()` DTO and calls the module facade. No extra logic. Never expose `auth.user.list-recipients` or any internal-only operation as a responder or an HTTP route.
- `@MessagePattern(...)` = request/response. `@EventPattern(...)` = fire-and-forget for NATS-core messages; errors never reach the producer, so handle and log them inside the handler.
- Never rename a pattern on one side only. Payloads are DTO classes; responses are plain serializable objects (NATS serializes JSON, so dates arrive as ISO strings).
- Errors cross NATS as the object `{ status, code, message }` (optionally `errors`), produced by `NatsErrorFilter` (`backend/core/src/common/filters/nats-exception.filter.ts`) from an `AppException`.

### JetStream events

- NATS JetStream is the ONLY domain event bus. Subjects `t.<tenant>.<module>.<event>`; one stream `<MODULE>_EVENTS` per module on `t.*.<module>.>`, created by the owning module on startup; durable consumers named `<consumer>-<producer>` with explicit ack (`backend/STEPS.md` S1.2).
- Every event carries a unique `eventId` and an ISO-8601 UTC `occurredAt`. Consumers deduplicate with a `ProcessedEvent` row written in the same transaction as the handler. Emit only after the database transaction commits. The tenant of a consumed event comes from the subject and is checked against the payload.
- Use the `JetStreamService` pattern (`@nats-io/jetstream` v3, `backend/STEPS.md` S1.3). The existing implementation is `backend/core/src/auth/events/` (`jetstream.service.ts`, `consumed-event.processor.ts`, `auth.events.ts`); reuse it rather than writing a second one.
- Events that cross the process boundary are listed in `backend/core/AGENTS.md` (Event bus) and `backend/telemetry/AGENTS.md`. The `attendance` domain keeps the module name `attendance` in subjects.

### Bootstrap

`core` is an HTTP app that also answers the NATS responders (target, shape decided in T6):

```typescript
// core/src/main.ts (to create)
const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api');
app.useGlobalPipes(createValidationPipe());      // whitelist + forbidNonWhitelisted + transform
app.useGlobalFilters(new HttpErrorFilter());      // domain errors -> { detail, code }
app.enableCors({ origin: envs.webOrigin, credentials: true });
app.connectMicroservice<MicroserviceOptions>(
  { transport: Transport.NATS, options: { servers: envs.natsServer } },
  { inheritAppConfig: true },                     // so pipes/filters apply to the responders
);
await app.startAllMicroservices();
await app.listen(envs.port);
```

- Global pipes/filters of the HTTP app do not reach a connected microservice unless `inheritAppConfig: true`. Verify the behavior against the installed Nest version.
- `core/src/main.ts` is a hybrid app (HTTP plus a NATS microservice). The validation pipe must throw a `ValidationException` (an `AppException`), not a `BadRequestException` or `RpcException` (see `backend/core/src/common/pipes/validation.pipe.ts`).

---

## HTTP layer (core)

### Module

```typescript
// core/src/organization/organization.module.ts (example, to create)
@Module({
  controllers: [SitesController, OrganizationResponder],
  providers: [OrganizationFacade, SitesService /* , repositories, PrismaService of this module */],
  exports: [OrganizationFacade],   // the ONLY public export
})
export class OrganizationModule {}
```

### Controller

```typescript
// core/src/organization/sites.controller.ts (example, to create)
@Controller('sites')
export class SitesController {
  constructor(private readonly organization: OrganizationFacade) {}

  @Get(':siteId')
  get(@CurrentActor() actor: Actor, @Param('siteId', ParseUUIDPipe) siteId: string) {
    return this.organization.getSite(actor, siteId);
  }
}
```

Rules:

- A controller validates (DTO / pipes), takes the actor from `@CurrentActor()` and calls ONE facade method. No business rules, no Prisma, no other module's classes.
- The actor is built by the global guard from the `auth.token.verify` result (an in-process facade call in `core`). Public routes carry `@Public()`. Coarse role checks use `@Roles(...)` and plan gating `@RequiresFeature(...)`; fine-grained rules stay in the module. Full rules: `backend/core/AGENTS.md` (HTTP layer, route map).
- Routes: plural kebab-case resource, collection route is `@Get()` (no trailing slash), path params `:id` validated with a pipe (`ParseUUIDPipe` for UUID ids). The route map in `backend/core/AGENTS.md` is the contract; update it when you add a route.
- Constructor injection only (never field injection or `any` bodies).

### Responder (answers telemetry)

```typescript
// core/src/organization/organization.responder.ts (example, to create)
@Controller()
export class OrganizationResponder {
  constructor(private readonly organization: OrganizationFacade) {}

  @MessagePattern(ORGANIZATION_PATTERNS.siteGet)
  siteGet(@Payload() dto: SiteGetDto) {
    return this.organization.getSiteById(dto);
  }
}
```

`@Controller()` without prefix: it is only a handler container.

### Calling core from telemetry (NATS client)

`telemetry` registers one NATS `ClientProxy` (token `NATS_SERVICE` in `config/services.ts`, the pattern the removed gateway used) and wraps every request with `timeout` and `catchError`:

```typescript
// telemetry/src/common/nats-request.ts (to create)
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout } from 'rxjs';

export function request<TResult, TPayload>(
  client: ClientProxy,
  pattern: string,
  payload: TPayload,
  timeoutMs = 5000,
): Promise<TResult> {
  return firstValueFrom(
    client.send<TResult, TPayload>(pattern, payload).pipe(
      timeout(timeoutMs),
      catchError((error) => {
        throw new RpcException(error);
      }),
    ),
  );
}
```

- ALWAYS `timeout(...)`: if core is down, NATS requests otherwise hang. `TimeoutError` is mapped to 504 `upstream_timeout` by the telemetry filter; no responder maps to 503 `upstream_unavailable`.
- ALWAYS wrap the error with `catchError` -> `throw new RpcException(error)` so ONE filter maps every upstream error. Without it the error surfaces as a generic 500.
- Never cache an `auth.token.verify` result across requests: deactivation and suspension must take effect immediately.
- Do not call `ClientsModule.register` again in feature modules; import the shared NATS module.

---

## DTOs (class-validator + class-transformer)

```typescript
// core/src/organization/dto/create-site.dto.ts (example, to create)
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SITE_NAME_MAX_LENGTH, SITE_NAME_MIN_LENGTH } from '../organization.constants';

export class CreateSiteDto {
  @IsString()
  @MinLength(SITE_NAME_MIN_LENGTH)
  @MaxLength(SITE_NAME_MAX_LENGTH)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
```

```typescript
// core/src/organization/dto/update-site.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateSiteDto } from './create-site.dto';

export class UpdateSiteDto extends PartialType(CreateSiteDto) {}
```

```typescript
// core/src/organization/dto/site-response.dto.ts
export class SiteResponseDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string; // ISO-8601
}
```

Rules:

- `@nestjs/mapped-types` (`PartialType`, `PickType`, `OmitType`) is not installed in `core` yet; check the app's `package.json` before importing.
- `whitelist: true` + `forbidNonWhitelisted: true` is the "extra=forbid" equivalent: unknown fields are rejected, so mass assignment is impossible. Every DTO property MUST carry at least one validator decorator, or `whitelist` strips it.
- `transform: true` converts payloads to DTO instances and primitives from `@Param` / `@Query` (use `@Type(() => Number)` for query numbers).
- Strip any `tenantId` / `actor` field the client sent; the actor comes from the guard, never from the DTO.
- Constraints (`MaxLength`, `Min`, `Max`) come from constants and are mirrored by the frontend's Zod schemas (teamworkflow-zod).
- PATCH: apply only the fields that were sent. Pass the DTO to Prisma `update({ data })`; `undefined` fields are ignored by Prisma, `null` sets NULL, which matches "not sent" vs "set to null".
- Response DTOs never include secrets or internal fields. Prefer Prisma `select` over deleting properties afterwards.
- Do not use CLI-scaffolded `entities/*.entity.ts` as the API shape; the source of truth for persisted shapes is `schema.prisma`.
- Enums: define them in `schema.prisma` (Prisma generates the TS enum) and mirror the values in the DTO with `@IsEnum`. The frontend mirrors the same values.

---

## Services and facades

```typescript
// backend/core/src/auth/auth.service.ts (shape)
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await verifyPassword(user.passwordHash, dto.password))) {
      throw new InvalidCredentialsException();
    }
    return this.tokens.issue(user);
  }
}
```

- The facade is the module's public API: a thin `@Injectable()` that delegates to the module's use-case services. It is the only provider the module exports.
- One public service method = one use case = one transaction.
- Business validation (ownership, state transitions, uniqueness) lives in the service and throws domain errors.
- Do not log full payloads (they may contain passwords or tokens).
- Within ONE module, services may inject each other. Across modules use only the exported facade, never the repository or the Prisma client.
- Across services (`core` <-> `telemetry`) use a NATS request or a JetStream event. No shared tables, no shared database role.

---

## Errors

### Contract

The frontend reads status + body. Every HTTP error response, from `core` and from `telemetry`, has this shape:

```json
{ "detail": "Team not found", "code": "team_not_found" }
```

Validation errors add the field list:

```json
{ "detail": "Validation failed", "code": "validation_error", "errors": [{ "field": "name", "constraints": ["name must be longer than or equal to 3 characters"] }] }
```

- Messages are generic and safe to show: no stack traces, SQL, Prisma messages or internal ids.
- Resources the user may not see -> 404 (not 403), to prevent enumeration.

### Domain errors: `AppException` (`backend/core/src/common/exceptions/app.exceptions.ts`)

```typescript
export type AppErrorCode = 'invalid_credentials' | 'email_taken' | 'validation_error' /* ... */;

export interface AppErrorBody {
  status: number;
  code: AppErrorCode;
  message: string;
  errors?: ValidationErrorItem[];
}

// Transport-agnostic: extends Error, NOT RpcException or HttpException
export class AppException extends Error {
  constructor(
    public readonly status: number,
    public readonly code: AppErrorCode,
    message: string,
    public readonly errors?: ValidationErrorItem[],
  ) {
    super(message);
    this.name = new.target.name;
  }

  getError(): AppErrorBody {
    const body: AppErrorBody = { status: this.status, code: this.code, message: this.message };
    if (this.errors) body.errors = this.errors;
    return body;
  }
}

export class EmailTakenException extends AppException {
  constructor() {
    super(409, 'email_taken', 'Email is already in use');
  }
}
```

- The hierarchy has one class per known error (`InvalidCredentialsException`, `InvalidTokenException`, `ForbiddenException`, `TenantSuspendedException`, `TenantCancelledException`, `EmailTakenException`, `ValidationException`). `AppErrorCode` is a closed union: extend it when you add a code.
- Services throw these. Domain code NEVER throws `RpcException` or `HttpException`; each edge translates: `HttpErrorFilter` (HTTP) maps to `{ detail, code }` (plus `errors` only for `validation_error`), `NatsErrorFilter` (NATS responders) sends `{ status, code, message }`. `configureApp` (`backend/core/src/app.config.ts`) registers the global pipe and filter.
- Messages are fixed and generic (they reach end users): never reveal whether an email exists or why a login failed.
- Prisma errors are translated INSIDE the service/repository, not leaked (see "Prisma errors").
- An `@EventPattern` handler or a JetStream consumer has no response stream: errors there never reach the producer. Catch and log them in the handler.
- `RpcException` only appears on the client side (see the `catchError` guidance for telemetry -> core calls); domain code never throws it.

### HTTP exception filter (`backend/core/src/http/filters/http-exception.filter.ts`)

`core` implements `HttpErrorFilter` with three branches: `AppException` -> `getError()` mapped to `{ detail, code }` (plus `errors` when present); `HttpException` (unknown route, bad JSON, parse pipes) -> its status with `code` taken from a status map and `http_error` as default; anything else -> logged, then 500 `{ detail: "Internal server error", code: "internal_error" }` without leaking the message or stack.

```typescript
const HTTP_STATUS_CODES: Record<number, string> = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found',
  405: 'method_not_allowed', 409: 'conflict', 413: 'payload_too_large',
  415: 'unsupported_media_type', 422: 'unprocessable_entity', 429: 'rate_limited',
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      const { status, code, message, errors } = exception.getError();
      return response.status(status).json({ detail: message, code, ...(errors ? { errors } : {}) });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message
          : exception.message;
      return response.status(status).json({ detail: message, code: HTTP_STATUS_CODES[status] ?? 'http_error' });
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Unknown error',
      exception instanceof Error ? exception.stack : undefined,
    );
    return response.status(500).json({ detail: 'Internal server error', code: 'internal_error' });
  }
}
```

- Telemetry guidance (its filter in `telemetry/src/http/filters/`, not built yet): add a `TimeoutError` (rxjs) branch answering 504 `{ detail: "Service timeout", code: "upstream_timeout" }`, and map an `RpcException` coming back from `core` (`{ status, code, message, errors? }`) to the same `{ detail, code }` body.
- When the NATS server or `core` is unreachable (telemetry side), the error arrives as an `Empty response` / connection message, not an `RpcException` with `status`. Map it to 503 `upstream_unavailable` with its own branch (verify the real error text first).
- In `core`, `configureApp` registers the global pipe and filter; do not repeat `app.useGlobalFilters(...)` in `main.ts`.
- Codes owned by the HTTP layer (`feature_not_in_plan`, `rate_limited`, `csrf_invalid`, `invalid_token`, `tenant_suspended`, `tenant_cancelled`) are listed in `backend/core/AGENTS.md` and `backend/telemetry/AGENTS.md`.

---

## Database Access (Prisma, per data owner)

### Project status

Prisma is installed only for the `auth` module of `backend/core` (Prisma 7.10: `src/auth/prisma/schema.prisma` in the `auth` PostgreSQL schema, `prisma.auth.config.ts`, `PrismaService`, generated client in `src/auth/prisma/generated`, migrations in `src/auth/prisma/migrations`). The other owners do not exist yet. Conventions below assume **Prisma ORM 7**. Prisma 8 is published as a release candidate with a different client API (`db.orm...`, `db migrate`); do NOT adopt it without asking. Check the installed version before copying any snippet: `pnpm list prisma @prisma/client`.

### Owners and layout

- One Prisma schema, client, migration history, PostgreSQL schema and role per owner: `auth`, `organization`, `tasks`, `notifications`, `billing` (all inside `core`) and `attendance` (inside `telemetry`).
- `core` opens one connection per module with that module's role (`<module>_svc`), which cannot read other schemas. Isolation is enforced by roles, not only by convention.
- The folder layout of the five Prisma projects inside `core` (`src/<module>/prisma/` vs a root `prisma/<module>/`) was decided in T6: `src/<module>/prisma/` plus one `prisma.<module>.config.ts` at the `backend/core` root and `pnpm prisma:<module>:*` scripts that pass `--config`. `telemetry` uses `backend/telemetry/prisma/` and `ATTENDANCE_DATABASE_URL`.

### Install (ask first), inside the app that owns the data

```bash
cd backend/telemetry          # or the core module's app folder, once it exists
pnpm add @prisma/client @prisma/adapter-pg pg dotenv
pnpm add -D prisma
pnpm exec prisma init --datasource-provider postgresql --output ../src/generated/prisma
```

### Files

```prisma
// backend/core/src/auth/prisma/schema.prisma (exists; same shape for every owner)
generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  moduleFormat = "cjs" // apps compile to CommonJS (module: nodenext without "type": "module")
}

datasource db {
  provider = "postgresql"
}

model User {
  id           String   @id @default(uuid(7)) @db.Uuid
  email        String   @unique
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  @@map("users")
}
```

```typescript
// backend/core/prisma.auth.config.ts (exists; the schema and migrations paths point to src/auth/prisma/). Other owners read their own variable, e.g. ATTENDANCE_DATABASE_URL
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
```

Notes verified against Prisma docs and the existing `backend/core` auth module:

- In Prisma 7 the connection URL lives in `prisma.config.ts`, NOT in `schema.prisma`; the generator is `prisma-client` with an explicit `output`; the client needs a driver adapter (`@prisma/adapter-pg`).
- `backend/core/prisma.auth.config.ts` reads the URL without `env()` because `prisma generate` runs in the Docker build, where the variable does not exist and `env()` would throw.
- The generated client is source code inside `src/<module>/prisma/generated/`: it is gitignored; run `pnpm prisma:<module>:generate` in dev setup, CI and in the Dockerfile before `nest build`.
- The `pg` adapter does not read `?schema=` from the URL: pass the PostgreSQL schema to `PrismaPg` explicitly (see `backend/core/src/auth/prisma/prisma.service.ts`).
- `moduleFormat = "cjs"` avoids `exports is not defined in ES module scope` when Nest (CommonJS) loads the client.
- Table/column names: Prisma models are PascalCase singular; map them to plural snake_case with `@@map` / `@map` so raw SQL and `teamworkflow-postgres` queries stay readable.
- No foreign keys across schemas. Reference another owner's data by id only, and keep a local copy fed by events when you need to read it (for example telemetry's `ShiftSnapshot`).

### PrismaService (one per owner)

```typescript
// backend/core/src/auth/prisma/prisma.service.ts (exists; shape)
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg(
        { connectionString: envs.databaseUrl },
        { schema: schemaFromUrl(envs.databaseUrl) }, // defaults to the owner's schema name
      ),
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- ONE `PrismaService` per owner, importing ITS OWN generated client. In `core` it is provided inside its module and NEVER exported: other modules reach the data through the facade.
- Do not make a module's `PrismaModule` `@Global()` in `core`: a global Prisma provider would let any module reach another module's client.
- Slow query logging: see teamworkflow-postgres ("Query logging").

### Data access: service or repository?

- Small domain: the service uses `this.prisma.<model>` directly (Prisma is already a typed query builder).
- Introduce `<domain>.repository.ts` when queries are reused by 2+ use cases, filters grow, or you want to mock data access in tests without mocking Prisma's shape.

```typescript
// core/src/organization/sites.repository.ts (example, to create)
@Injectable()
export class SitesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tenantId: string, id: string) {
    return this.prisma.site.findFirst({ where: { id, tenantId } });
  }

  async list(params: { tenantId: string; skip: number; take: number; search?: string }) {
    const where: Prisma.SiteWhereInput = {
      tenantId: params.tenantId,
      ...(params.search ? { name: { contains: params.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.site.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // deterministic order
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.site.count({ where }),
    ]);
    return { items, total };
  }
}
```

Rules:

- Every query filters by `tenantId` (multitenant). A test proves tenant isolation.
- Repositories only build and run queries: no business rules, no throwing domain errors beyond translating Prisma errors.
- Use `select` / `include` explicitly. No N+1: fetch relations with `include` or one `findMany` with `where: { id: { in: ids } }`, never a query per row in a loop.
- Always a deterministic `orderBy` (with a unique tiebreaker such as `id`) for paginated queries.
- When adding or changing filters or ordering, check that an index serves them (teamworkflow-postgres).
- Raw SQL: only tagged templates (`` this.prisma.$queryRaw`SELECT ... WHERE id = ${id}` ``), which bind parameters. NEVER `$queryRawUnsafe` / `$executeRawUnsafe` with interpolated user input.
- Mapping Prisma results to response DTOs happens in the service (or a small mapper function), never in the controller.

### Transactions

```typescript
// Batch of independent writes (all or nothing)
await this.prisma.$transaction([
  this.prisma.site.create({ data }),
  this.prisma.auditLog.create({ data: logData }),
]);

// Interactive: later steps depend on earlier results
const result = await this.prisma.$transaction(async (tx) => {
  const site = await tx.site.create({ data: { name: dto.name, tenantId } });
  await tx.post.create({ data: { siteId: site.id, tenantId, name: 'Main entrance' } });
  return site;
});
```

- Inside the callback use ONLY `tx`, never `this.prisma`, or the work escapes the transaction.
- Keep interactive transactions short; no NATS calls (`client.send`) or other network I/O inside them.
- A transaction cannot span owners (modules or services): each owner has its own client, schema and role. Cross-owner workflows use events with idempotent handlers and compensations; ask the user before designing a saga.
- Emit JetStream events only after the transaction commits; consumers write the `ProcessedEvent` row in the same transaction as their handler.
- Unique-constraint races are resolved by the database: catch `P2002` instead of "check then insert".

### Prisma errors

```typescript
import { Prisma } from '../generated/prisma/client';

try {
  return await this.prisma.user.create({ data });
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') throw new EmailTakenException(); // unique violation
    if (error.code === 'P2025') throw new AppException(404, 'user_not_found', 'User not found'); // record not found on update/delete (add the code to AppErrorCode first)
    if (error.code === 'P2003') throw new AppException(409, 'invalid_reference', 'Referenced resource does not exist'); // FK violation (add the code to AppErrorCode first)
  }
  throw error; // unknown errors are logged by the filter and become 500
}
```

- `findUnique` returns `null` when missing: check and throw the not-found domain error. `findUniqueOrThrow`, `update` and `delete` throw `P2025`.
- Import `Prisma` from the owner's own generated client (the `prisma-client` generator), not from `@prisma/client`.

---

## Pagination & Filters

```typescript
// core/src/http/dto/pagination.dto.ts (to create)
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export class PaginationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}

export function toSkipTake({ page, pageSize }: PaginationDto) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
```

```typescript
// core/src/http/dto/page.dto.ts (to create)
export class PageDto<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

```typescript
// core/src/organization/dto/site-filters.dto.ts (to create)
export class SiteFiltersDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
```

- Every collection endpoint is paginated and returns `PageDto<T>` (`items`, `total`, `page`, `pageSize`). Never return unbounded lists.
- Facades receive `{ page, pageSize, ...filters }` (or `skip`/`take`) and return `{ items, total }`; the controller (or the facade) builds the `PageDto`. `telemetry` has its own copy of these DTOs (the services do not share code).
- `page` / `pageSize` mirror the frontend's pagination schema (teamworkflow-zod).
- `skip` + `count` are fine while tables are small. For deep pages see teamworkflow-postgres ("Pagination Cost") before changing the API.

---

## Security

| Concern | Rule |
|---------|------|
| Mass assignment | DTOs with `whitelist` + `forbidNonWhitelisted`; never spread a raw body into `data` |
| Input validation | class-validator constraints at the HTTP layer AND on NATS payloads (NATS is a trust boundary too); business validation in services |
| Actor and tenant | Built only from `auth.token.verify`; `tenantId`, `role`, `siteIds`, plan and features never come from body, query, path or headers; no tenant in request/reply subjects |
| Object-level access | Services check ownership and tenant; return 404 when not allowed |
| Module boundaries | A module never reads another module's tables or uses its Prisma client; DB roles enforce it |
| SQL injection | Prisma queries / tagged `$queryRaw` only; never `Unsafe` variants with user input |
| Secrets | Only via `envs`; never committed, never logged, never in responses or error messages |
| Info disclosure | Generic error messages; no stack traces; Prisma errors translated; never log tokens, cookies or `Authorization` headers |
| Passwords | Hash with argon2 (used by the `auth` module); never store or log plain text |
| NATS | Never exposed to the internet. Only `core` and `telemetry` are published, behind one reverse proxy. Do not publish `4222`/`8222` beyond local development; use credentials/TLS when deployed (ask) |
| CORS / cookies / CSRF | `core` allows only `WEB_ORIGIN` with credentials; httpOnly cookies and CSRF for web, bearer for mobile (rules in `backend/core/AGENTS.md`) |

### Auth

The `auth` module (`backend/core/src/auth`) owns identity, tokens and `auth.token.verify`. `core` verifies tokens in-process through the `auth` facade; `telemetry` verifies every HTTP request and WebSocket connection with the NATS request `auth.token.verify`. Do not invent a second auth mechanism; follow `backend/core/src/auth/AGENTS.md`. Mark gaps with `// TODO(auth):`.

---

## Naming Conventions

| Entity | Pattern | Example |
|--------|---------|---------|
| Folder / file | kebab-case, Nest style | `organization/sites.service.ts` |
| Module / Controller / Service | `<Domain>Module` / `Controller` / `Service` | `SitesService` |
| Module public service | `<Module>Facade` | `OrganizationFacade` |
| Repository | `<Domain>Repository` | `SitesRepository` |
| DTO | `Create<Model>Dto`, `Update<Model>Dto`, `<Model>ResponseDto`, `<Model>FiltersDto` | `CreateSiteDto` |
| Prisma model | singular PascalCase, `@@map` plural snake_case | `Site` -> `sites` |
| Prisma field | camelCase, `@map` snake_case | `createdAt` -> `created_at` |
| Domain exception | `<Problem>Exception` extending the error base | `SiteNotFoundException` |
| Error code | snake_case | `site_not_found` |
| Request/reply pattern | `<module>.<resource>.<action>` | `organization.site.get` |
| JetStream subject | `t.<tenant>.<module>.<event>` (snake_case event) | `t.acme.attendance.alert_opened` |
| Pattern constant | `<MODULE>_PATTERNS.<action>` (as in `AUTH_PATTERNS.tokenVerify`) | `ORGANIZATION_PATTERNS.siteGet` |
| Env var per data owner | `<OWNER>_DATABASE_URL` | `ATTENDANCE_DATABASE_URL` |
| DI token | UPPER_SNAKE string in `config/services.ts` | `NATS_SERVICE` |
| URL prefix | plural kebab-case under `/api` (core) or `/api/v1/telemetry` | `/api/sites` |
| Explicit index | `<Model>_<fields>_idx` (Prisma default) or `map: "ix_<table>_<columns>"` | see teamworkflow-postgres |

---

## Testing

### Setup

Tests run with the scripts of each app (`pnpm test`, `pnpm test:cov`, `pnpm test:e2e`), which launch Jest. Specs sit next to the code (`*.spec.ts`, as in `backend/core/src/auth/auth.service.login.spec.ts`); e2e specs go in `test/` (`test/e2e/` against the isolated test stack, `test/jest-e2e.json`). Keep the existing specs green.

### Controller: mock the facade

```typescript
// core/src/organization/sites.controller.spec.ts (example, to create)
import { Test } from '@nestjs/testing';
import { SitesController } from './sites.controller';
import { OrganizationFacade } from './organization.facade';

describe('SitesController', () => {
  let controller: SitesController;
  const organization = { getSite: jest.fn() };
  const actor = { userId: 'u1', tenantId: 't1', role: 'admin' } as const;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [SitesController],
      providers: [{ provide: OrganizationFacade, useValue: organization }],
    }).compile();
    controller = moduleRef.get(SitesController);
  });

  it('get delegates to the facade with the actor and returns the result', async () => {
    organization.getSite.mockResolvedValue({ id: 's1' });

    await expect(controller.get(actor, 's1')).resolves.toEqual({ id: 's1' });
    expect(organization.getSite).toHaveBeenCalledWith(actor, 's1');
  });
});
```

### Service: mock `PrismaService`

```typescript
// backend/core/src/auth/auth.service.login.spec.ts (shape of the existing specs)
describe('AuthService.login', () => {
  let service: AuthService;
  const prisma = { user: { findUnique: jest.fn() } };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [AuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('throws InvalidCredentialsException when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login({ email: 'a@b.com', password: 'x' })).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  });
});
```

### Telemetry client of core: mock `ClientProxy`

```typescript
const client = { send: jest.fn(), emit: jest.fn() };
// provide { provide: NATS_SERVICE, useValue: client }
client.send.mockReturnValue(of({ userId: 'u1', tenantId: 't1', role: 'employee' }));
// assert the pattern ('auth.token.verify') and payload; a throwError(...) reply becomes an RpcException
```

- Unit tests mock the boundary: the facade of other modules, `PrismaService` (or the repository), `ClientProxy` in `telemetry`. Never hit NATS or a real DB in unit tests.
- A `PrismaService` extends a generated client that needs its database URL; always provide a fake with `useValue`.
- Responder tests: instantiate the responder with a mocked facade and assert delegation and payload; the result must equal the in-process facade result.
- Validation tests: use `ValidationPipe.transform(payload, { type: 'body', metatype: Dto })` or `class-validator`'s `validate` to assert rejected inputs.
- Module boundary check: a test or lint rule proves no module imports another module's internals or Prisma client (to create).
- Tenant isolation: every owner's repository tests prove another tenant's rows are never returned.

### E2E with supertest (core HTTP layer)

```typescript
// core/test/sites.e2e-spec.ts (example, to create)
describe('Sites (e2e)', () => {
  let app: INestApplication;
  const organization = { getSite: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OrganizationFacade)
      .useValue(organization)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app); // same prefix, pipe, filter, guard as main.ts
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /api/sites/not-a-uuid returns 422', () =>
    request(app.getHttpServer()).get('/api/sites/not-a-uuid').expect(422));
});
```

- The global prefix, pipe, filter and guard MUST be applied in the test the same way as in `main.ts`; extract a shared `configureApp(app)` function (`backend/core/test/support/core-app.ts` is the existing reference for bootstrapping).
- HTTP layer tests always cover: guard (no token, invalid token, actor only from the verify result), cookie vs bearer, CSRF, CORS, role decorators, plan gating, tenant status, error mapping, throttling. The full list is in `backend/core/AGENTS.md` (Tests).
- Module e2e against a real database: use a dedicated TEST database or schema (its `<OWNER>_DATABASE_URL` pointing to the test database), migrated with `prisma migrate deploy`, and clean tables between tests. NEVER run tests against development or production data.
- Name tests by behavior: `<action> <expected> when <condition>`.
- Lint and format before finishing: `pnpm lint`, `pnpm format`.

---

## Commands

```bash
cd backend/<app>          # core | telemetry

pnpm install
pnpm start:dev            # nest start --watch
pnpm build
pnpm lint                 # oxlint --type-aware
pnpm format               # prettier
pnpm test                 # unit
pnpm test:cov
pnpm test:e2e

# Whole stack (from backend/)
docker compose up --build   # nats, postgres, core (+ telemetry once it exists); then: docker compose exec core pnpm prisma:auth:migrate:deploy

# Prisma (only in apps with a schema)
pnpm exec prisma generate
pnpm exec prisma migrate dev --name <name>      # see teamworkflow-prisma-migrations
```

If Context7 MCP is available, query it for up-to-date NestJS, Prisma and class-validator docs before using unfamiliar APIs (resolve the library id first). Adapt paths to the real files found when mapping the project.

---

## Checklist

- [ ] Existing structure mapped; no silent restructuring; uninstalled deps asked about first
- [ ] HTTP layer has no business logic or DB access; business rules live in module services
- [ ] Code placed per "Decision Trees"; layers respected (controller -> facade/service -> repository -> Prisma)
- [ ] Module exports only its facade; no import of another module's repository, Prisma client or internals
- [ ] Cross-domain reactions through JetStream events (`t.<tenant>.<module>.<event>`, `ProcessedEvent` dedup, emit after commit)
- [ ] Request/reply pattern or event changed on the producer, every consumer and the docs of both services in the same change (core responders table, `docs/architecture.md`)
- [ ] Telemetry calls to core wrapped with `timeout` and `catchError -> RpcException` (client side only; domain code never throws it)
- [ ] DTO classes with validators on every property; `whitelist` + `forbidNonWhitelisted`; no `any` payloads; actor never read from the client
- [ ] Services throw `{ status, code, message }` domain errors; the HTTP filter maps them to `{ detail, code }` with the right status
- [ ] Prisma errors translated (`P2002`, `P2025`, `P2003`); no raw Prisma messages leaked
- [ ] Own `PrismaService`, schema, role and `<OWNER>_DATABASE_URL` per data owner; no cross-owner DB access; every query filters by `tenantId`
- [ ] No N+1; explicit `select`/`include`; deterministic `orderBy` on paginated queries
- [ ] Transactions use `tx` inside the callback and contain no network calls
- [ ] Collections paginated with `PageDto` (`page`, `pageSize`, `total`, `items`)
- [ ] Schema changes have a reviewed migration (teamworkflow-prisma-migrations); indexes designed from queries (teamworkflow-postgres)
- [ ] Config via each app's `envs.ts` (joi); `.env.example` and docker-compose updated; no secrets in code, logs or responses
- [ ] Unit tests with mocked facade / `PrismaService` / `ClientProxy`; e2e with supertest; DB tests only on the TEST database
- [ ] `pnpm lint` and `pnpm format` pass
- [ ] Frontend contract kept: camelCase, `null` optionals, ISO dates (update frontend types / Zod if the contract changed: teamworkflow-typescript, teamworkflow-zod)
