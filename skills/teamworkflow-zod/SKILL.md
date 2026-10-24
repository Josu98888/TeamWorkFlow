---
name: teamworkflow-zod
description: >
  Zod 4 validation patterns for TeamWorkFlow: Server Action input (FormData), React Hook Form,
  searchParams, webhooks and other untrusted data, error formatting, and v3 → v4 syntax changes.
  Trigger: When creating or editing Zod schemas, validating input in Server Actions, Route Handlers
  or forms, parsing searchParams, or migrating Zod 3 syntax.
  Placement comes from teamworkflow-frontend; type rules from teamworkflow-typescript.
license: Apache-2.0
metadata:
  author: teamworkflow-team
  version: "2.0"
  scope: [root, frontend]
  auto_invoke: "Creating Zod schemas"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, WebFetch, WebSearch, Task
---

# TeamWorkFlow – Zod 4

## Project Status (READ FIRST)

The frontend is a fresh Next.js scaffold. Schemas in this skill **do not exist yet**.

- Check `frontend/package.json` for `zod`:
  - Missing → it is a foundation dependency (see teamworkflow-nextjs). Ask before installing.
  - `zod` 4.x → `import { z } from "zod"`.
  - `zod` 3.25.x → v4 API is available at `import { z } from "zod/v4"`. Tell the user and prefer upgrading to 4.x.
  - `zod` < 3.25 → this skill does not apply; tell the user.
- Before creating a schema, search for an existing one in `domains/<domain>/schemas.ts` and `shared/lib/schemas.ts`.

---

## Critical Rules

- Schemas live in `domains/<domain>/schemas.ts` (agnostic ones in `shared/lib/schemas.ts`). NEVER in `actions.ts` (`"use server"` files export only async functions) or inside components.
- The SAME schema validates on client and server. Never write two versions.
- Server Actions and Route Handlers ALWAYS use `safeParse` and return errors. NEVER `parse` (it throws).
- Zod constraints mirror the backend DTO constraints (class-validator). The backend `ValidationPipe` (in `core` and `telemetry`) remains the final authority and answers `422` with `{ detail, code, errors }` (teamworkflow-nest).
- Enum values come from `as const` arrays in `types.ts` (`z.enum(PROJECT_STATUSES)`), never repeated inline.
- Schemas validate INPUT. Backend response types live in `types.ts` (teamworkflow-typescript), not in `z.infer`.
- Use Zod 4 syntax only (see "v3 → v4 Changes").
- NEVER name an inferred type `FormData`.

---

## Where Schemas Go

| What | Location |
|------|----------|
| Domain input schemas (create/update forms) | `domains/<domain>/schemas.ts` |
| Agnostic reusable schemas (pagination, id param) | `shared/lib/schemas.ts` (create when needed) |
| Webhook payload schemas | `shared/lib/webhooks.ts` or the domain that owns the event |
| Input types | `z.infer` / `z.input` / `z.output` next to the schema |

Export schemas used outside the domain through `index.ts` (schemas are client-safe).

---

## Mirroring DTO Constraints

Before writing a schema, Grep `backend/core/src/<module>/dto/` (or `backend/telemetry/src/<module>/dto/`; until T6 `backend/gateway/src/<domain>/` and `backend/auth/src/`) for the request DTO (class-validator decorators) and copy its constraints. If the DTO does not exist yet, agree the contract with the backend first (teamworkflow-nest).

