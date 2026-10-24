---
name: teamworkflow-typescript
description: >
  TypeScript strict patterns for the TeamWorkFlow frontend.
  Trigger: When writing or refactoring TypeScript in frontend/ (.ts/.tsx): types mirroring NestJS backend
  DTOs, const values + derived types, unions, generics, type guards, removing any, tightening unknown,
  discriminated unions and exhaustiveness.
  Placement and no-duplication rules come from teamworkflow-frontend (source of truth).
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "2.0"
  scope: [root, frontend]
  auto_invoke: "Writing TypeScript types/interfaces"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# TeamWorkFlow – TypeScript

## Project Status (READ FIRST)

The frontend is a fresh Next.js scaffold. Most domain types and helpers in this skill **do not exist yet**.

- Before importing a type or helper, check it exists (Glob/Grep). If not, create it where teamworkflow-frontend says.
- Before creating a type, search for an existing one. Derive from it instead of redefining (see "Derive, Don't Redefine").
- Check `frontend/tsconfig.json` once:
  - `"strict": true` MUST be enabled (Next.js scaffold default). If not, tell the user.
  - Recommended (ask before enabling, it may surface many errors): `"noUncheckedIndexedAccess": true`.

---

## Critical Rules

- NEVER `any`. Use `unknown` + narrowing, generics, or Zod.
- NEVER `enum`. Use `as const` values + derived union types.
- NEVER `as` to silence a type error. Allowed only at typed boundaries (e.g. `backendFetch<T>`) and `as const`.
- NEVER `@ts-ignore`. If unavoidable, use `@ts-expect-error` with a comment explaining why.
- NEVER non-null assertions (`value!`) without a comment justifying why the value cannot be null.
- `type` by default. `interface` only for declaration merging / module augmentation.
- Types for backend data mirror the NestJS backend response DTOs (`core` and `telemetry`) exactly (names, nullability, nesting).
- Untrusted external data is validated with Zod, not hand-written guards.
- `import type` for type-only imports.
- Every union handled in a `switch` or map must be exhaustive.

---

## Where Types Go

| What | Location |
|------|----------|
| Backend data types (mirror backend DTOs) | `domains/<domain>/types.ts` |
| Runtime values for backend enums (`as const` arrays) | `domains/<domain>/types.ts`, next to their type |
| Input types from Zod | `domains/<domain>/schemas.ts` via `z.infer` |
| Component props | Inline or local `type Props` in the component file |
| Agnostic generic types | `shared/lib/types.ts` (create when needed) |
| Agnostic type helpers (`assertNever`) | `shared/lib/assert-never.ts` (create when needed) |

Types used outside the domain are exported through the domain's `index.ts` (`export type { … }`).

---

## Mirroring Backend DTOs (REQUIRED)

Before writing a domain type, Grep `backend/core/src/<module>/dto/` (or `backend/telemetry/src/<module>/dto/`) for the response DTO and mirror it (see teamworkflow-nest). If it does not exist yet, agree the contract first; never invent fields.

| NestJS / Prisma (JSON) | TypeScript |
|------------------------|------------|
| `string` | `string` |
| `number`, `Decimal` | `number` (Decimal serializes as `string`; check the API response) |
| `boolean` | `boolean` |
| `Date` (ISO-8601), uuid | `string` (JSON has no Date type) |
| optional DTO field (`@IsOptional()`) | `X \| null` (the backend sends `null`, the key is present) |
| `X[]` | `X[]` |
| string-literal union / enum | union derived from an `as const` array |
| Nested object DTO | Separate named type |

```ts
// frontend/domains/projects/types.ts
export const PROJECT_STATUSES = ["pending", "accepted", "rejected"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type ProjectTeam = {
  id: string;
  name: string;
};

export type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  team: ProjectTeam;              // nested DTO → named type
  description: string | null;     // optional field in the DTO
  createdAt: string;              // datetime → ISO string
};
```

```ts
// ❌ NEVER
type Project = {
  description?: string;           // wrong: backend sends null, not a missing key
  createdAt: Date;                // wrong: JSON delivers a string
  team: { id: string; name: string }; // inline domain model
};
```

- Keep field names exactly as the API returns them (camelCase from the backend).
- Convert dates to `Date` only at the point of use (formatting), never in the domain type.
- If a DTO serializes with `@Exclude()` / `@Expose()` or an interceptor that strips `null`, fields can be absent: then use `field?: X`. Check the DTO and interceptors.

