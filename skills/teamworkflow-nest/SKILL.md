---
name: teamworkflow-nest
description: "Trigger: creating or editing code in backend/ (gateway, auth, microservices): controllers, DTOs, services, NATS patterns, Prisma data access, errors, config, tests. NestJS 12 microservices patterns for TeamWorkFlow."
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "1.0"
  scope: [root, backend]
  auto_invoke:
    - "Creating endpoints, DTOs or modules in backend/"
    - "Writing business logic or database access in backend/"
    - "Adding or changing NATS message patterns between gateway and microservices"
    - "Writing backend tests"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# TeamWorkFlow – NestJS Microservices Backend

## Project Status (READ FIRST)

The backend is a pnpm-managed NestJS 12 monorepo-style folder (`backend/`) with independent apps. Most of it is scaffolding. Verify against the real files before writing code, because versions and files change.

### What EXISTS today

| Piece | State |
|-------|-------|
| `backend/gateway` | HTTP gateway. `main.ts` does `NestFactory.create(AppModule)`, `app.setGlobalPrefix('api')`, listens on `envs.port` (3000). Modules: `AuthModule`, `NatsModule` |
| `backend/gateway/src/config/` | `envs.ts` (joi validation, exports the `envs` object), `services.ts` (`AUTH_SERVICE`, `NATS_SERVICE` tokens), `index.ts` (barrel) |
| `backend/gateway/src/transport/nats.module.ts` | `ClientsModule.register([{ name: NATS_SERVICE, transport: Transport.NATS, options: { servers: envs.natsServer } }])`, registered and re-exported |
| `backend/gateway/src/auth/` | `AuthController` (`@Controller('auth')`) injecting `ClientProxy` via `@Inject(NATS_SERVICE)`. `login` calls `this.client.send({ cmd: 'login' }, {})`; `logout`, `register`, `refresh-token` are stubs returning literals |
| `backend/auth` | Generated with Nest CLI. `AuthController` with `@MessagePattern('createAuth' \| 'findAllAuth' \| 'findOneAuth' \| 'updateAuth' \| 'removeAuth')`, `AuthService` returning placeholder strings, `dto/create-auth.dto.ts`, `dto/update-auth.dto.ts`, `entities/auth.entity.ts` |
| Tooling | pnpm, TypeScript 6 (`module: nodenext`, CommonJS output), Jest 30 (+ ts-jest), supertest, oxlint (`--type-aware`), prettier |
| `backend/docker-compose.yml` | `nats-server` (4222, 8222), `auth-microservice` (3001), `gateway` (3000); env `PORT`, `NATS_SERVER=nats://nats-server:4222` |

### What does NOT exist yet