| class-validator | Zod 4 |
|-----------------|-------|
| `@IsString()` | `z.string()` |
| `@IsNotEmpty()` / `@MinLength(1)` | `z.string().trim().min(1)` |
| `@MaxLength(100)` | `.max(100)` |
| `@IsEmail()` | `z.email()` |
| `@IsUUID()` | `z.uuid()` (use `z.guid()` if IDs aren't RFC-compliant UUIDs) |
| `@IsUrl()` | `z.url()` |
| `@IsInt()` + `@Min(0)` | `z.number().int().min(0)` |
| `@IsNumberString()` / decimal as string | `z.string()` + regex, or `z.number()` — match what the API expects |
| `@IsEnum(...)` / `@IsIn([...])` | `z.enum(VALUES)` from `types.ts` |
| `@IsOptional()` | `.nullable()` or `.optional()` — match what the API accepts |
| `@IsISO8601()` / `@IsDateString()` | `z.iso.datetime()` / `z.iso.date()` |

Keep field names identical to the request DTO (camelCase).

```ts
// frontend/domains/projects/schemas.ts
import { z } from "zod";
import { PROJECT_STATUSES } from "./types";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, { error: "Project name is required" }).max(100),
  description: z.string().trim().max(500).optional(),
  teamId: z.uuid({ error: "Select a team" }),
});

export const updateProjectStatusSchema = z.object({
  status: z.enum(PROJECT_STATUSES),
});

export type CreateProjectValues = z.infer<typeof createProjectSchema>;
```

---

## Validating FormData (Server Actions)

`FormData` values are always `string`, `File`, or absent. Schemas for native forms must account for this.

```ts
// frontend/domains/tasks/schemas.ts
import { z } from "zod";
import { TASK_PRIORITIES } from "./types";

// Required number from a text input: "" must fail, not become 0
const requiredNumber = (label: string) =>
  z.string({ error: `${label} is required` })
    .trim()
    .min(1, { error: `${label} is required` })
    .pipe(z.coerce.number({ error: `${label} must be a number` }));

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, { error: "Title is required" }).max(100),
  description: z.string().trim().min(1, { error: "Description is required" }).max(100),
  estimateHours: requiredNumber("Estimate").pipe(z.number().int().min(0).max(1000)),
  priority: z.enum(TASK_PRIORITIES, { error: "Select a priority" }),
  isArchived: z.stringbool().default(false), // checkbox: "on" or absent
});
```

```ts
// In the Server Action (see teamworkflow-nextjs for the full pattern)
const parsed = taskFormSchema.safeParse(Object.fromEntries(formData));
```

Gotchas:

- ❌ `z.coerce.number()` alone turns `""` into `0`. Validate the string first, then `.pipe()` into the number.
- ❌ `z.boolean()` fails for checkboxes. Use `z.stringbool()` (`"on"`, `"true"`, `"1"`, `"yes"` → `true`).
- ❌ `Object.fromEntries(formData)` keeps only the LAST value of repeated keys. For multi-select / checkbox groups, read them explicitly:

```ts
const parsed = schema.safeParse({
  ...Object.fromEntries(formData),
  tags: formData.getAll("tags"),
});
```

- Optional text inputs arrive as `""`, not absent. If the backend expects `null` for empty values, transform:

```ts
const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));
```

---

## Validating Objects (React Hook Form / object-input actions)

React Hook Form sends typed values, so coercion is usually unnecessary. Full pattern in teamworkflow-frontend ("Forms").

When the schema has `coerce`, `transform`, `pipe` or `default`, input and output types differ. Type the form with both:

```ts
type TaskFormInput = z.input<typeof taskFormSchema>;
type TaskFormOutput = z.output<typeof taskFormSchema>;

const form = useForm<TaskFormInput, unknown, TaskFormOutput>({
  resolver: zodResolver(taskFormSchema),
});
```

Object-input Server Actions receive `unknown` and still validate with the same schema:

```ts
export async function createTask(input: unknown) {
  const parsed = taskSchema.safeParse(input);
  // …
}
```

---

## Validating `searchParams`

Never trust URL params. Parse them in the page with fallbacks instead of erroring:

```ts
// frontend/shared/lib/schemas.ts
import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
});
```

```tsx
// frontend/app/(teamworkflow)/projects/page.tsx
import { paginationSchema } from "@/shared/lib/schemas";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: Props) {
  const { page, pageSize } = paginationSchema.parse(await searchParams); // .catch() makes parse safe here
  // …
}
```

> `.catch(value)` returns the fallback on invalid input, so `.parse` cannot throw for these fields. This is the ONLY case where `parse` is acceptable.

---

## Untrusted External Data

Webhooks, `JSON.parse`, `localStorage`, third-party APIs: validate with `safeParse` before use. Never cast.

```ts
const webhookPayloadSchema = z.object({
  event: z.enum(["project.created", "project.updated"]),
  projectId: z.uuid(),
  occurredAt: z.iso.datetime(),
});

const parsed = webhookPayloadSchema.safeParse(JSON.parse(rawBody));
if (!parsed.success) {
  return Response.json({ error: "Invalid payload" }, { status: 400 });
}
```

```ts
// ❌ NEVER
const payload = JSON.parse(rawBody) as WebhookPayload;
```

`z.object` strips unknown keys by default (safe for forwarding to the backend). Use `z.strictObject` to reject unknown keys, `z.looseObject` to keep them.

---

## Error Messages

Use the `error` param (Zod 4). Messages are user-facing: short, clear, in the app's UI language.

```ts
z.string().min(1, { error: "Name is required" });
z.email({ error: "Invalid email" });

// Different message for missing vs wrong type
z.string({
  error: (issue) => (issue.input === undefined ? "Required" : "Must be text"),
});
```

### Formatting errors for the UI

```ts
// Field errors for useActionState (shape used by teamworkflow-nextjs)
const { fieldErrors } = z.flattenError(parsed.error);
// { name?: string[]; description?: string[]; teamId?: string[] }

// Nested structures
const tree = z.treeifyError(parsed.error);

// Raw issues
parsed.error.issues;
```

- NEVER return raw Zod errors or issues to the user as-is. Map to `fieldErrors` + a short message.
- NEVER log full input with sensitive fields (passwords, tokens).

---

## Refinements

```ts
// Cross-field validation: attach the error to the right field with `path`
export const passwordChangeSchema = z
  .object({
    password: z.string().min(8, { error: "At least 8 characters" }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "Passwords don't match",
    path: ["confirmPassword"],
  });
```

```ts
// Several issues at once
schema.superRefine((data, ctx) => {
  if (data.dueDate < data.startDate) {
    ctx.addIssue({
      code: "custom",
      message: "Due date must be after start date",
      path: ["dueDate"],
    });
  }
});
```

- Async refinements (e.g. uniqueness checks) require `safeParseAsync`. Prefer letting the backend enforce uniqueness and mapping its `{ detail, code }` error instead (e.g. `team_name_taken`).

---

## Composition (no duplication)

Build related schemas from one base instead of rewriting fields:

```ts
const taskBaseSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(100),
});

export const createTaskSchema = taskBaseSchema.extend({
  estimateHours: z.number().int().min(0),
});

export const updateTaskSchema = createTaskSchema.partial();

export const taskIdentitySchema = taskBaseSchema.pick({ title: true, description: true });
```

Reusable field helpers (`requiredNumber`, `optionalText`) go in the domain's `schemas.ts`, or `shared/lib/schemas.ts` if agnostic.

---

## v3 → v4 Changes (REQUIRED)

Always use the v4 column.

| Zod 3 (❌) | Zod 4 (✅) |
|------------|-----------|
| `z.string().email()` | `z.email()` |
| `z.string().uuid()` | `z.uuid()` (strict RFC) or `z.guid()` (permissive) |
| `z.string().url()` | `z.url()` |
| `z.string().datetime()` / `.date()` | `z.iso.datetime()` / `z.iso.date()` |
| `z.string().ip()` | `z.ipv4()` / `z.ipv6()` |
| `{ message: "…" }` | `{ error: "…" }` |
| `{ required_error, invalid_type_error }` | `{ error: (issue) => … }` |
| `z.ZodIssueCode.custom` | `code: "custom"` |
| `error.errors` | `error.issues` |
| `error.flatten()` | `z.flattenError(error)` |
| `error.format()` | `z.treeifyError(error)` |
| `.strict()` / `.passthrough()` | `z.strictObject()` / `z.looseObject()` |
| `a.merge(b)` | `a.extend(b.shape)` |
| `z.record(z.number())` | `z.record(z.string(), z.number())` (key schema required) |
| `z.nativeEnum(MyEnum)` | `z.enum(VALUES)` (no TS enums — see teamworkflow-typescript) |
| `.default(x)` with transforms | `.default()` now returns `x` as OUTPUT; use `.prefault(x)` to parse it as input |

---

## Checklist

- [ ] Zod 4 installed and imported correctly (`"zod"`, or `"zod/v4"` on 3.25.x)
- [ ] Schemas in `schemas.ts`, never in `actions.ts` or components
- [ ] Same schema used on client and server
- [ ] Constraints match the backend DTO (class-validator); camelCase field names
- [ ] Enums from `as const` arrays in `types.ts`
- [ ] Server code uses `safeParse` (only `parse` with `.catch()` fallbacks)
- [ ] FormData: numbers via string + `.pipe()`, checkboxes via `z.stringbool()`, multi-values via `getAll`
- [ ] RHF with transforms typed with `z.input` / `z.output`
- [ ] Untrusted data validated, never cast
- [ ] Errors mapped with `z.flattenError`; no raw errors shown to users
- [ ] Related schemas composed (`extend`, `partial`, `pick`), not rewritten
- [ ] No Zod 3 syntax; no inferred type named `FormData`