---

## Const Values + Derived Types

Use a union type directly when only the type is needed. When the values are also needed at runtime (iteration, select options, Zod), define an `as const` array ONCE and derive the type from it.

```ts
// ✅ Type-only: a plain union is fine
type SortDirection = "asc" | "desc";

// ✅ Runtime values needed: as const array is the single source
export const PROJECT_STATUSES = ["pending", "accepted", "rejected"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// ✅ Reuse the same values everywhere
const projectStatusSchema = z.enum(PROJECT_STATUSES);
PROJECT_STATUSES.map((status) => <option key={status} value={status}>{projectStatusLabel(status)}</option>);

// ❌ NEVER: values and type defined separately (they drift)
type ProjectStatus = "pending" | "accepted" | "rejected";
const STATUS_OPTIONS = ["pending", "accepted", "rejected"];

// ❌ NEVER: TypeScript enums
enum ProjectStatus { Pending = "pending" }
```

Use an `as const` object instead of an array only when you need named keys for the values:

```ts
export const PROJECT_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
} as const;

export type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];
```

### `satisfies` for typed constants

`satisfies` checks a value against a type without widening it:

```ts
export const PROJECT_STATUS_LABELS = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
} as const satisfies Record<ProjectStatus, string>;
```

---

## `type` vs `interface`

Use `type` by default: it handles unions, intersections and `ComponentProps<…> & {…}` uniformly.

```ts
// ✅
type Admin = User & { permissions: string[] };
type ButtonProps = ComponentProps<"button"> & { loading: boolean };

// ✅ interface only for declaration merging / module augmentation
declare module "some-lib" {
  interface Config {
    autoprojectMode: boolean;
  }
}
```

---

## Flat Domain Types

Domain models (backend data, store state) keep one level of nesting. Nested objects get their own named type, mirroring nested DTOs.

Local, one-off shapes are allowed inline: component props, function options, Next.js `params`.

```ts
// ✅ Domain model: nested object → named type
type ProjectTeam = { id: string; name: string };
type Project = { id: string; team: ProjectTeam };

// ✅ Local one-off shape inline
type Props = { params: Promise<{ id: string }> };
export function TeamBadge({ team }: { team: ProjectTeam }) { /* … */ }

// ❌ Domain model with inline nested object
type Project = { id: string; team: { id: string; name: string } };
```

---

## Derive, Don't Redefine (REQUIRED)

Every type has one source. Everything else is derived from it.

```ts
import type { Project } from "./types";

type ProjectSummary = Pick<Project, "id" | "status">;
type ProjectStatusValue = Project["status"];
type ProjectWithoutTask = Omit<Project, "task">;
type CreateProjectValues = z.infer<typeof createProjectSchema>;
type ProjectsResult = Awaited<ReturnType<typeof getProjects>>;
type SubmitProjectParams = Parameters<typeof submitProject>;
```

Useful utility types: `Pick`, `Omit`, `Partial`, `Required`, `Readonly`, `Extract`, `Exclude`, `NonNullable`, `ReturnType`, `Awaited`, `Parameters`, indexed access (`T["key"]`, `T[number]`).

> `Record<string, X>` only for genuinely open-ended keys. When keys are known, use `Record<KnownUnion, X>` (see teamworkflow-frontend, "Strict key typing").

---

## No `any` — Use `unknown`, Generics or Zod

```ts
// ✅ Generics for flexible but typed functions
function first<T>(items: readonly T[]): T | undefined {
  return items[0];
}

// ✅ unknown + Zod for untrusted data
import { z } from "zod";

const webhookPayloadSchema = z.object({
  event: z.enum(["project.created", "project.updated"]),
  projectId: z.uuid(),
});

export function parseWebhookPayload(input: unknown) {
  return webhookPayloadSchema.safeParse(input);
}

// ✅ unknown in catch blocks
try {
  await createProject(input);
} catch (error: unknown) {
  if (error instanceof BackendError && error.status === 409) {
    return { success: false, message: "Project already exists" };
  }
  throw error;
}

// ❌ NEVER
function parse(input: any): any {}
const data = JSON.parse(raw) as Project;   // unvalidated cast of untrusted data
```