- `auth/src/main.ts` is still the default HTTP bootstrap (`NestFactory.create`, `app.listen(process.env.PORT ?? 3000)`). It does NOT yet connect to NATS as a microservice. Until it does, the `@MessagePattern` handlers receive nothing. Converting it to `NestFactory.createMicroservice` with `Transport.NATS` is a task to do (ask first, see "Microservice Bootstrap").
- No env validation in `auth` (the `joi` / `dotenv` imports exist only in the gateway's `package.json`).
- No `class-validator` / `class-transformer`, no global `ValidationPipe`, no exception filters, no `RpcException` usage.
- No Prisma anywhere: no `prisma/schema.prisma`, no `prisma.config.ts`, no `PrismaService`, no database container in `docker-compose.yml`.
- No pagination DTOs, no auth guards/JWT, no shared library between apps (each app duplicates its own constants).
- Gateway endpoints `logout`, `register`, `refresh-token` are stubs; `AUTH_SERVICE` token in `services.ts` is unused.

### Rules for working in this state

1. Map the existing structure first (Glob `backend/**/*.ts`, excluding `node_modules` and `dist`).
2. New code follows this skill. Existing code is NOT moved or restructured without asking; propose a plan instead of mixing styles silently.
3. NEVER import a package that is not installed. Libraries this skill uses that are NOT installed yet: `class-validator`, `class-transformer`, `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `dotenv` and `joi` in `auth`. ASK the user before installing (`pnpm add ...` inside the app folder).
4. Files this skill describes but that do not exist are marked "(to create)".
5. Mark pending work with `// TODO(<feature>):` and report it.

---

## Related Skills (who owns what)

| Topic | Owner skill |
|-------|-------------|
| Backend structure, controllers, DTOs, services, NATS contracts, errors, config, tests | **teamworkflow-nest** (this skill) |
| Prisma Migrate workflow, SQL review, expand/contract, backfills | teamworkflow-prisma-migrations |
| Index design, `EXPLAIN`, query performance, monitoring | teamworkflow-postgres |
| Frontend types mirroring these DTOs | teamworkflow-typescript |
| Frontend validation mirroring these constraints | teamworkflow-zod |

---

## Stack

| Component | Library | Notes |
|-----------|---------|-------|
| Framework | NestJS 12 (`@nestjs/common`, `@nestjs/core`) | Express platform in both apps |
| Transport | `@nestjs/microservices` + NATS (`nats`, `@nats-io/transport-node`) | Gateway = client, services = servers |
| Validation (to install) | `class-validator` + `class-transformer` | Global `ValidationPipe` |
| Env config | `joi` + `dotenv` | Pattern: `gateway/src/config/envs.ts` |
| ORM (to install) | Prisma 7 (stable at time of writing) + `@prisma/adapter-pg` | Per microservice, see "Database Access" |
| Database | PostgreSQL; one shared database `teamworkflow`, one PostgreSQL schema + role and one Prisma schema per data-owning microservice | The gateway NEVER touches a DB |
| Tests | Jest 30, `@nestjs/testing`, supertest | Run through the `test` scripts (they use `--experimental-vm-modules`) |
| Lint / format | oxlint (`pnpm lint`), prettier (`pnpm format`) | |
| Package manager | pnpm | Run commands from the app folder (`backend/gateway`, `backend/auth`) |

---

## Critical Rules

- Two kinds of apps: the **gateway** (HTTP in, NATS out) and **microservices** (NATS in, own data). Never put business logic or DB access in the gateway.
- Only microservices touch databases. Each data-owning microservice has its OWN Prisma schema and migrations; all of them share the `teamworkflow` database, each in its own PostgreSQL schema with its own role (`backend/STEPS.md` S1.1). Never read another service's tables; ask it over NATS.
- Layers inside a microservice: **message controller -> service -> (repository) -> PrismaService**. Never skip or invert layers.
- Gateway controllers do HTTP only: parse, call `client.send` once, return the result. No business rules.
- Controllers in microservices (`@MessagePattern`) do transport only: take the `@Payload()` DTO, call ONE service method.
- Services hold business logic and own transactions. They throw domain exceptions that extend `RpcException`, NEVER `HttpException`, inside microservices.
- Only the gateway turns errors into HTTP status codes (exception filter).
- Every payload crossing NATS and every HTTP body is a DTO class with `class-validator` decorators. Never pass `any` or a raw `Request` body downstream.
- Never return Prisma models containing secrets (password hashes, tokens). Map to a response DTO / use `select`.
- Config only through the `envs` object of each app. Never scatter `process.env` in code.
- Message patterns are a contract: change them in the gateway and the service in the same change.
- Every `schema.prisma` change ships with a reviewed migration (teamworkflow-prisma-migrations). Indexes are designed from real queries (teamworkflow-postgres).
- No blocking calls in request paths; always `await` / `firstValueFrom`.
- New dependencies are added only after asking the user, with the package manager (`pnpm add`), in the app that needs them.
- JSON contract with the frontend: camelCase fields (TypeScript/JSON default in NestJS), `null` for empty optionals, ISO-8601 datetimes, no trailing slashes.

---

## Project Structure (target)

```text
backend/
├── docker-compose.yml                    # exists; add one postgres per data-owning service (to create)
├── gateway/
│   └── src/
│       ├── main.ts                       # exists; add ValidationPipe + exception filter (to create)
│       ├── app.module.ts                 # exists
│       ├── config/                       # exists: envs.ts, services.ts, index.ts
│       ├── transport/nats.module.ts      # exists
│       ├── common/                       # (to create) agnostic gateway code
│       │   ├── filters/rpc-exception.filter.ts
│       │   ├── dto/pagination.dto.ts
│       │   └── dto/page.dto.ts
│       └── <domain>/                     # exists for auth; one folder per domain
│           ├── <domain>.module.ts
│           ├── <domain>.controller.ts    # HTTP -> client.send
│           ├── dto/                      # HTTP request/response DTOs
│           └── <domain>.patterns.ts      # (to create) message pattern constants
└── <service>/                            # e.g. auth (exists), future: teams, tasks…
    ├── prisma/                           # (to create) data-owning services only
    │   ├── schema.prisma
    │   └── migrations/
    ├── prisma.config.ts                  # (to create)
    ├── src/
    │   ├── main.ts                       # createMicroservice (NATS) + global pipe
    │   ├── app.module.ts
    │   ├── config/envs.ts                # (to create) joi, same pattern as gateway
    │   ├── common/
    │   │   └── exceptions/app.exceptions.ts   # (to create) RpcException hierarchy
    │   ├── prisma/                       # (to create)
    │   │   ├── prisma.module.ts
    │   │   └── prisma.service.ts
    │   ├── generated/prisma/             # (generated, gitignored) Prisma Client output
    │   └── <domain>/
    │       ├── <domain>.module.ts
    │       ├── <domain>.controller.ts    # @MessagePattern handlers
    │       ├── <domain>.service.ts       # business logic
    │       ├── <domain>.repository.ts    # optional, see "Data Access"
    │       ├── <domain>.patterns.ts      # (to create)
    │       ├── dto/                      # exists in auth (create-*.dto.ts, update-*.dto.ts)
    │       └── entities/                 # exists in auth (CLI scaffold). Prefer Prisma types + response DTOs
    └── test/                             # e2e (jest-e2e.json)
```

Create each file when a feature needs it. Small domains may skip `repository` until needed, never skip the service.

---

## Decision Trees

### Where does this code go?

```text
HTTP route, status code, params, Swagger metadata?   -> gateway/src/<domain>/<domain>.controller.ts
HTTP -> NATS error mapping?                          -> gateway/src/common/filters/
Request/response shape (HTTP)?                       -> gateway/src/<domain>/dto/
Payload shape (NATS)?                                -> <service>/src/<domain>/dto/
Business rule / orchestration / transaction?         -> <service>/src/<domain>/<domain>.service.ts
Prisma query (findMany, create, filters)?            -> service (small) or <domain>.repository.ts (queries grow)
Table definition?                                    -> <service>/prisma/schema.prisma + migration
Index for a query?                                   -> @@index in schema.prisma (design: teamworkflow-postgres)
Env variable?                                        -> <app>/src/config/envs.ts (+ .env.example + docker-compose)
Enum / limit / literal used in 2+ places?            -> <domain>.constants.ts (or the Prisma enum)
Domain error?                                        -> <service>/src/common/exceptions or <domain>/<domain>.exceptions.ts
Message pattern string?                               -> <domain>.patterns.ts (one per side, kept identical)
Cross-service data (user name in a task)?            -> ask the owning service over NATS, never its DB
Slow endpoint or query?                              -> teamworkflow-postgres
```

### Which status code (set in the gateway)?

```text
GET    -> 200
POST   -> 201 (returns created resource)   (login/refresh: @HttpCode(200))
PATCH  -> 200 (returns updated resource)
DELETE -> 204 (no body)  (@HttpCode(204))
Validation error                         -> 422 (ValidationPipe errorHttpStatusCode)
Not found / not allowed to see           -> 404
Conflict (duplicate, invalid transition) -> 409
Unauthorized                             -> 401
Microservice unreachable / timeout       -> 503 / 504
```

### Which DTO?

```text
HTTP POST body         -> Create<Model>Dto   (gateway)
HTTP PATCH body        -> Update<Model>Dto   (PartialType of Create)
NATS payload           -> same DTO shape, redeclared in the service (apps do not share code yet)
Response               -> <Model>ResponseDto (explicit fields, no secrets)
Query filters          -> <Model>FiltersDto extends PaginationDto
```

---

## Config (env validation with joi)

Follow the existing gateway pattern (`gateway/src/config/envs.ts`): validate once at import time, export a typed `envs` object, fail fast.

```typescript
// gateway/src/config/envs.ts (exists; shown to mirror it in microservices)
import 'dotenv/config';
import * as joi from 'joi';

interface EnvVars {
  PORT: number;
  NATS_SERVER: string[];
}

const envsSchema = joi
  .object({
    PORT: joi.number().required(),
    NATS_SERVER: joi.array().items(joi.string()).required(),
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
};
```

A data-owning microservice (to create: `auth/src/config/envs.ts`) adds `DATABASE_URL`:

```typescript
interface EnvVars {
  PORT: number;
  NATS_SERVER: string[];
  DATABASE_URL: string;
}

const envsSchema = joi
  .object({
    PORT: joi.number().required(),
    NATS_SERVER: joi.array().items(joi.string()).required(),
    DATABASE_URL: joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  })
  .unknown(true);

// ...same validate/throw as above...

export const envs = {
  port: envVars.PORT,
  natsServer: envVars.NATS_SERVER,
  databaseUrl: envVars.DATABASE_URL,
};
```

```bash
# backend/auth/.env.example (to create; committed, no real values)
PORT=3001
NATS_SERVER=nats://localhost:4222
DATABASE_URL=postgresql://user:password@localhost:5432/teamworkflow_auth
```

- `NATS_SERVER` is a comma-separated list split into `string[]` (as in the gateway).
- In `docker-compose.yml` the service's `environment` must also receive `DATABASE_URL` (host = the postgres service name, not `localhost`).
- `.env` is never committed. Each microservice has its own `DATABASE_URL` (the shared `teamworkflow` database, the service's own schema and role).
- Do not add a second config mechanism (`@nestjs/config`) without asking; extend `envs.ts`.

---

## NATS Contract (gateway <-> microservices)

### Pattern naming

The existing code mixes styles: the gateway sends `{ cmd: 'login' }` while the CLI-generated auth service listens on plain strings (`'createAuth'`). Pick ONE convention for new code and ask before migrating existing patterns.

Recommended: string patterns `<service>.<resource>.<action>` (lowercase, dot-separated), kept in a constants file per side:

```typescript
// gateway/src/auth/auth.patterns.ts (to create) and auth/src/auth/auth.patterns.ts (to create, identical)
export const AUTH_PATTERNS = {
  LOGIN: 'auth.login',
  REGISTER: 'auth.register',
  REFRESH: 'auth.refresh',
  USERS_FIND_ONE: 'auth.users.find-one',
} as const;
```

- `@MessagePattern(...)` = request/response (the gateway waits for a reply). Use it for everything the HTTP caller needs an answer for.
- `@EventPattern(...)` = fire-and-forget (`client.emit`). Errors never reach the producer; handle and log them inside the handler.
- Never rename a pattern in only one side; deploy order would break the contract.
- Payloads are DTO classes; responses are plain serializable objects (no class instances with methods, no `Date` assumptions: NATS serializes JSON, so dates arrive as ISO strings).

### Microservice bootstrap (to change in `auth/src/main.ts`, ask first)

```typescript
// auth/src/main.ts
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, RpcException, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { envs } from './config/envs';

async function bootstrap() {
  const logger = new Logger('Main-Auth');

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.NATS,
    options: { servers: envs.natsServer },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Microservices must throw RpcException, not BadRequestException
      exceptionFactory: (errors) =>
        new RpcException({
          status: 422,
          code: 'validation_error',
          message: 'Validation failed',
          errors: errors.map((e) => ({
            field: e.property,
            constraints: Object.values(e.constraints ?? {}),
          })),
        }),
    }),
  );

  await app.listen();
  logger.log(`Auth microservice connected to NATS: ${envs.natsServer.join(',')}`);
}
void bootstrap();
```

- With `createMicroservice` there is no HTTP port; the `PORT` env and the `3001:3001` mapping in `docker-compose.yml` become unnecessary. Ask before removing them.
- A hybrid app (HTTP + NATS) is NOT needed. If used, global filters/pipes of the HTTP app do not apply to the microservice unless `inheritAppConfig: true`.

---

## Gateway: HTTP -> NATS

### Module

```typescript
// gateway/src/auth/auth.module.ts (exists)
@Module({
  controllers: [AuthController],
  imports: [NatsModule],
})
export class AuthModule {}
```

`NatsModule` already registers and exports the `NATS_SERVICE` client; feature modules import it. Do not call `ClientsModule.register` again in feature modules.

### Controller

```typescript
// gateway/src/auth/auth.controller.ts
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout } from 'rxjs';
import { NATS_SERVICE } from '../config';
import { AUTH_PATTERNS } from './auth.patterns';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() loginDto: LoginDto) {
    return firstValueFrom(
      this.client.send(AUTH_PATTERNS.LOGIN, loginDto).pipe(
        timeout(5000),
        catchError((error) => {
          throw new RpcException(error);
        }),
      ),
    );
  }
}
```

Rules:

- Return the awaited value (`firstValueFrom`) or the Observable. Either works with Nest, but `firstValueFrom` gives a place to apply `timeout` and `catchError` and is easier to unit-test.
- ALWAYS wrap the error with `catchError` -> `throw new RpcException(error)`, so ONE gateway filter maps every microservice error. Without it the error surfaces as a generic 500.
- ALWAYS `timeout(...)`: if the service is down, NATS requests otherwise hang until the client gives up. `TimeoutError` is mapped to 504 by the filter.
- To avoid repeating this pipe in every controller, extract a helper when the third endpoint appears (e.g. `gateway/src/common/nats-send.ts`, to create):

```typescript
// gateway/src/common/nats-send.ts (to create)
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout } from 'rxjs';

export function send<TResult, TPayload>(
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

- Field injection (`@Inject(NATS_SERVICE) private readonly client`) exists in the current controller; new code prefers constructor injection.
- Routes: plural kebab-case resource, collection route is `@Get()` (no trailing slash), path params `:id` validated with a pipe (`ParseUUIDPipe` for UUID ids).
- Stubs that return literals (`logout`, `register`, `refresh-token`) are replaced by real `client.send` calls when the service handlers exist.

### Gateway bootstrap (to change in `gateway/src/main.ts`)

```typescript
const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api');
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    errorHttpStatusCode: 422,
  }),
);
app.useGlobalFilters(new RpcExceptionFilter());
await app.listen(envs.port);
```

`ValidationPipe` requires `class-validator` and `class-transformer` (NOT installed: ask first).

---

## DTOs (class-validator + class-transformer)

```typescript
// gateway/src/teams/dto/create-team.dto.ts (example, to create)
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TEAM_NAME_MAX_LENGTH, TEAM_NAME_MIN_LENGTH } from '../teams.constants';

export class CreateTeamDto {
  @IsString()
  @MinLength(TEAM_NAME_MIN_LENGTH)
  @MaxLength(TEAM_NAME_MAX_LENGTH)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
```

```typescript
// gateway/src/teams/dto/update-team.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateTeamDto } from './create-team.dto';

export class UpdateTeamDto extends PartialType(CreateTeamDto) {}
```

```typescript
// gateway/src/teams/dto/team-response.dto.ts
export class TeamResponseDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string; // ISO-8601
}
```

Rules:

- `@nestjs/mapped-types` (`PartialType`, `PickType`, `OmitType`) is already a dependency of `auth`; check that the gateway has it before importing.
- `whitelist: true` + `forbidNonWhitelisted: true` is the "extra=forbid" equivalent: unknown fields are rejected, so mass assignment is impossible. Every DTO property MUST carry at least one validator decorator, or `whitelist` strips it.
- `transform: true` converts payloads to DTO instances and primitives from `@Param` / `@Query` (use `@Type(() => Number)` for query numbers).
- Constraints (`MaxLength`, `Min`, `Max`) come from constants and are mirrored by the frontend's Zod schemas (teamworkflow-zod).
- PATCH: apply only the fields that were sent. Pass the DTO to Prisma `update({ data })`; `undefined` fields are ignored by Prisma, `null` sets NULL, which matches "not sent" vs "set to null".
- Response DTOs never include secrets or internal fields. Prefer Prisma `select` over deleting properties afterwards.
- Do not use CLI-scaffolded `entities/*.entity.ts` as the API shape; the source of truth for persisted shapes is `schema.prisma`.
- Enums: define them in `schema.prisma` (Prisma generates the TS enum) and mirror the values in the gateway DTO with `@IsEnum`. The frontend mirrors the same values.

---

## Microservice: controller and service

```typescript
// auth/src/auth/auth.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { AUTH_PATTERNS } from './auth.patterns';
import { LoginDto } from './dto/login.dto';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(AUTH_PATTERNS.LOGIN)
  login(@Payload() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}
```

```typescript
// auth/src/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvalidCredentialsException } from './auth.exceptions';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user /* || !(await verify(user.passwordHash, dto.password)) */) {
      throw new InvalidCredentialsException();
    }
    return { id: user.id, email: user.email };
  }
}
```

- `@Controller()` without prefix: in microservices the controller is only a handler container.
- One public service method = one use case = one transaction.
- Business validation (ownership, state transitions, uniqueness) lives in the service and throws domain exceptions.
- Do not log full payloads (they may contain passwords or tokens).
- Cross-domain inside ONE service: inject the other domain's service (exported by its module), never its repository.
- Cross-SERVICE: use a `ClientProxy` (NATS) and a pattern. No shared tables, no shared database.

---

## Errors

### Contract

The frontend reads status + body. Every error response has this shape:

```json
{ "detail": "Team not found", "code": "team_not_found" }
```

Validation errors add the field list:

```json
{ "detail": "Validation failed", "code": "validation_error", "errors": [{ "field": "name", "constraints": ["name must be longer than or equal to 3 characters"] }] }
```

- Messages are generic and safe to show: no stack traces, SQL, Prisma messages or internal ids.
- Resources the user may not see -> 404 (not 403), to prevent enumeration.

### Microservice: RpcException hierarchy (to create `auth/src/common/exceptions/app.exceptions.ts`)

```typescript
import { RpcException } from '@nestjs/microservices';