Validate with Zod at every untrusted boundary: webhooks, `JSON.parse`, `localStorage`, `searchParams`, `FormData`, third-party responses.
Responses from our own NestJS backend are typed at the single boundary `backendFetch<T>` (see teamworkflow-nextjs).

---

## Type Guards & Narrowing

Use hand-written guards for narrowing values you already typed (unions, discriminants), not for validating external data.

```ts
// ✅ Discriminant narrowing
type Result =
  | { success: true; data: Project }
  | { success: false; message: string };

function handle(result: Result) {
  if (result.success) {
    return result.data;      // Project
  }
  return result.message;     // string
}

// ✅ Guard on a known union
function isFinalStatus(status: ProjectStatus): status is "accepted" | "rejected" {
  return status === "accepted" || status === "rejected";
}

// ✅ Filtering nulls with a typed predicate
const descriptions = projects
  .map((project) => project.description)
  .filter((d): d is string => d !== null);

// ❌ Weak structural guard for external data — use Zod instead
function isUser(value: unknown): value is User {
  return typeof value === "object" && value !== null && "id" in value;
}
```

---

## Exhaustiveness (REQUIRED)

When branching on a union, make the compiler fail if a new member is added and not handled.

```ts
// frontend/shared/lib/assert-never.ts — create when first needed
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
```

```ts
import { assertNever } from "@/shared/lib/assert-never";

function statusIcon(status: ProjectStatus) {
  switch (status) {
    case "pending":
      return "clock";
    case "accepted":
      return "check";
    case "rejected":
      return "x";
    default:
      return assertNever(status); // compile error if a status is missing
  }
}
```

For lookups, `satisfies Record<Union, X>` gives the same guarantee without a switch.

---

## Coupled Props: Discriminated Unions (REQUIRED)

If two or more props are only meaningful together, they belong to the same branch of a discriminated union. Never model them as independent optionals.

```ts
// ❌ Independent optionals — half-states compile
type PaginationProps = {
  onPageChange?: (page: number) => void;
  pageSize?: number;
  currentPage?: number;
};

// ✅ All-or-nothing per branch
type ControlledPagination = {
  controlled: true;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
};

type UncontrolledPagination = {
  controlled: false;
  currentPage?: never;
  pageSize?: never;
  onPageChange?: never;
};

type PaginationProps = ControlledPagination | UncontrolledPagination;
```

Component-level examples (batch vs instant filters): see teamworkflow-frontend.

---

## Functions

- Type parameters always. Return types are inferred for local functions; annotate exported functions when the inferred type is complex or part of a public API (`Promise<ProjectFormState>`).
- Prefer `readonly T[]` for array parameters you don't mutate.
- Use an options object for 3+ parameters or any boolean flag:

```ts
// ✅
function searchTasks(options: { title?: string; maxHours?: number; onlyOpen: boolean }) {}

// ❌ Boolean trap
function searchTasks(title: string, maxHours: number, onlyOpen: boolean) {}
```

---

## Naming

- Types: `PascalCase`, no prefixes (`Project`, not `IProject` or `TProject`).
- Generics: single uppercase letter or descriptive `TItem`, `TValue`.
- `as const` value arrays: `UPPER_SNAKE_CASE` plural (`PROJECT_STATUSES`).
- Props types: `Props` when local to one component file; `<Component>Props` when exported.

---

## Imports

```ts
import type { Project } from "./types";
import { createProject, type CreateProjectInput } from "./api";
```

```ts
// ❌ Value import of something only used as a type
import { Project } from "./types";
```

---

## Checklist

- [ ] `strict` enabled in `tsconfig.json`
- [ ] No `any`, no `enum`, no `@ts-ignore`
- [ ] No `as` casts except `as const` and typed boundaries; no unjustified `!`
- [ ] Domain types mirror backend DTOs: `X | null` for Optional, `string` for dates/UUIDs
- [ ] Runtime values as `as const` arrays with derived types (single source)
- [ ] Types derived (`Pick`, `Omit`, `z.infer`, indexed access), not redefined
- [ ] Untrusted data validated with Zod
- [ ] Unions handled exhaustively (`assertNever` or `satisfies Record<Union, …>`)
- [ ] Coupled props modeled as discriminated unions
- [ ] Known-key maps use `Record<Union, X>`, not `Record<string, X>`
- [ ] `type` by default; `import type` for types