export class AppRpcException extends RpcException {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    // Passing an OBJECT to RpcException sends it as-is to the caller
    super({ status, code, message });
  }
}

export class NotFoundRpcException extends AppRpcException {
  constructor(code: string, message: string) {
    super(404, code, message);
  }
}

export class ConflictRpcException extends AppRpcException {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

export class UnauthorizedRpcException extends AppRpcException {
  constructor(code: string, message: string) {
    super(401, code, message);
  }
}
```

```typescript
// auth/src/auth/auth.exceptions.ts
export class InvalidCredentialsException extends UnauthorizedRpcException {
  constructor() {
    super('invalid_credentials', 'Invalid credentials');
  }
}
```

- Services throw these. Nest returns the object passed to `RpcException` as the error to the client. Throwing an `HttpException` inside a microservice reaches the gateway as a generic internal error.
- Prisma errors are translated INSIDE the service/repository, not leaked (see "Prisma errors").
- An `@EventPattern` handler has no response stream: errors there never reach the producer. Catch and log them in the handler.
- Optional microservice `RpcExceptionFilter` (`@Catch()` returning `throwError(() => ...)`) to normalize unknown errors to `{ status: 500, code: 'internal_error' }` and log the original. A filter's `catch()` MUST return an Observable.

### Gateway: filter mapping to HTTP (to create `gateway/src/common/filters/rpc-exception.filter.ts`)

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Response } from 'express';
import { TimeoutError } from 'rxjs';

interface RpcErrorBody {
  status?: number;
  code?: string;
  message?: string;
  errors?: unknown;
}

@Catch()
export class RpcExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RpcExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      // Gateway-level errors (ValidationPipe 422, ParseUUIDPipe, 404 routes)
      const body = exception.getResponse();
      const detail = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
      return response.status(exception.getStatus()).json({
        detail: Array.isArray(detail) ? 'Validation failed' : detail,
        code: Array.isArray(detail) ? 'validation_error' : 'http_error',
        ...(Array.isArray(detail) ? { errors: detail } : {}),
      });
    }

    if (exception instanceof TimeoutError) {
      return response.status(504).json({ detail: 'Service timeout', code: 'service_timeout' });
    }

    if (exception instanceof RpcException) {
      const error = exception.getError();
      if (typeof error === 'object' && error !== null && 'status' in error) {
        const { status, code, message, errors } = error as RpcErrorBody;
        const httpStatus = Number.isInteger(status) ? (status as number) : 500;
        return response.status(httpStatus).json({
          detail: message ?? 'Internal server error',
          code: code ?? 'internal_error',
          ...(errors ? { errors } : {}),
        });
      }
    }

    this.logger.error(exception);
    return response.status(500).json({ detail: 'Internal server error', code: 'internal_error' });
  }
}
```

- When the NATS server or a service is unreachable, the error arrives as an `Empty response` / connection message (not an `RpcException` with `status`). The fallback maps it to 500; if it matters, map to 503 and add a branch (verify the real error text first).
- Register with `app.useGlobalFilters(new RpcExceptionFilter())` in `main.ts`.

---

## Database Access (Prisma, per microservice)

### Project status

Prisma is NOT installed. Conventions below assume **Prisma ORM 7** (stable). Prisma 8 is published as a release candidate with a different client API (`db.orm...`, `db migrate`); do NOT adopt it without asking. Check the installed version before copying any snippet: `pnpm list prisma @prisma/client`.

### Install (ask first), inside each data-owning service

```bash
cd backend/auth
pnpm add @prisma/client @prisma/adapter-pg pg dotenv
pnpm add -D prisma
pnpm exec prisma init --datasource-provider postgresql --output ../src/generated/prisma
```

### Files (all to create)

```prisma
// auth/prisma/schema.prisma
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
// auth/prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

Notes verified against Prisma docs:

- In Prisma 7 the connection URL lives in `prisma.config.ts`, NOT in `schema.prisma`; the generator is `prisma-client` with an explicit `output`; the client needs a driver adapter (`@prisma/adapter-pg`).
- The generated client is source code inside `src/generated/prisma/`: add it to `.gitignore` and run `pnpm exec prisma generate` in dev setup, CI and in the Dockerfile before `nest build`.
- `moduleFormat = "cjs"` avoids `exports is not defined in ES module scope` when Nest (CommonJS) loads the client. If the app ever moves to ESM, revisit.
- `uuid(7)` is supported in recent Prisma versions; verify with the installed version, otherwise use `uuid()`.
- Table/column names: Prisma models are PascalCase singular; map them to plural snake_case with `@@map` / `@map` so raw SQL and `teamworkflow-postgres` queries stay readable.

### PrismaService

```typescript
// auth/src/prisma/prisma.service.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { envs } from '../config/envs';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: new PrismaPg({ connectionString: envs.databaseUrl }) });
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

```typescript
// auth/src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

- ONE `PrismaService` per microservice, importing ITS OWN generated client. Never share a client or a schema between services.
- `PrismaModule` is imported once in `AppModule`. `@Global()` is acceptable here because every domain needs it.
- Slow query logging: see teamworkflow-postgres ("Query logging").

### Data access: service or repository?

- Small domain: the service uses `this.prisma.<model>` directly (Prisma is already a typed query builder).
- Introduce `<domain>.repository.ts` when queries are reused by 2+ use cases, filters grow, or you want to mock data access in tests without mocking Prisma's shape.

```typescript
// teams/src/teams/teams.repository.ts (example, to create)
@Injectable()
export class TeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.team.findUnique({ where: { id } });
  }

  async list(params: { skip: number; take: number; search?: string }) {
    const where: Prisma.TeamWhereInput = params.search
      ? { name: { contains: params.search, mode: 'insensitive' } }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // deterministic order
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.team.count({ where }),
    ]);
    return { items, total };
  }
}
```

Rules:

- Repositories only build and run queries: no business rules, no throwing HTTP/domain errors beyond translating Prisma errors.
- Use `select` / `include` explicitly. No N+1: fetch relations with `include` or one `findMany` with `where: { id: { in: ids } }`, never a query per row in a loop.
- Always a deterministic `orderBy` (with a unique tiebreaker such as `id`) for paginated queries.
- When adding or changing filters or ordering, check that an index serves them (teamworkflow-postgres).
- Raw SQL: only tagged templates (`` this.prisma.$queryRaw`SELECT ... WHERE id = ${id}` ``), which bind parameters. NEVER `$queryRawUnsafe` / `$executeRawUnsafe` with interpolated user input.
- Mapping Prisma results to response DTOs happens in the service (or a small mapper function), never in the controller.

### Transactions

```typescript
// Batch of independent writes (all or nothing)
await this.prisma.$transaction([
  this.prisma.team.create({ data }),
  this.prisma.auditLog.create({ data: logData }),
]);

// Interactive: later steps depend on earlier results
const result = await this.prisma.$transaction(async (tx) => {
  const team = await tx.team.create({ data: { name: dto.name } });
  await tx.membership.create({ data: { teamId: team.id, userId: dto.ownerId, role: 'OWNER' } });
  return team;
});
```

- Inside the callback use ONLY `tx`, never `this.prisma`, or the work escapes the transaction.
- Keep interactive transactions short; no NATS calls (`client.send`) or other network I/O inside them.
- Transactions cannot span services or databases. For cross-service workflows use idempotent steps and compensations, and ask the user before designing a saga.
- Unique-constraint races are resolved by the database: catch `P2002` instead of "check then insert".

### Prisma errors

```typescript
import { Prisma } from '../generated/prisma/client';

try {
  return await this.prisma.user.create({ data });
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') throw new ConflictRpcException('email_taken', 'Email already registered'); // unique violation
    if (error.code === 'P2025') throw new NotFoundRpcException('user_not_found', 'User not found'); // record not found on update/delete
    if (error.code === 'P2003') throw new ConflictRpcException('invalid_reference', 'Referenced resource does not exist'); // FK violation
  }
  throw error; // unknown errors are logged by the filter and become 500
}
```

- `findUnique` returns `null` when missing: check and throw the not-found domain error. `findUniqueOrThrow`, `update` and `delete` throw `P2025`.
- Import `Prisma` from the app's own generated client (the `prisma-client` generator), not from `@prisma/client`.

---

## Pagination & Filters

```typescript
// gateway/src/common/dto/pagination.dto.ts (to create)
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
// gateway/src/common/dto/page.dto.ts (to create)
export class PageDto<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

```typescript
// gateway/src/teams/dto/team-filters.dto.ts (to create)
export class TeamFiltersDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
```

- Every collection endpoint is paginated and returns `PageDto<T>` (`items`, `total`, `page`, `pageSize`). Never return unbounded lists.
- The microservice receives `{ page, pageSize, ...filters }` (or `skip`/`take`) and returns `{ items, total }`; the gateway builds the `PageDto`.
- `page` / `pageSize` mirror the frontend's pagination schema (teamworkflow-zod).
- `skip` + `count` are fine while tables are small. For deep pages see teamworkflow-postgres ("Pagination Cost") before changing the API.

---

## Security

| Concern | Rule |
|---------|------|
| Mass assignment | DTOs with `whitelist` + `forbidNonWhitelisted`; never spread a raw body into `data` |
| Input validation | class-validator constraints at the gateway AND in the service (NATS is a trust boundary too); business validation in services |
| Object-level access | Services check ownership; return 404 when not allowed (once auth exists) |
| SQL injection | Prisma queries / tagged `$queryRaw` only; never `Unsafe` variants with user input |
| Secrets | Only via `envs`; never committed, never logged, never in responses or error messages |
| Info disclosure | Generic error messages; no stack traces; Prisma errors translated |
| Passwords | Hash with argon2 or bcrypt (ask before installing); never store or log plain text |
| NATS | Only the gateway is exposed publicly. Do not publish `4222`/`8222` beyond local development; use credentials/TLS when deployed (ask) |
| CORS | Enable explicitly in the gateway (`app.enableCors({ origin: [...] })`) only for known frontend origins |

### Auth (NOT IMPLEMENTED YET)

When auth is designed: login/refresh in the `auth` service, a JWT guard in the gateway (`@UseGuards`), a `@CurrentUser()` decorator, and the user id forwarded to services in the payload. Until then do not invent auth; mark `// TODO(auth):`.

---

## Naming Conventions

| Entity | Pattern | Example |
|--------|---------|---------|
| Folder / file | kebab-case, Nest style | `teams/teams.service.ts` |
| Module / Controller / Service | `<Domain>Module` / `Controller` / `Service` | `TeamsService` |
| Repository | `<Domain>Repository` | `TeamsRepository` |
| DTO | `Create<Model>Dto`, `Update<Model>Dto`, `<Model>ResponseDto`, `<Model>FiltersDto` | `CreateTeamDto` |
| Prisma model | singular PascalCase, `@@map` plural snake_case | `Team` -> `teams` |
| Prisma field | camelCase, `@map` snake_case | `createdAt` -> `created_at` |
| Domain exception | `<Problem>Exception` extending an `Rpc` base | `TeamNotFoundException` |
| Error code | snake_case | `team_not_found` |
| NATS pattern | `<service>.<resource>.<action>` | `teams.members.add` |
| Pattern constant | `<SERVICE>_PATTERNS.<ACTION>` | `AUTH_PATTERNS.LOGIN` |
| DI token | UPPER_SNAKE string in `config/services.ts` | `NATS_SERVICE` |
| URL prefix | plural kebab-case under `/api` | `/api/vehicle-models` |
| Explicit index | `<Model>_<fields>_idx` (Prisma default) or `map: "ix_<table>_<columns>"` | see teamworkflow-postgres |

---

## Testing

### Setup

Tests run with the existing scripts (`pnpm test`, `pnpm test:cov`, `pnpm test:e2e`), which launch Jest 30 with `--experimental-vm-modules`. Specs sit next to the code (`*.spec.ts`, as in `auth.controller.spec.ts` / `auth.service.spec.ts`); e2e specs go in `test/` with `jest-e2e.json`.

### Gateway controller: mock `ClientProxy`

```typescript
// gateway/src/auth/auth.controller.spec.ts
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { NATS_SERVICE } from '../config';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let controller: AuthController;
  const client = { send: jest.fn(), emit: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: NATS_SERVICE, useValue: client }],
    }).compile();
    controller = moduleRef.get(AuthController);
  });

  it('login forwards the DTO to auth.login and returns the reply', async () => {
    client.send.mockReturnValue(of({ id: 'u1' }));

    await expect(controller.login({ email: 'a@b.com', password: 'secret123' })).resolves.toEqual({ id: 'u1' });
    expect(client.send).toHaveBeenCalledWith('auth.login', { email: 'a@b.com', password: 'secret123' });
  });

  it('login rethrows microservice errors as RpcException', async () => {
    client.send.mockReturnValue(throwError(() => ({ status: 401, code: 'invalid_credentials' })));

    await expect(controller.login({ email: 'a@b.com', password: 'x' })).rejects.toBeInstanceOf(RpcException);
  });
});
```

### Microservice service: mock `PrismaService`

```typescript
// auth/src/auth/auth.service.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { InvalidCredentialsException } from './auth.exceptions';

describe('AuthService', () => {
  let service: AuthService;
  const prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [AuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('login throws InvalidCredentialsException when the user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login({ email: 'a@b.com', password: 'x' })).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  });
});
```

- Unit tests mock the boundary: `ClientProxy` in the gateway, `PrismaService` (or the repository) in services. Never hit NATS or a real DB in unit tests.
- A `PrismaService` extends a generated client that needs `DATABASE_URL`; always provide a fake with `useValue`, never import the real class's constructor path in unit tests that instantiate it.
- Microservice controller tests: instantiate the controller with a mocked service and assert delegation and payload.
- Validation tests: use `ValidationPipe.transform(payload, { type: 'body', metatype: Dto })` or `class-validator`'s `validate` to assert rejected inputs.

### E2E with supertest (gateway)

```typescript
// gateway/test/auth.e2e-spec.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { NATS_SERVICE } from '../src/config';
import { RpcExceptionFilter } from '../src/common/filters/rpc-exception.filter';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const client = { send: jest.fn(), connect: jest.fn(), close: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NATS_SERVICE)
      .useValue(client)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, errorHttpStatusCode: 422 }));
    app.useGlobalFilters(new RpcExceptionFilter());
    await app.init();
  });

  afterAll(() => app.close());

  it('POST /api/auth/login returns 422 for an invalid body', () =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email: 'not-an-email' }).expect(422));

  it('POST /api/auth/login returns the service reply', async () => {
    client.send.mockReturnValue(of({ id: 'u1' }));
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'secret123' })
      .expect(200)
      .expect({ id: 'u1' });
  });
});
```

- Gateway e2e overrides the NATS client (no broker needed); the global prefix, pipe and filter MUST be applied in the test the same way as in `main.ts`, so extract a shared `configureApp(app)` function when the setup grows (to create).
- Microservice e2e against a real database: use a dedicated TEST database (`DATABASE_URL` pointing to e.g. `teamworkflow_auth_test`), migrated with `prisma migrate deploy`, and clean tables between tests. NEVER run tests against development or production data.
- Name tests by behavior: `<action> <expected> when <condition>`.
- Lint and format before finishing: `pnpm lint`, `pnpm format`.

---

## Commands

```bash
cd backend/<app>          # gateway | auth | <future service>

pnpm install
pnpm start:dev            # nest start --watch
pnpm build
pnpm lint                 # oxlint --type-aware
pnpm format               # prettier
pnpm test                 # unit
pnpm test:cov
pnpm test:e2e

# Whole stack (from backend/)
docker compose up --build

# Prisma (only in services with a schema, after installing Prisma)
pnpm exec prisma generate
pnpm exec prisma migrate dev --name <name>      # see teamworkflow-prisma-migrations
```

If Context7 MCP is available, query it for up-to-date NestJS, Prisma and class-validator docs before using unfamiliar APIs (resolve the library id first). Adapt paths to the real files found when mapping the project.

---

## Checklist

- [ ] Existing structure mapped; no silent restructuring; uninstalled deps asked about first
- [ ] Gateway has no business logic or DB access; microservice owns its data
- [ ] Code placed per "Decision Trees"; layers respected (controller -> service -> repository -> Prisma)
- [ ] Message pattern changed in BOTH the gateway and the service; constants used, no literals
- [ ] Gateway `client.send` wrapped with `firstValueFrom`, `timeout` and `catchError -> RpcException`
- [ ] DTO classes with validators on every property; `whitelist` + `forbidNonWhitelisted`; no `any` payloads
- [ ] Services throw `RpcException`-based domain errors; no `HttpException` in microservices
- [ ] Gateway filter maps errors to `{ detail, code }` with the right status
- [ ] Prisma errors translated (`P2002`, `P2025`, `P2003`); no raw Prisma messages leaked
- [ ] Own `PrismaService` and own Prisma schema per microservice; no cross-service DB access
- [ ] No N+1; explicit `select`/`include`; deterministic `orderBy` on paginated queries
- [ ] Transactions use `tx` inside the callback and contain no network calls
- [ ] Collections paginated with `PageDto` (`page`, `pageSize`, `total`, `items`)
- [ ] Schema changes have a reviewed migration (teamworkflow-prisma-migrations); indexes designed from queries (teamworkflow-postgres)
- [ ] Config via each app's `envs.ts` (joi); `.env.example` and docker-compose updated; no secrets in code, logs or responses
- [ ] Unit tests with mocked `ClientProxy` / `PrismaService`; e2e with supertest; DB tests only on the TEST database
- [ ] `pnpm lint` and `pnpm format` pass
- [ ] Frontend contract kept: camelCase, `null` optionals, ISO dates (update frontend types / Zod if the contract changed: teamworkflow-typescript, teamworkflow-zod)
